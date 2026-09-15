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