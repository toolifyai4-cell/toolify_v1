/**
 * Platform configuration for the webview UI.
 *
 * In the original Cline, this file wires up the `VSCodeClient` gRPC
 * implementation that maps webview RPCs to VS Code extension APIs.
 * In TOOLIFY, the extension host (`VscodeWebviewProvider`) handles this
 * directly via the `CommandRunner` — so this file exposes config flags
 * and feature toggles the webview can read at startup.
 */

export interface PlatformConfig {
	/** Whether the webview is running inside VS Code. */
	readonly isVsCode: boolean

	/** Whether dev mode is active (served from Vite dev server). */
	readonly isDev: boolean

	/** The VS Code API object (null in dev mode). */
	readonly vscodeApi: any | null

	/** Extension version string. */
	readonly version: string

	/** Build timestamp. */
	readonly buildTimestamp: string

	/** Feature flags. */
	readonly features: {
		readonly enableChat: boolean
		readonly enableHistory: boolean
		readonly enableCheckpoints: boolean
		readonly enableMcp: boolean
	}
}

export const platformConfig: PlatformConfig = {
	isVsCode: typeof (globalThis as any).acquireVsCodeApi === "function",
	isDev: import.meta.env?.DEV ?? false,
	vscodeApi: typeof (globalThis as any).acquireVsCodeApi === "function"
		? (globalThis as any).acquireVsCodeApi()
		: null,
	version: "0.1.0",
	buildTimestamp: "dev",
	features: {
		enableChat: true,
		enableHistory: true,
		enableCheckpoints: true,
		enableMcp: true,
	},
}
