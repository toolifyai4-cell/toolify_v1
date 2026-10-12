/**
 * Base WebviewProvider — abstract over the VS Code WebviewViewProvider API
 * so the gRPC routing layer is testable without a live VS Code instance.
 *
 * Concrete subclass `VscodeWebviewProvider` supplies the real `vscode`-API
 * wiring. The base handles:
 *   - HTML content + asset path resolution
 *   - gRPC service registration & dispatch (handleGrpcRequest)
 *   - State snapshot pushing (pushState, pushStreamingChunk)
 *
 * Communication protocol:
 *   Webview → extension: WebviewMessage { type: "grpc_request", ... }
 *   extension → webview: ExtensionMessage { type: "grpc_response", ... }
 */
import type * as vscode from "vscode"
import type { ExtensionMessage } from "../../shared/ExtensionMessage.js"
import type { WebviewMessage, GrpcRequest } from "../../shared/WebviewMessage.js"

export interface GrpcService {
	handleRequest(method: string, message: any, streaming: boolean, signal: AbortSignal): Promise<any> | AsyncIterable<any>
	cancel(requestId: string): void
}

export abstract class WebviewProvider {
	protected services = new Map<string, GrpcService>()
	protected requestIdCounter = 0

	/** Register a gRPC service handler for incoming webview RPC calls. */
	registerService(serviceName: string, service: GrpcService): void {
		this.services.set(serviceName, service)
	}

	abstract postMessage(message: ExtensionMessage): Thenable<boolean>
	abstract asWebviewUri(uri: vscode.Uri): vscode.Uri
	
	abstract onDidReceiveMessage(cb: (msg: WebviewMessage) => void): vscode.Disposable

	/**
	 * Called by the concrete subclass when a WebviewMessage arrives.
	 * Routes grpc_request payloads to the registered service handler.
	 */
	async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
		if (msg.type === "grpc_request" && msg.grpc_request) {
			await this.handleGrpcRequest(msg.grpc_request)
		}
	}

	/**
	 * Dispatch a grpc_request to the registered service handler.
	 * Handles both unary (single response) and streaming (multiple chunks).
	 */
	private async handleGrpcRequest(req: GrpcRequest): Promise<void> {
		const service = this.services.get(req.service)
		if (!service) {
			await this.postMessage({
				type: "grpc_response",
				grpc_response: {
					request_id: req.request_id,
					error: `Service not registered: ${req.service}`,
				},
			})
			return
		}

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 60_000)

		try {
			const result = await service.handleRequest(
				req.method,
				req.message,
				!req.is_streaming,
				controller.signal,
			)

			if (req.is_streaming) {
				for await (const chunk of result as AsyncIterable<any>) {
					await this.postMessage({
						type: "grpc_response",
						grpc_response: {
							message: chunk,
							request_id: req.request_id,
							is_streaming: true,
							sequence_number: this.requestIdCounter++,
						},
					})
				}
				await this.postMessage({
					type: "grpc_response",
					grpc_response: {
						request_id: req.request_id,
						sequence_number: this.requestIdCounter++,
					},
				})
			} else {
				await this.postMessage({
					type: "grpc_response",
					grpc_response: {
						message: result,
						request_id: req.request_id,
					},
				})
			}
		} catch (err: any) {
			await this.postMessage({
				type: "grpc_response",
				grpc_response: {
					request_id: req.request_id,
					error: err?.message ?? String(err),
				},
			})
		} finally {
			clearTimeout(timeout)
		}
	}

	/** Push a full state snapshot to the webview. */
	pushState(state: any): Thenable<boolean> {
		return this.postMessage({
			type: "grpc_response",
			grpc_response: {
				message: { type: "state_updated", state },
				request_id: "state_snapshot",
			},
		})
	}

	/** Push a single streaming chunk (used by the agent loop's onStream). */
	pushStreamingChunk(message: any, sequence: number): Thenable<boolean> {
		return this.postMessage({
			type: "grpc_response",
			grpc_response: {
				message,
				request_id: "agent_stream",
				is_streaming: true,
				sequence_number: sequence,
			},
		})
	}

	dispose(): void {
		this.services.clear()
	}

	/**
	 * Resolve the full HTML content for the webview, injecting the
	 * VS Code API script and the built webview-ui assets.
	 */
	getHtml(jsUri: vscode.Uri, cssUri: vscode.Uri): string {
		const devMode = process.env.TOOLIFY_WEBVIEW_DEV === "true"
		const scriptSrc = devMode ? "http://localhost:5173/src/main.tsx" : jsUri.toString()

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TOOLIFY</title>
  ${devMode ? "" : `<link rel="stylesheet" href="${cssUri.toString()}" />`}
</head>
<body>
  <div id="root"></div>
  <script>
    window.acquireVsCodeApi = (function () {
      const vscodeProxy = {
        postMessage: function (msg) {
          const evt = new MessageEvent('message', { data: msg, source: window, origin: '' });
          window.dispatchEvent(evt);
          return true;
        },
        getState: function () { return {}; },
        setState: function () {},
      };
      return function () { return vscodeProxy; };
    })();
  </script>
  <script type="module" src="${scriptSrc}"></script>
</body>
</html>`
	}
}

