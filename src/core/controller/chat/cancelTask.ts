/**
 * ChatService.cancelTask — cancels the currently running agent loop.
 *
 * Signals the AbortController that the agent loop was created with,
 * causing it to break out of the current step and emit a final
 * `run_finished` event.
 */
import type { VscodeWebviewProvider } from "../../../hosts/vscode/VscodeWebviewProvider.js"
import { completeAgentStream } from "../state/subscribeToState.js"

export async function cancelTask(
	_provider: VscodeWebviewProvider,
): Promise<{ cancelled: boolean }> {
	// Signal the active session to abort via the shared AbortController.
	// The GrpcStateEmitter.onError will be called with "interrupted".
	completeAgentStream("default")
	return { cancelled: true }
}
