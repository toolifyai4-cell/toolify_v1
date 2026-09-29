/**
 * Streaming tests for the two real provider adapters and the stream consumer.
 *
 * `fetch` is stubbed with a hand-built SSE body so these exercise the actual
 * wire-format translation without network access or API keys.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import "./vi-shim";
import { OpenAICompatibleAdapter } from "../src/models/openai-compatible.js";
import { AnthropicAdapter } from "../src/models/anthropic.js";
import { MockModelAdapter } from "../src/models/mock.js";
import { createModelProvider } from "../src/providers/provider.js";
import { consumeProviderStream } from "../src/agent/stream-consumer.js";
import type { ChatRequest, ModelEvent } from "../src/agent/types.js";

const REQUEST: ChatRequest = {
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
};

/** Stub global fetch with an SSE response built from the given raw text. */
function stubSse(body: string, init?: { status?: number; headers?: Record<string, string> }) {
  const encoder = new TextEncoder();
  // Deliver in small pieces to also exercise chunk-boundary handling.
  const pieces = body.match(/[\s\S]{1,17}/g) ?? [body];
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < pieces.length) controller.enqueue(encoder.encode(pieces[i++]));
      else controller.close();
    },
  });
  const fetchMock = vi.fn(async () =>
    new Response(stream, {
      status: init?.status ?? 200,
      headers: { "content-type": "text/event-stream", ...(init?.headers ?? {}) },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function drain(iter: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function textOf(events: ModelEvent[]): string {
  return events
    .filter((e) => e.type === "text_delta")
    .map((e) => (e as { text: string }).text)
    .join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleAdapter.stream", () => {
  it("emits text deltas that reassemble into the full message", async () => {
    stubSse(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":", world"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        "data: [DONE]\n\n",
    );
    const a = new OpenAICompatibleAdapter({
      baseUrl: "https://example.test/v1",
      model: "gpt-4o",
      apiKey: "k",
    });
    const events = await drain(a.stream(REQUEST));
    expect(textOf(events)).toBe("Hello, world");
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });

  it("reassembles a tool call streamed across many argument fragments", async () => {
    stubSse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":""}}]}}]}\n\n' +
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"pa"}}]}}]}\n\n' +
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.ts\\"}"}}]}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
        "data: [DONE]\n\n",
    );
    const a = new OpenAICompatibleAdapter({
      baseUrl: "https://example.test/v1",
      model: "gpt-4o",
    });
    const events = await drain(a.stream(REQUEST));
    const done = events.find((e) => e.type === "tool_call_complete") as
      | { call: { name: string; input: unknown } }
      | undefined;
    expect(done).toBeDefined();
    expect(done!.call.name).toBe("read_file");
    expect(done!.call.input).toEqual({ path: "a.ts" });
    expect(events.filter((e) => e.type === "tool_call_start")).toHaveLength(1);
  });

  it("surfaces usage from the trailing usage chunk", async () => {
    stubSse(
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":22}}\n\n' +
        "data: [DONE]\n\n",
    );
    const a = new OpenAICompatibleAdapter({
      baseUrl: "https://example.test/v1",
      model: "gpt-4o",
    });
    const events = await drain(a.stream(REQUEST));
    const usage = events.find((e) => e.type === "usage") as
      | { usage: { inputTokens: number; outputTokens: number } }
      | undefined;
    expect(usage?.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
  });

  it("maps finish_reason and exposes DeepSeek-style reasoning separately", async () => {
    stubSse(
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"length"}]}\n\n' +
        "data: [DONE]\n\n",
    );
    const a = new OpenAICompatibleAdapter({
      baseUrl: "https://example.test/v1",
      model: "deepseek-chat",
    });
    const events = await drain(a.stream(REQUEST));
    expect(events.some((e) => e.type === "reasoning_delta")).toBe(true);
    const completed = events.find((e) => e.type === "completed") as
      | { finishReason: string }
      | undefined;
    expect(completed?.finishReason).toBe("max_tokens");
  });

  it("reports an error event for a non-2xx response instead of throwing", async () => {
    stubSse("nope", { status: 429 });
    const a = new OpenAICompatibleAdapter({
      baseUrl: "https://example.test/v1",
      model: "gpt-4o",
      apiKey: "k",
    });
    const events = await drain(a.stream(REQUEST));
    const err = events.find((e) => e.type === "error") as
      | { error: { code: string } }
      | undefined;
    expect(err?.error.code).toBe("rate_limit");
  });

  it("skips malformed JSON frames without breaking the stream", async () => {
    stubSse(
      "data: {not json}\n\n" +
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
        "data: [DONE]\n\n",
    );
    const a = new OpenAICompatibleAdapter({
      baseUrl: "https://example.test/v1",
      model: "gpt-4o",
    });
    expect(textOf(await drain(a.stream(REQUEST)))).toBe("ok");
  });

  it("requests stream mode and usage accounting in the request body", async () => {
    const fetchMock = stubSse("data: [DONE]\n\n");
    const a = new OpenAICompatibleAdapter({
      baseUrl: "https://example.test/v1",
      model: "gpt-4o",
    });
    await drain(a.stream(REQUEST));
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});

describe("AnthropicAdapter.stream", () => {
  it("maps content_block_delta text into text deltas and reads usage", async () => {
    stubSse(
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":30}}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n' +
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n' +
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );
    const a = new AnthropicAdapter({ apiKey: "k", model: "claude-sonnet-4-20250514" });
    const events = await drain(a.stream(REQUEST));
    expect(textOf(events)).toBe("Hi there");
    const usage = events.find((e) => e.type === "usage") as
      | { usage: { inputTokens: number; outputTokens: number } }
      | undefined;
    expect(usage?.usage).toEqual({ inputTokens: 30, outputTokens: 9 });
    const completed = events.find((e) => e.type === "completed") as
      | { finishReason: string }
      | undefined;
    expect(completed?.finishReason).toBe("stop");
  });

  it("reassembles a tool_use block from input_json_delta fragments", async () => {
    stubSse(
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"write_file"}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"x.ts\\",\\"content\\":\\"hi\\"}"}}\n\n' +
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
    );
    const a = new AnthropicAdapter({ apiKey: "k", model: "claude-sonnet-4-20250514" });
    const events = await drain(a.stream(REQUEST));
    const done = events.find((e) => e.type === "tool_call_complete") as
      | { call: { name: string; input: unknown } }
      | undefined;
    expect(done?.call.name).toBe("write_file");
    expect(done?.call.input).toEqual({ path: "x.ts", content: "hi" });
    const completed = events.find((e) => e.type === "completed") as
      | { finishReason: string }
      | undefined;
    expect(completed?.finishReason).toBe("tool_use");
  });

  it("ignores ping events and surfaces error events", async () => {
    stubSse(
      'event: ping\ndata: {"type":"ping"}\n\n' +
        'event: error\ndata: {"type":"error","error":{"message":"overloaded"}}\n\n',
    );
    const a = new AnthropicAdapter({ apiKey: "k", model: "claude-sonnet-4-20250514" });
    const events = await drain(a.stream(REQUEST));
    const err = events.find((e) => e.type === "error") as
      | { error: { message: string } }
      | undefined;
    expect(err?.error.message).toBe("overloaded");
  });
});

describe("createModelProvider streaming capability", () => {
  it("forwards stream and reports streaming=true for streaming adapters", async () => {
    stubSse('data: {"choices":[{"delta":{"content":"yo"}}]}\n\ndata: [DONE]\n\n');
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "https://example.test/v1",
      model: "gpt-4o",
    });
    const provider = createModelProvider(adapter);
    expect(provider.capabilities.streaming).toBe(true);
    expect(typeof provider.stream).toBe("function");
    const events = await drain(provider.stream!(REQUEST));
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
  });

  it("reports streaming=false and omits stream for the mock adapter", () => {
    const provider = createModelProvider(new MockModelAdapter([{ text: "scripted" }]));
    expect(provider.capabilities.streaming).toBe(false);
    expect(provider.stream).toBeUndefined();
  });
});

describe("consumeProviderStream", () => {
  it("assembles a ChatResponse and reports deltas live", async () => {
    stubSse(
      'data: {"choices":[{"delta":{"content":"abc"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"def"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":7}}\n\n' +
        "data: [DONE]\n\n",
    );
    const provider = createModelProvider(
      new OpenAICompatibleAdapter({
        baseUrl: "https://example.test/v1",
        model: "gpt-4o",
      }),
    );
    const deltas: string[] = [];
    let firstToken = 0;
    const res = await consumeProviderStream({
      provider,
      request: REQUEST,
      idleTimeoutMs: 5000,
      onTextDelta: (d) => deltas.push(d),
      onFirstToken: () => { firstToken++; },
    });
    expect(res.text).toBe("abcdef");
    expect(deltas).toEqual(["abc", "def"]);
    expect(firstToken).toBe(1);
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
    expect(res.finishReason).toBe("stop");
  });

  it("promotes a plain stop to tool_use when tool calls were streamed", async () => {
    stubSse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"glob","arguments":"{\\"pattern\\":\\"*.ts\\"}"}}]}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        "data: [DONE]\n\n",
    );
    const provider = createModelProvider(
      new OpenAICompatibleAdapter({
        baseUrl: "https://example.test/v1",
        model: "gpt-4o",
      }),
    );
    const res = await consumeProviderStream({
      provider,
      request: REQUEST,
      idleTimeoutMs: 5000,
    });
    expect(res.finishReason).toBe("tool_use");
    expect(res.toolCalls).toHaveLength(1);
  });


  it("throws when the stream stalls past the idle timeout", async () => {
    // A stream that emits one event and then hangs forever.
    const encoder = new TextEncoder();
    const hanging = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'));
        // deliberately never close
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(hanging, { status: 200 })));

    const provider = createModelProvider(
      new OpenAICompatibleAdapter({
        baseUrl: "https://example.test/v1",
        model: "gpt-4o",
      }),
    );
    await expect(
      consumeProviderStream({ provider, request: REQUEST, idleTimeoutMs: 60 }),
    ).rejects.toThrow(/idle/i);
  });

  it("rejects with a clear error if a provider claims streaming but has no stream()", async () => {
    const provider = {
      id: "broken",
      modelId: "m",
      capabilities: { streaming: true, tools: true },
      chat: async () => ({
        text: "",
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "stop" as const,
      }),
    };
    await expect(
      consumeProviderStream({ provider, request: REQUEST, idleTimeoutMs: 100 }),
    ).rejects.toThrow(/does not implement stream/);
  });
});
