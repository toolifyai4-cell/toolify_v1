import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../agent/types.js";

/**
 * Append-only JSONL event log per session (free observability, replayable,
 * resumable). Every agent step is persisted here.
 */
export class SessionStore {
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

  async readAll(): Promise<AgentEvent[]> {
    let raw: string;
    try {
      raw = (await readFile(this.logPath, "utf8")).toString();
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as AgentEvent);
  }

  static newId(): string {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
