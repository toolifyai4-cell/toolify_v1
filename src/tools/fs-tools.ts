import { exec } from "node:child_process";
import { promisify } from "node:util";
import { stat, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, resolve, dirname, sep } from "node:path";

const execAsync = promisify(exec);

/** Shared path-safety guard: every tool path must resolve inside the workspace. */
export class PathGuard {
  readonly root: string;
  constructor(readonly workspace: string) {
    this.root = resolve(workspace);
  }

  guard(p: string): string {
    const abs = resolve(this.root, p);
    const rootWithSep = this.root.endsWith(sep) ? this.root : this.root + sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new Error(
        `Path escapes workspace: "${p}" resolves to ${abs}, outside ${this.root}`,
      );
    }
    return abs;
  }
}

// ---------------------------------------------------------------------------
// File tools
// ---------------------------------------------------------------------------

const IGNORED_DIRS = ["node_modules", ".git", "dist", ".toolify"];

export async function readFileTool(
  guard: PathGuard,
  input: { path: string },
): Promise<string> {
  const abs = guard.guard(input.path);
  const st = await stat(abs);
  if (st.size > 512 * 1024) {
    return `File too large to read fully (${st.size} bytes). Read a range instead.`;
  }
  const buf = await readFile(abs);
  return buf.toString("utf8");
}

export async function writeFileTool(
  guard: PathGuard,
  input: { path: string; content: string },
): Promise<string> {
  const abs = guard.guard(input.path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, input.content, "utf8");
  return `Wrote ${Buffer.byteLength(input.content, "utf8")} bytes to ${input.path}`;
}

/** Line-based edit: replace exact old text with new text (must match exactly once). */
export async function editFileTool(
  guard: PathGuard,
  input: { path: string; oldText: string; newText: string },
): Promise<string> {
  const abs = guard.guard(input.path);
  const src = (await readFile(abs, "utf8")).toString();
  const occurrences = src.split(input.oldText).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_text not found in ${input.path}`);
  }
  if (occurrences > 1) {
    throw new Error(
      `old_text matches ${occurrences} times in ${input.path}; include more surrounding context so it matches exactly once`,
    );
  }
  const updated = src.replace(input.oldText, input.newText);
  await writeFile(abs, updated, "utf8");
  return `Edited ${input.path}: replaced ${input.oldText.length} chars with ${input.newText.length} chars`;
}

export async function statTool(guard: PathGuard, p: string): Promise<boolean> {
  try {
    await stat(guard.guard(p));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Glob matcher (minimal: supports *, **, ?)
// ---------------------------------------------------------------------------

export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        while (pattern[i + 1] === "/" || pattern[i + 1] === "\\") i++;
      } else {
        re += "[^/\\\\]*";
      }
    } else if (c === "?") {
      re += "[^/\\\\]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(re);
}
