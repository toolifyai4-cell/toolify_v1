import { readdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { type PathGuard, globToRegExp } from "./fs-tools.js";

const MAX_WALK_DEPTH = 8;
const IGNORED_DIRS = ["node_modules", ".git", "dist", ".toolify"];

/**
 * Strip wrapping quotes/whitespace from a model-supplied pattern.
 *
 * Weaker models frequently emit a pattern with the quotes *inside* the string
 * value, e.g. a double-quoted glob whose quotes end up as literal characters.
 * Without this, glob matching treats those quotes as part of the filename and
 * reports "No files matched", wasting a whole agent turn.
 *
 * Only symmetric wrapping quotes are removed, so a legitimate pattern that
 * merely contains a quote internally is left untouched.
 */
export function normalizePattern(raw: string): string {
  let p = raw.trim();
  for (let i = 0; i < 2; i++) {
    const first = p[0];
    const last = p[p.length - 1];
    const isQuote =
      (first === '"' && last === '"') || (first === "'" && last === "'");
    if (!isQuote || p.length < 2) break;
    p = p.slice(1, -1).trim();
  }
  return p;
}

export async function globTool(
  guard: PathGuard,
  input: { pattern: string },
): Promise<string> {
  const rawPattern = normalizePattern(input.pattern);
  const pattern = rawPattern.toLowerCase();
  const files: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH || files.length > 500) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = `${dir}\\${e.name}`;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.includes(e.name)) continue;
        await walk(full, depth + 1);
      } else if (
        globToRegExp(pattern).test(e.name.toLowerCase()) ||
        globToRegExp(pattern).test(full.toLowerCase())
      ) {
        files.push(full);
        if (files.length > 500) return;
      }
    }
  }

  const root = guard.root;
  try {
    const st = await stat(root);
    if (!st.isDirectory()) await walk(dirname(root), 0);
    else await walk(root, 0);
  } catch {
    return `Workspace not accessible: ${root}`;
  }
  void stat;
  void readdir;
  return files.length > 0
    ? files.slice(0, 500).join("\n")
    : `No files matched pattern "${rawPattern}"`;
}

export async function grepTool(
  guard: PathGuard,
  input: { pattern: string; glob?: string },
): Promise<string> {
  const { readdir: rd } = await import("node:fs/promises");
  const regex = new RegExp(input.pattern, "i");
  const globRe = input.glob ? globToRegExp(input.glob.toLowerCase()) : null;
  const hits: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH || hits.length > 200) return;
    let entries;
    try {
      entries = await rd(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = `${dir}\\${e.name}`;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.includes(e.name)) continue;
        await walk(full, depth + 1);
      } else if (!globRe || globRe.test(e.name.toLowerCase())) {
        try {
          const src = (await readFile(full, "utf8")).toString();
          if (src.includes("\u0000")) continue; // binary
          const lines = src.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              hits.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              if (hits.length > 200) return;
            }
          }
        } catch {
          // unreadable — skip
        }
      }
    }
  }
  await walk(guard.root, 0);
  return hits.length > 0
    ? hits.join("\n")
    : `No matches for pattern "${input.pattern}"`;
}
