import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAgentContainer } from "../src/app/container.js";
import { createAgentLoop } from "../src/agent/loop.js";
import { MockModelAdapter } from "../src/models/mock.js";
import { InMemoryEventBus } from "../src/agent/events.js";
import type { AgentEvent } from "../src/agent/types.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

describe("Agent loop integration via container", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "toolify-integ-"));
  });
  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("creates a full dependency graph and runs a simple goal", async () => {
    const adapter = new MockModelAdapter([
      { text: "Done - I created the file.", finishReason: "stop" },
    ]);

    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "Say hello",
      mode: "act",
      maxIterations: 10,
      policyConfig: {},
      verificationCommands: [],
      verificationMaxRounds: 0,
      approval: {
        request: async () => ({ approved: true, scope: "session" }),
      },
      onEvent: () => {},
    });

    expect(deps.adapter).toBe(adapter);
    expect(deps.provider.id).toBe("mock");
    expect(deps.toolRegistry.list().length).toBeGreaterThan(0);
    expect(deps.eventBus).toBeInstanceOf(InMemoryEventBus);
    expect(deps.approval).toBeDefined();
    expect(deps.sessionRepo).toBeDefined();
    expect(deps.checkpointRepo).toBeDefined();
    expect(deps.verification).toBeDefined();

    await deps.sessions.init();
    await deps.checkpoints.init();

    const loop = createAgentLoop(deps);
    const result = await loop.run("Say hello");

    expect(result.finishReason).toBe("stop");
    expect(result.iterations).toBe(0);
  });

  it("emits events to the event bus", async () => {
    const adapter = new MockModelAdapter([
      { text: "Hello world", finishReason: "stop" },
    ]);

    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "Say hi",
      mode: "act",
      approval: { request: async () => ({ approved: true, scope: "session" }) },
    });

    // Subscribe to the event bus BEFORE running the loop
    const busEvents: AgentEvent[] = [];
    deps.eventBus.subscribe((e) => busEvents.push(e));

    await deps.sessions.init();
    await deps.checkpoints.init();

    const loop = createAgentLoop(deps);
    await loop.run("Say hi");

    // The loop emits session events through the event bus
    expect(busEvents.length).toBeGreaterThan(0);
  });

  it("persists session events to the JSONL log", async () => {
    const adapter = new MockModelAdapter([
      { text: "Task complete", finishReason: "stop" },
    ]);

    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "Test persistence",
      mode: "act",
      approval: { request: async () => ({ approved: true, scope: "session" }) },
    });

    await deps.sessions.init();
    await deps.checkpoints.init();

    const loop = createAgentLoop(deps);
    await loop.run("Test persistence");

    const logPath = join(deps.sessions.sessionDir, "events.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const logContent = await readFile(logPath, "utf8");
    const lines = logContent.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    // Verify at least one valid JSONL entry
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toHaveProperty("type");
    expect(parsed).toHaveProperty("ts");
  });

  it("deny-all approval by default", async () => {
    const adapter = new MockModelAdapter([
      {
        toolCalls: [{ name: "write_file", input: { path: "test.txt", content: "hi" } }],
        finishReason: "tool_use",
      },
      { text: "Cant write that", finishReason: "stop" },
    ]);

    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "Write a file",
      mode: "act",
      // No approval provided - should default to deny-all
      verificationCommands: [],
      verificationMaxRounds: 0,
    });

    await deps.sessions.init();
    await deps.checkpoints.init();

    const loop = createAgentLoop(deps);
    const result = await loop.run("Write a file");

    // Should complete (denied tool produces an error result, loop continues)
    expect(["stop", "error", "budget"]).toContain(result.finishReason);
  });
});
