/**
 * Shared model-pricing resolution.
 *
 * Both adapters previously kept their own static table and silently fell back
 * to `{inputPerM: 0, outputPerM: 0}` for unknown models, which made an unknown
 * model look free rather than unpriced. `resolvePricing` keeps the estimate
 * fallback but marks it explicitly so the UI can say "pricing unknown"
 * instead of showing a misleading `$0.0000`.
 *
 * These figures are ESTIMATES and will drift; a `pricing` block in
 * `.toolify/config.json` always wins.
 */
import type { ModelPricing } from "../agent/types.js";

const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o": { inputPerM: 0.000005, outputPerM: 0.000015, isEstimate: true },
  "gpt-4o-mini": { inputPerM: 0.00000015, outputPerM: 0.0000006, isEstimate: true },
  "gpt-4-turbo": { inputPerM: 0.00001, outputPerM: 0.00003, isEstimate: true },
  "gpt-3.5-turbo": { inputPerM: 0.0000005, outputPerM: 0.0000015, isEstimate: true },
  "claude-3-5-sonnet-20241022": { inputPerM: 0.000003, outputPerM: 0.000015, isEstimate: true },
  "claude-3-opus-20240229": { inputPerM: 0.000015, outputPerM: 0.000075, isEstimate: true },
  "claude-sonnet-4-20250514": { inputPerM: 0.000003, outputPerM: 0.000015, isEstimate: true },
  "gemini-1.5-pro": { inputPerM: 0.00000125, outputPerM: 0.000005, isEstimate: true },
  "gemini-1.5-flash": { inputPerM: 0.000000075, outputPerM: 0.0000003, isEstimate: true },
  "gemini-2.0-flash": { inputPerM: 0.0000001, outputPerM: 0.0000004, isEstimate: true },
  "gemini-2.5-pro": { inputPerM: 0.00000125, outputPerM: 0.000005, isEstimate: true },
  "gemini-2.5-flash": { inputPerM: 0.00000015, outputPerM: 0.0000006, isEstimate: true },
  "deepseek-chat": { inputPerM: 0.00000014, outputPerM: 0.00000028, isEstimate: true },
  "deepseek-reasoner": { inputPerM: 0.00000055, outputPerM: 0.00000219, isEstimate: true },
  "llama-3.3-70b-versatile": { inputPerM: 0.00000059, outputPerM: 0.00000079, isEstimate: true },
  "llama-3.1-8b-instant": { inputPerM: 0.00000005, outputPerM: 0.00000008, isEstimate: true },
  "mixtral-8x7b-32768": { inputPerM: 0.00000027, outputPerM: 0.00000027, isEstimate: true },
  "sonar-pro": { inputPerM: 0.000001, outputPerM: 0.000001, isEstimate: true },
  "sonar": { inputPerM: 0.000001, outputPerM: 0.000001, isEstimate: true },
};

/** Free-tier models frequently used through gateways. */
const KNOWN_FREE_MODELS = new Set(["auto", "free", "gpt-3.5-turbo-free"]);

/** Marker meaning "no price is known" — not "the model is free". */
export const UNKNOWN_PRICING: ModelPricing = {
  inputPerM: 0,
  outputPerM: 0,
  isEstimate: true,
};

/** True when pricing was a zero-value guess rather than a real figure. */
export function isPricingKnown(pricing: ModelPricing): boolean {
  return pricing.inputPerM > 0 || pricing.outputPerM > 0;
}

/**
 * Resolve pricing for a model id.
 *
 * Order: explicit config > known free model > static table > unknown marker.
 * Matching is case-insensitive and tolerates gateway prefixes such as
 * `openrouter/qwen/qwen3.8-omni-flash` by also trying the trailing segment.
 */
export function resolvePricing(
  modelId: string,
  explicit?: ModelPricing,
): ModelPricing {
  if (explicit) return explicit;

  const id = modelId.toLowerCase();
  if (KNOWN_FREE_MODELS.has(id)) {
    return { inputPerM: 0, outputPerM: 0, isEstimate: true };
  }

  const direct = DEFAULT_MODEL_PRICING[modelId] ?? DEFAULT_MODEL_PRICING[id];
  if (direct) return direct;

  // Try the last path segment for gateway-prefixed ids.
  const tail = id.split("/").pop() ?? id;
  if (tail !== id) {
    const viaTail = DEFAULT_MODEL_PRICING[tail];
    if (viaTail) return viaTail;
  }

  return UNKNOWN_PRICING;
}

export { DEFAULT_MODEL_PRICING };
