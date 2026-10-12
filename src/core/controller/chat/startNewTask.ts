/**
 * ChatService.startNewTask — starts a new agent session.
 *
 * Creates a fresh agent container with the active provider/model config,
 * wires up a `GrpcStateEmitter` as the stream callback, and fires the
 * agent loop in the background. Returns a task handle (session ID) that
 * the webview uses to correlate subsequent streaming events.
 */
import type { VscodeWebviewProvider } from "../../../hosts/vscode/VscodeWebviewProvider.js"
import { createAgentContainer } from "../../../app/container.js"
import { createAgentLoop } from "../../../agent/loop.js"
import { GrpcStateEmitter } from "../agent/GrpcStateEmitter.js"
import { loadConfig, createAdapter, resolveWorkspace } from "../../../cli/run.js"
import { SessionStore } from "../../../storage/session.js"
import type { ToolifyConfig } from "../../../cli/run.js"
import type { AgentMode } from "../../../agent/types.js"

interface StartNewTaskRequest {
	goal: string
	mode?: AgentMode
}

interface StartNewTaskResponse {
	sessionId: string
	status: "started"
}

export async function startNewTask(
	message: any,
	_signal: AbortSignal,
	_provider: VscodeWebviewProvider,
): Promise<StartNewTaskResponse> {
	const req = message as StartNewTaskRequest
	const workspace = resolveWorkspace().workspace

	// Load provider/model config from the workspace.
	const cfg: ToolifyConfig = await loadConfig(workspace)
	const adapter = createAdapter(cfg, workspace)
	const sessionId = SessionStore.newId()
	const emitter = new GrpcStateEmitter(sessionId)

		// Build the full agent container with the gRPC emitter as stream callbacks.
	const container = createAgentContainer({
		workspace,
		model: adapter,
		goal: req.goal,
		mode: req.mode ?? "act",
		sessionId,
		onStream: emitter,
		policyConfig: cfg.policy ?? {},
		maxIterations: cfg.maxIterations ?? 40,
		approval: {
			request: async (_call, _reason) => ({ approved: true, scope: "session" as const }),
		},
	})

	const loop = createAgentLoop(container)

	// Kick off the run — the GrpcStateEmitter feeds events into the
	// streaming pipeline; subscribeToState drains them to the webview.
	void loop.run(req.goal).then(
		() => emitter.finish("max_tokens"),
		(err: Error) => emitter.onError(err.message ?? "Unknown error", "error"),
	)

	return { sessionId, status: "started" }
}
