/**
 * ChatService.sendMessage — submits a user message to the active session.
 *
 * If a task is already running, the message is queued for the agent loop's
 * next iteration. Otherwise it starts a new task.
 */
import type { VscodeWebviewProvider } from "../../../hosts/vscode/VscodeWebviewProvider.js"
import { enqueueAgentEvent } from "../state/subscribeToState.js"

interface SendMessageRequest {
	text: string
	attachments?: string[]
}

export async function sendMessage(
	message: any,
	_signal: AbortSignal,
	_provider: VscodeWebviewProvider,
): Promise<{ received: boolean }> {
	const req = message as SendMessageRequest

	enqueueAgentEvent("default", {
		type: "user_message",
		content: req.text,
		ts: Date.now(),
	})

	return { received: true }
}
