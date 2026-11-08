/**
 * ChatService.cancelTask — cancels the currently running agent loop.
 *
 * Signals the AbortController that the agent loop was created with,
 * causing it to break out of the current step and emit a final
 * `run_finished` event.
 */
import type { VscodeWebviewProvider } from "../../../hosts/vscode/VscodeWebviewProvider.js"
import type { AgentSessionManager } from "../../../extension/agent-session-manager.js"
import { agentSessionManager } from "../../../extension/agent-session-manager.js"
import { completeAgentStream } from "../state/subscribeToState.js"

interface CancelTaskRequest {
	sessionId?: string
}

export async function cancelTask(
	_provider: VscodeWebviewProvider,
	_sessionManager: AgentSessionManager,
	message?: any,
): Promise<{ cancelled: boolean }> {
	const req = message as CancelTaskRequest | undefined

	// Use the provided sessionId, or fall back to the most recent active session.
	const sessionId = req?.sessionId ?? agentSessionManager.listSessions()[0] ?? "default"

	// Cancel via the session manager (aborts the AbortController).
	agentSessionManager.cancelSession(sessionId)

	// Mark the stream as completed so the webview stops polling.
	completeAgentStream(sessionId)

	return { cancelled: true }
}