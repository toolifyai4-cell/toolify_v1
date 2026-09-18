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
  /**
   * Wall-clock budget for one `adapter.chat()` call (default 30s).
   * Fires `AgentTimeoutError` so a hung provider can never freeze the TUI.
   */
  modelTimeoutMs?: number;
  /**
   * Execution mode (Cline parity): Plan = read-only tools only; Act = full tools.
   */
  mode: AgentMode;
  /**
   * Optional abort signal from the TUI's AbortController. When aborted,
   * the in-flight HTTP request is cancelled and the loop exits on the next
   * iteration check with reason "aborted".
   */
  signal?: AbortSignal;
  /**
   * Live-streamed stream callbacks so the TUI can render incrementally.
   */
  onStream?: {
    onAssistantText?: (delta: string) => void;
    onToolStart?: (call: ToolCall) => void;
    onToolResult?: (callId: string, result: string, isError: boolean) => void;
    onStatus?: (status: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
    /** Fired once per model turn when the first token arrives. */
    onFirstToken?: () => void;
    /**
     * Fired when the run fails with a parsed, user-friendly error banner.
     * The TUI renders this as a colored error box in the chat stream.
     */
    onError?: (banner: string, kind: "error" | "timeout") => void;
  };
}

export interface AgentRunResult {
  finishReason: string;
  iterations: number;
  verificationRounds: number;
}


/**
 * Wrap a promise with a wall-clock timeout.
 *
 * When the timer fires first the caller sees an `AgentTimeoutError` whose
 * message names the timed-out operation; when the work finishes first the
 * timer is cleared and the result passes through untouched.
 */
export class AgentTimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "AgentTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentTimeoutError(operation, timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([work, guard]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export const DEFAULT_MODEL_TIMEOUT_MS = 30_000;

/**
 * Short human label for the active adapter used in error/timeout messages.
 * Prefers `name` when the adapter exposes one, else falls back to its model id.
 */
function adapterLabel(o: Pick<AgentLoopOptions, "adapter">): string {
  return o.adapter.name || o.adapter.modelId || "model";
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
/** Parse a thrown error into a categorized, user-friendly banner + severity kind. */
function classifyAgentError(
  err: unknown,
  modelLabel: string,
  baseURL?: string,
): { banner: string; kind: "error" | "timeout" } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // 1. Context window exceeded.
  if (
    lower.includes("context_length_exceeded") ||
    lower.includes("max_tokens") ||
    lower.includes("token limit") ||
    lower.includes("context window") ||
    lower.includes("context_length")
  ) {
    return {
      banner: `[ERROR] Context limit reached: The conversation history exceeds the model's maximum context window. Clear chat history (/clear) or switch to a higher-context model.`,
      kind: "error",
    };
  }

  // 2. Authentication / invalid API key.
  if (
    lower.includes("invalid_api_key") ||
    lower.includes("unauthorized") ||
    lower.includes("authentication") ||
    msg.startsWith("Provider error 401") ||
    msg.startsWith("Provider error 403")
  ) {
    return {
      banner: `[ERROR] Authentication failed: Invalid or missing API key for target provider. Check your key in provider settings.`,
      kind: "error",
    };
  }

  // 3. Rate limited / quota exceeded.
  if (
    lower.includes("rate_limit") ||
    lower.includes("rate limit") ||
    lower.includes("quota_exceeded") ||
    lower.includes("quota exceeded") ||
    msg.startsWith("Provider error 429")
  ) {
    return {
      banner: `[ERROR] Rate limit reached: Request limit or quota exceeded for this provider/model. Please wait or switch models.`,
      kind: "error",
    };
  }

  // 4. Network / connection failure.
  if (
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("econnaborted") ||
    lower.includes("network") ||
    lower.includes("connection") ||
    lower.includes("reset") ||
    msg.startsWith("Provider error 50") ||
    msg.startsWith("Provider error 59")
  ) {
    const url = baseURL ?? "the configured endpoint";
    return {
      banner: `[ERROR] Connection failed: Unable to reach the configured Base URL (${url}). Verify network connection or provider endpoint settings.`,
      kind: "error",
    };
  }

  // 5. Timeout.
  if (err instanceof AgentTimeoutError) {
    return {
      banner: `[TIMEOUT] Request timed out after ${Math.round((err as AgentTimeoutError).timeoutMs / 1000)}s with no response from ${modelLabel}.`,
      kind: "timeout",
    };
  }

  // Fallback: generic error.
  return {
    banner: `[ERROR] ${msg.split("\n")[0].slice(0, 300)}`,
    kind: "error",
  };
}

export class AgentLoop {
  private aborted = false;
  constructor(private readonly opts: AgentLoopOptions) {}

  /** Abort the current run. Safe to call from outside the loop. */
  abort(): void {
    this.aborted = true;
    // The caller (TUI) holds the AbortController and calls controller.abort()
    // directly; the loop only tracks the aborted flag for its iteration checks.
  }

  private systemPrompt(): string {
    return [
      "You are TOOLIFY, an AI coding agent running inside an Ink TUI.",
      "",
      "## Core Rules",
      "1. ALWAYS provide a direct text answer to the user's question directly in the chat stream.",
      "2. ALWAYS provide a clear, concise final summary of all actions taken (files modified, tools executed, tests run) at the end of every task execution.",
      "3. When executing tools, do not suppress conversational text output - stream your thinking process alongside tool execution.",
      "4. At the end of tool execution runs, force a standard completion block containing:",
      "   - Direct answer / solution.",
      "   - Action Summary (e.g., '### Actions Taken', listing modified files and status).",
      "5. Use the provided tools to read, write, and edit files in the workspace.",
      "6. Verify your changes by running tests and type checking before declaring completion.",
      "",
      "## Plan & Build Execution Guidelines",
      "In PLAN MODE: analyze requirements, propose architecture, and deliver a step-by-step plan. Do NOT modify files.",
      "In BUILD MODE: implement the plan, run verification (tsc + tests), and report results.",
      "Before declaring task completion, strictly adhere to these guidelines and verify all changes.",
      "",
      "## Task Digest (pinned)",
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
        if (this.aborted) {
          await this.emit({ type: "run_finished", reason: "aborted" as never, ts: Date.now() });
          return { finishReason: "aborted", iterations, verificationRounds };
        }
        let iteration = 0;
        let modelDone = false;

        while (iteration < o.maxIterations) {
          if (this.aborted) {
            await this.emit({ type: "run_finished", reason: "aborted" as never, ts: Date.now() });
            return { finishReason: "aborted", iterations, verificationRounds };
          }
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

          const res = await withTimeout(
            o.adapter.chat({
              system: this.systemPrompt(),
              messages: requestMessages,
              tools: o.tools,
              signal: o.signal,
            }),
            o.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
            `model call (${adapterLabel(o)})`,
          );

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
            o.onStream?.onFirstToken?.();
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
      // If the run was aborted (Esc / Ctrl+C), don't show an error banner.
      if (o.signal?.aborted) {
        finishReason = "aborted";
        await this.emit({ type: "error", message: "Run cancelled by user.", ts: Date.now() });
      } else {
        const label = adapterLabel(o);
        const classification = classifyAgentError(err, label, undefined);
        await this.emit({ type: "error", message: classification.banner, ts: Date.now() });
        o.onStream?.onError?.(classification.banner, classification.kind);
        finishReason = "error";
      }
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
