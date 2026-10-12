/**
 * GrpcClient — typed wrapper around GrpcClientBase.
 *
 * Mirrors the service handlers registered in `CommandRunner` (extension side).
 * Each method corresponds to a gRPC service + method pair.
 */
import { GrpcClientBase } from "./grpc-client-base.js"
import type { ExtensionState, ClineMessage } from "@shared/ExtensionMessage.js"

export class GrpcClient extends GrpcClientBase {
	// --- StateService ---
	subscribeToState = (message?: any): Promise<void> =>
		this.rpc("StateService", "subscribeToState", message ?? {})

	// --- ChatService ---
	startNewTask = (goal: string, mode: "plan" | "act" = "act"): Promise<{ sessionId: string; status: string }> =>
		this.rpc("ChatService", "startNewTask", { goal, mode })

	sendMessage = (text: string, attachments?: string[]): Promise<{ received: boolean }> =>
		this.rpc("ChatService", "sendMessage", { text, attachments })

	cancelTask = (): Promise<{ cancelled: boolean }> =>
		this.rpc("ChatService", "cancelTask", {})

	clearHistory = (): Promise<{ cleared: boolean }> =>
		this.rpc("ChatService", "clearHistory", {})

	// --- ConfigService ---
	getProviders = (): Promise<any[]> =>
		this.rpc("ConfigService", "getProviders", {})

	updateConfig = (config: { apiKeys?: Record<string, string>; baseUrls?: Record<string, string>; theme?: string }): Promise<ExtensionState> =>
		this.rpc("ConfigService", "updateConfig", config)

	// --- TerminalService ---
	runCommand = (command: string, cwd?: string): AsyncIterable<{ output: string; done?: boolean; exitCode?: number }> =>
		this.streamRpc("TerminalService", "runCommand", { command, cwd })

	// --- AuthService ---
	getAuthStatus = (): Promise<{ isAuthenticated: boolean; user?: any }> =>
		this.rpc("AuthService", "getAuthStatus", {})

	logout = (): Promise<{ success: boolean }> =>
		this.rpc("AuthService", "logout", {})

	// --- Streaming agent events ---
	/**
	 * Subscribe to agent streaming events. The extension pushes ClineMessage
	 * entries via the agent_stream request channel.
	 */
	streamAgentEvents = (): AsyncIterable<{ type: string; data: any }> =>
		this.streamRpc("AgentService", "streamEvents", {})
}

/** Singleton gRPC client instance for the webview. */
let client: GrpcClient | null = null
export function getGrpcClient(): GrpcClient {
	if (!client) client = new GrpcClient()
	return client
}

/** Reset the singleton (used in tests / hot-reload). */
export function resetGrpcClient(): void {
	client = null
}

export type { ExtensionState, ClineMessage }