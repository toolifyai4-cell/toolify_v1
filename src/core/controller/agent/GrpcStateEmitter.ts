/**
 * GrpcStateEmitter — bridges the agent loop's `StreamCallbacks` into the
 * gRPC streaming pipeline.
 *
 * When the webview sends ChatService.startNewTask / sendMessage, the
 * handler creates an `AgentLoop` with an instance of this class as the
 * `onStream` callback. Each callback fires `enqueueAgentEvent()` (from
 * subscribeToState), which the `subscribeToState` generator drains and
 * forwards to the webview as streaming ClineMessage entries.
 */
import type { StreamCallbacks } from "../../../app/runtime-context.js"
import type { ToolCall, Usage, FinishReason } from "../../../agent/types.js"
import {
	enqueueAgentEvent,
	completeAgentStream,
} from "../state/subscribeToState.js"

export class GrpcStateEmitter implements StreamCallbacks {
	private readonly sessionId: string
	private messageBuffer: { type: string; content: string; ts: number }[] = []

	constructor(sessionId: string) {
		this.sessionId = sessionId
		this.start()
	}

	start(): void {
		// Flush any buffered events from a previous run.
		this.messageBuffer = []
	}

		onAssistantText(delta: string): void {
		enqueueAgentEvent(this.sessionId, {
			type: "assistant_message",
			content: delta,
			ts: Date.now(),
		})
	}

	onToolStart(call: ToolCall): void {
		enqueueAgentEvent(this.sessionId, {
			type: "tool_started",
			call,
			ts: Date.now(),
		})
	}

	onToolResult(callId: string, result: string, isError: boolean): void {
		enqueueAgentEvent(this.sessionId, {
			type: "tool_finished",
			callId,
			content: result,
			isError,
			ts: Date.now(),
		})
	}

	onStatus(status: { inputTokens: number; outputTokens: number; costUsd: number }): void {
		enqueueAgentEvent(this.sessionId, {
			type: "usage_update",
			usage: { inputTokens: status.inputTokens, outputTokens: status.outputTokens },
			costUsd: status.costUsd,
			ts: Date.now(),
		})
	}

	onFirstToken(): void {
		enqueueAgentEvent(this.sessionId, {
			type: "session_start",
			sessionDir: "",
			model: "",
			ts: Date.now(),
		})
	}

	onError(banner: string, kind: "error" | "timeout"): void {
		enqueueAgentEvent(this.sessionId, {
			type: "error",
			message: banner,
			ts: Date.now(),
		})
		completeAgentStream(this.sessionId)
	}

	/** Called when the agent loop finishes successfully. */
	finish(reason: FinishReason | "budget" | "loop_detected" | "interrupted" = "stop"): void {
		enqueueAgentEvent(this.sessionId, {
			type: "run_finished",
			reason,
			ts: Date.now(),
		})
		completeAgentStream(this.sessionId)
	}

	/** Flush any pending buffered messages. */
	flush(): void {
		for (const m of this.messageBuffer) {
			enqueueAgentEvent(this.sessionId, m as any)
		}
		this.messageBuffer = []
	}
}