import { createHash } from "node:crypto";

export type ToolCallSignature = string;

/**
 * Tool call signature: stable hash of name + sorted-JSON input.
 * (Sorted keys, like Cline's `toolCallSignature` — but hashed so signatures
 * are compact in history.)
 */
export function signature(name: string, input: unknown): ToolCallSignature {
  const sorted = sortKeys(input);
  const h = createHash("sha256");
  h.update(name);
  h.update("\u0000");
  h.update(JSON.stringify(sorted));
  return h.digest("hex").slice(0, 16);
}

function sortKeys(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// LoopDetector (R2 revised): strategy-diversity detection
//
// Cline's `LoopDetectionTracker` only counts *consecutive identical* calls
// (soft=3/hard=5) and then merely STOPS the run. TOOLIFY additionally catches:
//   1. Oscillating loops: A,B,A,B (or A,B,C,A,B,C) signature cycles
//   2. Semantic loops: same tool + same target path with repeated *failing*
//      results (e.g. edit_file failing 3x on the same file)
// and, on trigger, returns a `replan` verdict that makes the agent inject a
// forced re-plan event (a strategy-change prompt) instead of just stopping.
// ---------------------------------------------------------------------------

export interface LoopVerdict {
  kind: "ok" | "soft" | "hard" | "replan";
  message?: string;
}

export interface LoopDetectorConfig {
  softThreshold: number; // consecutive identical — warn
  hardThreshold: number; // consecutive identical — replan
  cycleLength: number; // repeating signature cycle of this length detected
  cycleRepeats: number; // ...observed this many times
  maxFailedOnSameTarget: number; // failing edits on the same path
}

export const DEFAULT_LOOP_CONFIG: LoopDetectorConfig = {
  softThreshold: 3,
  hardThreshold: 5,
  cycleLength: 2,
  cycleRepeats: 2,
  maxFailedOnSameTarget: 3,
};

interface CallRecord {
  sig: string;
  tool: string;
  target?: string;
  failed: boolean;
}

export class LoopDetector {
  private readonly config: LoopDetectorConfig;
  private readonly history: CallRecord[] = [];
  private consecutiveIdentical = 0;
  private readonly failedByTarget = new Map<string, number>();

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_LOOP_CONFIG, ...config };
  }

  record(call: {
    name: string;
    input: unknown;
    target?: string;
    failed?: boolean;
  }): LoopVerdict {
    const sig = signature(call.name, call.input);
    const rec: CallRecord = {
      sig,
      tool: call.name,
      target: call.target,
      failed: call.failed === true,
    };

    // 1. Consecutive identical (Cline-parity behavior).
    const last = this.history[this.history.length - 1];
    if (last && last.sig === sig) {
      this.consecutiveIdentical++;
    } else {
      this.consecutiveIdentical = 1;
    }

    // 2. Failed-by-target tracker (semantic loop detection).
    if (rec.target) {
      const n = (this.failedByTarget.get(rec.target) ?? 0) + (rec.failed ? 1 : 0);
      this.failedByTarget.set(rec.target, n);
    }

    this.history.push(rec);

    if (rec.failed && rec.target) {
      const fails = this.failedByTarget.get(rec.target) ?? 0;
      if (fails >= this.config.maxFailedOnSameTarget) {
        return {
          kind: "replan",
          message: `Failed ${fails} times on the same target ("${rec.target}"); forcing a strategy change instead of retrying the same approach.`,
        };
      }
    }

    if (this.consecutiveIdentical >= this.config.hardThreshold) {
      return {
        kind: "replan",
        message: `${this.consecutiveIdentical} consecutive identical calls to "${call.name}"; forcing a strategy change.`,
      };
    }

    if (this.consecutiveIdentical >= this.config.softThreshold) {
      return {
        kind: "soft",
        message: `${this.consecutiveIdentical} consecutive identical calls to "${call.name}"; consider a different approach.`,
      };
    }

    // 3. Oscillating cycle detection: the last cycleLength*repeats signatures
    //    (including the current call) form a repeating pattern.
    const span = this.config.cycleLength * this.config.cycleRepeats;
    if (this.history.length >= span) {
      const recent = this.history.slice(-span).map((r) => r.sig);
      const head = recent.slice(0, this.config.cycleLength);
      const rest = recent.slice(this.config.cycleLength);
      const isCycle = rest.every((s, i) => s === head[i % head.length]) &&
        new Set(head).size === head.length;
      if (isCycle) {
        return {
          kind: "replan",
          message: `Oscillating loop detected: ${head.length}-signature cycle repeating ${this.config.cycleRepeats}x; forcing a strategy change.`,
        };
      }
    }

    return { kind: "ok" };
  }

  reset(): void {
    this.history.length = 0;
    this.consecutiveIdentical = 0;
    this.failedByTarget.clear();
  }
}
