/**
 * Session repository contract — an append-only event log with optional state.
 *
 * The existing `SessionStore` (see `src/storage/session.ts`) implements this
 * interface. It was updated to add safe handling of malformed JSONL entries
 * and optional `loadState`/`saveState` methods.
 */
import type { AgentEvent } from "../agent/types.js";

// Re-export the canonical event type.
export type { AgentEvent } from "../agent/types.js";

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/** Minimal mutable state associated with a session. */
export interface SessionState {
  /** Unique session identifier. */
  readonly sessionId: string;
  /** Absolute workspace path. */
  readonly workspace: string;
  /** Provider identifier, e.g. "openai", "anthropic", "mock". */
  readonly provider: string;
  /** Model identifier, e.g. "gpt-4o". */
  readonly model: string;
  /** Execution mode. */
  readonly mode: "plan" | "act";
  /** Current run status. */
  readonly status: "idle" | "running" | "completed" | "error";
  /** Identifier of the current run (if any). */
  readonly currentRunId: string;
  /** Creation timestamp (epoch ms). */
  readonly createdAt: number;
  /** Last update timestamp (epoch ms). */
  readonly updatedAt: number;
  /** Optional task digest text (for display / restore). */
  readonly taskDigest?: string;
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/**
 * Session repository: append-only event persistence + optional state.
 *
 * Preserves JSONL event format and event ordering from the existing
 * `SessionStore`. No database is required.
 */
export interface SessionRepository {
  /** Ensure backing storage exists. */
  init(): Promise<void>;
  /** Append a single event to the log. */
  append(event: AgentEvent): Promise<void>;
  /** Read all events in order. */
  readAll(): Promise<AgentEvent[]>;
  /** Optional: load persisted session state. */
  loadState?(): Promise<SessionState | null>;
  /** Optional: persist session state. */
  saveState?(state: SessionState): Promise<void>;
}
