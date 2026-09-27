/**
 * Tests for the stream-usage capability fallback.
 *
 * Z.AI/GLM (and other strictly-validating gateways) reject
 * `stream_options: { include_usage: true }` with a generic HTTP 400
 * (`Invalid API parameter`, code 1210). Rather than hardcoding a vendor
 * exception, the adapter probes optimistically and withdraws the field on a
 * 400, degrading to "no usage data" instead of failing the whole turn.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatibleAdapter } from "../src/models/openai-compatible.js";
import { consumeProviderStream } from "../src/agent/stream-consumer.js";
import { createModelProvider } from "../src/providers/provider.js";
import type { ChatRequest, ModelEvent } from "../src/agent/types.js";

const REQUEST: ChatRequest = {
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
};

/** The exact shape Z.AI returns for an unsupported request field. */
const ZAI_ERROR = JSON.stringify({
  error: {
    code: 400,
    metadata: {
      raw: '{"error":{"code":"1210","message":"Invalid API parameter, please check the documentation."}}',
      provider_name: "Z.AI",
    },
  },
});

/** SSE body returned once the offending field is removed. */
const SSE_OK =
  'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  "data: [DONE]\n\n";

function sseResponse(body: string): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(body));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
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

const BASE = { baseUrl: "https://api.example.test/v1" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stream_options capability fallback", () => {
  it("retries without stream_options on a 400 and still streams text", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        call++;
        if (call === 1) {
          return new Response(ZAI_ERROR, {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        return sseResponse(SSE_OK);
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const a = new OpenAICompatibleAdapter({ ...BASE, model: "z-ai/glm-5.3-flashx" });
    const events = await drain(a.stream(REQUEST));

    // The turn must succeed despite the first 400.
    expect(textOf(events)).toBe("hello");
    expect(events.some((e) => e.type === "error")).toBe(false);

    // First request carried the field; the retry did not.
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true });
    expect(bodies[1]!.stream_options).toBeUndefined();
  });

  it("remembers the capability and stops sending the field on later turns", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        call++;
        if (call === 1) return new Response(ZAI_ERROR, { status: 400 });
        return sseResponse(SSE_OK);
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const a = new OpenAICompatibleAdapter({ ...BASE, model: "z-ai/glm-5.3-flashx" });
    await drain(a.stream(REQUEST));
    expect(a.streamUsageAvailable).toBe(false);

    await drain(a.stream(REQUEST));
    await drain(a.stream(REQUEST));

    // Turn 1 costs 2 calls (1 rejected + 1 retry); turns 2 and 3 cost 1 each.
    // If the capability were not remembered, turn 2 would probe again.
    expect(bodies).toHaveLength(4);
    expect(bodies[2]!.stream_options).toBeUndefined();
    expect(bodies[3]!.stream_options).toBeUndefined();
  });

  it("warns exactly once about degraded usage", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return new Response(ZAI_ERROR, { status: 400 });
        return sseResponse(SSE_OK);
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const a = new OpenAICompatibleAdapter({ ...BASE, model: "z-ai/glm-5.3-flashx" });
    await drain(a.stream(REQUEST));
    await drain(a.stream(REQUEST));
    await drain(a.stream(REQUEST));

    const usageWarnings = warn.mock.calls.filter((c) =>
      String(c[0]).includes("stream_options"),
    );
    expect(usageWarnings).toHaveLength(1);
  });
});

describe("stream_options fallback edge cases", () => {
  it("does NOT retry on a non-400 error (auth/rate-limit are not our problem)", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const a = new OpenAICompatibleAdapter({ ...BASE, model: "gpt-4o" });
    const events = await drain(a.stream(REQUEST));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const err = events.find((e) => e.type === "error") as
      | { error: { code: string } }
      | undefined;
    expect(err?.error.code).toBe("auth");
    // A 401 says nothing about stream_options, so the capability is untouched.
    expect(a.streamUsageAvailable).toBe(true);
  });

  it("surfaces a clear error when the retry ALSO fails", async () => {
    const fetchMock = vi.fn(async () => new Response(ZAI_ERROR, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const a = new OpenAICompatibleAdapter({ ...BASE, model: "z-ai/glm-5.3-flashx" });
    const events = await drain(a.stream(REQUEST));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const err = events.find((e) => e.type === "error") as
      | { error: { message: string } }
      | undefined;
    expect(err?.error.message).toContain("already retried without stream_options");
  });

  it("still works normally for providers that accept stream_options", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return sseResponse(
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
            'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n' +
            "data: [DONE]\n\n",
        );
      }),
    );

    const a = new OpenAICompatibleAdapter({ ...BASE, model: "gpt-4o" });
    const provider = createModelProvider(a);
    const res = await consumeProviderStream({
      provider,
      request: REQUEST,
      idleTimeoutMs: 5000,
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true });
    expect(res.text).toBe("ok");
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
  });

  it("honours an explicit streamUsage:false opt-out without probing", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return sseResponse(SSE_OK);
      }),
    );
    const a = new OpenAICompatibleAdapter({
      ...BASE,
      model: "gpt-4o",
      streamUsage: false,
    });
    await drain(a.stream(REQUEST));
    expect(bodies[0]!.stream_options).toBeUndefined();
  });
});
