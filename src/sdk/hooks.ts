import type { HookContext } from "./types";

/** Hook types – plugins can implement any subset they care about. */
export namespace hooks {
  /** Fired just before a tool execution starts. */
  export type onToolStart = (ctx: HookContext) => void;

  /** Fired after a tool execution completes successfully. */
  export type onToolSuccess = (ctx: HookContext & { output: unknown }) => void;

  /** Fired when a tool execution ends with an error. */
  export type onToolError = (ctx: HookContext & { error: string }) => void;

  /** Fired at the very beginning of an agent run. */
  export type onAgentStart = (prompt: string) => void;

  /** Fired when an agent run finishes (successfully or after an error). */
  export type onAgentEnd = (
    result: {
      /** True when the run finished without a fatal error. */
      success: boolean;
      /** Free‑form result output (optional). */
      output?: unknown;
      /** Error message if the run failed (optional). */
      error?: string;
    }
  ) => void;
}

/** Helper class that allows plugins to register callbacks for the hooks above.
 *  The agent loop can invoke `hookToolStart`, `hookToolSuccess`, etc., passing
 *  the current {@link HookContext}.
 */
export class HookRegistry {
  private readonly starts: Array<(ctx: HookContext) => void> = [];
  private readonly successes: Array<(ctx: HookContext & { output: unknown }) => void> = [];
  private readonly errors: Array<(ctx: HookContext & { error: string }) => void> = [];
  private readonly agentStarts: Array<(prompt: string) => void> = [];
  private readonly agentEnds: Array<(result: {
    success: boolean;
    output?: unknown;
    error?: string;
  }) => void> = [];

  /** Register a start‑tool hook. */
  onToolStart(cb: (ctx: HookContext) => void) {
    this.starts.push(cb);
  }
  /** Register a success‑tool hook. */
  onToolSuccess(cb: (ctx: HookContext & { output: unknown }) => void) {
    this.successes.push(cb);
  }
  /** Register an error‑tool hook. */
  onToolError(cb: (ctx: HookContext & { error: string }) => void) {
    this.errors.push(cb);
  }
  /** Register an agent‑start hook. */
  onAgentStart(cb: (prompt: string) => void) {
    this.agentStarts.push(cb);
  }
  /** Register an agent‑end hook. */
  onAgentEnd(cb: (result: {
    success: boolean;
    output?: unknown;
    error?: string;
  }) => void) {
    this.agentEnds.push(cb);
  }

  /** Emit "tool start" to all registered listeners. */
  emitToolStart(ctx: HookContext) {
    for (const cb of this.starts) cb(ctx);
  }
  /** Emit "tool success" to all registered listeners. */
  emitToolSuccess(ctx: HookContext & { output: unknown }) {
    for (const cb of this.successes) cb(ctx as any);
  }
  /** Emit "tool error" to all registered listeners. */
  emitToolError(ctx: HookContext & { error: string }) {
    for (const cb of this.errors) cb(ctx as any);
  }
  /** Emit "agent start" to all registered listeners. */
  emitAgentStart(prompt: string) {
    for (const cb of this.agentStarts) cb(prompt);
  }
  /** Emit "agent end" to all registered listeners. */
  emitAgentEnd(result: {
    success: boolean;
    output?: unknown;
    error?: string;
  }) {
    for (const cb of this.agentEnds) cb(result);
  }
}