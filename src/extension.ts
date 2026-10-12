/**
 * VS Code extension entry point for TOOLIFY.
 *
 * Registers the `toolifyChatView` webview view (contributed in package.json
 * under `contributes.views.explorer`) and wires up the gRPC message router.
 *
 * The extension host never renders UI directly — all rendering happens in
 * the isolated webview. The host owns the agent lifecycle, the gRPC service
 * handlers, and pushes state snapshots to the webview via postMessage.
 */
import * as vscode from "vscode"
import { VscodeWebviewProvider } from "./hosts/vscode/VscodeWebviewProvider.js"
import { CommandRunner } from "./core/controller/CommandRunner.js"

export function activate(context: vscode.ExtensionContext): void {
	const { extensionUri } = context

	const provider = new VscodeWebviewProvider(extensionUri, context)
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"toolifyChatView",
			provider,
		),
	)

	// Register all gRPC service handlers that the webview can call.
	const commandRunner = new CommandRunner(provider)
	provider.registerService("StateService", commandRunner)
	provider.registerService("ChatService", commandRunner)
	provider.registerService("ConfigService", commandRunner)
	provider.registerService("TerminalService", commandRunner)
	provider.registerService("AuthService", commandRunner)

	context.subscriptions.push({ dispose: () => provider.dispose() })

	// Auto-focus the Explorer sidebar and reveal the TOOLIFY view.
	// The small delay ensures VS Code has registered the view first.
	setTimeout(() => {
		Promise.resolve(
			vscode.commands.executeCommand("workbench.view.explorer"),
		).catch(() => {})
		Promise.resolve(
			vscode.commands.executeCommand("workbench.action.showView", "toolifyChatView"),
		).catch(() => {})
	}, 500)
}

export function deactivate(): void {
	// No-op — VS Code manages the lifecycle.
}