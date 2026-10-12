/**
 * ConfigService.getProviders — returns the provider catalog for the
 * webview's settings/providers picker.
 */
import { PROVIDER_CATALOG } from "../../../components/ProviderModal.js"
import { readConfigSync } from "../../../utils/config.js"

export async function getProviders(
	_message: any,
	_signal: AbortSignal,
): Promise<Array<{ id: string; name: string; category: string; defaultModel: string; isCurrent: boolean; isConfigured: boolean }>> {
	const cfg = readConfigSync()
	const workspace = process.cwd()

	return PROVIDER_CATALOG.map((p) => ({
		id: p.id,
		name: p.name,
		category: p.category,
		defaultModel: p.defaultModel,
		isCurrent: false, // would compare against active model
		isConfigured: !!(cfg.apiKeys[p.id] || process.env[(p.id.toUpperCase() + "_API_KEY")]),
	}))
}
