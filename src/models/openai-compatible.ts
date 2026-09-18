import type {
  ChatRequest,
  ChatResponse,
  FinishReason,
  ModelAdapter,
  ModelMessage,
  ModelPricing,
  ToolCall,
  ToolSchema,
  Usage,
} from "../agent/types.js";
import { updateQuotaFromHeaders } from "./quota-tracker.js";

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
    this.pricing = opts.pricing ?? { inputPerM: 0, outputPerM: 0 };
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
