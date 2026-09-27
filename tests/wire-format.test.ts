/**
 * Regression tests for the OpenAI-compatible wire format.
 *
 * The headline bug here was a nested array in `messages`: `toWireMessage`
 * returned an ARRAY for tool-result turns and was spread with `.map(...spread)`,
 * producing `messages[N] = [ {...} ]`. Every OpenAI-compatible endpoint rejects
 * that with `messages.N: expected object, received array`, which broke EVERY
 * tool-calling turn. These tests assert the serialized request body structurally
 * so this can never regress silently again.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatibleAdapter } from "../src/models/openai-compatible.js";
import type { ChatRequest, ModelMessage } from "../src/agent/types.js";

const adapter = new OpenAICompatibleAdapter({
  baseUrl: "https://example.test/v1",
  model: "gpt-4o",
  apiKey: "k",
});

/** Capture the `messages` array from the last request body. */
async function capture(messages: ModelMessage[]): Promise<unknown[]> {
  let captured: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body)).messages;
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
  await adapter.chat({ system: "sys", messages, tools: [] });
  return captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible message wire format", () => {
  it("flattens tool results into sibling role:tool messages (no nested array)", async () => {
    const messages = await capture([
      { role: "user", content: "read a.ts" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "read_file", input: { path: "a.ts" } }],
      },
      {
        role: "user",
        content: "",
        toolResults: [
          { callId: "call_1", content: "contents of a.ts" },
          { callId: "call_2", content: "contents of b.ts" },
        ],
      },
    ]);

    // This is the exact assertion that would have caught the bug.
    for (const m of messages) {
      expect(Array.isArray(m)).toBe(false);
    }

    const asObjects = messages as Array<Record<string, unknown>>;
    expect(asObjects[0]).toEqual({ role: "system", content: "sys" });
    expect(asObjects[1]).toEqual({ role: "user", content: "read a.ts" });
    expect(asObjects[2]!.role).toBe("assistant");
    expect(asObjects[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "contents of a.ts",
    });
    expect(asObjects[4]).toEqual({
      role: "tool",
      tool_call_id: "call_2",
      content: "contents of b.ts",
    });
    // system + user + assistant + 2 tool results
    expect(asObjects).toHaveLength(5);
  });

  it("keeps assistant tool_calls as a single object message", async () => {
    const messages = await capture([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "glob", input: { pattern: "*.ts" } }],
      },
    ]);
    const asObjects = messages as Array<Record<string, unknown>>;
    expect(asObjects[1]!.role).toBe("assistant");
    expect(Array.isArray(asObjects[1])).toBe(false);
    const toolCalls = asObjects[1]!.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls[0]!.function).toEqual({
      name: "glob",
      arguments: JSON.stringify({ pattern: "*.ts" }),
    });
  });

  it("emits only a system message for an empty conversation", async () => {
    const messages = await capture([]);
    expect(messages).toEqual([{ role: "system", content: "sys" }]);
  });
});
