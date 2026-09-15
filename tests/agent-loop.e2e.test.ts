import { describe, it, expect, beforeEach } from "vitest";
import { AgentLoop, type ApprovalHandler } from "../src/agent/loop.js";
import { MockModelAdapter, type MockTurn } from "../src/models/mock.js";
import { PolicyEngine, TOOL_SCHEMAS, type ProjectPolicyConfig } from "../src/tools/registry.js";
import { TaskDigest } from "../src/agent/digest.js";
import { ContextManager } from "../src/agent/context.js";
import { CostMeter } from "../src/agent/meter.js";
import { LoopDetector } from "../src/agent/loop-detector.js";
import { SessionStore } from "../src/storage/session.js";
import { CheckpointStore } from "../src/checkpoint/store.js";
import { VerificationGate } from "../src/verify/gate.js";
import { PathGuard } from "../src/tools/fs-tools.js";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Deterministic end-to-end agent test: the scripted MockModelAdapter drives
 * the full TOOLIFY loop (tools → policy → checkpoints → verification) with
 * zero API keys and zero nondeterminism.
 */
describe("AgentLoop end-to-end (mock model)", () => {
  let workspace = "";
  /** Per-test approval policy: "deny" (default) or "session" (auto-grant). */
  let approvalMode: "deny" | "session" = "session";

  const approval: ApprovalHandler = {
    request: async () =>
      approvalMode === "session" ? { approved: true, scope: "session" } : { approved: false },
  };

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "toolify-e2e-"));
    approvalMode = "session";
  });

  function makeLoop(turns: MockTurn[], policyCfg: ProjectPolicyConfig = {}, verifyCommands: Array<{ name: string; command: string }> = []) {
    const adapter = new MockModelAdapter(turns);
    const guard = new PathGuard(workspace);
    const policy = new PolicyEngine(policyCfg);
    const digest = new TaskDigest("initial");
    const context = new ContextManager(adapter, digest, { contextWindow: 200_000 });
    const meter = new CostMeter(adapter.pricing);
    const sessions = new SessionStore(workspace, SessionStore.newId());
    const checkpoints = new CheckpointStore(workspace);
    const verification = new VerificationGate(guard, () => {}, { commands: verifyCommands, maxRounds: 2 });
    const loopDetector = new LoopDetector();
    const loop = new AgentLoop({
      adapter,
      guard,
      policy,
      digest,
      context,
      meter,
      sessions,
      checkpoints,
      verification,
      approval,
      loopDetector,
            tools: TOOL_SCHEMAS,
      maxIterations: 10,
      mode: "act",
    });
    return { loop, sessions, adapter, meter };
  }

  it("writes a file through the full loop and finishes verified", async () => {
    const turns: MockTurn[] = [
      { toolCalls: [{ name: "write_file", input: { path: "hello.txt", content: "from TOOLIFY" } }] },
      { text: "File created.", finishReason: "stop" },
    ];
    const { loop, sessions, meter } = makeLoop(turns, {}, [
      { name: "check", command: "echo verified" },
    ]);
    const result = await loop.run("create hello.txt");
    expect(result.finishReason).toBe("stop");
    expect((await readFile(join(workspace, "hello.txt"), "utf8")).toString()).toBe("from TOOLIFY");

    const events = await sessions.readAll();
    const types = events.map((e) => e.type);
    expect(types).toContain("user_message");
    expect(types).toContain("tool_started");
    expect(types).toContain("tool_finished");
    expect(types).toContain("verification");
    expect(types).toContain("run_finished");
    expect(meter.costUsd).toBe(0);
  });

  it("verification failure feeds back and the model retries", async () => {
    const turns: MockTurn[] = [
      { toolCalls: [{ name: "write_file", input: { path: "wrong.txt", content: "oops" } }] },
      { toolCalls: [{ name: "write_file", input: { path: "required.txt", content: "fixed" } }] },
      { text: "fixed it", finishReason: "stop" },
    ];
    const { loop } = makeLoop(turns, {}, [
      { name: "require", command: "node -e \"require('fs').accessSync('required.txt')\"" },
    ]);
    const result = await loop.run("create required.txt");
    expect(result.finishReason).toBe("stop");
    expect((await readFile(join(workspace, "required.txt"), "utf8")).toString()).toBe("fixed");
    expect(result.verificationRounds).toBeGreaterThanOrEqual(1);
  });

  it("denied gated tool returns denial to the model instead of executing", async () => {
    approvalMode = "deny"; // no allowlist, approval DENIED
    const turns: MockTurn[] = [
      { toolCalls: [{ name: "terminal", input: { command: "whoami" } }] },
      { text: "understood, adjusting", finishReason: "stop" },
    ];
    const { loop, sessions } = makeLoop(turns); // no allowlist, auto-approve OFF
    const result = await loop.run("run whoami");
    expect(result.finishReason).toBe("stop");
    const events = await sessions.readAll();
    expect(events.some((e) => e.type === "approval_decision")).toBe(true);
  });

  it("checkpoints snapshotted files into the CAS store", async () => {
    const turns: MockTurn[] = [
      { toolCalls: [{ name: "write_file", input: { path: "ck.txt", content: "v1" } }] },
      { text: "done", finishReason: "stop" },
    ];
    const { loop } = makeLoop(turns);
    await loop.run("create ck.txt");
    const store = new CheckpointStore(workspace);
    const list = await store.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((c) => c.files.some((f) => f.path === "ck.txt"))).toBe(true);
  });

  it("compaction triggers proactively when the context budget is exceeded", async () => {
    const turns: MockTurn[] = [
      { text: "summary of earlier talk", finishReason: "stop" },
      { text: "final", finishReason: "stop" },
    ];
    const adapter = new MockModelAdapter(turns);
    const digest = new TaskDigest("goal");
    const context = new ContextManager(adapter, digest, {
      contextWindow: 100,
      compactAtFraction: 0.5,
      keepRecent: 1,
    });
    const messages = [
      { role: "user" as const, content: "x".repeat(400) },
      { role: "user" as const, content: "y".repeat(400) },
    ];
    expect(context.shouldCompact(messages)).toBe(true);
    const comp = await context.maybeCompact(messages);
    expect(comp.didCompact).toBe(true);
    expect(comp.summarizedCount).toBe(1);
    expect(comp.messages[0].content).toContain("Summary: summary of earlier talk");
  });
});
