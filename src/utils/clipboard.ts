/**
 * Clipboard helpers for the Toolify terminal TUI (nexipi).
 *
 * Uses native Windows `clip.exe` so no extra npm dependency is required.
 * Paste is handled by Ink's built-in `usePaste` hook.
 *
 * All operations fail silently when clipboard access is unavailable,
 * so the UI never crashes because of clipboard issues.
 */

import { execFileSync } from "node:child_process";

/** Copy text to the Windows clipboard. Returns false on failure. */
export function copyToClipboard(text: string): boolean {
  try {
    execFileSync("clip.exe", [], { input: text, encoding: "utf8", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}