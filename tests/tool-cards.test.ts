import { describe, it, expect } from "vitest";
import {
  COMMAND_TOOLS,
  EDITOR_TOOLS,
  cardTitle,
  clipLine,
  diffLineArrays,
  highlightLine,
  splitLines,
  summarizeEdit,
  truncateArray,
  truncateLines,
} from "../src/components/ToolCards.js";
import { buildVerificationReport } from "../src/components/verification.js";
import type { ToolCall } from "../src/agent/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const tc = (name: string, input: unknown, id = "c1"): ToolCall => ({
  id,
  name: name as ToolCall["name"],
  input,
});

describe("ToolCards metrics & folding", () => {
  it("folds long output to head + `... N more lines` + tail", () => {
    const text = Array.from({ length: 23 }, (_, i) => `line-${i + 1}`).join("\n");
    const t = truncateLines(text, 8, 4);
    expect(t.summary).toBe("... 11 more lines");
    expect(t.head).toHaveLength(8);
    expect(t.tail).toHaveLength(4);
    expect(t.head[0]).toBe("line-1");
    expect(t.tail[3]).toBe("line-23");
  });

  it("folds wide windows too (44 more lines summary)", () => {
    const text = Array.from({ length: 60 }, (_, i) => `l${i}`).join("\n");
    const t = truncateLines(text, 12, 4);
    expect(t.summary).toBe("... 44 more lines");
  });

  it("leaves short output untouched", () => {
    const t = truncateLines("a\nb\nc");
    expect(t.summary).toBeNull();
    expect(t.head).toEqual(["a", "b", "c"]);
    expect(t.tail).toEqual([]);
  });

  it("truncateArray reports the hidden count for any array type", () => {
    const t = truncateArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, 2);
    expect(t.hidden).toBe(5);
    expect(t.summary).toBe("... 5 more lines");
    expect(t.head).toEqual([1, 2, 3]);
    expect(t.tail).toEqual([9, 10]);
  });

  it("splitLines drops the trailing newline element", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });

  it("clipLine truncates runaway lines with an ellipsis", () => {
    expect(clipLine("x".repeat(200), 10)).toBe("xxxxxxxxxx…");
    expect(clipLine("short", 10)).toBe("short");
  });
});

describe("ToolCards diff + summary", () => {
  it("computes a single-hunk diff (common prefix/suffix stripped)", () => {
    const diff = diffLineArrays(["a", "b", "c", "d"], ["a", "b", "X", "Y", "d"]);
    expect(diff.removed).toEqual(["c"]);
    expect(diff.added).toEqual(["X", "Y"]);
  });

  it("summarizes a brand-new file as L+N lines (new)", () => {
    const content = Array.from({ length: 44 }, (_, i) => `export const v${i + 1} = 1;`).join("\n");
    const s = summarizeEdit(tc("write_file", { path: "src/gen.ts", content }));
    expect(s).toEqual({ added: 44, removed: 0, isNew: true });
  });

  it("summarizes an edit as L+added lines / -removed lines", () => {
    const common = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const oldText = [...common, "r1", "r2", "r3", "r4"].join("\n");
    const newText = [...common, ...Array.from({ length: 12 }, (_, i) => `nm${i}`)].join("\n");
    const s = summarizeEdit(tc("edit_file", { path: "src/e.ts", oldText, newText }));
    expect(s).toEqual({ added: 12, removed: 4, isNew: false });
  });

  it("returns null when the editor inputs are missing", () => {

describe("ToolCards titles", () => {
  it("maps command tools to `* run_commands(<cmd>)`", () => {
    expect(cardTitle(tc("terminal", { command: "echo hi" }))).toBe("* run_commands(echo hi)");
    expect(cardTitle(tc("execute_command", { command: "npm test" }))).toBe(
      "* run_commands(npm test)",
    );
  });

  it("maps editor tools to `* editor(<path>)`", () => {
    expect(cardTitle(tc("write_file", { path: "src/a.ts", content: "x" }))).toBe(
      "* editor(src/a.ts)",
    );
    expect(cardTitle(tc("replace_in_file", { path: "a.ts", oldText: "", newText: "" }))).toBe(
      "* editor(a.ts)",
    );
  });

  it("keeps other tools as `* <name>(<arg>)`", () => {
    expect(cardTitle(tc("read_file", { path: "a.ts" }))).toBe("* read_file(a.ts)");
    expect(cardTitle(tc("grep", { pattern: "TODO" }))).toBe("* grep(TODO)");
  });

  it("exposes the tool-name sets used for card selection", () => {
    expect(COMMAND_TOOLS.has("terminal")).toBe(true);
    expect(COMMAND_TOOLS.has("execute_command")).toBe(true);
    expect(EDITOR_TOOLS.has("write_file")).toBe(true);
    expect(EDITOR_TOOLS.has("replace_in_file")).toBe(true);
    expect(COMMAND_TOOLS.has("read_file")).toBe(false);
  });
});

describe("ToolCards syntax highlighting", () => {
  it("colorizes tokens but keeps the visible text intact", () => {
    const raw = highlightLine('const x = "hi"; // note 42');
    expect(stripAnsi(raw)).toBe('const x = "hi"; // note 42');
    expect(raw).not.toBe('const x = "hi"; // note 42'); // ANSI applied
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi(highlightLine("plain text"))).toBe("plain text");
  });
});

describe("verification report format", () => {
  it("builds markdown checkmarks for passes and failures", () => {
    const report = buildVerificationReport([
      { name: "calls onExit", command: "npm test", passed: true },
      { name: "typecheck", command: "npx tsc --noEmit", passed: false },
    ]);
    expect(report).toContain("### Verification");
    expect(report).toContain("- [x] **calls onExit**");
    expect(report).toContain("- [ ] **typecheck**");
  });

  it("falls back to the command when no name is provided", () => {
    const report = buildVerificationReport([{ name: "", command: "npm run lint", passed: true }]);
    expect(report).toContain("- [x] **npm run lint**");
  });

  it("reports an empty checklist cleanly", () => {
    expect(buildVerificationReport([])).toBe("### Verification\n(no checks ran)");
  });
});

    expect(summarizeEdit(tc("write_file", { path: "x.ts" }))).toBeNull();
    expect(summarizeEdit(tc("edit_file", { path: "x.ts" }))).toBeNull();
    expect(summarizeEdit(tc("read_file", { path: "x.ts" }))).toBeNull();
  });
});
