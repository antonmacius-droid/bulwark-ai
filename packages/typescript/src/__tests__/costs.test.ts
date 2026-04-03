import { describe, it, expect } from "vitest";
import { CostCalculator } from "../billing/costs";

describe("CostCalculator", () => {
  it("should calculate GPT-4o costs correctly", () => {
    const calc = new CostCalculator();
    const cost = calc.calculate("gpt-4o", 1000, 500);
    // GPT-4o: $2.50 input, $10.00 output per million
    expect(cost.inputCost).toBeCloseTo(0.0025, 4);
    expect(cost.outputCost).toBeCloseTo(0.005, 4);
    expect(cost.totalCost).toBeCloseTo(0.0075, 4);
    expect(cost.model).toBe("gpt-4o");
    expect(cost.provider).toBe("openai");
  });

  it("should calculate Claude costs correctly", () => {
    const calc = new CostCalculator();
    const cost = calc.calculate("claude-sonnet-4-6", 1000, 500);
    expect(cost.inputCost).toBeCloseTo(0.003, 4);
    expect(cost.outputCost).toBeCloseTo(0.0075, 4);
    expect(cost.provider).toBe("anthropic");
  });

  it("should allow custom pricing overrides", () => {
    const calc = new CostCalculator({ "custom-model": { input: 1.0, output: 2.0 } });
    const cost = calc.calculate("custom-model", 1_000_000, 500_000);
    expect(cost.inputCost).toBeCloseTo(1.0, 2);
    expect(cost.outputCost).toBeCloseTo(1.0, 2);
  });

  it("should fallback to gpt-4o-mini for unknown models", () => {
    const calc = new CostCalculator();
    const cost = calc.calculate("unknown-model", 1000, 500);
    // Falls back to gpt-4o-mini pricing
    expect(cost.totalCost).toBeGreaterThan(0);
  });
});
