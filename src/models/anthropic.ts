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
import {
  ToolCallAccumulator,
  isDoneFrame,
  iterSse,
} from "../providers/streaming.js";

/**
 * Anthropic native adapter (Messages API).
 */
export class AnthropicAdapter implements ModelAdapter {
  readonly name = "anthropic";
  readonly modelId: string;
  readonly pricing: ModelPricing;
  private readonly apiKey: string;

  constructor(opts: { apiKey: string; model: string; pricing?: ModelPricing }) {
    this.apiKey = opts.apiKey;
    this.modelId = opts.model;
    this.pricing = opts.pricing ?? { inputPerM: 3, outputPerM: 15 };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    const messages = req.messages.map((m) => {
      if (m.toolResults && m.toolResults.length > 0) {
        return {
          role: "user" as const,
          content: m.toolResults.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.callId,
            content: r.content,
            is_error: r.isError === true,
          })),
        };
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        const content: unknown[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
        return { role: "assistant" as const, content };
      }
      return { role: m.role, content: m.content };
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelId,
        max_tokens: req.maxOutputTokens ?? 4096,
        system: req.system,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      }),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(
        `Provider error ${res.status} from anthropic (${this.modelId}): ${errText.slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as AnthropicResponse;
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? `toolu_${toolCalls.length}`,
          name: (block.name ?? "unknown") as ToolCall["name"],
          input: block.input,
        });
      }
    }

    const stop = data.stop_reason;
    const finishReason: FinishReason =
      stop === "tool_use" ? "tool_use" : stop === "max_tokens" ? "max_tokens" : stop === "end_turn" ? "stop" : "error";

    const usage: Usage = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };

    return { text, toolCalls, usage, finishReason };
  }

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  /**
   * Stream one turn from the native Messages API.
   *
   * Anthropic uses named SSE events rather than OpenAI's `delta` shape, so the
   * mapping is explicit. The relevant lifecycle is:
   *
   *   message_start        -> carries input token usage
   *   content_block_start  -> opens a text or tool_use block
   *   content_block_delta  -> text_delta | input_json_delta | thinking_delta
   *   message_delta        -> carries stop_reason and output token usage
   *   message_stop         -> end of stream
   *
   * `ping` events are ignored; `error` events are surfaced to the caller.
   */
  async *stream(req: ChatRequest): AsyncIterable<ModelEvent> {
    const tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    const messages = req.messages.map((m) => {
      if (m.toolResults && m.toolResults.length > 0) {
        return {
          role: "user" as const,
          content: m.toolResults.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.callId,
            content: r.content,
            is_error: r.isError === true,
          })),
        };
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        const content: unknown[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
        }
        return { role: "assistant" as const, content };
      }
      return { role: m.role, content: m.content };
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelId,
        max_tokens: req.maxOutputTokens ?? 4096,
        system: req.system,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        stream: true,
      }),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      yield {
        type: "error",
        error: {
          code: classifyAnthropicStatus(res.status),
          message: `Provider error ${res.status} from anthropic (${this.modelId}): ${errText.slice(0, 500)}`,
        },
      };
      return;
    }

    if (!res.body) {
      yield {
        type: "error",
        error: { code: "no_body", message: "Anthropic returned no response body to stream." },
      };
      return;
    }

    const acc = new ToolCallAccumulator();
    let finishReason: FinishReason = "stop";
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let sawUsage = false;
    // Maps Anthropic's block index to our accumulator index so interleaved
    // text and tool blocks stay correctly separated.
    const blockIndexToTool = new Map<number, number>();
    let nextToolIndex = 0;

    for await (const frame of iterSse(res.body, req.signal)) {
      if (isDoneFrame(frame.data)) break;

      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(frame.data) as AnthropicStreamEvent;
      } catch {
        continue;
      }

      // The `event:` line is authoritative, but the payload also carries `type`.
      switch (event.type ?? frame.event) {
        case "message_start": {
          const input = event.message?.usage?.input_tokens;
          if (typeof input === "number") {
            usage = { ...usage, inputTokens: input };
            sawUsage = true;
          }
          break;
        }

        case "content_block_start": {
          const block = event.content_block;
          const blockIndex = event.index ?? 0;
          if (block?.type === "tool_use") {
            const toolIndex = nextToolIndex++;
            blockIndexToTool.set(blockIndex, toolIndex);
            const { id, isNew } = acc.add(toolIndex, { id: block.id, name: block.name });
            if (isNew) {
              yield { type: "tool_call_start", id, name: block.name ?? "unknown" };
            }
            // Some models send the whole input up front instead of streaming
            // it as input_json_delta fragments.
            if (block.input !== undefined && typeof block.input === "object") {
              acc.add(toolIndex, { args: JSON.stringify(block.input) });
            } else if (typeof block.input === "string") {
              acc.add(toolIndex, { args: block.input });
            }
          } else if (block?.type === "text" && block.text) {
            yield { type: "text_delta", text: block.text };
          } else if (block?.type === "thinking" && block.thinking) {
            yield { type: "reasoning_delta", text: block.thinking };
          }
          break;
        }

        case "content_block_delta": {
          const delta = event.delta;
          if (delta?.type === "text_delta" && delta.text) {
            yield { type: "text_delta", text: delta.text };
          } else if (delta?.type === "input_json_delta" && delta.partial_json) {
            const toolIndex = blockIndexToTool.get(event.index ?? 0);
            if (toolIndex !== undefined) {
              const { id } = acc.add(toolIndex, { args: delta.partial_json });
              yield { type: "tool_call_delta", id, argumentsDelta: delta.partial_json };
            }
          } else if (delta?.type === "thinking_delta" && delta.thinking) {
            yield { type: "reasoning_delta", text: delta.thinking };
          }
          break;
        }

        case "message_delta": {
          const stop = event.delta?.stop_reason;
          if (stop) finishReason = mapAnthropicStopReason(stop);
          const output = event.usage?.output_tokens;
          if (typeof output === "number") {
            usage = { ...usage, outputTokens: output };
            sawUsage = true;
          }
          break;
        }

        case "error": {
          yield {
            type: "error",
            error: {
              code: "stream_error",
              message: event.error?.message ?? "Anthropic stream error.",
            },
          };
          return;
        }

        default:
          // `ping`, `content_block_stop`, `message_stop` need no handling.
          break;
      }
    }

    for (const call of acc.finish()) {
      yield { type: "tool_call_complete", call };
    }
    if (sawUsage) yield { type: "usage", usage };
    yield { type: "completed", finishReason };
  }
}

/** Map Anthropic's `stop_reason` vocabulary onto the agent's. */
function mapAnthropicStopReason(stop: string): FinishReason {
  switch (stop) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "end_turn":
    case "stop_sequence":
      return "stop";
    default:
      return "error";
  }
}

function classifyAnthropicStatus(status: number): string {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 413) return "bad_request";
  if (status === 529) return "overloaded";
  if (status >= 500) return "server";
  return "http_error";
}

/** One decoded Anthropic SSE event payload. */
interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  content_block?: {
    type?: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}
interface AnthropicResponse {
  content?: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}
