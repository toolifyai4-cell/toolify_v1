/**
 * Approval contract — decouples the agent runtime from the Ink/CLI approval UI.
 *
 * The existing `ApprovalHandler` interface (defined in `src/agent/loop.ts`)
 * continues to work through a compatibility adapter.
 */
import type { RiskTier, ToolCall } from "../agent/types.js";
import type { AgentEventBus } from "../agent/events.js";

// ---------------------------------------------------------------------------
// Approval decision
// ---------------------------------------------------------------------------

/** Result of an approval request. */
export interface ApprovalDecision {
  /** Whether the tool call is approved to proceed. */
  readonly approved: boolean;
  /** Scope for which future calls with the same tier are auto-approved. */
  readonly scope?: "once" | "session" | "workspace";
  /** Optional explanation of the decision (denial reason, etc.). */
  readonly reason?: string;
}

/** Context supplied to an approval request. */
export interface ApprovalContext {
  /** Risk tier of the tool call being approved. */
  readonly riskTier: RiskTier;
  /** Human-readable reason explaining why approval is needed. */
  readonly reason: string;
  /** Absolute workspace path. */
  readonly workspace: string;
}

// ---------------------------------------------------------------------------
// Approval service interface
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic approval interface.
 *
 * Must be implemented by an adapter around the existing Ink-based
 * `ApprovalHandler` so the core runtime never imports React or Ink.
 */
export interface ApprovalService {
  request(call: ToolCall, context: ApprovalContext): Promise<ApprovalDecision>;
}

// ---------------------------------------------------------------------------
// Legacy handler (compatibility)
// ---------------------------------------------------------------------------

/**
 * Shape of the legacy `ApprovalHandler` defined in `src/agent/loop.ts`.
 *
 * Separated into its own type so the adapter can reference it without
 * creating a circular import with `loop.ts`.
 */
export interface LegacyApprovalHandler {
  request(
    call: ToolCall,
    reason: string,
  ): Promise<{ approved: boolean; scope?: "once" | "session" }>;
}

// ---------------------------------------------------------------------------
// Compatibility adapter
// ---------------------------------------------------------------------------

/**
 * Wrap a legacy `ApprovalHandler` as an `ApprovalService`.
 *
 * The `scope` is mapped directly: `"session"` → `"session"`, `"once"` → `"once"`.
 * When the legacy handler doesn't return a scope, `undefined` is preserved.
 */
export function createApprovalService(
  handler: LegacyApprovalHandler,
): ApprovalService {
  return {
    async request(call, ctx) {
      const result = await handler.request(call, ctx.reason);
      return {
        approved: result.approved,
        scope: result.scope as "once" | "session" | "workspace" | undefined,
        reason: result.approved ? undefined : ctx.reason,
      };
    },
  };
}
