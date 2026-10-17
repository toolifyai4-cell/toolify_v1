/**
 * Clipboard helpers for the Toolify terminal TUI (nexipi).
 *
 * Uses native Windows tools so no extra npm dependency is required:
 *   - copy:  spawn `clip.exe`, pipe text to stdin
 *   - paste: spawn PowerShell `Get-Clipboard`, read stdout
 *
 * All operations fail silently (return empty / no-op) when clipboard access
 * is unavailable, so the UI never crashes because of clipboard issues.
 */

import { execFileSync, execSync } from "node:child_process";

/** Copy text to the Windows clipboard. Returns false on failure. */
export function copyToClipboard(text: string): boolean {
  try {
    execFileSync("clip.exe", [], { input: text, encoding: "utf8", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Read text from the Windows clipboard. Returns "" on failure or empty. */
export function readFromClipboard(): string {
  try {
    return execSync('powershell -NoProfile -Command "Get-Clipboard"', {
      encoding: "utf8",
      windowsHide: true,
    }).replace(/\r?\n$/, "");
  } catch {
    return "";
  }
}