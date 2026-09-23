import { describe, it, expect, beforeEach } from "vitest";
import { AgentLoop, PLAN_MODE_FOOTER, type ApprovalHandler } from "../src/agent/loop.js";
import { MockModelAdapter, type MockTurn } from "../src/models/mock.js";
import { PolicyEngine, TOOL_SCHEMAS } from "../src/tools/registry.js";
import { TaskDigest } from "../src/agent/digest.js";
import { ContextManager } from "../src/agent/context.js";
import { CostMeter } from "../src/agent/meter.js";
import { LoopDetector } from "../src/agent/loop-detector.js";
import { SessionStore } from "../src/storage/session.js";
import { CheckpointStore } from "../src/checkpoint/store.js";
import { VerificationGate } from "../src/verify/gate.js";
import { PathGuard } from "../src/tools/fs-tools.js";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../src/agent/types.js";

/**
 * Plan Mode refactor coverage:
 *  1. write/execute tool calls are intercepted GRACEFULLY — never a hard
 *     "[BLOCKED ...]" error (isError must be false, no error banner).
 *  2. The system prompt mandates the structured markdown blueprint
 *     (target files/folders, code modification outline, terminal commands).
 *  3. Every concluding Plan-mode blueprint ends with PLAN_MODE_FOOTER —
 *     enforced at runtime even if the model omits it.
 *  4. Read-only tools (read_file, list_files, search_files, and their
 *     glob/grep equivalents) execute normally in Plan Mode.
 */

const approval: ApprovalHandler = {
  request: async () => ({ approved: true, scope: "session" }),
};

describe("Plan Mode (read-only blueprinting)", () => {
  let workspace = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "toolify-plan-"));
  });

  function makeLoop(turns: MockTurn[], mode: "plan" | "act" = "plan") {
    const adapter = new MockModelAdapter(turns);
    const guard = new PathGuard(workspace);
    const policy = new PolicyEngine();
    const digest = new TaskDigest("plan test");
    const context = new ContextManager(adapter, digest, { contextWindow: 200_000 });
    const meter = new CostMeter(adapter.pricing);
    const sessions = new SessionStore(workspace, SessionStore.newId());
    const checkpoints = new CheckpointStore(workspace);
    const verification = new VerificationGate(guard, () => {}, { commands: [], maxRounds: 1 });
    const streamEvents: Array<{ kind: string; isError?: boolean; content?: string }> = [];
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
      loopDetector: new LoopDetector(),
      tools: TOOL_SCHEMAS,
      maxIterations: 10,
      mode,
      onStream: {
        onToolResult: (_callId, content, isError) => {
          streamEvents.push({ kind: "tool_result", isError, content });
        },
      },
    });
    return { loop, sessions, streamEvents, adapter };
  }

  async function toolFinishedEvents(
    sessions: SessionStore,
  ): Promise<Array<Extract<AgentEvent, { type: "tool_finished" }>>> {
    const events = await sessions.readAll();
    return events.filter(
      (e): e is Extract<AgentEvent, { type: "tool_finished" }> => e.type === "tool_finished",
    );
  }

  async function finalAssistantText(sessions: SessionStore): Promise<string> {
    const events = await sessions.readAll();
    const msg = [...events]
      .reverse()
      .find((e) => e.type === "assistant_message" && e.content.length > 0);
    expect(msg).toBeDefined();
    return (msg as Extract<AgentEvent, { type: "assistant_message" }>).content;
  }

  // --- Req 1: graceful interception — no hard blocked error ---

  it("intercepts write_file gracefully: isError=false, no [BLOCKED] text, file not written", async () => {
    const { loop, sessions, streamEvents } = makeLoop([
      { toolCalls: [{ name: "write_file", input: { path: "sneaky.txt", content: "x" } }] },
      { text: "## Blueprint\n\ndone", finishReason: "stop" },
    ]);
    const result = await loop.run("make a plan");
    expect(result.finishReason).toBe("stop");

    const finished = await toolFinishedEvents(sessions);
    expect(finished).toHaveLength(1);
    const evt = finished[0]!;
    expect(evt.isError).toBe(false);
    expect(evt.content).not.toContain("[BLOCKED");
    expect(evt.content).toContain("intercepted, not executed");
    expect(evt.content).toContain("NOT an error");
    expect(evt.content).toContain("**Target files/folders**");
    expect(streamEvents.some((e) => e.isError === true)).toBe(false);
    await expect(access(join(workspace, "sneaky.txt"))).rejects.toThrow();
  });

  it("intercepts terminal and edit_file the same graceful way", async () => {
    const { loop, sessions } = makeLoop([
      { toolCalls: [{ name: "terminal", input: { command: "echo hi" } }] },
      { toolCalls: [{ name: "edit_file", input: { path: "a.ts", oldText: "a", newText: "b" } }] },
      { text: "plan complete", finishReason: "stop" },
    ]);
    await loop.run("plan");

    const finished = await toolFinishedEvents(sessions);
    expect(finished).toHaveLength(2);
    for (const evt of finished) {
      expect(evt.isError).toBe(false);
      expect(evt.content).not.toContain("[BLOCKED");
      expect(evt.content).toContain("intercepted, not executed");
    }
  });

  it("does not emit approval requests for intercepted calls (graceful, not gated)", async () => {
    const { loop, sessions } = makeLoop([
      { toolCalls: [{ name: "write_file", input: { path: "x.txt", content: "y" } }] },
      { text: "done", finishReason: "stop" },
    ]);
    await loop.run("plan");
    const events = await sessions.readAll();
    expect(events.some((e) => e.type === "approval_request")).toBe(false);
    expect(events.some((e) => e.type === "approval_decision")).toBe(false);
  });

  // --- Req 2: structured markdown blueprint mandated by the system prompt ---

  it("system prompt mandates the three blueprint sections + footer line", async () => {
    const { loop, adapter } = makeLoop([{ text: "ok", finishReason: "stop" }]);
    await loop.run("plan a feature");

    const system = adapter.requests[0]?.system ?? "";
    expect(system).toContain("### Plan Mode (read-only blueprinting)");
    expect(system).toContain("**Target files/folders**");
    expect(system).toContain("**Code modification outline**");
    expect(system).toContain("**Terminal commands**");
    expect(system).toContain(PLAN_MODE_FOOTER);
    expect(system).toContain("read_file");
    expect(system).toContain("list_files");
    expect(system).toContain("search_files");
    expect(system).not.toContain("[BLOCKED");
  });

  // --- Req 3: every blueprint concludes with the exact Tab-switch line ---

  it("PLAN_MODE_FOOTER is the exact required string", () => {
    expect(PLAN_MODE_FOOTER).toBe(
      "👉 Press 'Tab' to switch to Act Mode when you are ready to execute this plan.",
    );
  });

  it("appends the footer when the model's final blueprint omits it", async () => {
    const { loop, sessions } = makeLoop([
      { text: "## Blueprint\n\n1. **Target files/folders**: src/x.ts", finishReason: "stop" },
    ]);
    await loop.run("plan");

    const content = await finalAssistantText(sessions);
    expect(content.trimEnd().endsWith(PLAN_MODE_FOOTER)).toBe(true);
  });

  it("does not duplicate the footer when the model already included it", async () => {
    const { loop, sessions } = makeLoop([
      { text: `All done.\n\n${PLAN_MODE_FOOTER}`, finishReason: "stop" },
    ]);
    await loop.run("plan");

    const content = await finalAssistantText(sessions);
    expect(content.split(PLAN_MODE_FOOTER).length - 1).toBe(1);
  });

  it("appends the footer even after read-only tool use in the same run", async () => {
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
    const { loop, sessions } = makeLoop([
      { toolCalls: [{ name: "read_file", input: { path: "src/a.ts" } }] },
      { text: "Blueprint based on src/a.ts.", finishReason: "stop" },
    ]);
    await loop.run("plan");

    const content = await finalAssistantText(sessions);
    expect(content.trimEnd().endsWith(PLAN_MODE_FOOTER)).toBe(true);
  });

  // --- Req 4: read-only tools execute normally in Plan Mode ---

  it("read_file executes normally in Plan Mode (real file content returned)", async () => {
    await writeFile(join(workspace, "visible.txt"), "READABLE-CONTENT-123", "utf8");
    const { loop, sessions } = makeLoop([
      { toolCalls: [{ name: "read_file", input: { path: "visible.txt" } }] },
      { text: "I can see the file.", finishReason: "stop" },
    ]);
    await loop.run("inspect");

    const finished = await toolFinishedEvents(sessions);
    expect(finished).toHaveLength(1);
    expect(finished[0]!.isError).toBeFalsy();
    expect(finished[0]!.content).toContain("READABLE-CONTENT-123");
    expect(finished[0]!.content).not.toContain("intercepted");
  });

  it("list_files executes normally in Plan Mode (returns matching paths)", async () => {
    await writeFile(join(workspace, "alpha.ts"), "// a\n", "utf8");
    await writeFile(join(workspace, "beta.ts"), "// b\n", "utf8");
    const { loop, sessions } = makeLoop([
      { toolCalls: [{ name: "list_files", input: { pattern: "*.ts" } }] },
      { text: "listed", finishReason: "stop" },
    ]);
    await loop.run("list files");

    const finished = await toolFinishedEvents(sessions);
    expect(finished).toHaveLength(1);
    expect(finished[0]!.isError).toBeFalsy();
    expect(finished[0]!.content).toContain("alpha.ts");
    expect(finished[0]!.content).toContain("beta.ts");
    expect(finished[0]!.content).not.toContain("intercepted");
  });

  it("search_files executes normally in Plan Mode (grep hits returned)", async () => {
    await writeFile(join(workspace, "code.ts"), "const UNIQUE_NEEDLE = 42;\n", "utf8");
    const { loop, sessions } = makeLoop([
      { toolCalls: [{ name: "search_files", input: { pattern: "UNIQUE_NEEDLE" } }] },
      { text: "found it", finishReason: "stop" },
    ]);
    await loop.run("search");

    const finished = await toolFinishedEvents(sessions);
    expect(finished).toHaveLength(1);
    expect(finished[0]!.isError).toBeFalsy();
    expect(finished[0]!.content).toContain("UNIQUE_NEEDLE");
    expect(finished[0]!.content).not.toContain("intercepted");
  });

  it("glob and grep (equivalents) also run normally in Plan Mode", async () => {
    await writeFile(join(workspace, "globbed.md"), "# DOC_MARKER\n", "utf8");
    const { loop, sessions } = makeLoop([
      { toolCalls: [{ name: "glob", input: { pattern: "*.md" } }] },
      { toolCalls: [{ name: "grep", input: { pattern: "DOC_MARKER" } }] },
      { text: "explored", finishReason: "stop" },
    ]);
    await loop.run("explore");

    const finished = await toolFinishedEvents(sessions);
    expect(finished).toHaveLength(2);
    for (const evt of finished) {
      expect(evt.isError).toBeFalsy();
      expect(evt.content).not.toContain("intercepted");
    }
    expect(finished[0]!.content).toContain("globbed.md");
    expect(finished[1]!.content).toContain("DOC_MARKER");
  });

  it("read-only tools still respect the policy denyPaths even in Plan Mode", async () => {
    await writeFile(join(workspace, ".env"), "SECRET=1\n", "utf8");
    const engine = new PolicyEngine({ denyPaths: [".env*"] });
    const decision = engine.decide({ id: "t", name: "read_file", input: { path: ".env" } });
    expect(decision.allowed).toBe(false);
  });

  // --- Act Mode sanity: interception never leaks into Act Mode ---

  it("Act Mode still executes write_file normally (no interception)", async () => {
    const { loop } = makeLoop(
      [
        { toolCalls: [{ name: "write_file", input: { path: "ok.txt", content: "written" } }] },
        { text: "wrote it", finishReason: "stop" },
      ],
      "act",
    );
    await loop.run("write");
    const read = await readFile(join(workspace, "ok.txt"), "utf8");
    expect(read).toBe("written");
  });
});

