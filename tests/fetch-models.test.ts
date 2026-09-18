import { describe, it, expect } from "vitest";
import { getModelsForProvider } from "../src/models/fetch-models.js";

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => JSON.stringify(body),
    json: async () => body as any,
  } as unknown as Response;
}

/** Mock fetch that routes on URL substrings and records every request. */
function mockFetch(
  routes: Array<{ match: (url: string) => boolean; respond: () => Response }>,
): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const captured: CapturedRequest = { url: String(url), init: init ?? {} };
    requests.push(captured);
    const route = routes.find((r) => r.match(captured.url));
    if (!route) throw new Error(`no mock route for ${captured.url}`);
    return route.respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

const GEMINI_LIST = {
  models: [
    { name: "models/gemini-3.1-pro", inputTokenLimit: 1_048_576, supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3-flash", inputTokenLimit: 1_048_576, supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-flash", inputTokenLimit: 1_048_576, supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-flash-lite", inputTokenLimit: 1_048_576, supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
  ],
};

describe("getModelsForProvider — Gemini key tier resolution", () => {
  it("returns the FULL suite (Pro included) when the key is paid/billing-enabled", async () => {
    const { fetchImpl, requests } = mockFetch([
      { match: (u) => u.includes("/models?key=") && !u.includes("generateContent"), respond: () => jsonResponse(200, GEMINI_LIST) },
      { match: (u) => u.includes(":generateContent"), respond: () => jsonResponse(200, { candidates: [] }) },
    ]);
    const result = await getModelsForProvider("gemini", "AIza-paid-key", { fetchImpl });
    expect(result.error).toBeUndefined();
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("gemini-3.1-pro");
    expect(ids).toContain("gemini-3-flash");
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).not.toContain("text-embedding-004"); // embed-only filtered out
    expect(result.models.every((m) => m.isFree === false)).toBe(true);
    expect(result.models[0]!.contextTokens).toBe(1_048_576);
    // Tier probe hit the Pro model's endpoint with the saved key.
    const probe = requests.find((r) => r.url.includes(":generateContent"));
    expect(probe).toBeDefined();
    expect(probe!.url).toContain("gemini-3.1-pro:generateContent?key=AIza-paid-key");
    expect((probe!.init as { method?: string }).method).toBe("POST");
  });

  it("restricts to FREE flash-only models when the Pro probe returns 403", async () => {
    const { fetchImpl } = mockFetch([
      { match: (u) => u.includes("/models?key="), respond: () => jsonResponse(200, GEMINI_LIST) },
      { match: (u) => u.includes(":generateContent"), respond: () => jsonResponse(403, { error: { message: "Billing not enabled" } }) },
    ]);
    const result = await getModelsForProvider("gemini", "AIza-free-key", { fetchImpl });
    expect(result.error).toBeUndefined();
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("gemini-3-flash");
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).toContain("gemini-2.5-flash-lite");
    expect(ids.some((id) => /pro/i.test(id))).toBe(false); // Pro excluded on free tier
    expect(result.models.every((m) => m.isFree === true)).toBe(true);
  });

  it("restricts to FREE flash-only models when the Pro probe returns 429 quota", async () => {
    const { fetchImpl } = mockFetch([
      { match: (u) => u.includes("/models?key="), respond: () => jsonResponse(200, GEMINI_LIST) },
      { match: (u) => u.includes(":generateContent"), respond: () => jsonResponse(429, { error: { message: "Quota exceeded" } }) },
    ]);
    const result = await getModelsForProvider("gemini", "AIza-free-key", { fetchImpl });
    expect(result.models.map((m) => m.id)).toEqual([
      "gemini-3-flash",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
    expect(result.models.every((m) => m.isFree === true)).toBe(true);
  });

  it("reports unauthorized when the Gemini key cannot list models at all", async () => {
    const { fetchImpl } = mockFetch([
      { match: (u) => u.includes("/models?key="), respond: () => jsonResponse(400, { error: { message: "API key not valid" } }) },
    ]);
    const result = await getModelsForProvider("gemini", "AIza-bad", { fetchImpl });
    expect(result.models).toEqual([]);
    expect(result.error).toContain("API key not valid");
  });
});

describe("getModelsForProvider — OpenRouter / Groq / Ollama probing", () => {
  const OPENROUTER_BODY = {
    data: [
      { id: "dots3-note-preview:free", context_length: 40_960, pricing: { prompt: "0" } },
      { id: "cohere/north-mini-code:free", context_length: 131_072, pricing: { prompt: "0" } },
      { id: "anthropic/claude-3.5-sonnet", context_length: 200_000, pricing: { prompt: "0.000003" } },
    ],
  };

  it("flags :free / $0-priced OpenRouter models and sends the Bearer key", async () => {
    const { fetchImpl, requests } = mockFetch([
      { match: (u) => u.includes("openrouter.ai/api/v1/models"), respond: () => jsonResponse(200, OPENROUTER_BODY) },
    ]);
    const result = await getModelsForProvider("openrouter", "sk-or-1", { fetchImpl });
    expect(result.error).toBeUndefined();
    const byId = new Map(result.models.map((m) => [m.id, m]));
    expect(byId.get("dots3-note-preview:free")!.isFree).toBe(true);
    expect(byId.get("cohere/north-mini-code:free")!.isFree).toBe(true);
    expect(byId.get("anthropic/claude-3.5-sonnet")!.isFree).toBe(false);
    expect(byId.get("anthropic/claude-3.5-sonnet")!.contextTokens).toBe(200_000);
    const headers = requests[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-or-1");
    expect(headers["HTTP-Referer"]).toBe("https://toolify.dev");
  });

  it("drops OpenRouter entirely when the key is unauthorized (401)", async () => {
    const { fetchImpl } = mockFetch([
      { match: (u) => u.includes("openrouter.ai"), respond: () => jsonResponse(401, { error: { message: "No auth credentials found" } }) },
    ]);
    const result = await getModelsForProvider("openrouter", "sk-or-bad", { fetchImpl });
    expect(result.models).toEqual([]);
    expect(result.error).toContain("unauthorized");
    expect(result.error).toContain("No auth credentials found");
  });

  it("probes Ollama /api/tags without auth and honors a /v1-suffixed base URL", async () => {
    const { fetchImpl, requests } = mockFetch([
      { match: (u) => u.endsWith("/api/tags"), respond: () => jsonResponse(200, { models: [{ name: "llama3.2" }, { name: "qwen2.5-coder:latest" }] }) },
    ]);
    const result = await getModelsForProvider("ollama", "", {
      fetchImpl,
      baseUrl: "http://192.168.1.20:11434/v1",
    });
    expect(result.models.map((m) => m.id)).toEqual(["llama3.2", "qwen2.5-coder:latest"]);
    expect(requests[0]!.url).toBe("http://192.168.1.20:11434/api/tags");
    expect(requests[0]!.init.headers).toEqual({});
  });

  it("probes Groq at its default endpoint with the Bearer key", async () => {
    const { fetchImpl, requests } = mockFetch([
      { match: (u) => u.includes("api.groq.com/openai/v1/models"), respond: () => jsonResponse(200, { data: [{ id: "llama-3.3-70b-versatile" }, { id: "mixtral-8x7b-32768" }] }) },
    ]);
    const result = await getModelsForProvider("groq", "gsk_1", { fetchImpl });
    expect(result.models.map((m) => m.id)).toEqual(["llama-3.3-70b-versatile", "mixtral-8x7b-32768"]);
    const headers = requests[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer gsk_1");
  });

  it("surfaces a specific provider message when a probe is forbidden (403)", async () => {
    const { fetchImpl } = mockFetch([
      { match: (u) => u.includes("api.groq.com"), respond: () => jsonResponse(403, { error: { message: "Org not verified" } }) },
    ]);
    const result = await getModelsForProvider("groq", "gsk_bad", { fetchImpl });
    expect(result.models).toEqual([]); // filtered out, never surfaced to the picker
    expect(result.error).toContain("unauthorized");
    expect(result.error).toContain("Org not verified");
  });

  it("never rejects — network failures return fallback models with isFallback flag", async () => {
    const { fetchImpl } = mockFetch([
      { match: () => true, respond: () => { throw new TypeError("fetch failed"); } },
    ]);
    const result = await getModelsForProvider("deepseek", "k", { fetchImpl });
    // Now returns fallback models instead of empty array
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.models.every((m) => m.isFallback === true)).toBe(true);
    expect(result.models.every((m) => m.fetchedAt)).toBe(true);
    expect(result.error).toContain("Offline");
  });
});

