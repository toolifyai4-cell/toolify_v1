import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAgentContainer } from "../src/app/container.js";
import { MockModelAdapter } from "../src/models/mock.js";
import { PolicyEngine, TOOL_SCHEMAS } from "../src/tools/registry.js";
import { PathGuard } from "../src/tools/fs-tools.js";
import { createToolRegistryAdapter } from "../src/tools/tool-registry-adapter.js";
import type { ToolCall } from "../src/agent/types.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ToolRegistry contract", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "toolify-toolreg-"));
    await writeFile(join(workspace, "hello.txt"), "world", "utf8");
  });
  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("lists tools from the existing schema registry", () => {
    const adapter = new MockModelAdapter([{ text: "x", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
    });
    const tools = deps.toolRegistry.list();
    expect(tools.length).toBe(TOOL_SCHEMAS.length);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("terminal");
  });

  it("has a lookup by name", () => {
    const adapter = new MockModelAdapter([{ text: "x", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
    });
    const def = deps.toolRegistry.get("read_file");
    expect(def).toBeDefined();
    expect(def!.name).toBe("read_file");
  });

  it("returns undefined for unknown tool", () => {
    const adapter = new MockModelAdapter([{ text: "x", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
    });
    expect(deps.toolRegistry.get("nonexistent")).toBeUndefined();
  });

  it("executes read_file and returns content", async () => {
    const adapter = new MockModelAdapter([{ text: "x", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
    });
    const call: ToolCall = {
      id: "call_1",
      name: "read_file",
      input: { path: "hello.txt" },
    };
    const result = await deps.toolRegistry.execute(call, {
      workspace,
      guard: new PathGuard(workspace),
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("world");
  });

  it("exposes risk tier for each tool", () => {
    const adapter = new MockModelAdapter([{ text: "x", finishReason: "stop" }]);
    const deps = createAgentContainer({
      workspace,
      model: adapter,
      goal: "test",
    });
    const readDef = deps.toolRegistry.get("read_file");
    const writeDef = deps.toolRegistry.get("write_file");
    const terminalDef = deps.toolRegistry.get("terminal");

    expect(readDef!.risk).toBe("read");
    expect(writeDef!.risk).toBe("write");
    expect(terminalDef!.risk).toBe("dangerous");
  });

  it("createToolRegistryAdapter wraps PolicyEngine+PathGuard", () => {
    const adapter = new MockModelAdapter([{ text: "x", finishReason: "stop" }]);
    const policy = new PolicyEngine({});
    const guard = new PathGuard(workspace);
    const registry = createToolRegistryAdapter(adapter, policy, guard);
    expect(registry.list().length).toBe(TOOL_SCHEMAS.length);
  });
});
