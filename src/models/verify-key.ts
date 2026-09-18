import type { SettingsProvider } from "../components/settings.js";

/**
 * Lightweight live API-key verification for the provider configuration flow.
 *
 * Each provider is probed at the cheapest authenticated endpoint available;
 * a 2xx response proves the credential is accepted, 401/403 (or any network
 * failure) proves it is not. `verifyProviderKey` never throws — it always
 * resolves to a `VerifyKeyResult` so UI callers can render the outcome
 * directly.
 */

export interface VerifyKeyResult {
  readonly ok: boolean;
  /** Specific provider/HTTP error detail; empty string when verified. */
  readonly detail: string;
}

export type VerifyKeyFetch = typeof fetch;

export interface VerifyKeyOptions {
  /** User-entered base URL; overrides the provider default when non-empty. */
  readonly baseUrl?: string;
  /** Forwarded to the request so a cancelled modal can abort in-flight work. */
  readonly signal?: AbortSignal;
  /** Injectable fetch for tests (defaults to global fetch). */
  readonly fetchImpl?: VerifyKeyFetch;
}

/** Default endpoints probed per settings provider when no base URL is given. */
export const VERIFY_BASE_URLS: Record<SettingsProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  ollama: "http://localhost:11434",
  openrouter: "https://openrouter.ai/api/v1",
  litellm: "http://localhost:4000/v1",
  omniroute: "https://api.omniroute.ai/v1",
  unoroute: "https://api.unoroute.dev/v1",
  perplexity: "https://api.perplexity.ai",
};

const REQUEST_TIMEOUT_MS = 10_000;

interface VerifyRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

export async function verifyProviderKey(
  providerId: SettingsProvider,
  apiKey: string,
  options: VerifyKeyOptions = {},
): Promise<VerifyKeyResult> {
  const request = buildVerifyRequest(providerId, apiKey, options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort);
  try {
    const res = await fetchImpl(request.url, {
      method: "GET",
      headers: request.headers,
      signal: controller.signal,
    });
    if (res.ok) {
      return { ok: true, detail: "" };
    }
    return { ok: false, detail: await extractErrorDetail(res) };
  } catch (err) {
    if (options.signal?.aborted) {
      return { ok: false, detail: "Cancelled." };
    }
    if (controller.signal.aborted) {
      return {
        ok: false,
        detail: `Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `Network error: ${msg}` };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Map each provider to its lightweight authenticated probe endpoint. */
function buildVerifyRequest(
  providerId: SettingsProvider,
  apiKey: string,
  baseUrlOverride?: string,
): VerifyRequest {
  const key = apiKey.trim();
  switch (providerId) {
    case "openrouter":
      // Dedicated key-inspection endpoint — cheaper than listing models.
      return {
        url: "https://openrouter.ai/api/v1/key",
        headers: bearerHeaders(key, { "HTTP-Referer": "https://toolify.dev" }),
      };
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/models",
        headers: bearerHeaders(key),
      };
    case "gemini":
      // Gemini authenticates via query parameter, not an auth header.
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        headers: {},
      };
    case "ollama": {
      // Native tag listing lives at the server root; tolerate a base URL
      // entered with the OpenAI-compatible "/v1" suffix.
      const base = (baseUrlOverride?.trim() || VERIFY_BASE_URLS.ollama)
        .replace(/\/v1\/?$/i, "")
        .replace(/\/+$/, "");
      return { url: `${base}/api/tags`, headers: {} };
    }
    default: {
      // DeepSeek / OpenAI / generic OpenAI-compatible gateways.
      const base = normalizeBaseUrl(baseUrlOverride) ?? VERIFY_BASE_URLS[providerId];
      if (providerId === "anthropic") {
        // Anthropic rejects Bearer tokens on API keys; it requires its own
        // header pair on the same GET <base>/models probe.
        return {
          url: `${base}/models`,
          headers: key ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : {},
        };
      }
      return { url: `${base}/models`, headers: bearerHeaders(key) };
    }
  }
}

function bearerHeaders(
  key: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

function normalizeBaseUrl(baseUrlOverride?: string): string | undefined {
  const trimmed = baseUrlOverride?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
}

async function extractErrorDetail(res: Response): Promise<string> {
  const head =
    res.status === 401 || res.status === 403
      ? `Invalid API key or unauthorized (HTTP ${res.status})`
      : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
  const provider = await extractProviderMessage(res);
  return provider ? `${head}: ${provider}` : head;
}

/** Surface the specific error message the provider returned, when it did. */
async function extractProviderMessage(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: unknown } | string;
        message?: unknown;
      };
      if (
        typeof parsed.error === "object" &&
        parsed.error !== null &&
        typeof parsed.error.message === "string"
      ) {
        return truncate(parsed.error.message);
      }
      if (typeof parsed.error === "string") return truncate(parsed.error);
      if (typeof parsed.message === "string") return truncate(parsed.message);
      return "";
    } catch {
      return truncate(text);
    }
  } catch {
    return "";
  }
}

function truncate(value: string, max = 160): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
