import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { PathGuard } from "./fs-tools.js";

const execAsync = promisify(exec);

export interface TerminalResult {
  output: string;
  exitCode: number;
}

const MAX_OUTPUT = 32_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function capOutput(s: string): string {
  return s.length > MAX_OUTPUT
    ? s.slice(0, MAX_OUTPUT) + `\n[truncated, ${s.length} chars total]`
    : s;
}

/**
 * Terminal tool — PowerShell-first on Windows (R8), bash elsewhere.
 * Runs with workspace cwd, hard timeout, and output cap.
 */
export async function terminalTool(
  guard: PathGuard,
  input: { command: string; timeoutMs?: number },
): Promise<TerminalResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isWindows = process.platform === "win32";
  const opts = {
    cwd: guard.root,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8" as const,
  };

  const cmd = isWindows
    ? `powershell.exe -NoProfile -NonInteractive -Command "${input.command.replace(/"/g, '\\"')}"`
    : input.command;

  try {
    const r = await execAsync(cmd, opts);
    return { output: capOutput(`${r.stdout ?? ""}${r.stderr ?? ""}`), exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message: string };
    return {
      output: capOutput(`${e.stdout ?? ""}${e.stderr ?? ""}${e.message}`),
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}
