import { describe, it, expect, beforeEach } from "vitest";
import { SLAMonitor } from "../monitoring/sla-monitor";
import { createDatabase } from "../database";

describe("SLAMonitor", () => {
  let monitor: SLAMonitor;

  beforeEach(() => {
    const db = createDatabase(":memory:");
    db.init();
    // Seed some audit data
    const now = new Date().toISOString();
    for (let i = 0; i < 10; i++) {
      db.run(
        "INSERT INTO bulwark_audit (id, action, model, provider, duration_ms, cost_usd, input_tokens, output_tokens, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [`audit_${i}`, "chat", "gpt-4o", "openai", 100 + i * 50, 0.01, 100, 50, now]
      );
    }
    // Add some errors
    db.run(
      "INSERT INTO bulwark_audit (id, action, model, provider, duration_ms, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      ["audit_err_1", "policy_block", "gpt-4o", "openai", 5, now]
    );
    // Add anthropic data
    db.run(
      "INSERT INTO bulwark_audit (id, action, model, provider, duration_ms, cost_usd, input_tokens, output_tokens, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["audit_anth_1", "chat", "claude-sonnet", "anthropic", 200, 0.02, 200, 100, now]
    );

    monitor = new SLAMonitor(db);
  });

  it("returns health for all providers", async () => {
    const summary = await monitor.getProviderHealth("24h");
    expect(summary.providers.length).toBeGreaterThanOrEqual(2);
    const openai = summary.providers.find(p => p.provider === "openai");
    expect(openai).toBeDefined();
    expect(openai!.totalRequests).toBe(11); // 10 chat + 1 error
    expect(openai!.successCount).toBe(10);
    expect(openai!.errorCount).toBe(1);
  });

  it("calculates error rate correctly", async () => {
    const summary = await monitor.getProviderHealth("24h");
    const openai = summary.providers.find(p => p.provider === "openai")!;
    expect(openai.errorRate).toBeCloseTo(1 / 11, 2);
  });

  it("calculates latency percentiles", async () => {
    const summary = await monitor.getProviderHealth("24h");
    const openai = summary.providers.find(p => p.provider === "openai")!;
    expect(openai.p50LatencyMs).toBeGreaterThan(0);
    expect(openai.p95LatencyMs).toBeGreaterThanOrEqual(openai.p50LatencyMs);
    expect(openai.p99LatencyMs).toBeGreaterThanOrEqual(openai.p95LatencyMs);
  });

  it("returns single provider health", async () => {
    const health = await monitor.getProviderHealthSingle("anthropic", "24h");
    expect(health).toBeDefined();
    expect(health!.provider).toBe("anthropic");
    expect(health!.totalRequests).toBe(1);
  });

  it("returns null for unknown provider", async () => {
    const health = await monitor.getProviderHealthSingle("unknown", "24h");
    expect(health).toBeNull();
  });

  it("checks alert rules", async () => {
    const alertMonitor = new SLAMonitor(
      (monitor as unknown as { db: unknown }).db as ReturnType<typeof createDatabase>,
      {
        alertRules: [
          { provider: "openai", metric: "error_rate", threshold: 0.01, action: "alert" },
        ],
      }
    );
    const alerts = await alertMonitor.checkAlerts("24h");
    expect(alerts.length).toBe(1);
    expect(alerts[0].provider).toBe("openai");
    expect(alerts[0].metric).toBe("error_rate");
  });
});
