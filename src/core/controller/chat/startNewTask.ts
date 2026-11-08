/**
 * ChatService.startNewTask — starts a new agent session.
 *
 * Creates a fresh agent container with the active provider/model config,
 * wires up stream callbacks via the session manager, and fires the
 * agent loop in the background. Returns a task handle (session ID) that
 * the webview uses to correlate subsequent streaming events.
 */
import type { VscodeWebviewProvider } from "../../../hosts/vscode/VscodeWebviewProvider.js"
import { createAgentContainer } from "../../../app/container.js"
import { loadWorkspaceConfig, createAdapter } from "../../../extension/workspace-config.js"
import type { ToolifyConfig } from "../../../utils/config.js"
import type { AgentMode } from "../../../agent/types.js"
import { AgentSessionManager } from "../../../extension/agent-session-manager.js"
import { SessionStore } from "../../../storage/session.js"

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
	sessionManager: AgentSessionManager,
): Promise<StartNewTaskResponse> {
	const req = message as StartNewTaskRequest

	// Load provider/model config from the active VS Code workspace folder.
	const cfg: ToolifyConfig = await loadWorkspaceConfig()
	const workspace = process.cwd()
	const adapter = createAdapter(cfg, workspace)

	// Generate a session id shared between the container's SessionStore
	// and the session manager so the webview can correlate events.
	const sessionId = SessionStore.newId()

	// Build the agent container (stream callbacks are wired by the session manager).
	const container = createAgentContainer({
		workspace,
		model: adapter,
		goal: req.goal,
		mode: req.mode ?? "act",
		sessionId,
		policyConfig: {},
		maxIterations: 40,
		approval: {
			request: async (_call, _reason) => ({ approved: true, scope: "session" as const }),
		},
	})

	// Create the session through the session manager, which owns the loop lifecycle.
	sessionManager.createSession(container, req.goal, sessionId)

	return { sessionId, status: "started" }
}