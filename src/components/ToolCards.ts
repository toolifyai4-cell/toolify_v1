import type { ToolCall } from "../agent/types.js";

/**
 * Act Mode tool-card rendering helpers:
 *  - truncateLines: head/tail output folding with `... N more lines`
 *  - diffLineArrays / summarizeEdit: L+N/-N line metrics for the editor card
 *  - highlightLine: lightweight syntax highlighting for the code/diff body
 *  - ToolCallCard: `* run_commands(...)` and `* editor(...)` render cards
 */

const RESET = "\u001b[0m";
const DIM_C = "\u001b[2m";
const GREEN_C = "\u001b[32m";
const RED_C = "\u001b[31m";
const YELLOW_C = "\u001b[33m";
const MAGENTA_C = "\u001b[35m";

/** Tool names rendered as a command-execution card. */
export const COMMAND_TOOLS = new Set<string>(["terminal", "execute_command"]);
/** Tool names rendered as a file-modification / diff card. */
export const EDITOR_TOOLS = new Set<string>(["write_file", "edit_file", "replace_in_file"]);

/** Split text into lines, dropping a single trailing newline's empty element. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export interface TruncatedLines<T> {
  readonly head: T[];
  readonly tail: T[];
  readonly hidden: number;
  readonly summary: string | null;
}

/** Fold a long array to head + `... N more lines` + tail. */
export function truncateArray<T>(items: readonly T[], head: number, tail: number): TruncatedLines<T> {
  if (items.length <= head + tail) {
    return { head: [...items], tail: [], hidden: 0, summary: null };
  }
  const hidden = items.length - head - tail;
  return {
    head: items.slice(0, head),
    tail: items.slice(items.length - tail),
    hidden,
    summary: `... ${hidden} more lines`,
  };
}

/** Fold terminal/file output text to a head/tail window with a summary line. */
export function truncateLines(text: string, head = 8, tail = 4): TruncatedLines<string> {
  return truncateArray(splitLines(text), head, tail);
}

export interface LineDiff {
  readonly added: string[];
  readonly removed: string[];
}

/** Single-hunk diff: strip the common prefix and suffix, keep the middle. */
export function diffLineArrays(oldLines: readonly string[], newLines: readonly string[]): LineDiff {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;
  return {
    removed: oldLines.slice(prefix, oldLines.length - suffix),
    added: newLines.slice(prefix, newLines.length - suffix),
  };
}

export interface EditSummary {
  readonly added: number;
  readonly removed: number;
  readonly isNew: boolean;
}

/** Line metrics for an editor-card tool call, or null when inputs are missing. */
export function summarizeEdit(call: ToolCall): EditSummary | null {
  const input = (call.input ?? {}) as Record<string, unknown>;
  if (call.name === "write_file") {
    if (typeof input.content !== "string") return null;
    return { added: splitLines(input.content).length, removed: 0, isNew: true };
  }
  if (call.name === "edit_file") {
    if (typeof input.oldText !== "string" || typeof input.newText !== "string") return null;
    const diff = diffLineArrays(splitLines(input.oldText), splitLines(input.newText));
    return { added: diff.added.length, removed: diff.removed.length, isNew: false };
  }
  return null;
}

export function cardDiff(
  oldLines: readonly string[],
  newLines: readonly string[],
): LineDiff | null {
  if (oldLines.length === 0 && newLines.length === 0) return null;
  return diffLineArrays(oldLines, newLines);
}
const TOKEN_RE =
  /(\/\/.*$)|((?<=^|\s)#[^\s].*$)|("[^"]*"|'[^']*'|`[^`]*`)|\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|export|from|default|class|extends|new|async|await|try|catch|finally|throw|typeof|instanceof|interface|type|enum|readonly|static|null|undefined|true|false|this|void|as|in|of)\b|(0x[0-9a-fA-F_]+|\b\d[\d_]*(?:\.\d+)?\b)/g;

/** Color one source line: comments dim, strings green, keywords magenta, numbers yellow. */
export function highlightLine(line: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    out += line.slice(last, m.index);
    if (m[1] !== undefined || m[2] !== undefined) out += DIM_C + m[0] + RESET;
    else if (m[3] !== undefined) out += GREEN_C + m[0] + RESET;
    else if (m[4] !== undefined) out += MAGENTA_C + m[0] + RESET;
    else out += YELLOW_C + m[0] + RESET;
    last = m.index + m[0].length;
  }
  return out + line.slice(last);
}

/** Clip one rendered line so a card never overflows the terminal width. */
export function clipLine(line: string, max = 160): string {
  return line.length > max ? line.slice(0, max) + "…" : line;
}

/** `* run_commands(<cmd>)` / `* editor(<path>)` / `* <tool>(<arg>)`. */
export function cardTitle(call: ToolCall): string {
  const input = (call.input ?? {}) as Record<string, unknown>;
  let arg = "";
  for (const key of ["path", "command", "pattern"]) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) {
      arg = v.length <= 120 ? v : v.slice(0, 119) + "…";
      break;
    }
  }
  if (!arg) {
    try {
      const j = JSON.stringify(input) ?? "{}";
      arg = j.length <= 80 ? j : j.slice(0, 79) + "…";
    } catch {
      arg = "?";
    }
  }
  const display = COMMAND_TOOLS.has(call.name)
    ? "run_commands"
    : EDITOR_TOOLS.has(call.name)
      ? "editor"
      : call.name;
  return `* ${display}(${arg})`;
}
