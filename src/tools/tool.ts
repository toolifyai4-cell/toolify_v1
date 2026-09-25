/**
 * Tool contract — the generic, provider-agnostic tool interface.
 *
 * The existing `ToolSchema` / `PolicyEngine.execute` pathway continues to work.
 * New code and tests use the `ToolDefinition` / `ToolRegistry` contract.
 */
import type { RiskTier, PolicyDecision, ToolCall } from "../agent/types.js";
import type { PolicyEngine } from "./registry.js";
import type { ApprovalService } from "../safety/approval-service.js";
import type { AgentEventBus } from "../agent/events.js";
import type { PathGuard } from "./fs-tools.js";

// ---------------------------------------------------------------------------
// Structured errors
// ---------------------------------------------------------------------------

/** Structured error returned by a tool. */
export interface ToolError {
  /** Stable machine-readable code, e.g. "path_escape", "timeout", "unknown". */
  readonly code: string;
  /** Human-readable message. */
  readonly message: string;
  /** Whether the caller may legitimately retry. */
  readonly recoverable: boolean;
  /** Optional structured details for debugging. */
  readonly details?: unknown;
}

/** Structured result returned by a tool. */
export interface ToolResult<TOutput = unknown> {
  /** True when the tool executed without error. */
  readonly ok: boolean;
  /** Rendered text content (bounded to the configured output limit). */
  readonly content: string;
  /** Typed payload (optional, tool-specific). */
  readonly data?: TOutput;
  /** Error details when `ok` is false. */
  readonly error?: ToolError;
}

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

/**
 * Context injected into every tool execution.
 *
 * Replaces the positional `(guard: PathGuard, input: {...})` signature of the
 * legacy tool functions with a single, extensible bag of dependencies.
 */
export interface ToolExecutionContext {
  /** Workspace root (absolute path). */
  readonly workspace: string;
  /** Path guard for workspace confinement. */
  readonly guard: Pick<PathGuard, "root" | "guard">;
  /** Cancellation signal from the agent loop / TUI. */
  readonly signal?: AbortSignal;
  /**
   * Policy engine — tools may consult it for tier lookups or allowlist checks.
   * Optional to keep the interface usable in isolation.
   */
  readonly policy?: Pick<PolicyEngine, "decide">;
  /**
   * Approval service — tools that internally need to escalate can call this.
   * Optional.
   */
  readonly approval?: ApprovalService;
  /** Event bus for emitting tool-level events. Optional. */
  readonly eventBus?: AgentEventBus;
  /** Maximum characters of output to retain (truncation limit). */
  readonly maxOutputChars?: number;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * Generic tool definition.
 *
 * `TInput` is the validated payload type; `TOutput` is an optional typed
 * payload carried alongside `content`.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly risk: RiskTier;
  readonly inputSchema: Record<string, unknown>;

  /** Validate raw input and return the typed payload. Throws on invalid input. */
  validate(input: unknown): TInput;

  /** Execute the tool and return a structured result. */
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}

// ---------------------------------------------------------------------------
// Tool registry / executor
// ---------------------------------------------------------------------------

/** Executes a single tool call, returning a structured result. */
export interface ToolExecutor {
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}

/**
 * Registry of available tools.
 *
 * Combines lookup (`get`/`list`) with execution (`execute`).
 */
export interface ToolRegistry extends ToolExecutor {
  get(name: string): ToolDefinition | undefined;
  list(): readonly ToolDefinition[];
}

// ---------------------------------------------------------------------------
// Policy gate
// ---------------------------------------------------------------------------

/**
 * The narrow slice of the policy engine that the agent loop needs.
 *
 * `PolicyEngine` structurally satisfies this, so the loop can depend on the
 * interface rather than the concrete class. Keeping it separate from
 * `ToolRegistry` matters: the registry *executes* tools, while the gate
 * *decides* whether a call is allowed and remembers session-wide grants.
 */
export interface PolicyGate {
  /** Classify a call and decide whether it is allowed without approval. */
  decide(call: ToolCall): PolicyDecision;
  /** Remember an approval for the remainder of the session. */
  grantForSession(tier: RiskTier): void;
}
