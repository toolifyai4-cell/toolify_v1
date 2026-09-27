import type { ModelPricing, Usage } from "./types.js";

/**
 * Live cost meter (R1): Cline shows cost only in the sidebar after the fact;
 * TOOLIFY reports usage+cost every turn in the event stream.
 */
export class CostMeter {
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0 };
  costUsd = 0;

  constructor(private readonly pricing: ModelPricing) {}

  /**
   * True when no real price is known for this model, so `costUsd` is 0 because
   * the price is UNKNOWN rather than because the model is free. Callers should
   * surface "pricing unknown" instead of a misleading `$0.0000`.
   */
  get pricingUnknown(): boolean {
    return this.pricing.inputPerM <= 0 && this.pricing.outputPerM <= 0;
  }

  add(u: Usage): { usage: Usage; costUsd: number } {
    this.usage.inputTokens += u.inputTokens;
    this.usage.outputTokens += u.outputTokens;
    this.costUsd =
      (this.usage.inputTokens / 1e6) * this.pricing.inputPerM +
      (this.usage.outputTokens / 1e6) * this.pricing.outputPerM;
    return { usage: { ...this.usage }, costUsd: this.costUsd };
  }
}
