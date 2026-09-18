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
  /** True when marked free or detected on the provider's free tier. */
  readonly isFree?: boolean;
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
  if (result.error) return []; // 401/403/network — not usable for this key
  return result.models.map((m) => ({
    id: m.id,
    displayName: prettifyModelId(m.id),
    providerId: entry.providerId,
    providerName: PROVIDER_NAMES[entry.providerId] ?? entry.providerId,
    contextLimit: formatContextLimit(m.contextTokens),
    ...(m.isFree ? { isFree: true } : {}),
  }));
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

/** 1_048_576 -> "1.0M"; 512_000 -> "512K"; 32768 -> "32K"; undefined -> "—". */
export function formatContextLimit(tokens?: number): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return "—";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.floor(tokens / 1000)}K`;
  return String(Math.round(tokens));
}
