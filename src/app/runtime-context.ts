/**
 * Runtime context — the central type that describes everything the agent
 * loop needs at run-time.
 *
 * `AgentDependencies` combines the new interface contracts (provider, tools,
 * approval, persistence, verification, event bus) with the agent-core types
 * that still use concrete implementations in Phase 1 (guard, policy, digest,
 * context manager, cost meter, loop detector, context manager).
 *
 * `AgentDependencies` is consumed by the `createAgentLoop` factory in
 * `src/agent/loop.ts`; the CLI constructs it via `createAgentContainer` in
 * `src/app/container.ts`.
 */
import type {
  AgentMode,
  ToolCall,
  ToolSchema,
  ModelAdapter,
} from "../agent/types.js";
import type { ModelProvider } from "../providers/provider.js";
import type { ToolDefinition, ToolRegistry } from "../tools/tool.js";
import type { ApprovalService } from "../safety/approval-service.js";
import type { SessionRepository, SessionState } from "../persistence/session-repository.js";
import type { CheckpointRepository } from "../persistence/checkpoint-repository.js";
import type { AgentEventBus } from "../agent/events.js";
import type { PathGuard } from "../tools/fs-tools.js";
import type { PolicyEngine } from "../tools/registry.js";
import type { TaskDigest } from "../agent/digest.js";
import type { ContextManager } from "../agent/context.js";
import type { CostMeter } from "../agent/meter.js";
import type { LoopDetector } from "../agent/loop-detector.js";
import type { VerificationGate, VerificationService, VerificationOutcome } from "../verify/gate.js";
import type { SessionStore } from "../storage/session.js";
import type { CheckpointStore } from "../checkpoint/store.js";

// Re-export the verification contract types for consumers.
export type { VerificationOutcome, VerificationService } from "../verify/gate.js";

// ---------------------------------------------------------------------------
// Stream callbacks (compatibility layer for the existing onStream hooks)
// ---------------------------------------------------------------------------

/** Live-streamed stream callbacks so the TUI can render incrementally. */
export interface StreamCallbacks {
  onAssistantText?: (delta: string) => void;
  onToolStart?: (call: ToolCall) => void;
  onToolResult?: (callId: string, result: string, isError: boolean) => void;
  onStatus?: (status: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }) => void;
  /** Fired once per model turn when the first token arrives. */
  onFirstToken?: () => void;
  /** Fired when the run fails with a parsed, user-friendly error banner. */
  onError?: (banner: string, kind: "error" | "timeout") => void;
}

// ---------------------------------------------------------------------------
// Agent dependencies
// ---------------------------------------------------------------------------

/**
 * All runtime dependencies required by the agent loop.
 *
 * Constructed by `createAgentContainer`; consumed by `createAgentLoop`.
 * Contains both the new interface views (e.g. `provider`, `toolRegistry`,
 * `approval`, `eventBus`) and the concrete implementations needed by the
 * existing loop internals (e.g. `adapter`, `policy`, `guard`).
 */
export interface AgentDependencies {
  // --- New contract interfaces ---

  /** Provider-neutral model contract (wrapped from the concrete adapter). */
  readonly provider: ModelProvider;

  /** Tool registry (wrapped from the existing PolicyEngine + PathGuard). */
  readonly toolRegistry: ToolRegistry;

  /** Approval service (wrapped from the existing ApprovalHandler). */
  readonly approval: ApprovalService;

  /** Session event-log repository. */
  readonly sessionRepo: SessionRepository;

  /** Checkpoint repository. */
  readonly checkpointRepo: CheckpointRepository;

  /** Verification service. */
  readonly verification: VerificationService;

  /** In-memory event bus for broadcasting events to multiple subscribers. */
  readonly eventBus: AgentEventBus;

  // --- Concrete implementations (agent core + persistence) ---

  /** The underlying model adapter (provides `pricing` for CostMeter). */
  readonly adapter: ModelAdapter;

  /** Workspace path-safety guard. */
  readonly guard: PathGuard;

  /** Risk-tiered policy engine (auto-allow / deny / session grants). */
  readonly policy: PolicyEngine;

  /** Pinned task state that survives compaction. */
  readonly digest: TaskDigest;

  /** Context window budgeting + proactive compaction. */
  readonly context: ContextManager;

  /** Live cost meter. */
  readonly meter: CostMeter;

  /** Loop / strategy-diversity detector. */
  readonly loopDetector: LoopDetector;

  /** Concrete SessionStore (implements SessionRepository). */
  readonly sessions: SessionStore;

  /** Concrete CheckpointStore (implements CheckpointRepository). */
  readonly checkpoints: CheckpointStore;

  /** Concrete VerificationGate (implements VerificationService). */
  readonly verificationGate: VerificationGate;

  /** Existing tool schemas (for the loop's `tools` field). */
  readonly toolSchemas: readonly ToolSchema[];

  // --- Configuration ---

  readonly mode: AgentMode;
  readonly maxIterations: number;
  readonly modelTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onStream?: StreamCallbacks;
}

// Re-export types used by container consumers.
export type { ToolCall, ToolSchema } from "../agent/types.js";
export type { ToolDefinition, ToolRegistry } from "../tools/tool.js";
export type { ApprovalService, ApprovalDecision } from "../safety/approval-service.js";
export type { SessionRepository } from "../persistence/session-repository.js";
export type { CheckpointRepository } from "../persistence/checkpoint-repository.js";
export type { ModelProvider } from "../providers/provider.js";
export type { AgentEventBus } from "../agent/events.js";
