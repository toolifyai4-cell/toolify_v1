import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../agent/types.js";
import type { SessionRepository, SessionState } from "../persistence/session-repository.js";

/**
 * Append-only JSONL event log per session (free observability, replayable,
 * resumable). Every agent step is persisted here.
 *
 * Implements the `SessionRepository` contract (see `src/persistence/session-repository.ts`).
 */
export class SessionStore implements SessionRepository {
  readonly sessionDir: string;
  private readonly logPath: string;

  constructor(private readonly workspace: string, readonly id: string) {
    this.sessionDir = join(workspace, ".toolify", "sessions", id);
    this.logPath = join(this.sessionDir, "events.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
  }

  async append(e: AgentEvent): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    await appendFile(this.logPath, JSON.stringify(e) + "\n", "utf8");
  }

  /**
   * Read all events in order.
   *
   * Malformed JSONL lines are silently skipped rather than crashing the
   * session replay, so a truncated or corrupted log never blocks the agent.
   */
  async readAll(): Promise<AgentEvent[]> {
    let raw: string;
    try {
      raw = (await readFile(this.logPath, "utf8")).toString();
    } catch {
      return [];
    }
    const events: AgentEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        // Malformed entry — skip to preserve order of valid events.
      }
    }
    return events;
  }

  /** Optional state persistence (implements `SessionRepository.saveState`). */
  async saveState?(state: SessionState): Promise<void> {
    await this.init();
    await writeFile(
      join(this.sessionDir, "state.json"),
      JSON.stringify(state, null, 2),
      "utf8",
    );
  }

  /** Optional state loading (implements `SessionRepository.loadState`). */
  async loadState?(): Promise<SessionState | null> {
    try {
      const raw = await readFile(
        join(this.sessionDir, "state.json"),
        "utf8",
      );
      return JSON.parse(raw) as SessionState;
    } catch {
      return null;
    }
  }

  static newId(): string {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
