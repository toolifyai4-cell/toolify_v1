import { describe, it, expect } from "vitest";
import {
  verifyProviderKey,
  VERIFY_BASE_URLS,
  type VerifyKeyFetch,
} from "../src/models/verify-key.js";

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
  } as unknown as Response;
}

function textResponse(status: number, text: string, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => text,
  } as unknown as Response;
}

function mockFetch(
  respond: (req: CapturedRequest) => Response | Promise<Response>,
): { fetchImpl: VerifyKeyFetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const captured: CapturedRequest = { url: String(url), init: init ?? {} };
    requests.push(captured);
    return respond(captured);
  }) as unknown as VerifyKeyFetch;
  return { fetchImpl, requests };
}

function headerOf(req: CapturedRequest, name: string): string | undefined {
  const headers = (req.init.headers ?? {}) as Record<string, string>;
  return headers[name];
}

describe("verifyProviderKey endpoint selection", () => {
  it("probes the OpenRouter dedicated key endpoint with a Bearer header", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, { data: {} }));
    const result = await verifyProviderKey("openrouter", "sk-or-v1-abc", { fetchImpl });
    expect(result.ok).toBe(true);
    expect(requests[0]!.url).toBe("https://openrouter.ai/api/v1/key");
    expect(headerOf(requests[0]!, "Authorization")).toBe("Bearer sk-or-v1-abc");
    expect(headerOf(requests[0]!, "HTTP-Referer")).toBe("https://toolify.dev");
  });

  it("probes the Groq models endpoint with a Bearer header", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, { data: [] }));
    const result = await verifyProviderKey("groq", "gsk_abc", { fetchImpl });
    expect(result.ok).toBe(true);
    expect(requests[0]!.url).toBe("https://api.groq.com/openai/v1/models");
    expect(headerOf(requests[0]!, "Authorization")).toBe("Bearer gsk_abc");
  });

  it("probes Gemini with the key as a query parameter and no auth header", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, { models: [] }));
    const result = await verifyProviderKey("gemini", "AIza+sy/1", { fetchImpl });
    expect(result.ok).toBe(true);
    expect(requests[0]!.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent("AIza+sy/1")}`,
    );
    expect(headerOf(requests[0]!, "Authorization")).toBeUndefined();
  });

  it("probes the Ollama tag listing without any auth header", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, { models: [] }));
    const result = await verifyProviderKey("ollama", "", { fetchImpl });
    expect(result.ok).toBe(true);
    expect(requests[0]!.url).toBe("http://localhost:11434/api/tags");
    expect(headerOf(requests[0]!, "Authorization")).toBeUndefined();
  });

  it("honors a custom Ollama base URL even when it carries a /v1 suffix", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, { models: [] }));
    await verifyProviderKey("ollama", "", {
      fetchImpl,
      baseUrl: "http://10.0.0.8:11434/v1/",
    });
    expect(requests[0]!.url).toBe("http://10.0.0.8:11434/api/tags");
  });

  it("probes DeepSeek / OpenAI / generic gateways at base_url + /models", async () => {
    for (const provider of ["openai", "perplexity", "litellm"] as const) {
      const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, { data: [] }));
      const result = await verifyProviderKey(provider, "key-1", { fetchImpl });
      expect(result.ok).toBe(true);
      expect(requests[0]!.url).toBe(`${VERIFY_BASE_URLS[provider]}/models`);
      expect(headerOf(requests[0]!, "Authorization")).toBe("Bearer key-1");
    }
  });

  it("lets a user-entered base URL override the generic default", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, { data: [] }));
    await verifyProviderKey("openai", "key-1", {
      fetchImpl,
      baseUrl: "https://proxy.corp/v9/",
    });
    expect(requests[0]!.url).toBe("https://proxy.corp/v9/models");
  });

  it("sends Anthropic credentials via x-api-key headers, not Bearer", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, { data: [] }));
    const result = await verifyProviderKey("anthropic", "sk-ant-1", { fetchImpl });
    expect(result.ok).toBe(true);
    expect(requests[0]!.url).toBe("https://api.anthropic.com/v1/models");
    expect(headerOf(requests[0]!, "x-api-key")).toBe("sk-ant-1");
    expect(headerOf(requests[0]!, "anthropic-version")).toBe("2023-06-01");
    expect(headerOf(requests[0]!, "Authorization")).toBeUndefined();
  });
});

describe("verifyProviderKey outcome mapping", () => {
  it("treats any 2xx response as verified", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(204, undefined));
    const result = await verifyProviderKey("openai", "k", { fetchImpl });
    expect(result).toEqual({ ok: true, detail: "" });
  });

  it("maps 401 to a failure that includes the provider's specific message", async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse(401, { error: { message: "Incorrect API key provided" } }),
    );
    const result = await verifyProviderKey("openai", "bad", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Invalid API key or unauthorized");
    expect(result.detail).toContain("HTTP 401");
    expect(result.detail).toContain("Incorrect API key provided");
  });

  it("maps 403 to a failure with the provider message", async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse(403, { message: "Region not allowed" }),
    );
    const result = await verifyProviderKey("groq", "bad", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("HTTP 403");
    expect(result.detail).toContain("Region not allowed");
  });

  it("surfaces plain-text bodies from unexpected status codes", async () => {
    const { fetchImpl } = mockFetch(() => textResponse(500, "upstream exploded", "Boom"));
    const result = await verifyProviderKey("openai", "k", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("HTTP 500 Boom: upstream exploded");
  });

  it("turns network failures into a failed result, never a throw", async () => {
    const { fetchImpl } = mockFetch(() => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    const result = await verifyProviderKey("ollama", "", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Network error");
    expect(result.detail).toContain("ECONNREFUSED");
  });

  it("reports cancellation when the modal aborts an in-flight check", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = mockFetch(() => {
      throw new Error("aborted");
    });
    const result = await verifyProviderKey("openai", "k", {
      fetchImpl,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Cancelled");
  });
});
