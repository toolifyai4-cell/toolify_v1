import { readConfig } from "../utils/config.js";
import { getModelsForProvider, type ProbedModel } from "./fetch-models.js";

/**
 * Multi-provider aggregation & fallback registry for the /models picker.
 *
 * Reads every provider that holds a key in ~/.toolify/config.json:
 *   - 0 providers  -> empty list (the UI shows the "no providers" guard).
 *   - 1 provider   -> ONLY that provider's live model list.
 *   - 2+ providers -> concurrent probing (allSettled); providers whose probe
 *     fails (401/403/network) are dropped, the rest are merged with metadata.
 */

export interface ModelDescriptor {
  /** e.g. "gemini-2.5-flash", "llama-3.3-70b-versatile" */
  readonly id: string;
  /** e.g. "Gemini 2.5 Flash" */
  readonly displayName: string;
  /** e.g. "gemini", "groq", "openrouter" */
  readonly providerId: string;
  /** e.g. "Google Gemini", "Groq" */
  readonly providerName: string;
  /** e.g. "1.0M", "512K", "128K", "32K" (em dash when unknown). */
  readonly contextLimit: string;
  /** True when contextLimit is a static default estimate (not from live API). */
  readonly contextLimitEstimate?: boolean;
  /** True when marked free or detected on the provider's free tier. */
  readonly isFree?: boolean;
  /** True when this model comes from a static fallback (not live API). */
  readonly isFallback?: boolean;
  /** ISO timestamp when the fallback data was generated. */
  readonly fetchedAt?: string;
}

export interface RegistryDeps {
  /** Injectable credential store reader (defaults to the real config store). */
  readConfigFn?: () => Promise<{ apiKeys: Record<string, string>; baseUrls: Record<string, string> }>;
  /** Injectable prober (defaults to getModelsForProvider). */
  getModelsFn?: (
    providerId: string,
    apiKey: string,
    baseUrl?: string,
  ) => Promise<{ models: readonly ProbedModel[]; error?: string }>;
}

export const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  groq: "Groq",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  perplexity: "Perplexity AI",
  omniroute: "OmniRoute",
  unoroute: "UnoRoute",
  litellm: "LiteLLM",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  vllm: "vLLM",
  jan: "Jan",
  mock: "Mock (offline)",
};

/**
 * Default context limits per provider — used as estimates when the provider
 * API doesn't return contextTokens. These are STATIC DEFAULTS that will
 * drift over time and should be labeled as estimates in the UI.
 */
export const DEFAULT_CONTEXT_LIMITS: Record<string, { tokens: number; label: string }> = {
  gemini: { tokens: 1_048_576, label: "1.0M" },
  openai: { tokens: 131_072, label: "128K" },
  anthropic: { tokens: 200_000, label: "200K" },
  groq: { tokens: 131_072, label: "131K" },
  deepseek: { tokens: 64_000, label: "64K" },
  openrouter: { tokens: 128_000, label: "128K" },
  perplexity: { tokens: 128_000, label: "128K" },
  omniroute: { tokens: 128_000, label: "128K" },
  unoroute: { tokens: 128_000, label: "128K" },
  litellm: { tokens: 128_000, label: "128K" },
  ollama: { tokens: 131_072, label: "131K" },
  lmstudio: { tokens: 131_072, label: "131K" },
  vllm: { tokens: 131_072, label: "131K" },
  jan: { tokens: 131_072, label: "131K" },
  mock: { tokens: 32_768, label: "32K" },
};

export async function getAllConfiguredModels(deps: RegistryDeps = {}): Promise<ModelDescriptor[]> {
  const readConfigFn = deps.readConfigFn ?? readConfig;
  const getModelsFn =
    deps.getModelsFn ??
    ((providerId: string, apiKey: string, baseUrl?: string) =>
      getModelsForProvider(providerId, apiKey, { baseUrl }));

  const cfg = await readConfigFn();
  const configured = Object.entries(cfg.apiKeys)
    .filter(([id, key]) => key.trim().length > 0 && PROVIDER_NAMES[id] !== undefined)
    .map(([id, key]) => ({
      providerId: id,
      apiKey: key.trim(),
      baseUrl: cfg.baseUrls[id],
    }));
  if (configured.length === 0) return [];

  const results = await Promise.allSettled(
    configured.map((p) => probeOne(p, getModelsFn)),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

async function probeOne(
  entry: { providerId: string; apiKey: string; baseUrl?: string },
  getModelsFn: NonNullable<RegistryDeps["getModelsFn"]>,
): Promise<ModelDescriptor[]> {
  let result: { models: readonly ProbedModel[]; error?: string };
  try {
    result = await getModelsFn(entry.providerId, entry.apiKey, entry.baseUrl);
  } catch {
    return []; // probe threw — drop this provider from the aggregation
  }
  // Keep fallback models even if there's an error (they're tagged with isFallback)
  if (result.error && !result.models.some(m => m.isFallback)) return [];
  const defaultLimit = DEFAULT_CONTEXT_LIMITS[entry.providerId];
  return result.models.map((m) => {
    const hasLiveContext = typeof m.contextTokens === "number" && m.contextTokens > 0;
    return {
      id: m.id,
      displayName: prettifyModelId(m.id),
      providerId: entry.providerId,
      providerName: PROVIDER_NAMES[entry.providerId] ?? entry.providerId,
      contextLimit: hasLiveContext
        ? formatTokenLimit(m.contextTokens)
        : defaultLimit
        ? formatTokenLimit(defaultLimit.tokens)
        : "N/A",
      contextLimitEstimate: !hasLiveContext && !!defaultLimit,
      ...(m.isFree ? { isFree: true } : {}),
      ...(m.isFallback ? { isFallback: true, fetchedAt: m.fetchedAt } : {}),
    };
  });
}

/** "gemini-2.5-flash" -> "Gemini 2.5 Flash"; "x/y:free" -> "Y" (free flag kept separately). */
export function prettifyModelId(id: string): string {
  const cleaned = id.replace(/:free$/i, "").replace(/:latest$/i, "");
  const special = new Set(["gpt", "ai", "llm", "api", "o1", "o3", "o4"]);
  return cleaned
    .split(/[/_-]+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const lower = token.toLowerCase();
      if (special.has(lower)) return token.toUpperCase();
      // Keep version tokens like "2.5" or "3.1" as-is.
      return /^[0-9]/.test(token) ? token : token[0]!.toUpperCase() + token.slice(1);
    })
    .join(" ");
}

/** 
 * Format token limit for display badges.
 * 1_000_000 -> "1M"; 1_500_000 -> "1.5M"; 2_000_000 -> "2M"
 * 256_000 -> "256K"; 131_072 -> "131K"; 32_768 -> "33K"
 * Returns "N/A" if no context attribute is provided.
 */
export function formatTokenLimit(tokens?: number): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return "N/A";
  if (tokens >= 1_000_000) {
    // Round to nearest 0.1M (100,000 tokens), then format
    const millions = Math.round(tokens / 100_000) / 10;
    return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(Math.round(tokens));
}
