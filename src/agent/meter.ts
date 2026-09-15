import type { ModelPricing, Usage } from "./types.js";

/**
 * Live cost meter (R1): Cline shows cost only in the sidebar after the fact;
 * TOOLIFY reports usage+cost every turn in the event stream.
 */
export class CostMeter {
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0 };
  costUsd = 0;

  constructor(private readonly pricing: ModelPricing) {}

  add(u: Usage): { usage: Usage; costUsd: number } {
    this.usage.inputTokens += u.inputTokens;
    this.usage.outputTokens += u.outputTokens;
    this.costUsd =
      (this.usage.inputTokens / 1e6) * this.pricing.inputPerM +
      (this.usage.outputTokens / 1e6) * this.pricing.outputPerM;
    return { usage: { ...this.usage }, costUsd: this.costUsd };
  }
}
