import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker } from "../circuit-breaker";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ enabled: true, failureThreshold: 3, cooldownMs: 100, maxOpenCycles: 3 });
  });

  it("starts in closed state — provider is available", () => {
    expect(cb.isAvailable("openai")).toBe(true);
    expect(cb.getState("openai").state).toBe("closed");
  });

  it("stays closed below failure threshold", () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.isAvailable("openai")).toBe(true);
    expect(cb.getState("openai").failures).toBe(2);
  });

  it("trips to open after reaching failure threshold", () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.isAvailable("openai")).toBe(false);
    expect(cb.getState("openai").state).toBe("open");
  });

  it("transitions to half-open after cooldown", async () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    expect(cb.isAvailable("openai")).toBe(false);

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 150));
    expect(cb.isAvailable("openai")).toBe(true); // half-open allows one request
    expect(cb.getState("openai").state).toBe("half_open");
  });

  it("resets to closed on success in half-open", async () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");

    await new Promise(r => setTimeout(r, 150));
    cb.isAvailable("openai"); // transition to half-open
    cb.recordSuccess("openai");

    expect(cb.getState("openai").state).toBe("closed");
    expect(cb.getState("openai").failures).toBe(0);
  });

  it("re-opens on failure in half-open", async () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");

    await new Promise(r => setTimeout(r, 150));
    cb.isAvailable("openai"); // transition to half-open
    cb.recordFailure("openai");

    expect(cb.getState("openai").state).toBe("open");
  });

  it("auto-resets after maxOpenCycles to prevent permanent tripping", async () => {
    // Trip the circuit
    for (let i = 0; i < 3; i++) cb.recordFailure("openai");

    // Cycle through open→half-open→open maxOpenCycles times
    for (let cycle = 0; cycle < 2; cycle++) {
      await new Promise(r => setTimeout(r, 150));
      cb.isAvailable("openai"); // half-open
      cb.recordFailure("openai"); // back to open
    }

    // Third cycle should auto-reset
    await new Promise(r => setTimeout(r, 150));
    cb.isAvailable("openai"); // half-open
    cb.recordFailure("openai"); // should auto-reset (3rd cycle)

    expect(cb.getState("openai").state).toBe("closed");
    expect(cb.getState("openai").failures).toBe(0);
  });

  it("reset() clears state", () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.reset("openai");

    expect(cb.isAvailable("openai")).toBe(true);
    expect(cb.getState("openai").state).toBe("closed");
  });

  it("getAllStates() returns all tracked providers", () => {
    cb.recordFailure("openai");
    cb.recordFailure("anthropic");

    const states = cb.getAllStates();
    expect(Object.keys(states)).toContain("openai");
    expect(Object.keys(states)).toContain("anthropic");
  });

  it("isolates state between providers", () => {
    cb.recordFailure("openai");
    cb.recordFailure("openai");
    cb.recordFailure("openai");

    expect(cb.isAvailable("openai")).toBe(false);
    expect(cb.isAvailable("anthropic")).toBe(true);
  });
});
