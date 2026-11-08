/**
 * ConfigService.getProviders — returns the provider catalog for the
 * webview's settings/providers picker.
 */
import { readConfigSync } from "../../../utils/config.js"

const PROVIDER_CATALOG = [
	{ id: "anthropic", name: "Anthropic", category: "cloud", defaultModel: "claude-3-5-sonnet-20241022" },
	{ id: "openai", name: "OpenAI", category: "cloud", defaultModel: "gpt-4o" },
	{ id: "deepseek", name: "DeepSeek", category: "cloud", defaultModel: "deepseek-chat" },
	{ id: "groq", name: "Groq", category: "cloud", defaultModel: "llama-3.1-70b-versatile" },
	{ id: "ollama", name: "Ollama", category: "local", defaultModel: "llama3.1" },
	{ id: "gemini", name: "Google Gemini", category: "cloud", defaultModel: "gemini-1.5-pro" },
]

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
