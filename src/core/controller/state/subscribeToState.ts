/**
 * StateService.subscribeToState — streaming state handler.
 *
 * When the webview subscribes, this generator:
 *   1. Sends an initial `state_updated` snapshot (full ExtensionState)
 *   2. Then yields incremental `MessageStreamEvent` messages as the agent
 *      produces output (assistant text, tool calls, tool results, usage).
 *
 * The agent loop's onStream callback feeds events into a shared queue
 * that this generator drains. When the agent finishes (or errors), the
 * generator sends a final state snapshot and completes.
 */
import type { VscodeWebviewProvider } from "../../../hosts/vscode/VscodeWebviewProvider.js"
import type { ExtensionState, ClineMessage } from "../../../shared/ExtensionMessage.js"
import type { AgentEvent } from "../../../agent/types.js"
import { readConfigSync } from "../../../utils/config.js"
import { getQuota } from "../../../models/quota-tracker.js"
import { loadAuthSession, isAuthSessionValid } from "../../../auth/index.js"

interface StateStreamEvent {
	type: "state_updated"
	state: Partial<ExtensionState>
}

/** Queue of agent events to stream to the webview. */
const eventQueues = new Map<string, AgentEvent[]>()
/** Whether the agent stream has completed. */
const streamCompleted = new Map<string, boolean>()

/**
 * Called by the agent loop's onStream callback to enqueue an event
 * for streaming to the webview.
 */
export function enqueueAgentEvent(sessionId: string, event: AgentEvent): void {
	const queue = eventQueues.get(sessionId) ?? []
	queue.push(event)
	eventQueues.set(sessionId, queue)
}

/** Mark a streaming session as completed (agent finished or errored). */
export function completeAgentStream(sessionId: string): void {
	streamCompleted.set(sessionId, true)
}

/** Convert an AgentEvent into webview-visible ClineMessages + state deltas. */
function eventToMessages(event: AgentEvent): Partial<ExtensionState> {
	return { clineMessages: convertEvent(event) }
}

/** Map TOOLIFY AgentEvent types to ClineMessage entries. */
function convertEvent(event: AgentEvent): ClineMessage[] {
	switch (event.type) {
		case "assistant_message":
			return [{
				type: "say",
				say: "assistant",
				text: event.content ?? "",
				ts: event.ts,
			}]
		case "tool_started":
			return [{
				type: "say",
				say: "info",
				text: `* ${event.call.name}`,
				ts: event.ts,
			}]
		case "tool_finished":
			return [{
				type: "say",
				say: "info",
				text: `- Tool result: ${event.content ?? ""}`,
				ts: event.ts,
			}]
		case "usage_update":
			return [{
				type: "say",
				say: "api_req_stream_closed",
				ts: event.ts,
			}]
		case "error":
			return [{
				type: "say",
				say: "error",
				text: event.message,
				ts: event.ts,
			}]
		case "run_finished":
			return [{
				type: "say",
				say: "completion_result",
				text: `Finished: ${event.reason}`,
				ts: event.ts,
			}]
		case "session_start":
			return [{
				type: "say",
				say: "command_started",
				text: `Starting session: ${event.sessionDir}`,
				ts: event.ts,
			}]
		case "user_message":
			return [{
				type: "say",
				say: "user",
				text: event.content,
				ts: event.ts,
			}]
		default:
			return []
	}
}

/** Capture the current ExtensionState snapshot at this moment in time. */
export function captureStateSnapshot(sessionId?: string): ExtensionState {
	const cfg = readConfigSync()

	const session = loadAuthSession()
	const isAuthenticated = isAuthSessionValid(session)

	let provider = "anthropic"
	let model = "claude-3-5-sonnet-20241022"
	if (cfg.apiKeys) {
		const firstKey = Object.keys(cfg.apiKeys)[0]
		if (firstKey) provider = firstKey
	}
	if (cfg.baseUrls) {
		const firstUrl = Object.keys(cfg.baseUrls)[0]
		if (firstUrl) provider = firstUrl
	}

	const quota = getQuota(provider, model)

	return {
		clineMessages: [],
		mode: "act",
		autoApprovalSettings: { mode: "off" },
		apiConfiguration: {
			provider,
			model,
			baseUrl: cfg.baseUrls?.[provider],
		},
		workspace: process.cwd(),
		isRunning: false,
		platform: process.platform as any,
		isAuthenticated,
		userInfo: session?.user
			? {
					name: session.user.name,
					email: session.user.email,
					avatarUrl: session.user.avatarUrl,
					provider: session.user.provider,
				}
			: undefined,
		quotaState: quota
			? {
					remainingTokens: quota.remainingTokens,
					limitTokens: quota.limitTokens,
					remainingRequests: quota.remainingRequests,
					resetTime: quota.resetTime,
					isExhausted: quota.isExhausted,
				}
			: undefined,
		usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
		showWelcome: !isAuthenticated,
		shouldShowAnnouncement: false,
		taskHistory: [],
		themeId: cfg.theme,
	}
}

/**
 * Streaming generator for the StateService.subscribeToState RPC.
 * Yields { type: "state_updated", state } messages to the webview,
 * first with the full snapshot, then with incremental agent events.
 */
export async function* subscribeToState(
	provider: VscodeWebviewProvider,
	_message: any,
	signal: AbortSignal,
): AsyncIterable<StateStreamEvent> {
	// 1. Send the initial full state snapshot.
	const snapshot = captureStateSnapshot()
	yield { type: "state_updated", state: snapshot }

	// 2. Stream incremental agent events until the agent completes or
	//    the client cancels (via AbortSignal).
	const sessionId = snapshot.currentSessionId ?? "default"
	const pollInterval = 50 // ms

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

	while (!signal.aborted) {
		const queue = eventQueues.get(sessionId) ?? []
		const completed = streamCompleted.get(sessionId) ?? false

		while (queue.length > 0) {
			const event = queue.shift()!
			const delta = eventToMessages(event)
			yield { type: "state_updated", state: delta }
		}

		if (completed) {
			// Final snapshot with updated state.
			const finalSnapshot = { ...captureStateSnapshot(), isRunning: false }
			yield { type: "state_updated", state: finalSnapshot }
			break
		}

		await sleep(pollInterval)
	}

	// Cleanup.
	eventQueues.delete(sessionId)
	streamCompleted.delete(sessionId)
}