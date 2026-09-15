import type { ModelMessage, ModelAdapter, Usage } from "./types.js";
import type { TaskDigest } from "./digest.js";

/**
 * ContextManager (R1): proactive context budgeting and compaction.
 *
 * Cline's compaction is *reactive* — it kicks in only after a context-window
 * overflow error, retrying once. TOOLIFY compacts *proactively* before the
 * window fills: it estimates tokens per turn, and when usage crosses the
 * threshold it summarizes older turns (via a cheap single-model call),
 * while the TaskDigest stays pinned so early requirements survive.
 */

export interface ContextManagerConfig {
  /** Model context window (tokens). */
  contextWindow: number;
  /** Compact when estimated tokens exceed this fraction of the window. */
  compactAtFraction: number;
  /** Keep this many most-recent messages verbatim after compaction. */
  keepRecent: number;
  /** Reserve for the next model output. */
  outputReserve: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextManagerConfig = {
  contextWindow: 128_000,
  compactAtFraction: 0.7,
  keepRecent: 6,
  outputReserve: 8_000,
};

/** Rough token estimate (~4 chars/token, +overhead per message). */
export function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length + 8;
    for (const tc of m.toolCalls ?? []) {
      chars += JSON.stringify(tc.input ?? {}).length + 32;
    }
    for (const r of m.toolResults ?? []) {
      chars += r.content.length + 8;
    }
  }
  return Math.ceil(chars / 4);
}

export interface CompactionResult {
  messages: ModelMessage[];
  summarizedCount: number;
  keptCount: number;
  didCompact: boolean;
}

export class ContextManager {
  readonly config: ContextManagerConfig;
  /** Rolling totals for the live meter. */
  totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };

  constructor(
    private readonly adapter: ModelAdapter,
    private readonly digest: TaskDigest,
    config: Partial<ContextManagerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
  }

  estimate(messages: ModelMessage[]): number {
    return estimateTokens(messages);
  }

  shouldCompact(messages: ModelMessage[]): boolean {
    const budget =
      this.config.contextWindow * this.config.compactAtFraction -
      this.config.outputReserve;
    return this.estimate(messages) > budget;
  }

  async maybeCompact(messages: ModelMessage[]): Promise<CompactionResult> {
    if (!this.shouldCompact(messages)) {
      return { messages, summarizedCount: 0, keptCount: messages.length, didCompact: false };
    }

    const keep = Math.min(this.config.keepRecent, messages.length);
    const older = messages.slice(0, messages.length - keep);
    const recent = messages.slice(messages.length - keep);

    const olderText = older
      .map((m) => {
        const tcs = (m.toolCalls ?? [])
          .map((tc) => `[tool: ${tc.name} ${JSON.stringify(tc.input).slice(0, 200)}]`)
          .join(" ");
        const trs = (m.toolResults ?? [])
          .map((r) => `[result${r.isError ? " ERROR" : ""}: ${r.content.slice(0, 200)}]`)
          .join(" ");
        return `${m.role}: ${m.content} ${tcs} ${trs}`;
      })
      .join("\n");

    const summaryText = await this.adapter.chat({
      system:
        "Summarize this coding-agent conversation excerpt into at most 150 words. " +
        "Preserve: the user's requirements, key decisions, current approach, and any errors to avoid repeating.",
      messages: [{ role: "user", content: olderText.slice(0, 30_000) }],
      tools: [],
      maxOutputTokens: 400,
    });

    const summaryMessage: ModelMessage = {
      role: "user",
      content:
        `[Earlier conversation summarized to preserve requirements — ${older.length} messages compacted. Digest below is authoritative for the task goal.]\n` +
        `Summary: ${summaryText.text}`,
    };

    return {
      messages: [summaryMessage, ...recent],
      summarizedCount: older.length,
      keptCount: recent.length,
      didCompact: true,
    };
  }
}
