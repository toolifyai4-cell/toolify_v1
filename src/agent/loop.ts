import type {
  AgentEvent,
  AgentMode,
  ChatResponse,
  ModelMessage,
  ToolCall,
  ToolSchema,
} from "./types.js";
import type { TaskDigest } from "./digest.js";
import type { ContextManager } from "./context.js";
import type { CostMeter } from "./meter.js";
import type { SessionRepository } from "../persistence/session-repository.js";
import type { CheckpointRepository } from "../persistence/checkpoint-repository.js";
import type { VerificationOutcome, VerificationService } from "../verify/gate.js";
import type { PathGuard } from "../tools/fs-tools.js";
import type { PolicyGate } from "../tools/tool.js";
import type { LoopDetector } from "./loop-detector.js";
import type { ModelAdapter } from "./types.js";
import type { ModelProvider } from "../providers/provider.js";
import type { ToolRegistry, ToolResult } from "../tools/tool.js";
import type {
  ApprovalService,
  ApprovalContext,
} from "../safety/approval-service.js";
import type { AgentEventBus } from "./events.js";
import type {
  AgentDependencies,
  StreamCallbacks,
} from "../app/runtime-context.js";
// Value imports used only by the legacy `resolveDeps()` bridge.
import { createModelProvider } from "../providers/provider.js";
import { createToolRegistryAdapter } from "../tools/tool-registry-adapter.js";
// Timeout primitives now live in ./timeouts.ts so the streaming consumer can
// raise the same error without importing this module. Re-exported here for
// backward compatibility with existing importers.
import { AgentTimeoutError, withTimeout } from "./timeouts.js";
import { consumeProviderStream } from "./stream-consumer.js";
export { AgentTimeoutError, withTimeout } from "./timeouts.js";

/**
 * Exact footer appended to every Plan-mode blueprint. The runtime guarantees
 * this line terminates a plan (even when the model omits it); `plan-mode.test.ts`
 * asserts the literal string.
 */
export const PLAN_MODE_FOOTER: string =
  "👉 Press 'Tab' to switch to Act Mode when you are ready to execute this plan.";

export interface ApprovalHandler {
  request(
    call: ToolCall,
    reason: string,
  ): Promise<{ approved: boolean; scope?: "once" | "session" }>;
}

/**
 * The dependency set the agent loop actually consumes.
 *
 * Every member is an interface, so the loop has no compile-time or runtime
 * dependency on `PolicyEngine`, `SessionStore`, `CheckpointStore`,
 * `VerificationGate`, or any concrete `ModelAdapter`. The legacy concrete
 * options (`AgentLoopOptions`) are normalised into this shape by
 * `resolveDeps()`, which is why existing call sites keep working unchanged.
 */
export interface AgentRuntimeDeps {
  readonly provider: ModelProvider;
  readonly toolRegistry: ToolRegistry;
  readonly policy: PolicyGate;
  readonly approval: ApprovalService;
  readonly sessions: SessionRepository;
  readonly checkpoints: CheckpointRepository;
  readonly verification: VerificationService;
  readonly eventBus?: AgentEventBus;
  readonly digest: TaskDigest;
  readonly context: ContextManager;
  readonly meter: CostMeter;
  readonly loopDetector: LoopDetector;
  readonly guard: PathGuard;
  readonly tools: readonly ToolSchema[];
  readonly maxIterations: number;
  readonly mode: AgentMode;
  readonly modelTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onStream?: StreamCallbacks;
}

export interface AgentLoopOptions {
  adapter: ModelAdapter;
  guard: PathGuard;
  /**
   * Legacy options shape, retained for backward compatibility.
   *
   * New code should prefer `createAgentLoop(deps)` with the
   * interface-only `AgentDependencies` / `AgentRuntimeDeps`. Passing this
   * shape still works: the constructor normalises it through
   * `resolveDeps()`.
   */
  policy: PolicyGate;
  digest: TaskDigest;
  context: ContextManager;
  meter: CostMeter;
  sessions: SessionRepository;
  checkpoints: CheckpointRepository;
  verification: VerificationService;
  approval: ApprovalHandler;
  loopDetector: LoopDetector;
  tools: ToolSchema[];
  maxIterations: number;
  /**
   * Wall-clock budget for one provider `chat()` call (default 30s).
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
   * Uses the `StreamCallbacks` type from the runtime context.
   */
  onStream?: StreamCallbacks;
  /**
   * Optional event bus. When present, every session event is also emitted
   * here so subscribers (tests, live UI, telemetry) receive a parallel copy.
   */
  eventBus?: AgentEventBus;
}

export interface AgentRunResult {
  finishReason: string;
  iterations: number;
  verificationRounds: number;
}


export const DEFAULT_MODEL_TIMEOUT_MS = 30_000;

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

/** Distinguish an already-resolved `AgentRuntimeDeps` from legacy options. */
function isRuntimeDeps(o: AgentLoopOptions | AgentRuntimeDeps): o is AgentRuntimeDeps {
  return (o as AgentRuntimeDeps).provider !== undefined;
}

/**
 * Normalise the legacy concrete options into the interface-only
 * `AgentRuntimeDeps` shape the loop actually consumes.
 *
 * This is the single place where the concrete `PolicyEngine`, `ApprovalHandler`
 * and `ModelAdapter` are bridged into the new contracts. Everything below the
 * constructor is interface-only.
 */
function resolveDeps(o: AgentLoopOptions): AgentRuntimeDeps {
  // The legacy `PolicyEngine` also exposes `execute(guard, call)`; the registry
  // adapter wraps exactly that, so tools keep their current behaviour.
  const policyWithExecute = o.policy as PolicyGate & {
    execute?: (guard: PathGuard, call: ToolCall) => Promise<unknown>;
  };
  const toolRegistry: ToolRegistry =
    typeof policyWithExecute.execute === "function"
      ? createToolRegistryAdapter(o.policy, o.policy as never, o.guard)
      : ({
          async execute(call: ToolCall, ctx): Promise<ToolResult> {
            const r = await policyWithExecute.execute!(ctx.guard as PathGuard, call);
            const content = typeof r === "string" ? (r as string) : (r as { output: string }).output;
            const failed =
              typeof r === "object" && "exitCode" in (r as object) && (r as { exitCode: number }).exitCode !== 0;
            return failed
              ? {
                  ok: false,
                  content,
                  error: { code: "TOOL_EXECUTION_FAILED", message: content, recoverable: true },
                }
              : { ok: true, content };
          },
          get: (name: string) =>
            o.tools.find((t) => t.name === name)
              ? {
                  name,
                  description: o.tools.find((t) => t.name === name)!.description,
                  risk: "dangerous" as const,
                  inputSchema: o.tools.find((t) => t.name === name)!.inputSchema,
                  validate: (i: unknown) => i,
                  execute: async (i: unknown) => ({ ok: true, content: String(i) }),
                }
              : undefined,
          list: () =>
            o.tools.map((t) => ({
              name: t.name,
              description: t.description,
              risk: "dangerous" as const,
              inputSchema: t.inputSchema,
              validate: (i: unknown) => i,
              execute: async (i: unknown) => ({ ok: true, content: String(i) }),
            })),
        } satisfies ToolRegistry);

  const approval: ApprovalService = {
    async request(call, ctx: ApprovalContext) {
      const d = await o.approval.request(call, ctx.reason);
      return {
        approved: d.approved,
        scope: d.scope,
        reason: d.approved ? undefined : "denied by user",
      };
    },
  };

  return {
    provider: createModelProvider(o.adapter),
    toolRegistry,
    policy: o.policy,
    approval,
    sessions: o.sessions,
    checkpoints: o.checkpoints,
    verification: o.verification,
    eventBus: o.eventBus,
    digest: o.digest,
    context: o.context,
    meter: o.meter,
    loopDetector: o.loopDetector,
    guard: o.guard,
    tools: o.tools,
    maxIterations: o.maxIterations,
    mode: o.mode,
    modelTimeoutMs: o.modelTimeoutMs,
    signal: o.signal,
    onStream: o.onStream,
  };
}

export class AgentLoop {
  private aborted = false;
  private readonly opts: AgentRuntimeDeps;
  private readonly label: string;

  constructor(opts: AgentLoopOptions | AgentRuntimeDeps) {
    this.opts = isRuntimeDeps(opts) ? opts : resolveDeps(opts);
    this.label = this.opts.provider.id || this.opts.provider.modelId || "model";
  }

  /** Abort the current run. Safe to call from outside the loop. */
  abort(): void {
    this.aborted = true;
    // The caller (TUI) holds the AbortController and calls controller.abort()
    // directly; the loop only tracks the aborted flag for its iteration checks.
  }

    private systemPrompt(): string {
    const lines = [
      "You are TOOLIFY, an AI coding agent running inside an Ink TUI.",
      "",
      "## Conversation First (human-like behavior)",
      "- If the user sends a greeting, small talk, thanks, or any casual conversational message that requires no tools (e.g. hi, hello, hey, how are you), answer directly with a short, friendly reply and ask how you can help.",
      "- Do NOT call list_files, glob, grep, read_file, workspace scans, or any read-only tools for casual chatter unless the user explicitly asks for an action, references files or code, or the task genuinely requires it.",
      "",
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
    ];

    if (this.opts.mode === "plan") {
      // Mandate the read-only blueprint structure so the model emits the
      // required sections and concludes with the exact footer line.
      lines.push(
        "",
        "### Plan Mode (read-only blueprinting)",
        "When in Plan Mode, deliver a step-by-step architecture plan using ONLY read-only tools: read_file, list_files, search_files, glob, grep. Do NOT modify files or execute terminal commands.",
        "",
        "Mandatory blueprint structure — include each heading exactly:",
        "**Target files/folders**:",
        "**Code modification outline**:",
        "**Terminal commands**:",
        "",
        "Conclude the blueprint with this exact footer line:",
        PLAN_MODE_FOOTER,
      );
    }

    return lines.join("\n");
  }

  private async emit(e: AgentEvent): Promise<void> {
    await this.opts.sessions.append(e);
    this.opts.eventBus?.emit(e);
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

      while (!done && verificationRounds <= o.verification.maxRounds) {
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

          const { response: res, streamed } = await this.runModelTurn(requestMessages);

          const { usage, costUsd } = o.meter.add(res.usage);
          await this.emit({ type: "usage_update", usage, costUsd, ts: Date.now() });

                    if (res.text) {
            let assistantText = res.text;
            // In Plan Mode, guarantee the concluding blueprint ends with the
            // footer line (even if the model omitted it), without duplicating it.
            if (o.mode === "plan" && res.toolCalls.length === 0) {
              assistantText = ensurePlanFooter(res.text);
            }
            await this.emit({
              type: "assistant_message",
              content: assistantText,
              usage: res.usage,
              ts: Date.now(),
            });
            // When streaming, deltas were already pushed to the TUI live, so
            // only the non-streaming path re-sends the whole message here.
            if (!streamed) {
              o.onStream?.onFirstToken?.();
              o.onStream?.onAssistantText?.(res.text);
            }
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
              } else if (verificationRounds > o.verification.maxRounds) {
                finishReason = "verification_failed";
                done = true;
              } else {
                feedback = o.verification.failureFeedback(outcome);
              }
            } else {
              finishReason = "stop";
              done = true;
            }
            break;
          }

          const results: Array<{
            callId: string;
            content: string;
            isError?: boolean;
          }> = [];
          for (const call of res.toolCalls) {
                        // Plan Mode (Cline parity): read-only tools (read_file, glob, grep,
            // list_files, search_files) still execute, but write/dangerous tools
            // are intercepted GRACEFULLY — never a hard "[BLOCKED ...] error".
            const PLAN_READ_ONLY = ["read_file", "glob", "grep", "list_files", "search_files"];
            if (o.mode === "plan" && !PLAN_READ_ONLY.includes(call.name)) {
              const inp = (call.input ?? {}) as Record<string, unknown>;
              const target =
                typeof inp.path === "string"
                  ? inp.path
                  : typeof inp.command === "string"
                    ? inp.command
                    : call.name;
              const content =
                `Plan Mode is read-only — this action was intercepted, not executed. NOT an error.\n` +
                `\n### Plan Mode (read-only blueprinting)` +
                `\n**Target files/folders**: ${target}` +
                `\n\nThis was a ${call.name} call. Switch to Act Mode (Tab) to run it for real.`;
              results.push({ callId: call.id, content, isError: false });
              await this.emit({
                type: "tool_finished",
                callId: call.id,
                content,
                isError: false,
                ts: Date.now(),
              });
              o.onStream?.onToolResult?.(call.id, content, false);
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
        const label = this.label;
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

  /**
   * Execute one model turn, preferring the streaming path.
   *
   * Both paths return the same `ChatResponse` shape, so the rest of the loop is
   * agnostic to which one ran. `streamed` tells the caller whether text
   * deltas were already delivered, so it does not re-send the full message.
   *
   * Note the timeout semantics differ by path, and deliberately so:
   *  - non-streaming: one wall-clock deadline for the entire call
   *  - streaming: a per-chunk idle deadline (a long generation is fine; a
   *    silent stream is a hang)
   */
  private async runModelTurn(
    messages: ModelMessage[],
  ): Promise<{ response: ChatResponse; streamed: boolean }> {
    const o = this.opts;
    const request = {
      system: this.systemPrompt(),
      messages,
      tools: [...o.tools],
      signal: o.signal,
    };
    const timeoutMs = o.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;

    if (o.provider.capabilities.streaming && o.provider.stream) {
      const response = await consumeProviderStream({
        provider: o.provider,
        request,
        idleTimeoutMs: timeoutMs,
        signal: o.signal,
        onFirstToken: o.onStream?.onFirstToken,
        onTextDelta: o.onStream?.onAssistantText,
      });
      return { response, streamed: true };
    }

    const response = await withTimeout(
      o.provider.chat(request),
      timeoutMs,
      `model call (${this.label})`,
    );
    return { response, streamed: false };
  }

  /** Policy check → approval (if gated) → execute → checkpoint → loop check. */
  private async executeTool(
    call: ToolCall,
    iteration: number,
  ): Promise<{ callId: string; content: string; isError?: boolean }> {
    const o = this.opts;
    const decision = o.policy.decide(call);

    if (!decision.allowed) {
      const ask = await o.approval.request(call, {
        riskTier: decision.tier,
        reason: decision.reason,
        workspace: o.guard.root,
      });
      if (!ask.approved) {
        await this.emit({
          type: "approval_decision",
          callId: call.id,
          approved: false,
          reason: ask.reason ?? "denied by user",
          ts: Date.now(),
        });
        return {
          callId: call.id,
          content: `[TOOL DENIED by user: ${decision.reason}]`,
          isError: true,
        };
      }
      if (ask.scope === "session" || ask.scope === "workspace") {
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
      const r = await o.toolRegistry.execute(call, {
        workspace: o.guard.root,
        guard: o.guard,
        signal: o.signal,
        policy: o.policy,
        approval: o.approval,
        eventBus: o.eventBus,
      });
      content = r.content;
      isError = !r.ok;
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

/** Ensure a Plan-mode blueprint ends with PLAN_MODE_FOOTER exactly once. */
function ensurePlanFooter(text: string): string {
  if (text.includes(PLAN_MODE_FOOTER)) return text;
  return text + (text.endsWith("\n") ? "" : "\n") + "\n" + PLAN_MODE_FOOTER;
}

function touchedPaths(call: ToolCall): string[] {
  const input = (call.input ?? {}) as Record<string, unknown>;
  if (call.name === "write_file" || call.name === "edit_file") {
    return typeof input.path === "string" ? [input.path] : [];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Dependency-injection factory
// ---------------------------------------------------------------------------

/** Re-export the stream-callbacks type for callers that import from the loop. */
export type { StreamCallbacks } from "../app/runtime-context.js";

/**
 * Construct an `AgentLoop` from the container's `AgentDependencies`.
 *
 * The container already exposes every dependency as an interface, so this is a
 * direct pass-through — no adapters, no round-tripping. The loop body is
 * interface-only from here on.
 */
export function createAgentLoop(deps: AgentDependencies): AgentLoop {
  return new AgentLoop({
    provider: deps.provider,
    toolRegistry: deps.toolRegistry,
    policy: deps.policy,
    approval: deps.approval,
    sessions: deps.sessionRepo,
    checkpoints: deps.checkpointRepo,
    verification: deps.verification,
    eventBus: deps.eventBus,
    digest: deps.digest,
    context: deps.context,
    meter: deps.meter,
    loopDetector: deps.loopDetector,
    guard: deps.guard,
    tools: deps.toolSchemas,
    maxIterations: deps.maxIterations,
    mode: deps.mode,
    modelTimeoutMs: deps.modelTimeoutMs,
    signal: deps.signal,
    onStream: deps.onStream,
  });
}
