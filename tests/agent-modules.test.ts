import { describe, it, expect } from "vitest";
import { TaskDigest } from "../src/agent/digest.js";
import { estimateTokens } from "../src/agent/context.js";
import { CostMeter } from "../src/agent/meter.js";
import { MockModelAdapter, type MockTurn } from "../src/models/mock.js";

describe("TaskDigest (R6)", () => {
  it("renders goal, decisions, and touched files", () => {
    const d = new TaskDigest("Build a calculator");
    d.addDecision("use TypeScript");
    d.touchFile("calc.ts", "created");
    const text = d.render();
    expect(text).toContain("Build a calculator");
    expect(text).toContain("use TypeScript");
    expect(text).toContain("calc.ts (created)");
  });

  it("does not downgrade created/modified to read", () => {
    const d = new TaskDigest("goal");
    d.touchFile("a.ts", "created");
    d.touchFile("a.ts", "read");
    expect(d.render()).toContain("a.ts (created)");
  });
});

describe("ContextManager estimation (R1)", () => {
  it("estimates tokens roughly by chars/4", () => {
    const est = estimateTokens([{ role: "user", content: "x".repeat(400) }]);
    expect(est).toBeGreaterThan(90);
    expect(est).toBeLessThan(120);
  });
});

describe("CostMeter (R1 live meter)", () => {
  it("accumulates usage and cost", () => {
    const m = new CostMeter({ inputPerM: 3, outputPerM: 15 });
    m.add({ inputTokens: 1_000_000, outputTokens: 100_000 });
    const r = m.add({ inputTokens: 1_000_000, outputTokens: 100_000 });
    expect(r.usage.inputTokens).toBe(2_000_000);
    expect(r.costUsd).toBeCloseTo(6 + 1.5 + 1.5, 5); // 2M in @ $3 + 200k out @ $15
  });
});

describe("MockModelAdapter", () => {
  it("consumes scripted turns in order and records requests", async () => {
    const turns: MockTurn[] = [
      { text: "thinking…" },
      { toolCalls: [{ name: "read_file", input: { path: "a.ts" } }] },
      { text: "done", finishReason: "stop" },
    ];
    const adapter = new MockModelAdapter(turns);
    const r1 = await adapter.chat({ system: "s", messages: [{ role: "user", content: "go" }], tools: [] });
    expect(r1.text).toBe("thinking…");
    const r2 = await adapter.chat({ system: "s", messages: [{ role: "user", content: "go" }], tools: [] });
    expect(r2.toolCalls[0].name).toBe("read_file");
    expect(adapter.requests).toHaveLength(2);
  });
});
