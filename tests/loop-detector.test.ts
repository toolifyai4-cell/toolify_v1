import { describe, it, expect } from "vitest";
import { LoopDetector, signature } from "../src/agent/loop-detector.js";

const write = (path: string) => ({ name: "write_file", input: { path, content: "x" } });
const read = (path: string) => ({ name: "read_file", input: { path } });

describe("LoopDetector (R2 revised)", () => {
  it("produces stable signatures regardless of key order", () => {
    expect(signature("t", { a: 1, b: 2 })).toBe(signature("t", { b: 2, a: 1 }));
    expect(signature("t", { a: 1 })).not.toBe(signature("u", { a: 1 }));
  });

  it("warns (soft) on 3 consecutive identical calls", () => {
    const d = new LoopDetector();
    expect(d.record(write("a.txt")).kind).toBe("ok");
    expect(d.record(write("a.txt")).kind).toBe("ok");
    expect(d.record(write("a.txt")).kind).toBe("soft");
  });

  it("forces replan on 5 consecutive identical calls", () => {
    const d = new LoopDetector();
    for (let i = 0; i < 4; i++) d.record(write("a.txt"));
    expect(d.record(write("a.txt")).kind).toBe("replan");
  });

  it("detects oscillating A,B,A,B loops that Cline misses", () => {
    const d = new LoopDetector();
    d.record(write("a.txt"));
    d.record(read("b.txt"));
    d.record(write("a.txt"));
    const verdict = d.record(read("b.txt")); // cycle complete
    expect(verdict.kind).toBe("replan");
    expect(verdict.message).toMatch(/[Oo]scillating/);
  });

  it("does not false-positive on a diverse history", () => {
    const d = new LoopDetector();
    for (let i = 0; i < 6; i++) {
      d.record(write(`file-${i}.txt`));
      d.record(read(`file-${i}.txt`));
    }
    expect(d.record(write("file-6.txt")).kind).toBe("ok");
  });

  it("forces replan after repeated failures on the same target", () => {
    const d = new LoopDetector();
    for (let i = 0; i < 3; i++) {
      const v = d.record({ name: "edit_file", input: { path: "x.ts", oldText: "a", newText: "b" }, target: "path:x.ts", failed: true });
      if (i < 2) expect(v.kind).toBe("ok");
      else expect(v.kind).toBe("replan");
    }
  });

  it("resets cleanly", () => {
    const d = new LoopDetector();
    d.record(write("a.txt"));
    d.record(write("a.txt"));
    d.reset();
    expect(d.record(write("a.txt")).kind).toBe("ok");
  });
});
