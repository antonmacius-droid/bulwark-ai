import { MODEL_PRICING, type CostRecord } from "./types";

export class CostCalculator {
  private pricing: Record<string, { input: number; output: number }>;

  constructor(overrides?: Record<string, { input: number; output: number }>) {
    this.pricing = { ...MODEL_PRICING, ...overrides };
  }

  /** Calculate cost for a request. Returns USD amounts. */
  calculate(model: string, inputTokens: number, outputTokens: number): CostRecord {
    const pricing = this.pricing[model] || this.pricing["gpt-4o-mini"] || { input: 0.15, output: 0.60 };

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return {
      model,
      provider: model.startsWith("claude") ? "anthropic" : "openai",
      inputTokens,
      outputTokens,
      inputCost: Math.round(inputCost * 1_000_000) / 1_000_000, // 6 decimal places
      outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
      totalCost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
    };
  }

  /** Update pricing for a model */
  setModelPrice(model: string, input: number, output: number): void {
    this.pricing[model] = { input, output };
  }
}
