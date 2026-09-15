import type {
  AgentEvent,
  AgentMode,
  ModelMessage,
  ToolCall,
  ToolSchema,
} from "./types.js";
import type { TaskDigest } from "./digest.js";
import type { ContextManager } from "./context.js";
import type { CostMeter } from "./meter.js";
import type { SessionStore } from "../storage/session.js";
import type { CheckpointStore } from "../checkpoint/store.js";
import { VerificationGate, type VerificationOutcome } from "../verify/gate.js";
import type { PathGuard } from "../tools/fs-tools.js";
import type { PolicyEngine } from "../tools/registry.js";
import type { LoopDetector } from "./loop-detector.js";
import type { ModelAdapter } from "./types.js";

export interface ApprovalHandler {
  request(
    call: ToolCall,
    reason: string,
  ): Promise<{ approved: boolean; scope?: "once" | "session" }>;
}

export interface AgentLoopOptions {
  adapter: ModelAdapter;
  guard: PathGuard;
  policy: PolicyEngine;
  digest: TaskDigest;
  context: ContextManager;
  meter: CostMeter;
  sessions: SessionStore;
  checkpoints: CheckpointStore;
  verification: VerificationGate;
  approval: ApprovalHandler;
  loopDetector: LoopDetector;
  tools: ToolSchema[];
  maxIterations: number;
  /** Read-only tools exposed in Plan mode; full tools in Act mode (Cline parity). */
  mode: AgentMode;
  /** Live-streamed stream callbacks so the TUI can render incrementally. */
  onStream?: {
    onAssistantText?: (delta: string) => void;
    onToolStart?: (call: ToolCall) => void;
    onToolResult?: (callId: string, result: string, isError: boolean) => void;
    onStatus?: (status: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
  };
}

export interface AgentRunResult {
  finishReason: string;
  iterations: number;
  verificationRounds: number;
}


const TOOL_TARGET_KEYS = ["path", "pattern", "command"] as const;

function toolTarget(input: unknown): string | undefined {
  if (input == null || typeof input !== "object") return undefined;
  const rec = input as Record<string, unknown>;
  for (const k of TOOL_TARGET_KEYS) {
    const v = rec[k];
    if (typeof v === "string") return `${k}:${v.slice(0, 120)}`;
  }
  return undefined;
}

/**
 * The TOOLIFY agent loop:
 *   system prompt (rules + pinned digest) → model → tool calls
 *   → policy (auto-allow / approval with per-session grants) → execute
 *   → checkpoint touched paths → loop detector (soft / hard / replan)
 *   → proactive compaction → results appended → repeat
 *   → verification gate MUST pass before a successful finish.
 */
export class AgentLoop {
  constructor(private readonly opts: AgentLoopOptions) {}

  private systemPrompt(): string {
    return [
      "You are TOOLIFY, an autonomous coding agent working in a workspace.",
      "Use the provided tools to read, write, edit, search, and run commands.",
      "Work step by step. Prefer edit_file for small changes, write_file for new files.",
      "Finish with a clear final message when the goal is achieved.",
      "",
      this.opts.digest.render(),
    ].join("\n");
  }

  private async emit(e: AgentEvent): Promise<void> {
    await this.opts.sessions.append(e);
  }

  async run(userGoal: string): Promise<AgentRunResult> {
    const o = this.opts;
    o.digest.setGoal(userGoal);
    await this.emit({ type: "user_message", content: userGoal, ts: Date.now() });

    const messages: ModelMessage[] = [{ role: "user", content: userGoal }];
    let iterations = 0;
    let verificationRounds = 0;
    let finishReason = "error";

    try {
      let feedback: string | null = null;
      let done = false;

      while (!done && verificationRounds <= o.verification.config.maxRounds) {
        let iteration = 0;
        let modelDone = false;

        while (iteration < o.maxIterations) {
          // Proactive compaction (R1) with the pinned digest (R6).
          const comp = await o.context.maybeCompact(messages);
          if (comp.didCompact) {
            await this.emit({
              type: "compaction",
              summarized: comp.summarizedCount,
              kept: comp.keptCount,
              ts: Date.now(),
            });
          }

          const requestMessages: ModelMessage[] = feedback
            ? [...messages, { role: "user", content: feedback }]
            : messages;
          feedback = null;

          const res = await o.adapter.chat({
            system: this.systemPrompt(),
            messages: requestMessages,
            tools: o.tools,
          });

          const { usage, costUsd } = o.meter.add(res.usage);
          await this.emit({ type: "usage_update", usage, costUsd, ts: Date.now() });

                    if (res.text) {
            await this.emit({
              type: "assistant_message",
              content: res.text,
              usage: res.usage,
              ts: Date.now(),
            });
                        // Stream assistant text live to the TUI (Cline renders markdown as it streams).
            o.onStream?.onAssistantText?.(res.text);
            o.onStream?.onStatus?.({
              inputTokens: o.meter.usage.inputTokens,
              outputTokens: o.meter.usage.outputTokens,
              costUsd: o.meter.costUsd,
            });
          }

          if (res.toolCalls.length === 0) {
            modelDone = true;
            // Verification gate decides (R4): MUST pass before success.
            if (o.verification.enabled) {
              const outcome = await o.verification.run();
              verificationRounds += outcome.rounds;
              // Record every verification round into the session log (R4 audit).
              for (const r of outcome.results) {
                await this.emit({
                  type: "verification",
                  command: r.command,
                  passed: r.passed,
                  output: r.output.slice(0, 2000),
                  ts: Date.now(),
                });
              }
              if (outcome.passed) {
                finishReason = "stop";
                done = true;
              } else if (verificationRounds > o.verification.config.maxRounds) {
                finishReason = "verification_failed";
                done = true;
              } else {
                feedback = VerificationGate.failureFeedback(outcome);
              }
            } else {
              finishReason = "stop";
              done = true;
            }
            break;
          }

                    const results = [];
          for (const call of res.toolCalls) {
            // Mode filtering (Cline parity): Plan mode blocks write/dangerous tools.
            const allowedByMode =
              o.mode === "act" ||
              (o.mode === "plan" && ["read_file", "glob", "grep"].includes(call.name));
            if (!allowedByMode) {
              const blocked = {
                callId: call.id,
                content: `[BLOCKED in Plan mode: ${call.name}. Switch to Act mode (Tab) to ${call.name}.]`,
                isError: true,
              } as const;
              results.push(blocked);
              await this.emit({
                type: "tool_finished",
                callId: call.id,
                content: blocked.content,
                isError: true,
                ts: Date.now(),
              });
                            o.onStream?.onToolResult?.(call.id, blocked.content, true);
              continue;
            }
                        // Fire streaming hook: the TUI highlights this tool in the conversation.
            o.onStream?.onToolStart?.(call);
            const result = await this.executeTool(call, iteration + 1);
            results.push(result);
            o.onStream?.onToolResult?.(call.id, result.content, !!result.isError);
            // Fire status tick (tokens/cost).
            o.onStream?.onStatus?.({
              inputTokens: o.meter.usage.inputTokens,
              outputTokens: o.meter.usage.outputTokens,
              costUsd: o.meter.costUsd,
            });
          }
          messages.push({
            role: "assistant",
            content: res.text,
            toolCalls: res.toolCalls,
          });
          messages.push({ role: "user", content: "", toolResults: results });
          iteration++;
          iterations = iteration;
          continue;
        }

        if (modelDone) break;
        if (!done && !modelDone) {
          finishReason = "budget";
          done = true;
        }
        void modelDone;
        break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.emit({ type: "error", message: msg, ts: Date.now() });
      finishReason = "error";
    }

    await this.emit({
      type: "run_finished",
      reason: finishReason as never,
      ts: Date.now(),
    });
    return { finishReason, iterations, verificationRounds };
  }

  /** Policy check → approval (if gated) → execute → checkpoint → loop check. */
  private async executeTool(
    call: ToolCall,
    iteration: number,
  ): Promise<{ callId: string; content: string; isError?: boolean }> {
    const o = this.opts;
    const decision = o.policy.decide(call);

    if (!decision.allowed) {
      const ask = await o.approval.request(call, decision.reason);
      if (!ask.approved) {
        await this.emit({
          type: "approval_decision",
          callId: call.id,
          approved: false,
          reason: "denied by user",
          ts: Date.now(),
        });
        return {
          callId: call.id,
          content: `[TOOL DENIED by user: ${decision.reason}]`,
          isError: true,
        };
      }
      if (ask.scope === "session") {
        o.policy.grantForSession(decision.tier);
      }
      await this.emit({
        type: "approval_decision",
        callId: call.id,
        approved: true,
        ts: Date.now(),
      });
    }

    await this.emit({ type: "tool_started", call, ts: Date.now() });

    let content: string;
    let isError = false;
    try {
      const r = await o.policy.execute(o.guard, call);
      content = typeof r === "string" ? r : r.output;
      isError = typeof r === "object" && "exitCode" in r && r.exitCode !== 0;
    } catch (err) {
      content = err instanceof Error ? err.message : String(err);
      isError = true;
    }

    // Snapshot touched paths into the CAS store (R3 — O(changed files)).
    const touched = touchedPaths(call);
    if (touched.length > 0) {
      try {
        await o.checkpoints.snapshot(touched);
      } catch {
        // checkpoint failure must not break the run
      }
    }

    await this.emit({
      type: "tool_finished",
      callId: call.id,
      content: content.slice(0, 2000),
      isError,
      ts: Date.now(),
    });

    // Strategy-diversity loop check (R2 revised).
    const verdict = o.loopDetector.record({
      name: call.name,
      input: call.input,
      target: toolTarget(call.input),
      failed: isError,
    });
    if (verdict.kind === "soft") {
      await this.emit({ type: "loop_warning", message: verdict.message ?? "", ts: Date.now() });
      content += `\n[loop-detector soft warning: ${verdict.message}]`;
    } else if (verdict.kind === "replan") {
      await this.emit({ type: "replan_forced", reason: verdict.message ?? "", ts: Date.now() });
      content +=
        `\n[FORCED STRATEGY CHANGE — ${verdict.message} ` +
        `Stop retrying the same approach: reassess, pick a DIFFERENT strategy, and continue.]`;
      o.loopDetector.reset();
    }
    void iteration;

    return { callId: call.id, content, isError };
  }
}

function touchedPaths(call: ToolCall): string[] {
  const input = (call.input ?? {}) as Record<string, unknown>;
  if (call.name === "write_file" || call.name === "edit_file") {
    return typeof input.path === "string" ? [input.path] : [];
  }
  return [];
}
