import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAgentContainer } from "../src/app/container.js";
import { MockModelAdapter } from "../src/models/mock.js";
import { InMemoryEventBus } from "../src/agent/events.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("createAgentContainer", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "toolify-container-"));
  });
  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("constructs all dependency views from minimal options", () => {
    const adapter = new MockModelAdapter([{ text: "hi", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
      approval: { request: async () => ({ approved: true, scope: "session" }) },
    });

    // Interface views
    expect(deps.provider.id).toBe("mock");
    expect(deps.provider.modelId).toBe("mock-scripted");
    expect(deps.toolRegistry).toBeDefined();
    expect(deps.approval).toBeDefined();
    expect(deps.eventBus).toBeInstanceOf(InMemoryEventBus);
    expect(deps.sessionRepo).toBeDefined();
    expect(deps.checkpointRepo).toBeDefined();
    expect(deps.verification).toBeDefined();

    // Concrete implementations
    expect(deps.adapter).toBe(adapter);
    expect(deps.guard).toBeDefined();
    expect(deps.policy).toBeDefined();
    expect(deps.digest).toBeDefined();
    expect(deps.context).toBeDefined();
    expect(deps.meter).toBeDefined();
    expect(deps.loopDetector).toBeDefined();
    expect(deps.sessions).toBeDefined();
    expect(deps.checkpoints).toBeDefined();
    expect(deps.verificationGate).toBeDefined();
    expect(deps.toolSchemas).toBeDefined();

    // Config
    expect(deps.mode).toBe("act");
    expect(deps.maxIterations).toBe(40);
    expect(deps.onStream).toBeUndefined();
  });

  it("uses defaults when optional options are omitted", () => {
    const adapter = new MockModelAdapter([{ text: "hi", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
    });

    // No approval provided — should have a deny-all handler
    expect(deps.approval).toBeDefined();
  });

  it("accepts custom maxIterations and mode", () => {
    const adapter = new MockModelAdapter([{ text: "hi", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
      mode: "plan",
      maxIterations: 5,
    });

    expect(deps.mode).toBe("plan");
    expect(deps.maxIterations).toBe(5);
  });

  it("accepts onStream and signal", () => {
    const adapter = new MockModelAdapter([{ text: "hi", finishReason: "stop" }]);
    const controller = new AbortController();
    const stream = {
      onError: () => {},
      onAssistantText: () => {},
    };
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
      mode: "act",
      signal: controller.signal,
      onStream: stream,
    });

    expect(deps.signal).toBe(controller.signal);
    expect(deps.onStream).toBe(stream);
  });

  it("passes policyConfig and verification options through", () => {
    const adapter = new MockModelAdapter([{ text: "hi", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
      policyConfig: { allowlist: ["read_file"] },
      verificationCommands: [{ name: "lint", command: "echo lint" }],
      verificationMaxRounds: 5,
    });

    expect(deps.policy).toBeDefined();
    expect(deps.verification.maxRounds).toBe(5);
    expect(deps.verification.enabled).toBe(true);
  });

  it("returns eventBus with working subscribe/emit", () => {
    const adapter = new MockModelAdapter([{ text: "hi", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
    });

    let received = false;
    deps.eventBus.subscribe(() => { received = true; });
    deps.eventBus.emit({ type: "error", message: "x", ts: 1 } as never);
    expect(received).toBe(true);
    expect(deps.eventBus.subscriberCount).toBe(1);
  });
});


