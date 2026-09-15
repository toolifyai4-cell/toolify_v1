import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../src/tools/registry.js";
import { PathGuard } from "../src/tools/fs-tools.js";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("PolicyEngine (R5)", () => {
  const call = (name: string, input: unknown) => ({
    id: "t1",
    name: name as never,
    input,
  });

  it("auto-allows read-tier tools", () => {
    const p = new PolicyEngine();
    expect(p.decide(call("read_file", { path: "src/a.ts" })).allowed).toBe(true);
    expect(p.decide(call("grep", { pattern: "x" })).allowed).toBe(true);
  });

  it("gates write-tier tools without a session grant", () => {
    const p = new PolicyEngine();
    expect(p.decide(call("write_file", { path: "a.txt", content: "x" })).allowed).toBe(false);
    p.grantForSession("write");
    expect(p.decide(call("write_file", { path: "a.txt", content: "x" })).allowed).toBe(true);
  });

  it("allows terminal commands matching the project allowlist", () => {
    const p = new PolicyEngine({ allowlist: ["npm test*"] });
    const d = p.decide(call("terminal", { command: "npm test" }));
    expect(d.allowed).toBe(true);
    expect(d.allowlisted).toBe(true);
    expect(p.decide(call("terminal", { command: "Remove-Item -Recurse C:\\" })).allowed).toBe(false);
  });

  it("denies paths configured in denyPaths even for reads", () => {
    const p = new PolicyEngine({ denyPaths: [".env*"] });
    const d = p.decide(call("read_file", { path: ".env.local" }));
    expect(d.allowed).toBe(false);
  });

  it("executes a real file write through the registry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolify-test-"));
    const guard = new PathGuard(dir);
    const p = new PolicyEngine();
    const r = await p.execute(guard, call("write_file", { path: "out/x.txt", content: "hello" }));
    expect(String(r)).toContain("Wrote");
    const content = (await readFile(join(dir, "out", "x.txt"), "utf8")).toString();
    expect(content).toBe("hello");
  });

  it("blocks path escape attempts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolify-test-"));
    const guard = new PathGuard(dir);
    expect(() => guard.guard("..\\elsewhere\\x.txt")).toThrow(/escapes workspace/);
  });
});
