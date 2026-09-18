import { describe, it, expect } from "vitest";
import {
  getAllConfiguredModels,
  formatContextLimit,
  prettifyModelId,
  type RegistryDeps,
} from "../src/models/model-registry.js";
import type { ProbedModel } from "../src/models/fetch-models.js";

type Cfg = { apiKeys: Record<string, string>; baseUrls: Record<string, string> };

function deps(
  config: Cfg,
  probe?: (providerId: string, apiKey: string, baseUrl?: string) => Promise<{ models: readonly ProbedModel[]; error?: string }>,
): RegistryDeps {
  return {
    readConfigFn: async () => config,
    getModelsFn: probe ?? (async () => ({ models: [] })),
  };
}

const GEMINI_MODELS: ProbedModel[] = [
  { id: "gemini-3.1-pro", contextTokens: 1_048_576 },
  { id: "gemini-2.5-flash", contextTokens: 1_048_576 },
];

const GROQ_MODELS: ProbedModel[] = [{ id: "llama-3.3-70b-versatile", contextTokens: 131_072 }];

describe("getAllConfiguredModels — 0 / 1 / multi-provider aggregation", () => {
  it("returns an empty array when ZERO providers are configured", async () => {
    const models = await getAllConfiguredModels(deps({ apiKeys: {}, baseUrls: {} }));
    expect(models).toEqual([]);
  });

  it("ignores blank keys and unknown provider ids in the config store", async () => {
    const models = await getAllConfiguredModels(
      deps({ apiKeys: { gemini: "  ", openai: "", bogus_provider: "k" }, baseUrls: {} }),
    );
    expect(models).toEqual([]);
  });

  it("returns ONLY the configured provider's models when ONE provider exists", async () => {
    const seen: string[] = [];
    const models = await getAllConfiguredModels(
      deps(
        { apiKeys: { gemini: "AIza-1" }, baseUrls: {} },
        async (providerId) => {
          seen.push(providerId);
          return { models: GEMINI_MODELS };
        },
      ),
    );
    expect(seen).toEqual(["gemini"]); // never probes unconfigured providers
    expect(models).toHaveLength(2);
    expect(models.every((m) => m.providerId === "gemini")).toBe(true);
    expect(models.every((m) => m.providerName === "Google Gemini")).toBe(true);
  });

  it("standardizes descriptors: display name, context badge, and metadata tags", async () => {
    const models = await getAllConfiguredModels(
      deps(
        { apiKeys: { gemini: "AIza-1" }, baseUrls: {} },
        async () => ({ models: [{ id: "gemini-2.5-flash", contextTokens: 1_048_576, isFree: true }] }),
      ),
    );
    expect(models[0]).toEqual({
      id: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      providerId: "gemini",
      providerName: "Google Gemini",
      contextLimit: "1.0M",
      isFree: true,
    });
  });

  it("merges TWO OR MORE providers concurrently with metadata tags", async () => {
    const models = await getAllConfiguredModels(
      deps(
        { apiKeys: { gemini: "AIza-1", groq: "gsk-1" }, baseUrls: {} },
        async (providerId) =>
          providerId === "gemini" ? { models: GEMINI_MODELS } : { models: GROQ_MODELS },
      ),
    );
    expect(models).toHaveLength(3);
    const providers = new Set(models.map((m) => m.providerId));
    expect(providers).toEqual(new Set(["gemini", "groq"]));
    expect(models.find((m) => m.id === "llama-3.3-70b-versatile")).toMatchObject({
      providerId: "groq",
      providerName: "Groq",
      contextLimit: "131K",
      displayName: "Llama 3.3 70b Versatile",
    });
  });

  it("drops providers whose probe fails (401/403) but keeps the rest (fallback registry)", async () => {
    const models = await getAllConfiguredModels(
      deps(
        { apiKeys: { gemini: "AIza-1", openrouter: "expired" }, baseUrls: {} },
        async (providerId) =>
          providerId === "openrouter"
            ? { models: [], error: "unauthorized: invalid key" }
            : { models: GEMINI_MODELS },
      ),
    );
    expect(models).toHaveLength(2);
    expect(models.every((m) => m.providerId === "gemini")).toBe(true);
  });

  it("keeps the aggregation alive when a probe promise rejects outright", async () => {
    const models = await getAllConfiguredModels(
      deps(
        { apiKeys: { gemini: "AIza-1", groq: "gsk-1" }, baseUrls: {} },
        async (providerId) => {
          if (providerId === "groq") throw new Error("boom");
          return { models: GEMINI_MODELS };
        },
      ),
    );
    expect(models).toHaveLength(2);
    expect(models.every((m) => m.providerId === "gemini")).toBe(true);
  });

  it("strips :free from the display name while preserving the isFree tag", async () => {
    const models = await getAllConfiguredModels(
      deps(
        { apiKeys: { openrouter: "sk-or-1" }, baseUrls: {} },
        async () => ({
          models: [{ id: "cohere/north-mini-code:free", contextTokens: 131_072, isFree: true }],
        }),
      ),
    );
    expect(models[0]!.displayName).toBe("Cohere North Mini Code");
    expect(models[0]!.isFree).toBe(true);
    expect(models[0]!.contextLimit).toBe("131K");
  });

  it("resolves base URLs from config.json baseUrls into the probe call", async () => {
    const seen: Array<{ providerId: string; apiKey: string; baseUrl?: string }> = [];
    await getAllConfiguredModels(
      deps(
        { apiKeys: { ollama: "x" }, baseUrls: { ollama: "http://10.0.0.5:11434/v1" } },
        async (providerId, apiKey, baseUrl) => {
          seen.push({ providerId, apiKey, baseUrl });
          return { models: [] };
        },
      ),
    );
    expect(seen).toEqual([{ providerId: "ollama", apiKey: "x", baseUrl: "http://10.0.0.5:11434/v1" }]);
  });
});

describe("context-limit formatting", () => {
  it("formats token counts into picker badges", () => {
    expect(formatContextLimit(1_048_576)).toBe("1.0M");
    expect(formatContextLimit(2_000_000)).toBe("2.0M");
    expect(formatContextLimit(512_000)).toBe("512K");
    expect(formatContextLimit(131_072)).toBe("131K");
    expect(formatContextLimit(32_768)).toBe("32K");
    expect(formatContextLimit(undefined)).toBe("—");
  });

  it("prettifies ids into display names", () => {
    expect(prettifyModelId("gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(prettifyModelId("gpt-4o")).toBe("GPT 4o");
    expect(prettifyModelId("llama-3.3-70b-versatile")).toBe("Llama 3.3 70b Versatile");
    expect(prettifyModelId("qwen2.5-coder:latest")).toBe("Qwen2.5 Coder");
  });
});

