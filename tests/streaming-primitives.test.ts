/**
 * Unit tests for the shared streaming primitives: the SSE reader and the
 * tool-call reassembler. These are the parts most likely to break silently
 * against a real provider, so they are tested with hand-built byte streams
 * rather than mocks of our own code.
 */
import { describe, it, expect } from "vitest";
import {
  ToolCallAccumulator,
  isDoneFrame,
  iterSse,
  parseToolArguments,
} from "../src/providers/streaming.js";

/** Build a ReadableStream that emits the given chunks in order. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
}

async function collect(s: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const out: Array<{ event?: string; data: string }> = [];
  for await (const frame of iterSse(s, signal)) out.push(frame);
  return out;
}

describe("isDoneFrame", () => {
  it("recognises the [DONE] sentinel with surrounding whitespace", () => {
    expect(isDoneFrame("[DONE]")).toBe(true);
    expect(isDoneFrame("  [DONE]\n")).toBe(true);
  });

  it("does not treat ordinary payloads as the terminator", () => {
    expect(isDoneFrame('{"choices":[]}')).toBe(false);
    expect(isDoneFrame("")).toBe(false);
  });
});

describe("iterSse", () => {
  it("parses simple data-only frames", async () => {
    const frames = await collect(
      streamOf(["data: one\n\n", "data: two\n\n", "data: [DONE]\n\n"]),
    );
    expect(frames.map((f) => f.data)).toEqual(["one", "two", "[DONE]"]);
  });

  it("reassembles frames split across arbitrary chunk boundaries", async () => {
    // The frame is cut mid-payload and even mid-keyword.
    const frames = await collect(streamOf(['data: {"hel', 'lo":true}\n', "\n"]));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data).toBe('{"hello":true}');
  });

  it("captures the event name and resets it between frames", async () => {
    const frames = await collect(
      streamOf([
        "event: content_block_delta\ndata: {\"a\":1}\n\n",
        "data: plain\n\n",
      ]),
    );
    expect(frames[0]!.event).toBe("content_block_delta");
    expect(frames[1]!.event).toBeUndefined();
  });

  it("ignores comment keep-alive lines", async () => {
    const frames = await collect(streamOf([": ping\n\n", "data: real\n\n"]));
    expect(frames.map((f) => f.data)).toEqual(["real"]);
  });

  it("joins multi-line data payloads with newlines", async () => {
    const frames = await collect(streamOf(["data: line1\ndata: line2\n\n"]));
    expect(frames[0]!.data).toBe("line1\nline2");
  });

  it("tolerates CRLF line endings", async () => {
    const frames = await collect(streamOf(["data: win\r\n\r\n"]));
    expect(frames[0]!.data).toBe("win");
  });

  it("stops at [DONE] even without a trailing blank line", async () => {
    const frames = await collect(streamOf(["data: a\n\n", "data: [DONE]\n"]));
    expect(frames.map((f) => f.data)).toEqual(["a", "[DONE]"]);
  });

  it("emits a trailing data frame that has no blank-line terminator", async () => {
    const frames = await collect(streamOf(["data: tail"]));
    expect(frames.map((f) => f.data)).toEqual(["tail"]);
  });

  it("skips empty frames produced by consecutive blank lines", async () => {
    const frames = await collect(streamOf(["\n\n\ndata: x\n\n"]));
    expect(frames).toHaveLength(1);
  });

  it("cancels the underlying reader when the signal aborts", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    let cancelled = false;
    // A stream that never closes, so only cancellation can end iteration.
    const hanging = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode("data: a\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });

        const out: string[] = [];
    await (async () => {
      for await (const frame of iterSse(hanging, controller.signal)) {
        out.push(frame.data);
        if (out.length === 1) controller.abort();
      }
    })();
    expect(out).toEqual(["a"]);
    expect(cancelled).toBe(true);
  });
});

describe("ToolCallAccumulator", () => {
  it("reassembles arguments split into many fragments", () => {
    const acc = new ToolCallAccumulator();
    acc.add(0, { id: "call_1", name: "read_file", args: '{"pa' });
    acc.add(0, { args: 'th":"src/' });
    acc.add(0, { args: 'index.ts"}' });
    const calls = acc.finish();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toEqual({ path: "src/index.ts" });
  });

  it("emits tool_call_start only once per index", () => {
    const acc = new ToolCallAccumulator();
    expect(acc.add(0, { id: "c1", name: "glob" }).isNew).toBe(true);
    expect(acc.add(0, { args: "{}" }).isNew).toBe(false);
    expect(acc.add(0, { args: "{}" }).isNew).toBe(false);
  });

  it("keeps parallel tool calls separate and preserves order", () => {
    const acc = new ToolCallAccumulator();
    acc.add(0, { id: "a", name: "read_file", args: '{"path":"a.ts"}' });
    acc.add(1, { id: "b", name: "read_file", args: '{"path":"b.ts"}' });
    const calls = acc.finish();
    expect(calls.map((c) => c.id)).toEqual(["a", "b"]);
    expect(calls[0]!.input).toEqual({ path: "a.ts" });
    expect(calls[1]!.input).toEqual({ path: "b.ts" });
  });

  it("synthesises a stable id when the provider omits one", () => {
    const acc = new ToolCallAccumulator();
    const first = acc.add(3, { name: "grep" });
    const second = acc.add(3, { args: "{}" });
    expect(first.id).toBe("call_3");
    expect(second.id).toBe("call_3");
    expect(acc.finish()[0]!.id).toBe("call_3");
  });

  it("returns an empty object when no arguments were streamed", () => {
    const acc = new ToolCallAccumulator();
    acc.add(0, { id: "x", name: "glob" });
    expect(acc.finish()[0]!.input).toEqual({});
  });

  it("marks truncated JSON rather than throwing", () => {
    const acc = new ToolCallAccumulator();
    acc.add(0, { id: "x", name: "read_file", args: '{"path":"a.ts"' });
    const input = acc.finish()[0]!.input as Record<string, unknown>;
    expect(input._parseError).toBe(true);
    expect(input._raw).toBe('{"path":"a.ts"');
  });
});

describe("parseToolArguments", () => {
  it("parses valid JSON objects", () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns {} for empty or whitespace input", () => {
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments("   ")).toEqual({});
  });

  it("flags malformed input instead of throwing", () => {
    const out = parseToolArguments("{oops") as Record<string, unknown>;
    expect(out._parseError).toBe(true);
  });
});
