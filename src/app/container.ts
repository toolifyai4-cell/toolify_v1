/**
 * Dependency container — constructs the full set of agent runtime dependencies
 * from a small, declarative options object.
 *
 * The container never imports React, Ink, or CLI-specific code. It can be
 * used from tests with a Mock provider, from the headless `toolify run`
 * command, or from the interactive `toolify chat` TUI.
 */
import { resolve } from "node:path";
import type { AgentDependencies, StreamCallbacks } from "./runtime-context.js";
import type { ModelAdapter, AgentMode } from "../agent/types.js";
import { createModelProvider } from "../providers/provider.js";
import { PolicyEngine, TOOL_SCHEMAS, type ProjectPolicyConfig } from "../tools/registry.js";
import { PathGuard } from "../tools/fs-tools.js";
import { TaskDigest } from "../agent/digest.js";
import { ContextManager } from "../agent/context.js";
import { CostMeter } from "../agent/meter.js";
import { LoopDetector } from "../agent/loop-detector.js";
import { SessionStore } from "../storage/session.js";
import { CheckpointStore } from "../checkpoint/store.js";
import { VerificationGate, type VerificationConfig } from "../verify/gate.js";
import { InMemoryEventBus } from "../agent/events.js";
import { createApprovalService, type LegacyApprovalHandler } from "../safety/approval-service.js";
import { createToolRegistryAdapter } from "../tools/tool-registry-adapter.js";

// ---------------------------------------------------------------------------
// Container options
// ---------------------------------------------------------------------------

export interface ContainerOptions {
  /** Absolute workspace path. */
  readonly workspace: string;
  /** The model adapter (MockModelAdapter, OpenAICompatibleAdapter, …). */
  readonly model: ModelAdapter;
  /** The user's goal / task description. */
  readonly goal: string;
  /** Execution mode (plan or act). Defaults to "act". */
  readonly mode?: AgentMode;
  /** Max loop iterations. Defaults to 40. */
  readonly maxIterations?: number;
  /** Per-call model timeout in ms. Defaults to 30 000. */
  readonly modelTimeoutMs?: number;
  /** Abort signal from the TUI (for Esc / Ctrl+C cancellation). */
  readonly signal?: AbortSignal;
  /** Policy configuration (allowlist, denyPaths). */
  readonly policyConfig?: ProjectPolicyConfig;
  /** Verification commands (order preserved). */
  readonly verificationCommands?: Array<{ name: string; command: string }>;
  /** Maximum verification rounds. Defaults to 3. */
  readonly verificationMaxRounds?: number;
  /** Context-window size in tokens. Defaults to 128 000. */
  readonly contextWindow?: number;
  /** Override the session id (defaults to a new id). */
  readonly sessionId?: string;
  /**
   * Approval handler. Defaults to deny-all (non-interactive).
   * Pass the CLI's `makeApproval` result or an interactive handler.
   */
  readonly approval?: LegacyApprovalHandler;
  /** Live-stream callbacks for the TUI. */
  readonly onStream?: StreamCallbacks;
  /**
   * Callback invoked for every agent event emitted during the run
   * (used by the headless CLI and by the container's default event bus wiring).
   */
  readonly onEvent?: (event: unknown) => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Default denial handler — used when no approval is injected. */
function defaultDenyApproval(): LegacyApprovalHandler {
  return {
    request: async (_call, _reason) => ({ approved: false }),
  };
}

/**
 * Construct all agent runtime dependencies from a declarative options object.
 *
 * The returned object can be passed to `createAgentLoop` in `src/agent/loop.ts`.
 * It contains:
 *  - New interface views (`provider`, `toolRegistry`, `approval`, …)
 *  - Concrete implementations (`adapter`, `guard`, `policy`, …)
 *
 * The container does NOT import React, Ink, or CLI-specific code.
 */
export function createAgentContainer(opts: ContainerOptions): AgentDependencies {
  const workspace = resolve(opts.workspace);
  const adapter: ModelAdapter = opts.model;

  // --- Provider contract ---
  const provider = createModelProvider(adapter);

  // --- Tools ---
  const guard = new PathGuard(workspace);
  const policy = new PolicyEngine(opts.policyConfig ?? {});
  const toolRegistry = createToolRegistryAdapter(adapter, policy, guard);

  // --- Approval ---
  const handler: LegacyApprovalHandler = opts.approval ?? defaultDenyApproval();
  const approval = createApprovalService(handler);

  // --- Agent core ---
  const digest = new TaskDigest(opts.goal);
  const context = new ContextManager(adapter, digest, {
    contextWindow: opts.contextWindow ?? 128_000,
  });
  const meter = new CostMeter(adapter.pricing);
  const loopDetector = new LoopDetector();

  // --- Persistence ---
  const sessions = new SessionStore(workspace, opts.sessionId ?? SessionStore.newId());
  const checkpoints = new CheckpointStore(workspace);
  const eventBus = new InMemoryEventBus();

  // --- Verification ---
  const verificationConfig: VerificationConfig = {
    commands: opts.verificationCommands ?? [],
    maxRounds: opts.verificationMaxRounds ?? 3,
  };
    const verification = new VerificationGate(
    guard,
    (e) => {
      eventBus.emit(e);
      opts.onEvent?.(e);
    },
    verificationConfig,
  );

  return {
    // New interface views
    provider,
    toolRegistry,
    approval,
    sessionRepo: sessions,
    checkpointRepo: checkpoints,
    verification,
    eventBus,
    // Concrete implementations
    adapter,
    guard,
    policy,
    digest,
    context,
    meter,
    loopDetector,
    sessions,
    checkpoints,
    verificationGate: verification,
    toolSchemas: TOOL_SCHEMAS,
    // Config
    mode: opts.mode ?? "act",
    maxIterations: opts.maxIterations ?? 40,
    modelTimeoutMs: opts.modelTimeoutMs,
    signal: opts.signal,
    onStream: opts.onStream,
  };
}
