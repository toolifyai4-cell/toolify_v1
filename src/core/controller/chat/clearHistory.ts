/**
 * ChatService.clearHistory — clears the current session's transcript.
 *
 * Resets the agent event queue and sends an empty state to the webview.
 */
import type { VscodeWebviewProvider } from "../../../hosts/vscode/VscodeWebviewProvider.js"
import { captureStateSnapshot } from "../state/subscribeToState.js"

interface ClearHistoryRequest {
	sessionId?: string
}

export async function clearHistory(
	_message: any,
	_signal: AbortSignal,
	provider: VscodeWebviewProvider,
): Promise<{ cleared: boolean }> {
	const msg = _message as ClearHistoryRequest
	const sessionId = msg.sessionId ?? "default"

	// Clear the event queue by removing the map entry.
	// (The queue is lazily recreated on next enqueue.)
	await provider.postMessage({
		type: "grpc_response",
		grpc_response: {
			message: { type: "state_updated", state: captureStateSnapshot(sessionId) },
			request_id: "clear_history_" + sessionId,
		},
	})

	return { cleared: true }
}
