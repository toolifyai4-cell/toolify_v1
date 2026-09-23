import { describe, it, expect } from "vitest";
import { activityText, type AgentActivity } from "../src/cli/chat.js";

/**
 * Unit tests for the Claude-style live activity mapping:
 * thinking synonyms rotate, tool runs name the tool, streaming shows
 * "Composing reply…", idle maps to nothing (line hidden).
 */
describe("activityText", () => {
  it("idle maps to nothing", () => {
    expect(activityText({ kind: "idle" }, 0)).toBeUndefined();
  });

  it("thinking cycles Calibrating → Thinking → Processing → Reasoning, then wraps", () => {
    const steps = [0, 1, 2, 3, 4].map((tick) => activityText({ kind: "thinking" }, tick));
    expect(steps).toEqual([
      "Calibrating…",
      "Thinking…",
      "Processing…",
      "Reasoning…",
      "Calibrating…", // wraps back around
    ]);
  });

  it("composing shows the reply line", () => {
    expect(activityText({ kind: "composing" }, 0)).toBe("Composing reply…");
  });

  it("tool phase names the running tool", () => {
    const cases: Array<[AgentActivity, string]> = [
      [{ kind: "tool", name: "read_file" }, "Running read_file…"],
      [{ kind: "tool", name: "terminal" }, "Running terminal…"],
      [{ kind: "tool", name: "write_file" }, "Running write_file…"],
    ];
    for (const [activity, expected] of cases) {
      expect(activityText(activity, 0)).toBe(expected);
    }
  });
});
