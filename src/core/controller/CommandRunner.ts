/**
 * CommandRunner — the top-level gRPC service dispatcher.
 *
 * Implements `GrpcService` (from the base WebviewProvider). When the webview
 * sends a `grpc_request` with service "StateService" / "ChatService" /
 * "ConfigService" / "TerminalService", the base provider calls
 * `handleRequest(method, message, streaming, signal)` here.
 *
 * Each method routes to a specialized handler that interacts with the
 * TOOLIFY agent runtime (AgentRunner / container / storage).
 */
import type { GrpcService } from "../webview/WebviewProvider.js"
import type { VscodeWebviewProvider } from "../../hosts/vscode/VscodeWebviewProvider.js"
import { subscribeToState } from "./state/subscribeToState.js"
import { startNewTask } from "./chat/startNewTask.js"
import { sendMessage } from "./chat/sendMessage.js"
import { cancelTask } from "./chat/cancelTask.js"
import { clearHistory } from "./chat/clearHistory.js"
import { updateConfig } from "./config/updateConfig.js"
import { getProviders } from "./config/getProviders.js"
import { runTerminalCommand } from "./terminal/runCommand.js"
import { getAuthStatus } from "./auth/getAuthStatus.js"
import { logoutUser } from "./auth/logoutUser.js"

export class CommandRunner implements GrpcService {
	private activeControllers = new Map<string, AbortController>()

	constructor(private readonly provider: VscodeWebviewProvider) {}

	/**
	 * Dispatch a single gRPC method call to its handler.
	 * Returns an async iterable for streaming methods, or a plain value
	 * for unary methods.
	 */
	handleRequest(
		method: string,
		message: any,
		_streaming: boolean,
		signal: AbortSignal,
		): Promise<any> | AsyncIterable<any> {
		switch (method) {
			// --- StateService ---
			case "subscribeToState":
				return subscribeToState(this.provider, message, signal)

			// --- ChatService ---
			case "startNewTask":
				return startNewTask(message, signal, this.provider)
			case "sendMessage":
				return sendMessage(message, signal, this.provider)
			case "cancelTask":
				return cancelTask(this.provider)
			case "clearHistory":
				return clearHistory(message, signal, this.provider)

			// --- ConfigService ---
			case "updateConfig":
				return updateConfig(message, signal, this.provider)
			case "getProviders":
				return getProviders(message, signal)

			// --- TerminalService ---
			case "runCommand":
				return runTerminalCommand(message, signal, this.provider)

			// --- AuthService ---
			case "getAuthStatus":
				return getAuthStatus(message, signal)
			case "logout":
				return logoutUser(message, signal)

			default:
				throw new Error(`Unknown gRPC method: ${method}`)
		}
	}

	/** Abort a streaming request by its request_id. */
	cancel(requestId: string): void {
		const ctrl = this.activeControllers.get(requestId)
		if (ctrl) {
			ctrl.abort()
			this.activeControllers.delete(requestId)
		}
	}
}
