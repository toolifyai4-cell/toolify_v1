/**
 * VscodeWebviewProvider — concrete WebviewViewProvider for VS Code.
 *
 * Implements the `vscode.WebviewViewProvider` interface so VS Code can
 * embed the TOOLIFY UI inside its sidebar (the `toolifyChatView` view
 * contributed in package.json).
 *
 * All gRPC service handlers are registered on the base `WebviewProvider`.
 * State snapshots and streaming chunks from the agent loop are pushed to
 * the webview via `postMessage` (implemented here as `webview.postMessage`).
 */
import * as vscode from "vscode"
import type { WebviewMessage } from "../../shared/WebviewMessage.js"
import type { ExtensionMessage } from "../../shared/ExtensionMessage.js"
import { WebviewProvider } from "../../core/webview/WebviewProvider.js"

export class VscodeWebviewProvider extends WebviewProvider {
	private _webview!: vscode.Webview
	private _disposable?: vscode.Disposable

	constructor(
		readonly extensionUri: vscode.Uri,
		private readonly context: vscode.ExtensionContext,
	) {
		super()
	}

	/** VS Code calls this when the view is first rendered. */
	resolveWebviewView(
		webviewView: vscode.WebviewView,
			_options: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this._webview = webviewView.webview

		this._webview.options = {
			enableScripts: true,
			...this._webview.options,
		}

		// Build HTML with resolved asset URIs.
				const jsUri = this._webview.asWebviewUri(
			this.extensionUri.with({ path: "dist/webview-ui/assets/index.js" }),
		)
		const cssUri = this._webview.asWebviewUri(
			this.extensionUri.with({ path: "dist/webview-ui/assets/index.css" }),
		)

		this._webview.html = this.getHtml(jsUri, cssUri)

		this._disposable = this._webview.onDidReceiveMessage((msg: any) => {
			this.handleWebviewMessage(msg as WebviewMessage).catch((err) => {
				console.error("[VscodeWebviewProvider] message error:", err)
			})
		})
		this.context.subscriptions.push(this._disposable)
	}

	postMessage(message: ExtensionMessage): Thenable<boolean> {
		return this._webview?.postMessage(message) ?? Promise.resolve(true)
	}

	asWebviewUri(uri: vscode.Uri): vscode.Uri {
		return this._webview?.asWebviewUri(uri) ?? uri
	}

	onDidReceiveMessage(cb: (msg: WebviewMessage) => void): vscode.Disposable {
		if (!this._webview) {
			return { dispose() {} }
		}
		return this._webview.onDidReceiveMessage((msg: any) => cb(msg as WebviewMessage))
	}

	override dispose(): void {
		this._disposable?.dispose()
		super.dispose()
	}
}