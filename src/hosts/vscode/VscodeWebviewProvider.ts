import * as vscode from "vscode"
import * as fs from "node:fs"
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

		const webviewUiRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview-ui")
		this._webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this.context.extensionUri,
				vscode.Uri.joinPath(this.context.extensionUri, "dist"),
				webviewUiRoot,
			],
		}

		const indexPath = vscode.Uri.joinPath(webviewUiRoot, "index.html")
		this._webview.html = this.getWebviewHtml(indexPath, webviewUiRoot)

		this._disposable = this._webview.onDidReceiveMessage((msg: any) => {
			this.handleWebviewMessage(msg as WebviewMessage).catch((err) => {
				console.error("[VscodeWebviewProvider] message error:", err)
			})
		})
		this.context.subscriptions.push(this._disposable)
	}

	private getWebviewHtml(indexPath: vscode.Uri, webviewUiRoot: vscode.Uri): string {
		const devMode = process.env.TOOLIFY_WEBVIEW_DEV === "true"
		if (devMode) {
			return this.getHtml(
				this._webview.asWebviewUri(vscode.Uri.joinPath(webviewUiRoot, "assets", "index.js")),
				this._webview.asWebviewUri(vscode.Uri.joinPath(webviewUiRoot, "assets", "index.css")),
			)
		}

		let html = fs.readFileSync(indexPath.fsPath, "utf8")
		const nonce = this.getNonce()
		const cspSource = this._webview.cspSource

		// Rewrite relative asset URLs (./assets/... or assets/...) to webview URIs.
		html = html.replace(
			/(src|href)=["']\.?\/?(assets\/[^"']+)["']/g,
			(_m, attr: string, assetPath: string) => {
				const assetUri = this._webview.asWebviewUri(
					vscode.Uri.joinPath(webviewUiRoot, ...assetPath.split("/")),
				)
				return `${attr}="${assetUri.toString()}"`
			},
		)

		const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource} data:; script-src 'nonce-${nonce}'; connect-src ${cspSource} https:;">`
		if (/<head[^>]*>/i.test(html)) {
			html = html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${csp}`)
		} else {
			html = `${csp}\n${html}`
		}

		// Add nonce to script tags so CSP allows them.
		html = html.replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`)
		return html
	}

	private getNonce(): string {
		const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
		let value = ""
		for (let i = 0; i < 32; i++) value += chars.charAt(Math.floor(Math.random() * chars.length))
		return value
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
