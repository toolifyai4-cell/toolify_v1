import type {
  ChatRequest,
  ChatResponse,
  FinishReason,
  ModelAdapter,
  ModelEvent,
  ModelMessage,
  ModelPricing,
  ToolCall,
  ToolSchema,
  Usage,
} from "../agent/types.js";
import { updateQuotaFromHeaders } from "./quota-tracker.js";
import {
  ToolCallAccumulator,
  isDoneFrame,
  iterSse,
} from "../providers/streaming.js";

/**
 * Static default pricing table — used when ModelPricing config is not set.
 * These are ESTIMATES that will drift from reality. Marked with isEstimate=true.
 * Update when providers change their pricing.
 */
const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o": { inputPerM: 0.000005, outputPerM: 0.000015, isEstimate: true },
  "gpt-4o-mini": { inputPerM: 0.00000015, outputPerM: 0.0000006, isEstimate: true },
  "gpt-4-turbo": { inputPerM: 0.00001, outputPerM: 0.00003, isEstimate: true },
  "gpt-3.5-turbo": { inputPerM: 0.0000005, outputPerM: 0.0000015, isEstimate: true },
  "claude-3-5-sonnet-20241022": { inputPerM: 0.000003, outputPerM: 0.000015, isEstimate: true },
  "claude-3-opus-20240229": { inputPerM: 0.000015, outputPerM: 0.000075, isEstimate: true },
  "claude-sonnet-4-20250514": { inputPerM: 0.000003, outputPerM: 0.000015, isEstimate: true },
  "gemini-1.5-pro": { inputPerM: 0.00000125, outputPerM: 0.000005, isEstimate: true },
  "gemini-1.5-flash": { inputPerM: 0.000000075, outputPerM: 0.0000003, isEstimate: true },
  "gemini-2.0-flash": { inputPerM: 0.0000001, outputPerM: 0.0000004, isEstimate: true },
  "gemini-2.5-pro": { inputPerM: 0.00000125, outputPerM: 0.000005, isEstimate: true },
  "gemini-2.5-flash": { inputPerM: 0.00000015, outputPerM: 0.0000006, isEstimate: true },
  "deepseek-chat": { inputPerM: 0.00000014, outputPerM: 0.00000028, isEstimate: true },
  "deepseek-reasoner": { inputPerM: 0.00000055, outputPerM: 0.00000219, isEstimate: true },
  "llama-3.3-70b-versatile": { inputPerM: 0.00000059, outputPerM: 0.00000079, isEstimate: true },
  "llama-3.1-8b-instant": { inputPerM: 0.00000005, outputPerM: 0.00000008, isEstimate: true },
  "mixtral-8x7b-32768": { inputPerM: 0.00000027, outputPerM: 0.00000027, isEstimate: true },
  "sonar-pro": { inputPerM: 0.000001, outputPerM: 0.000001, isEstimate: true },
  "sonar": { inputPerM: 0.000001, outputPerM: 0.000001, isEstimate: true },
};

/**
 * OpenAI-compatible adapter (OpenAI, OpenRouter, Ollama, LM Studio, etc.).
 *
 * Uses the /chat/completions endpoint with tools declared via JSON Schema.
 * A single adapter covers every OpenAI-compatible provider, which is how
 * TOOLIFY supports local models (Ollama) with zero API keys.
 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly name: string;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly pricing: ModelPricing;
  readonly providerId: string;

  constructor(opts: {
    baseUrl: string;
    apiKey?: string;
    model: string;
    name?: string;
    pricing?: ModelPricing;
    providerId?: string;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.modelId = opts.model;
    this.name = opts.name ?? "openai-compatible";
    this.apiKey = opts.apiKey;
    // Use explicit pricing if provided, otherwise look up defaults (marked as estimates)
    this.pricing = opts.pricing ?? DEFAULT_MODEL_PRICING[opts.model] ?? { inputPerM: 0, outputPerM: 0 };
    this.providerId = opts.providerId ?? "unknown";
  }
  private readonly apiKey?: string;

  chat(req: ChatRequest): Promise<ChatResponse> {
    return this.request(req);
  }

  private async request(req: ChatRequest): Promise<ChatResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

    const body = {
      model: this.modelId,
      stream: false,
      max_tokens: req.maxOutputTokens ?? 4096,
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map((m) => this.toWireMessage(m)),
      ],
      ...(req.tools.length > 0
        ? { tools: req.tools.map((t) => this.toWireTool(t)) }
        : {}),
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(
        `Provider error ${res.status} from ${this.name} (${this.modelId}): ${errText.slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as OpenAIChatCompletion;
    const choice = data.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error("Provider returned no choices");

    const text =
      typeof message.content === "string" ? message.content : "";
    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map(
      (tc, i) => ({
        id: tc.id || `call_${i}`,
        name: (tc.function?.name ?? "unknown") as ToolCall["name"],
        input: safeParse(tc.function?.arguments),
      }),
    );

    const finishReason: FinishReason =
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "length"
          ? "max_tokens"
          : choice.finish_reason === "stop"
            ? "stop"
            : "error";

    const usage: Usage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };

    // Parse rate-limit / quota headers from the response and persist them.
    if (res.headers && typeof res.headers.forEach === "function") {
      try {
        const headerMap: Record<string, string> = {};
        res.headers.forEach((v: string, k: string) => { headerMap[k] = v; });
        updateQuotaFromHeaders(this.providerId, this.modelId, headerMap);
      } catch { /* quota tracking is best-effort */ }
    }

    return { text, toolCalls, usage, finishReason, providerId: this.providerId };
  }

  private toWireMessage(m: ModelMessage): unknown {
    if (m.toolResults && m.toolResults.length > 0) {
      // Tool results are fed back as individual role:"tool" messages.
      return m.toolResults.map((r) => ({
        role: "tool",
        tool_call_id: r.callId,
        content: r.content,
      }));
    }
    if (m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "tool_call" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  }

  private toWireTool(t: ToolSchema): unknown {
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  /**
   * Stream one turn via SSE.
   *
   * This single implementation covers every OpenAI-compatible provider the
   * CLI routes here (OpenAI, OpenRouter, Groq, DeepSeek, Gemini via Google's
   * OpenAI-compatibility layer, Ollama, LM Studio, vLLM, LiteLLM, and the
   * OmniRoute/UnoRoute gateways) because they all share the
   * `/chat/completions` SSE vocabulary.
   */
  async *stream(req: ChatRequest): AsyncIterable<ModelEvent> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.modelId,
      stream: true,
      max_tokens: req.maxOutputTokens ?? 4096,
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map((m) => this.toWireMessage(m)),
      ],
      ...(req.tools.length > 0
        ? { tools: req.tools.map((t) => this.toWireTool(t)) }
        : {}),
    };
    // Ask for token accounting in the final chunk. Providers that do not know
    // this field ignore it; those that do return usage we would otherwise lose.
    body.stream_options = { include_usage: true };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      yield {
        type: "error",
        error: {
          code: classifyHttpStatus(res.status),
          message: `Provider error ${res.status} from ${this.name} (${this.modelId}): ${errText.slice(0, 500)}`,
        },
      };
      return;
    }

    // Preserve the existing quota-header accounting from the non-stream path.
    if (res.headers && typeof res.headers.forEach === "function") {
      try {
        const headerMap: Record<string, string> = {};
        res.headers.forEach((v: string, k: string) => { headerMap[k] = v; });
        updateQuotaFromHeaders(this.providerId, this.modelId, headerMap);
      } catch { /* quota tracking is best-effort */ }
    }

    if (!res.body) {
      yield {
        type: "error",
        error: { code: "no_body", message: "Provider returned no response body to stream." },
      };
      return;
    }

    // Not every "OpenAI-compatible" endpoint honours `stream: true`. Some
    // gateways, proxies, and test doubles reply with a single JSON completion
    // body instead of SSE. Detect that by content type and fall back to the
    // non-streaming parse, otherwise the turn would silently produce no text
    // and no usage.
    const contentType = res.headers?.get?.("content-type") ?? "";
    if (contentType.includes("application/json") && !contentType.includes("stream")) {
      let data: OpenAIChatCompletion | null = null;
      try {
        data = (await res.json()) as OpenAIChatCompletion;
      } catch {
        data = null;
      }
      if (data) {
        const choice = data.choices?.[0];
        const message = choice?.message;
        const text = typeof message?.content === "string" ? message.content : "";
        if (text) yield { type: "text_delta", text };
        for (const tc of message?.tool_calls ?? []) {
          const call: ToolCall = {
            id: tc.id || `call_${Math.random().toString(36).slice(2, 8)}`,
            name: (tc.function?.name ?? "unknown") as ToolCall["name"],
            input: safeParse(tc.function?.arguments),
          };
          yield { type: "tool_call_start", id: call.id, name: call.name };
          yield { type: "tool_call_complete", call };
        }
        const usage: Usage = {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        };
        yield { type: "usage", usage };
        yield {
          type: "completed",
          finishReason: mapOpenAIFinishReason(choice?.finish_reason ?? "stop"),
        };
        return;
      }
    }

    const acc = new ToolCallAccumulator();
    let finishReason: FinishReason = "stop";
    let usage: Usage | null = null;

    for await (const frame of iterSse(res.body, req.signal)) {
      if (isDoneFrame(frame.data)) break;

      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(frame.data) as OpenAIStreamChunk;
      } catch {
        // A malformed frame must not kill the stream; skip it.
        continue;
      }

      // Usage arrives on its own final chunk (or alongside the last choice).
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
        yield { type: "usage", usage };
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;

      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }
      // DeepSeek and some gateways expose chain-of-thought under a
      // non-standard key; surface it separately from user-visible text.
      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        yield { type: "reasoning_delta", text: reasoning };
      }

      for (const tc of delta?.tool_calls ?? []) {
        const index = tc.index ?? 0;
        const argsFragment = tc.function?.arguments;
        const { id, isNew } = acc.add(index, {
          id: tc.id,
          name: tc.function?.name,
          args: argsFragment,
        });
        if (isNew) {
          yield { type: "tool_call_start", id, name: tc.function?.name ?? "unknown" };
        }
        if (argsFragment) {
          yield { type: "tool_call_delta", id, argumentsDelta: argsFragment };
        }
      }

      if (choice.finish_reason) {
        finishReason = mapOpenAIFinishReason(choice.finish_reason);
      }
    }

    for (const call of acc.finish()) {
      yield { type: "tool_call_complete", call };
    }
    if (usage) yield { type: "usage", usage };
    yield { type: "completed", finishReason };
  }
}

function safeParse(s: string | undefined): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

interface OpenAIChatCompletion {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** One streamed chunk from `/chat/completions` with `stream: true`. */
interface OpenAIStreamChunk {
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      /** Non-standard: DeepSeek and some gateways stream chain-of-thought. */
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** Map OpenAI's `finish_reason` vocabulary onto the agent's. */
function mapOpenAIFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
      return "stop";
    default:
      // `content_filter`, `null`, and anything unrecognised.
      return "error";
  }
}

/** Map an HTTP status onto a stable error code shared across adapters. */
function classifyHttpStatus(status: number): string {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 422) return "bad_request";
  if (status >= 500) return "server";
  return "http_error";
}
