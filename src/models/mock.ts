import type {
  ChatRequest,
  ChatResponse,
  ModelAdapter,
  ModelPricing,
  ToolCall,
  ToolSchema,
  Usage,
} from "../agent/types.js";

export interface MockTurn {
  text?: string;
  toolCalls?: Array<{ name: ToolCall["name"]; input: unknown }>;
  finishReason?: ChatResponse["finishReason"];
}

/**
 * Scripted mock model adapter — the backbone of TOOLIFY's deterministic
 * end-to-end testing. Each `chat()` call consumes the next scripted turn,
 * so full agent runs (tools, policy, compaction, verification) can be
 * exercised with zero API keys and zero nondeterminism.
 */
export class MockModelAdapter implements ModelAdapter {
  readonly name = "mock";
  readonly modelId = "mock-scripted";
  readonly pricing: ModelPricing = { inputPerM: 0, outputPerM: 0 };

  private turns: MockTurn[];
  private consumed = 0;
  readonly requests: ChatRequest[] = [];

  constructor(turns: MockTurn[]) {
    this.turns = turns;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const turn = this.turns[this.consumed] ?? {
      text: "Mock adapter exhausted its script.",
      finishReason: "stop" as const,
    };
    this.consumed++;
    const usage: Usage = {
      inputTokens: 10 * req.messages.length,
      outputTokens: 20,
    };
    const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((tc, i) => ({
      id: `mock_call_${this.consumed}_${i}`,
      name: tc.name,
      input: tc.input,
    }));
    return {
      text: turn.text ?? "",
      toolCalls,
      usage,
      finishReason: turn.finishReason ?? (toolCalls.length > 0 ? "tool_use" : "stop"),
    };
  }
}
