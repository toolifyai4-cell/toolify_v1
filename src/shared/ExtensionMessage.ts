// ExtensionMessage: messages sent FROM the extension TO the webview.
// The webview holds a reactive copy of ExtensionState and receives
// streaming updates via grpc_response messages over postMessage.

/**
 * The protobuf-encoded response wrapper for all RPC calls between the
 * webview and the extension host. Every grpc_response carries a request_id
 * that matches the original grpc_request, plus the decoded message body
 * (or an error). Streaming responses have is_streaming=true on every chunk
 * except the last.
 */
export interface ExtensionMessage {
	type: "grpc_response"
	grpc_response?: GrpcResponse
}

export type GrpcResponse = {
	message?: any
	request_id: string
	error?: string
	is_streaming?: boolean
	sequence_number?: number
}

export type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "unknown"
export const DEFAULT_PLATFORM = "unknown"
export const COMMAND_CANCEL_TOKEN = "__toolify_command_cancel__"

/**
 * The top-level state snapshot that the extension pushes to the webview.
 * This is the "source of truth" that the webview's ExtensionStateContext
 * hydrates from on connect and then applies incrementally via streaming.
 */
export interface ExtensionState {
	/** Full chat transcript as typed message entries. */
	clineMessages: ClineMessage[]

	/** Current plan/act mode. */
	mode: "plan" | "act"

	/** Auto-approval settings from CLI config. */
	autoApprovalSettings: { mode: "off" | "writes" | "all" }

	/** Provider + model active for this session. */
	apiConfiguration: { provider: string; model: string; baseUrl?: string; maxTokens?: number }

	/** Workspace path the agent is operating on. */
	workspace: string

	/** Current running state — drives the thinking spinner in the UI. */
	isRunning: boolean

	/** Active session ID for checkpoint/restore. */
	currentSessionId?: string

	/** Platform from the host environment. */
	platform: Platform

	/** Whether the user is authenticated. */
	isAuthenticated: boolean

	/** User profile from the auth session, if available. */
	userInfo?: { name: string; email?: string; avatarUrl?: string; provider: string }

	/** Quota state for the active model. */
	quotaState?: {
		remainingTokens?: number
		limitTokens?: number
		remainingRequests?: number
		resetTime?: string
		isExhausted: boolean
	}

	/** Cost meter totals for the current session. */
	usage: { inputTokens: number; outputTokens: number; costUsd: number }

	/** Monotonic version for staleness checks. */
	stateVersion?: number

	/** Whether the webview should show the welcome/onboarding flow. */
	showWelcome: boolean

	/** Whether the announcement banner should be visible. */
	shouldShowAnnouncement: boolean

	/** Recent task history (last N sessions). */
	taskHistory: Array<{ id: string; ts: number; preview: string; role: "user" | "assistant" }>

	/** UI panel visibility flags. */
	showSettings?: boolean
	showHistory?: boolean
	showAccount?: boolean

	/** Active theme ID. */
	themeId?: string

	/** Available terminal profiles. */
	terminalProfiles?: string[]

	/** Current terminal profile selection. */
	defaultTerminalProfile?: string

	/** Background command state. */
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string

		/** Terminal output captured during the current run. */
	terminalOutput?: string
}

/**
 * The canonical message type for chat transcript entries, using
 * Cline's `say`/`ask` vocabulary so the webview's ChatView pipeline
 * (which groups, filters, and combines by say-type) renders correctly.
 */
export type ClineMessage =
	| { type: "say"; say: "assistant"; text?: string; ts: number }
	| { type: "say"; say: "user"; text?: string; ts: number }
	| { type: "say"; say: "api_req_started"; text?: string; ts: number }
	| { type: "say"; say: "api_req_stream_closed"; ts: number }
	| { type: "say"; say: "command_started"; text?: string; ts: number }
	| { type: "say"; say: "command_output"; text?: string; ts: number }
	| { type: "say"; say: "completion_result"; text?: string; ts: number }
	| { type: "say"; say: "info"; text?: string; ts: number }
	| { type: "say"; say: "error"; text?: string; ts: number }
	| { type: "say"; say: "task_progress"; text?: string; ts: number }
	| { type: "say"; say: "hook_status"; text?: string; ts: number }
	| { type: "say"; say: "hook_output_stream"; text?: string; ts: number }
	| { type: "ask"; ask: "command_output"; text?: string; ts: number }
	| { type: "ask"; ask: "completion_result_unavailable"; text?: string; ts: number }

/**
 * Tool-call / result entry rendered as an inline card in the transcript.
 */
export interface ClineSayTool {
	tool:
		| "editedExistingFile"
		| "newFileCreated"
		| "fileDeleted"
		| "readFile"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "webFetch"
		| "webSearch"
		| "runCommand"
	path?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
}

/** Converts a TOOLIFY chat message into a ClineMessage for the webview. */
export function chatMessageToClineMessage(msg: {
	role: "user" | "assistant"
	content: string
	thinking?: boolean
	tool_calls?: any[]
}): ClineMessage {
	if (msg.role === "user") {
		return { type: "say", say: "user", text: msg.content, ts: Date.now() }
	}
	return { type: "say", say: "assistant", text: msg.content, ts: Date.now() }
}

/** Converts a ClineMessage back into a TOOLIFY chat message shape. */
export function clineMessageToChatMessage(msg: ClineMessage): {
	role: "user" | "assistant"
	content: string
} {
	switch (msg.type) {
		case "say":
			if (msg.say === "user") return { role: "user", content: msg.text ?? "" }
			return { role: "assistant", content: ("text" in msg ? msg.text : "") ?? "" }
		case "ask":
			return { role: "assistant", content: msg.text ?? "" }
		default:
			return { role: "assistant", content: "" }
	}
}