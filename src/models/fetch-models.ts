/**
 * Fetch available models from a provider's API using the provided API key.
 * Returns a list of model IDs, or throws on failure.
 */
export async function fetchModels(
  provider: string,
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const url = buildModelsUrl(provider, baseUrl, apiKey);
  if (!url) {
    return [];
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey && provider !== "gemini") {
    if (provider === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (provider === "openrouter") {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["HTTP-Referer"] = "https://toolify.dev";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Unexpected response format");
    }
    const models = data.data.map((m) => m.id).filter((id): id is string => !!id);
    if (models.length === 0) {
      throw new Error("No models returned");
    }
    return models.sort();
  } finally {
    clearTimeout(timeout);
  }
}

function buildModelsUrl(provider: string, baseUrl: string, apiKey: string): string | null {
  const base = baseUrl.replace(/\/$/, "");
  switch (provider) {
    case "openai":
    case "deepseek":
    case "openrouter":
    case "ollama":
    case "litellm":
      return `${base}/models`;
    case "gemini":
      return `${base}/models?key=${encodeURIComponent(apiKey)}`;
    case "anthropic":
    case "omniroute":
    case "unoroute":
    case "mock":
      return null;
    default:
      return `${base}/models`;
  }
}

// ---------------------------------------------------------------------------
// Tier-aware model probing (used by the /models picker + model registry)
// ---------------------------------------------------------------------------

export interface ProbedModel {
  readonly id: string;
  /** Free-tier model (OpenRouter ":free" / $0 pricing / Gemini free tier). */
  readonly isFree?: boolean;
  /** Context window in tokens, when the provider exposes it. */
  readonly contextTokens?: number;
}

export interface ProbeResult {
  readonly models: readonly ProbedModel[];
  /** Set when the key could not list models (401/403/network). */
  readonly error?: string;
}

export interface ProbeOptions {
  /** Optional base URL override (from config.json baseUrls). */
  readonly baseUrl?: string;
  /** Injectable fetch for tests. */
  readonly fetchImpl?: typeof fetch;
}

const PROBE_TIMEOUT_MS = 8_000;
const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

const DEFAULT_PROBE_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  litellm: "http://localhost:4000/v1",
  omniroute: "https://api.omniroute.ai/v1",
  unoroute: "https://api.unoroute.dev/v1",
  perplexity: "https://api.perplexity.ai",
};

type FetchLike = typeof fetch;

function authHeaders(providerId: string, apiKey: string): Record<string, string> {
  if (!apiKey) return {};
  if (providerId === "anthropic") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (providerId === "openrouter") headers["HTTP-Referer"] = "https://toolify.dev";
  return headers;
}

async function toResult(
  res: Response,
  parse: (body: unknown) => readonly ProbedModel[],
): Promise<ProbeResult> {
  if (!res.ok) {
    const status = res.status;
    const kind = status === 401 || status === 403 ? "unauthorized" : `HTTP ${status}`;
    let detail = "";
    try {
      const text = await res.text();
      try {
        const parsed = JSON.parse(text) as {
          error?: { message?: unknown } | string;
          message?: unknown;
        };
        if (typeof parsed.error === "object" && parsed.error !== null && typeof parsed.error.message === "string") {
          detail = parsed.error.message;
        } else if (typeof parsed.error === "string") {
          detail = parsed.error;
        } else if (typeof parsed.message === "string") {
          detail = parsed.message;
        }
      } catch {
        detail = text.slice(0, 160);
      }
    } catch {
      /* body unreadable */
    }
    return { models: [], error: detail ? `${kind}: ${detail}` : kind };
  }
  try {
    return { models: parse(await res.json()) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { models: [], error: `Unexpected response format: ${msg}` };
  }
}

/**
 * Live model probing per provider. Always resolves (never throws); failed or
 * unauthorized providers return `{ models: [], error }` so the registry can
 * drop them from multi-provider aggregation.
 */
export async function getModelsForProvider(
  providerId: string,
  apiKey: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    switch (providerId) {
      case "gemini":
        return await probeGemini(apiKey, options.baseUrl, fetchImpl, controller.signal);
      case "openrouter":
        return await probeOpenRouter(apiKey, fetchImpl, controller.signal);
      case "ollama":
        return await probeOllama(options.baseUrl, fetchImpl, controller.signal);
      case "anthropic":
        return await probeAnthropic(apiKey, options.baseUrl, fetchImpl, controller.signal);
      default:
        // Groq / DeepSeek / OpenAI / LiteLLM / OmniRoute / UnoRoute / generic.
        return await probeOpenAICompatible(providerId, apiKey, options.baseUrl, fetchImpl, controller.signal);
    }
  } catch (err) {
    if (controller.signal.aborted) return { models: [], error: "Probe timed out." };
    const msg = err instanceof Error ? err.message : String(err);
    return { models: [], error: `Network error: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Google Gemini with FREE vs PAID tier resolution:
 *  1. List models with the saved key.
 *  2. Probe a Pro model with a 1-token generateContent call.
 *     - 200 -> Paid/billing-enabled project: return the FULL suite (Pro included).
 *     - 403/429 (un-linked billing / quota exhausted) -> AI Studio Free
 *       tier: restrict the list to flash-class models only.
 */
async function probeGemini(
  apiKey: string,
  baseUrlOverride: string | undefined,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const base = (baseUrlOverride?.trim() || GEMINI_DEFAULT_BASE).replace(/\/+$/, "");
  const listRes = await fetchImpl(`${base}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`, {
    headers: {},
    signal,
  });
  const listed = await toResult(listRes, (body) => {
    const models =
      (body as {
        models?: Array<{ name?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }>;
      }).models ?? [];
    return models
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => ({
        id: (m.name ?? "").replace(/^models\//, ""),
        contextTokens: m.inputTokenLimit,
      }))
      .filter((m) => m.id.length > 0);
  });
  if (listed.error || listed.models.length === 0) return listed;

  const proModel = listed.models.find((m) => /pro/i.test(m.id) && !/embedding/i.test(m.id));
  if (!proModel) {
    // No Pro model on this key's list — already a flash-only account.
    return { models: listed.models.map((m) => ({ ...m, isFree: true })) };
  }
  const probeRes = await fetchImpl(
    `${base}/models/${proModel.id}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
      signal,
    },
  );
  if (probeRes.status === 403 || probeRes.status === 429) {
    // Free tier: Pro endpoints are forbidden / quota-exhausted on this key.
    return {
      models: listed.models
        .filter((m) => /flash/i.test(m.id) && !/pro/i.test(m.id))
        .map((m) => ({ ...m, isFree: true })),
    };
  }
  // Paid / billing-enabled project: the full suite including Pro models.
  return { models: listed.models.map((m) => ({ ...m, isFree: false })) };
}

/** OpenRouter: tag ":free" models and $0-priced entries. */
async function probeOpenRouter(
  apiKey: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const res = await fetchImpl(OPENROUTER_MODELS_URL, {
    headers: authHeaders("openrouter", apiKey),
    signal,
  });
  return toResult(res, (body) => {
    const data =
      (body as {
        data?: Array<{ id?: string; context_length?: number; pricing?: { prompt?: string } }>;
      }).data ?? [];
    return data
      .filter((m) => typeof m.id === "string" && m.id.length > 0)
      .map((m) => ({
        id: m.id!,
        isFree: m.id!.endsWith(":free") || Number(m.pricing?.prompt ?? 1) === 0,
        contextTokens: m.context_length,
      }));
  });
}

/** Ollama local runner: /api/tags, no auth. */
async function probeOllama(
  baseUrlOverride: string | undefined,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const base = (baseUrlOverride?.trim() || "http://localhost:11434").replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  const res = await fetchImpl(`${base}/api/tags`, { headers: {}, signal });
  return toResult(res, (body) => {
    const models = (body as { models?: Array<{ name?: string }> }).models ?? [];
    return models
      .filter((m) => typeof m.name === "string" && m.name.length > 0)
      .map((m) => ({ id: m.name! }));
  });
}

/** Anthropic native /v1/models with x-api-key headers. */
async function probeAnthropic(
  apiKey: string,
  baseUrlOverride: string | undefined,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const base = (baseUrlOverride?.trim() || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const res = await fetchImpl(`${base}/models?limit=1000`, {
    headers: authHeaders("anthropic", apiKey),
    signal,
  });
  return toResult(res, (body) => {
    const data = (body as { data?: Array<{ id?: string }> }).data ?? [];
    return data.filter((m) => typeof m.id === "string" && m.id.length > 0).map((m) => ({ id: m.id! }));
  });
}

/** Groq / DeepSeek / OpenAI / LiteLLM / generic OpenAI-compatible gateways. */
async function probeOpenAICompatible(
  providerId: string,
  apiKey: string,
  baseUrlOverride: string | undefined,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const base = (baseUrlOverride?.trim() || DEFAULT_PROBE_BASES[providerId] || "").replace(/\/+$/, "");
  if (!base) return { models: [], error: `No endpoint configured for provider "${providerId}".` };
  const res = await fetchImpl(`${base}/models`, {
    headers: authHeaders(providerId, apiKey),
    signal,
  });
  return toResult(res, (body) => {
    const data =
      (body as {
        data?: Array<{ id?: string; context_length?: number; context_window?: number }>;
      }).data ?? [];
    return data
      .filter((m) => typeof m.id === "string" && m.id.length > 0)
      .map((m) => ({
        id: m.id!,
        contextTokens: m.context_length ?? m.context_window,
      }));
  });
}