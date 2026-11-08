/**
 * AgentSessionManager — owns and manages active AgentLoop instances
 * for the VS Code extension host.
 *
 * Unlike the CLI where loops are created ad-hoc per command, the extension
 * maintains long-running sessions keyed by session ID. Each session holds:
 *   - The AgentLoop instance
 *   - Its AbortController (for cancellation)
 *   - The AgentDependencies container
 *   - The GrpcStateEmitter (for streaming events to the webview)
 *
 * This replaces the previous inline loop creation in gRPC handlers.
 */
import type { AgentDependencies } from "../app/runtime-context.js";
import type { AgentLoop } from "../agent/loop.js";
import { createAgentLoop } from "../agent/loop.js";
import { GrpcStateEmitter } from "../core/controller/agent/GrpcStateEmitter.js";
import type { StreamCallbacks } from "../app/runtime-context.js";

export interface ActiveSession {
  readonly sessionId: string;
  readonly loop: AgentLoop;
  readonly controller: AbortController;
  readonly emitter: GrpcStateEmitter;
}

export class AgentSessionManager {
  private readonly sessions = new Map<string, ActiveSession>();

  /**
   * Create and start a new agent session. Fires the loop in the background
   * and returns the session handle.
   *
   * If `sessionId` is provided, it is used (must match the container's
   * SessionStore id). Otherwise a new UUID is generated.
   */
  createSession(
    deps: AgentDependencies,
    goal: string,
    sessionId?: string,
  ): { sessionId: string; controller: AbortController } {
    const id = sessionId ?? crypto.randomUUID();
    const controller = new AbortController();

    // Wire the stream callbacks into the gRPC streaming pipeline.
    const emitter = new GrpcStateEmitter(id);
    const streamCallbacks: StreamCallbacks = {
      onAssistantText: (delta) => emitter.onAssistantText(delta),
      onToolStart: (call) => emitter.onToolStart(call),
      onToolResult: (callId, result, isError) =>
        emitter.onToolResult(callId, result, isError),
      onStatus: (status) => emitter.onStatus(status),
      onFirstToken: () => emitter.onFirstToken(),
      onError: (banner, kind) => emitter.onError(banner, kind),
    };

    // Create the loop with stream callbacks wired.
    const loop = createAgentLoop({
      ...deps,
      signal: controller.signal,
      onStream: streamCallbacks,
    });

    const session: ActiveSession = { sessionId: id, loop, controller, emitter };
    this.sessions.set(id, session);

    // Fire the loop in the background; when it completes, clean up.
    void loop.run(goal).then(
      () => {
        emitter.finish("stop");
        this.sessions.delete(id);
      },
      (err: Error) => {
        emitter.onError(err.message ?? "Unknown error", "error");
        this.sessions.delete(id);
      },
    );

    return { sessionId: id, controller };
  }

  /** Get an active session by ID, if it exists. */
  getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Cancel and remove an active session. */
  cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.controller.abort();
    this.sessions.delete(sessionId);
    return true;
  }

  /** List all active session IDs. */
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Dispose all sessions (called on extension deactivation). */
  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.controller.abort();
    }
    this.sessions.clear();
  }

  /** VS Code Disposable interface implementation. */
  dispose(): void {
    this.disposeAll();
  }
}

export const agentSessionManager = new AgentSessionManager();
