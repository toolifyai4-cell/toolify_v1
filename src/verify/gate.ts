import { terminalTool } from "../tools/terminal-tool.js";
import type { PathGuard } from "../tools/fs-tools.js";
import type { AgentEvent } from "../agent/types.js";

/**
 * VerificationGate (R4).
 *
 * Cline has no test/lint gate — "done" is whatever the model claims.
 * TOOLIFY requires the configured verification commands (typecheck/test/lint)
 * to PASS before a run may finish with success; a failure is fed back into
 * the loop as an error tool-result so the model fixes it.
 */

export interface VerificationConfig {
  /** Commands that must pass, in order (e.g. typecheck, test, lint). */
  commands: Array<{ name: string; command: string }>;
  /** Stop the run after this many failed verification rounds. */
  maxRounds: number;
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  commands: [],
  maxRounds: 3,
};

export interface VerificationOutcome {
  passed: boolean;
  rounds: number;
  results: Array<{ name: string; command: string; passed: boolean; output: string }>;
}

/**
 * Verification service contract.
 *
 * The runtime depends on this interface, not on the concrete `VerificationGate`
 * class. Existing callers that cast to `VerificationGate` still work.
 */
export interface VerificationService {
  readonly enabled: boolean;
  readonly maxRounds: number;
  run(): Promise<VerificationOutcome>;
  failureFeedback(outcome: VerificationOutcome): string;
}

export class VerificationGate implements VerificationService {
  readonly config: VerificationConfig;

  constructor(
    private readonly guard: PathGuard,
    private readonly emit: (e: AgentEvent) => void,
    config: Partial<VerificationConfig> = {},
  ) {
    this.config = { ...DEFAULT_VERIFICATION_CONFIG, ...config };
  }

  get enabled(): boolean {
    return this.config.commands.length > 0;
  }

  /** Convenience accessor for the maximum verification rounds. */
  get maxRounds(): number {
    return this.config.maxRounds;
  }

  async run(): Promise<VerificationOutcome> {
    const results: VerificationOutcome["results"] = [];
    let rounds = 0;
    let passed = true;

    while (rounds < this.config.maxRounds) {
      results.length = 0;
      passed = true;
      for (const c of this.config.commands) {
        const r = await terminalTool(this.guard, { command: c.command });
        const ok = r.exitCode === 0;
        results.push({ name: c.name, command: c.command, passed: ok, output: r.output });
        this.emit({
          type: "verification",
          command: c.command,
          passed: ok,
          output: r.output.slice(0, 2000),
          ts: Date.now(),
        });
        if (!ok) {
          passed = false;
          break;
        }
      }
      if (passed) return { passed: true, rounds: rounds + 1, results };
      rounds++;
    }
    return { passed: false, rounds, results };
  }

  /** Formats the last failing result as tool-result content for the loop. */
  static failureFeedback(outcome: VerificationOutcome): string {
    const failed = outcome.results.find((r) => !r.passed);
    if (!failed) return "Verification failed with no detail.";
    return (
      `[VERIFICATION FAILED: ${failed.name} ("${failed.command}")]\n` +
      `Fix this before finishing. Output:\n${failed.output.slice(0, 4000)}`
    );
  }

  /** Instance-level convenience that delegates to the static method. */
  failureFeedback(outcome: VerificationOutcome): string {
    return VerificationGate.failureFeedback(outcome);
  }
}
