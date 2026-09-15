import { createHash } from "node:crypto";

/**
 * TaskDigest (R6): auto-maintained task state that survives compaction.
 *
 * Cline's memory bank is fully manual. TOOLIFY pins a rolling digest —
 * goal, decisions, open questions, touched-file map — that is re-injected
 * verbatim into the system prompt after every compaction, so early
 * requirements are never truncated away.
 */
export interface TaskDigestState {
  goal: string;
  decisions: string[];
  openQuestions: string[];
  touchedFiles: Map<string, "created" | "modified" | "read">;
  summary: string;
}

export class TaskDigest {
  state: TaskDigestState;

  constructor(goal: string) {
    this.state = {
      goal,
      decisions: [],
      openQuestions: [],
      touchedFiles: new Map(),
      summary: "",
    };
  }

  setGoal(goal: string): void {
    this.state.goal = goal;
  }

  addDecision(d: string): void {
    if (!this.state.decisions.includes(d)) this.state.decisions.push(d);
  }

  addOpenQuestion(q: string): void {
    if (!this.state.openQuestions.includes(q)) this.state.openQuestions.push(q);
  }

  touchFile(path: string, kind: "created" | "modified" | "read"): void {
    // Don't downgrade "created"/"modified" to "read".
    const prev = this.state.touchedFiles.get(path);
    if (prev === "created" || prev === "modified") return;
    this.state.touchedFiles.set(path, kind);
  }

  /** Renders the digest as text pinned into the system prompt. */
  render(): string {
    const s = this.state;
    const files = [...s.touchedFiles.entries()]
      .map(([p, k]) => `  - ${p} (${k})`)
      .join("\n");
    return [
      "=== TASK STATE DIGEST (pinned — survives compaction) ===",
      `Goal: ${s.goal}`,
      s.decisions.length ? `Decisions:\n${s.decisions.map((d) => `  - ${d}`).join("\n")}` : "",
      s.openQuestions.length ? `Open questions:\n${s.openQuestions.map((q) => `  - ${q}`).join("\n")}` : "",
      files ? `Touched files:\n${files}` : "",
      s.summary ? `Progress summary: ${s.summary}` : "",
      "=== END DIGEST ===",
    ]
      .filter(Boolean)
      .join("\n");
  }

  hash(): string {
    return createHash("sha256").update(this.render()).digest("hex").slice(0, 12);
  }
}
