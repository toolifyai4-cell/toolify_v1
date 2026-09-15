export interface SessionSummary {
  readonly model: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
}

export function formatDuration(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

const RULE = "─".repeat(55);

export function buildSessionSummary(summary: SessionSummary): string {
  const totalTokens = summary.inputTokens + summary.outputTokens;
  const duration = formatDuration(summary.endedAtMs - summary.startedAtMs);
  return [
    RULE,
    "  TOOLIFY CLI — Session Summary",
    RULE,
    `  Model         : ${summary.model}`,
    `  Duration      : ${duration}`,
    `  Tokens Used   : ${formatTokens(totalTokens)} tokens`,
    RULE,
    "  Goodbye!",
    "",
  ].join("\n");
}
