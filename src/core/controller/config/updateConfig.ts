/**
 * ConfigService.updateConfig — persists provider/model/API key changes
 * to ~/.toolify/config.json and pushes an updated ExtensionState to the webview.
 */
import { writeFileSync, existsSync, mkdirSync } from "node:fs"
import type { ExtensionState } from "../../../shared/ExtensionMessage.js"
import { captureStateSnapshot } from "../state/subscribeToState.js"
import { readConfigSync, configDir, configPath } from "../../../utils/config.js"

interface UpdateConfigRequest {
	apiKeys?: Record<string, string>
	baseUrls?: Record<string, string>
	theme?: string
}

export async function updateConfig(
	message: any,
	_signal: AbortSignal,
	_provider?: any,
): Promise<ExtensionState> {
		const req = message as UpdateConfigRequest

	// Read current config (readConfigSync returns a ToolifyConfig object).
	const cfg = readConfigSync()

	if (req.apiKeys) cfg.apiKeys = { ...(cfg.apiKeys ?? {}), ...req.apiKeys }
	if (req.baseUrls) cfg.baseUrls = { ...(cfg.baseUrls ?? {}), ...req.baseUrls }
	if (req.theme) cfg.theme = req.theme

	const dir = configDir()
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
	writeFileSync(configPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 })

	return captureStateSnapshot()
}
