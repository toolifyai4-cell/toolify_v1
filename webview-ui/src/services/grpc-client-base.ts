/**
 * GrpcClientBase — low-level bidirectional message transport between the
 * webview and the extension host.
 *
 * In the original Cline, this wraps `@vscode/webview-ui-toolkit`'s
 * `postMessage` + `onMessage` from `acquireVsCodeApi()`. In TOOLIFY, the
 * webview may run in VS Code (real `vscode` API) or in a browser for
 * development/testing (the `TOOLIFY_WEBVIEW_DEV` shim in the base
 * WebviewProvider).
 *
 * Protocol:
 *   - Webview sends `WebviewMessage { type: "grpc_request", grpc_request: {...} }`
 *   - Extension sends back `ExtensionMessage { type: "grpc_response", grpc_response: {...} }`
 *
 * Request IDs are auto-incremented to correlate requests with responses.
 * Streaming responses use `is_streaming: true` on each chunk except the last.
 */
import type { WebviewMessage, GrpcRequest, GrpcCancel } from "@shared/WebviewMessage.js"
import type { ExtensionMessage, GrpcResponse } from "@shared/ExtensionMessage.js"

const API = (globalThis as any).acquireVsCodeApi ? (globalThis as any).acquireVsCodeApi() : null

type ResponseHandler = (msg: ExtensionMessage) => void

export class GrpcClientBase {
	private requestCounter = 0
	private pending = new Map<string, {
		resolve: (msg: GrpcResponse) => void
		reject: (err: Error) => void
	}>()
	private streamHandlers = new Map<string, (msg: GrpcResponse) => void>()
	private messageHandler: ResponseHandler | null = null

	constructor() {
		this.messageHandler = (msg: ExtensionMessage) => this.handleMessage(msg)
		if (typeof window !== "undefined") {
			window.addEventListener("message", (e: MessageEvent) => {
				this.handleMessage(e.data as ExtensionMessage)
			})
		}
		// In dev mode, also listen for postMessage events dispatched
		// by the shim in WebviewProvider.getHtml.
		if (API) {
			// VS Code extension API already has its own event loop.
		}
	}

	private handleMessage(msg: ExtensionMessage): void {
		if (msg.type !== "grpc_response" || !msg.grpc_response) return

		const resp = msg.grpc_response
		const handler = this.pending.get(resp.request_id)

		if (handler && !resp.is_streaming) {
			this.pending.delete(resp.request_id)
			if (resp.error) {
				handler.reject(new Error(resp.error))
			} else {
				handler.resolve(resp)
			}
			return
		}

		// Streaming response — forward to the stream handler.
		const streamHandler = this.streamHandlers.get(resp.request_id)
		if (streamHandler) {
			streamHandler(resp)
			if (!resp.is_streaming) {
				// Final chunk — clean up.
				this.streamHandlers.delete(resp.request_id)
			}
		}
	}

	/**
	 * Send a unary (non-streaming) gRPC request and await the response.
	 */
	async rpc<T = any>(service: string, method: string, message: any): Promise<T> {
		const requestId = `req_${Date.now()}_${++this.requestCounter}`
		const grpcMsg: GrpcRequest = {
			service,
			method,
			message,
			request_id: requestId,
			is_streaming: false,
		}

		const promise = new Promise<{ response: GrpcResponse }>((resolve, reject) => {
			this.pending.set(requestId, {
				resolve: (resp) => resolve({ response: resp }),
				reject,
			})
		})

		this.postMessage(grpcMsg)

		const timeout = setTimeout(() => {
			this.pending.delete(requestId)
			// Don't reject — let the call complete if the response arrives late.
		}, 120_000)

		const result = await promise
		clearTimeout(timeout)

		if (result.response.error) {
			throw new Error(result.response.error)
		}
		return await result.response.message as T
	}

	/**
	 * Send a streaming gRPC request and yield each response chunk.
	 */
	async *streamRpc<T = any>(service: string, method: string, message: any): AsyncIterable<T> {
		const requestId = `stream_${Date.now()}_${++this.requestCounter}`
		const grpcMsg: GrpcRequest = {
			service,
			method,
			message,
			request_id: requestId,
			is_streaming: true,
		}

		// Create a queue to buffer stream chunks.
		const queue: T[] = []
		let resolve: (() => void) | null = null
		let done = false
		let error: Error | null = null

		this.streamHandlers.set(requestId, (resp: GrpcResponse) => {
			if (resp.error && !resp.is_streaming) {
				error = new Error(resp.error)
				done = true
			} else if (resp.message !== undefined) {
				queue.push(resp.message as T)
			}
			if (!resp.is_streaming) {
				done = true
			}
			resolve?.()
			resolve = null
		})

		this.postMessage(grpcMsg)

		while (!done || queue.length > 0) {
			if (queue.length > 0) {
				yield queue.shift()!
			} else {
				await new Promise<void>((r) => { resolve = r })
			}
		}

		this.streamHandlers.delete(requestId)

		if (error) throw error
	}

	/** Cancel a streaming request by its request ID. */
	cancel(requestId: string): void {
		const cancel: GrpcCancel = { request_id: requestId }
		this.postMessage({
			type: "grpc_request_cancel",
			grpc_request_cancel: cancel,
		})
		this.streamHandlers.delete(requestId)
	}

	private postMessage(msg: GrpcRequest | WebviewMessage): void {
		if (API) {
			API.postMessage(msg)
		} else if (typeof window !== "undefined") {
			window.postMessage(msg, "*")
		}
	}

	/**
	 * Subscribe to state updates pushed from the extension (not RPC —
	 * the extension pushes these proactively via ExtensionMessage).
	 */
	onStateUpdate(cb: (state: any) => void): () => void {
		const handler = (msg: ExtensionMessage) => {
			if (msg.type === "grpc_response" && msg.grpc_response?.message?.type === "state_updated") {
				cb(msg.grpc_response.message.state)
			}
		}
		this.messageHandler = handler
		if (typeof window !== "undefined") {
			const listener = (e: MessageEvent) => handler(e.data as ExtensionMessage)
			window.addEventListener("message", listener)
			return () => window.removeEventListener("message", listener)
		}
		return () => {}
	}
}