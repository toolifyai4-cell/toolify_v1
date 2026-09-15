import { describe, it, expect } from "vitest";
import {
  buildSessionSummary,
  formatDuration,
  formatTokens,
} from "../src/cli/session-summary.js";

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(3_726_000)).toBe("1h 2m 6s");
  });
  it("clamps negative input to zero", () => {
    expect(formatDuration(-5000)).toBe("0s");
  });
});

describe("formatTokens", () => {
  it("groups thousands", () => {
    expect(formatTokens(1500)).toBe("1,500");
  });
});

describe("buildSessionSummary", () => {
  const base = {
    model: "gpt-4o",
    startedAtMs: 1_000,
    endedAtMs: 61_000,
    inputTokens: 120,
    outputTokens: 30,
  };
  it("prints the header, model, tokens, duration and goodbye (no cost row)", () => {
    const out = buildSessionSummary(base);
    expect(out).toContain("TOOLIFY CLI \u2014 Session Summary");
    expect(out).toContain("gpt-4o");
    expect(out).toContain("1m 0s");
    expect(out).toContain("150 tokens");
    expect(out).toContain("Goodbye!");
    expect(out).not.toContain("Session Cost");
  });
  it("renders the zero-usage format without a cost row", () => {
    const out = buildSessionSummary({ ...base, inputTokens: 0, outputTokens: 0 });
    expect(out).toContain("Tokens Used   : 0 tokens");
    expect(out).not.toContain("Session Cost");
  });
});
