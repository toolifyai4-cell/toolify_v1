export interface ToolSchema {
  /** Unique name of the tool, used for identification and logging. */
  name: string;
  /** Human‑readable description shown in the UI / help. */
  description: string;
  /** JSON‑Schema that defines the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** Optional JSON‑Schema for the tool's output (if known). */
  outputSchema?: Record<string, unknown>;
}

/** Options passed to {@link createTool} when defining a new tool. */
export interface CreateToolOptions {
  /** Tool name. */
  name: string;
  /** Tool description. */
  description: string;
  /** JSON‑Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
  /** Executor function that runs the tool.
   *  Receives the raw input object (as parsed from the JSON‑Schema).
   *  Should return { success, output?, error? }.
   */
  execute: (
    input: Record<string, unknown>
  ) => Promise<{
    /** True when the tool ran without a fatal error. */
    success: boolean;
    /** Free‑form result object (serialised if needed). */
    output?: unknown;
    /** Human‑readable error message when `success` is false. */
    error?: string;
  }>;
}

/** Minimal executor signature – useful for type‑only imports. */
export type ToolExecutor = (
  input: Record<string, unknown>
) => Promise<{
  success: boolean;
  output?: unknown;
  error?: string;
}>;

/** Context passed to hook callbacks. */
export interface HookContext {
  /** Name of the tool being executed. */
  toolName: string;
  /** Unique identifier of the tool call (correlates with loop events). */
  callId: string;
  /** Raw input that was passed to the tool. */
  input: Record<string, unknown>;
  /** Result output from the tool (if any). */
  output?: unknown;
  /** Error message if the tool failed. */
  error?: string;
}

/** Approval service interface – matches the one used internally by the agent loop. */
export interface ApprovalService {
  /** Ask the user (or policy) whether a given tool call is allowed.
   *  @param call   Information about the tool call.
   *  @param reason Human‑readable explanation shown to the user.
   *  @returns      `{ approved: boolean; scope?: "once" | "session" }`.
   */
  request(
    call: {
      /** Tool name. */
      name: string;
      /** Input payload. */
      input: Record<string, unknown>;
    },
    reason: string
  ): Promise<{ approved: boolean; scope?: "once" | "session" }>;
}

/** Hooks that plugins can implement to react to agent lifecycle events. */
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