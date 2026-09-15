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
