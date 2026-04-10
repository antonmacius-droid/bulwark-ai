/**
 * Circuit breaker for LLM provider failures.
 *
 * States:
 * - CLOSED: normal operation, requests pass through
 * - OPEN: provider is failing, requests are rejected immediately
 * - HALF_OPEN: cooldown expired, one test request allowed through
 *
 * @example
 * ```ts
 * const gateway = new AIGateway({
 *   circuitBreaker: { enabled: true, failureThreshold: 5, cooldownMs: 30_000 },
 * });
 * ```
 */

export interface CircuitBreakerConfig {
  /** Enable circuit breaker (default: false) */
  enabled: boolean;
  /** Number of consecutive failures before tripping (default: 5) */
  failureThreshold?: number;
  /** Time in ms to wait before allowing a test request (default: 30000) */
  cooldownMs?: number;
  /** Max consecutive open cycles before auto-reset (default: 10). Prevents permanent tripping. */
  maxOpenCycles?: number;
}

type CircuitState = "closed" | "open" | "half_open";

interface ProviderCircuit {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  /** How many times the circuit has re-opened from half-open */
  openCycles: number;
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, ProviderCircuit>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly maxOpenCycles: number;

  constructor(config: CircuitBreakerConfig) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.cooldownMs = config.cooldownMs ?? 30_000;
    this.maxOpenCycles = config.maxOpenCycles ?? 10;
  }

  /** Check if a provider is available. Returns false if circuit is open. */
  isAvailable(provider: string): boolean {
    const circuit = this.circuits.get(provider);
    if (!circuit || circuit.state === "closed") return true;

    if (circuit.state === "open") {
      // Check if cooldown has elapsed → transition to half-open
      if (Date.now() - circuit.lastFailureAt >= this.cooldownMs) {
        circuit.state = "half_open";
        return true; // allow one test request
      }
      return false;
    }

    // half_open — allow the test request
    return true;
  }

  /** Record a successful call — resets the circuit to closed. */
  recordSuccess(provider: string): void {
    const circuit = this.circuits.get(provider);
    if (circuit) {
      circuit.state = "closed";
      circuit.failures = 0;
      circuit.openCycles = 0;
      circuit.lastSuccessAt = Date.now();
    }
  }

  /** Record a failed call — increments failure count, may trip the circuit. */
  recordFailure(provider: string): void {
    let circuit = this.circuits.get(provider);
    if (!circuit) {
      circuit = { state: "closed", failures: 0, lastFailureAt: 0, lastSuccessAt: 0, openCycles: 0 };
      this.circuits.set(provider, circuit);
    }

    circuit.failures++;
    circuit.lastFailureAt = Date.now();

    if (circuit.state === "half_open") {
      circuit.openCycles++;
      // Auto-reset after too many open cycles to prevent permanent tripping
      if (circuit.openCycles >= this.maxOpenCycles) {
        circuit.state = "closed";
        circuit.failures = 0;
        circuit.openCycles = 0;
      } else {
        circuit.state = "open";
      }
    } else if (circuit.failures >= this.failureThreshold) {
      circuit.state = "open";
    }
  }

  /** Get current state for a provider (for health checks / admin). */
  getState(provider: string): { state: CircuitState; failures: number; lastFailureAt: number } {
    const circuit = this.circuits.get(provider);
    if (!circuit) return { state: "closed", failures: 0, lastFailureAt: 0 };
    return { state: circuit.state, failures: circuit.failures, lastFailureAt: circuit.lastFailureAt };
  }

  /** Get states for all tracked providers. */
  getAllStates(): Record<string, { state: CircuitState; failures: number }> {
    const result: Record<string, { state: CircuitState; failures: number }> = {};
    for (const [provider, circuit] of this.circuits) {
      result[provider] = { state: circuit.state, failures: circuit.failures };
    }
    return result;
  }

  /** Reset a provider's circuit (admin override). */
  reset(provider: string): void {
    this.circuits.delete(provider);
  }
}
