/**
 * Loop-level tests for the streaming path.
 *
 * Verifies that when a provider is streaming-capable the loop actually uses
 * `stream()`, delivers deltas live, and does NOT re-send the whole message
 * afterwards (which would duplicate output in the TUI).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop } from "../src/agent/loop.js";
import { OpenAICompatibleAdapter } from "../src/models/openai-compatible.js";
import { MockModelAdapter } from "../src/models/mock.js";
import { createModelProvider } from "../src/providers/provider.js";
import type { ModelAdapter, ModelEvent } from "../src/agent/types.js";
import { PolicyEngine, TOOL_SCHEMAS } from "../src/tools/registry.js";
import { PathGuard } from "../src/tools/fs-tools.js";
import { TaskDigest } from "../src/agent/digest.js";
import { ContextManager } from "../src/agent/context.js";
import { CostMeter } from "../src/agent/meter.js";
import { LoopDetector } from "../src/agent/loop-detector.js";
import { SessionStore } from "../src/storage/session.js";
import { CheckpointStore } from "../src/checkpoint/store.js";
import { VerificationGate } from "../src/verify/gate.js";

const created: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const d of created) await rm(d, { recursive: true, force: true });
  created.length = 0;
});

/** A provider that yields a fixed list of ModelEvents and records the path used. */
function scriptedStreamingProvider(events: ModelEvent[]) {
  let streamed = 0;
  let chatted = 0;
  const provider = {
    id: "scripted",
    modelId: "scripted-1",
    capabilities: { streaming: true, tools: true },
    chat: async () => {
      chatted++;
      return {
        text: "CHAT-PATH-WAS-USED",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: "stop" as const,
      };
    },
    stream: async function* () {
      streamed++;
      for (const e of events) yield e;
    },
  };
  return {
    provider,
    get streamed() { return streamed; },
    get chatted() { return chatted; },
  };
}

/** Build a loop around a provider, wiring the real stores and a Mock adapter. */
function buildLoop(
  provider: unknown,
  ws: string,
  meterSource: ModelAdapter,
  onStream: Record<string, unknown>,
) {
  const digest = new TaskDigest("test");
  return new AgentLoop({
    provider: provider as never,
    toolRegistry: {
      execute: async () => ({ ok: true, content: "tool ran" }),
      get: () => undefined,
      list: () => [],
    } as never,
    policy: {
      decide: () => ({ allowed: true, tier: "read", reason: "read-only" }),
      grantForSession: () => undefined,
    } as never,
    approval: { request: async () => ({ approved: true, scope: "session" }) } as never,
    sessions: new SessionStore(ws, SessionStore.newId()),
    checkpoints: new CheckpointStore(ws),
    verification: new VerificationGate(new PathGuard(ws), () => undefined, { commands: [] }),
    digest,
    context: new ContextManager(meterSource, digest, { contextWindow: 128000 }),
    meter: new CostMeter(meterSource.pricing),
    loopDetector: new LoopDetector(),
    guard: new PathGuard(ws),
    tools: TOOL_SCHEMAS,
    maxIterations: 3,
    mode: "act",
    onStream: onStream as never,
  });
}

describe("AgentLoop streaming path", () => {
  it("uses stream() and delivers deltas live without duplicating text", async () => {
    const ws = await mkdtemp(join(tmpdir(), "toolify-stream-"));
    created.push(ws);

    const scripted = scriptedStreamingProvider([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "usage", usage: { inputTokens: 7, outputTokens: 3 } },
      { type: "completed", finishReason: "stop" },
    ]);

    const deltas: string[] = [];
    let firstToken = 0;

    const loop = buildLoop(scripted.provider, ws, new MockModelAdapter([]), {
      onFirstToken: () => { firstToken++; },
      onAssistantText: (d: string) => { deltas.push(d); },
    });

    const result = await loop.run("say hi");

    expect(scripted.streamed).toBe(1);
    expect(scripted.chatted).toBe(0);
    expect(result.finishReason).toBe("stop");
    // Deltas arrive individually and in order...
    expect(deltas).toEqual(["Hello ", "world"]);
    // ...and the assembled text is NOT re-sent after the stream completes.
    expect(deltas).not.toContain("Hello world");
    expect(firstToken).toBe(1);
  });

  it("falls back to chat() for a non-streaming provider, sending the full text once", async () => {
    const ws = await mkdtemp(join(tmpdir(), "toolify-nostream-"));
    created.push(ws);

    const mock = new MockModelAdapter([{ text: "non-streaming reply" }]);
    const provider = createModelProvider(mock);
    expect(provider.capabilities.streaming).toBe(false);

    const deltas: string[] = [];
    const loop = buildLoop(provider, ws, mock, {
      onAssistantText: (d: string) => deltas.push(d),
    });

    await loop.run("hi");
    expect(deltas).toEqual(["non-streaming reply"]);
  });
});
