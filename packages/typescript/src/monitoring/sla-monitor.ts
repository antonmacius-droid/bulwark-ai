/**
 * LLM Provider SLA Monitor
 *
 * Tracks real-time provider health from audit data:
 * - Uptime / error rate per provider
 * - Latency percentiles (p50, p95, p99)
 * - Request volume and cost
 * - Alert on threshold breaches
 *
 * All metrics are derived from existing audit logs — no synthetic probes needed.
 *
 * @example
 * ```ts
 * const monitor = new SLAMonitor(gateway.database, {
 *   alertRules: [
 *     { provider: "openai", metric: "error_rate", threshold: 0.05, action: "warn" },
 *     { provider: "openai", metric: "p95_latency", threshold: 5000, action: "alert" },
 *   ],
 *   onAlert: (alert) => slack.send(alert.message),
 * });
 *
 * const health = await monitor.getProviderHealth("1h");
 * const alerts = await monitor.checkAlerts();
 * ```
 */

import type { Database } from "../database";

export interface SLAMonitorConfig {
  /** Alert rules — check provider metrics against thresholds */
  alertRules?: AlertRule[];
  /** Callback when an alert fires */
  onAlert?: (alert: SLAAlert) => void | Promise<void>;
}

export interface AlertRule {
  /** Provider to monitor (or "*" for all) */
  provider: string;
  /** Metric to check */
  metric: "error_rate" | "p50_latency" | "p95_latency" | "p99_latency" | "avg_latency";
  /** Threshold value — error_rate is 0-1, latency is ms */
  threshold: number;
  /** Action when threshold breached */
  action: "warn" | "alert";
}

export interface SLAAlert {
  provider: string;
  metric: string;
  value: number;
  threshold: number;
  action: "warn" | "alert";
  message: string;
  timestamp: string;
}

export interface ProviderHealth {
  provider: string;
  /** Time window for these metrics */
  window: string;
  /** Total requests in window */
  totalRequests: number;
  /** Successful requests (action = "chat") */
  successCount: number;
  /** Failed requests (action contains "block", "error", etc.) */
  errorCount: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Latency percentiles in ms */
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  /** Min/max latency in ms */
  minLatencyMs: number;
  maxLatencyMs: number;
  /** Total cost in USD */
  totalCostUsd: number;
  /** Average cost per request */
  avgCostPerRequest: number;
  /** Total tokens consumed */
  totalTokens: number;
}

export interface ProviderHealthSummary {
  window: string;
  generatedAt: string;
  providers: ProviderHealth[];
}

type TimeWindow = "1h" | "6h" | "24h" | "7d" | "30d";

export class SLAMonitor {
  private db: Database;
  private config: SLAMonitorConfig;

  constructor(db: Database, config: SLAMonitorConfig = {}) {
    this.db = db;
    this.config = config;
  }

  /**
   * Get health metrics for all providers within a time window.
   */
  async getProviderHealth(window: TimeWindow = "24h"): Promise<ProviderHealthSummary> {
    const cutoff = this.windowToCutoff(window);

    // Get per-provider aggregates
    const rows = await this.db.queryAll<{
      provider: string;
      total: number;
      successes: number;
      errors: number;
      avg_latency: number;
      min_latency: number;
      max_latency: number;
      total_cost: number;
      total_tokens: number;
    }>(
      `SELECT
        provider,
        COUNT(*) as total,
        SUM(CASE WHEN action = 'chat' THEN 1 ELSE 0 END) as successes,
        SUM(CASE WHEN action != 'chat' THEN 1 ELSE 0 END) as errors,
        AVG(duration_ms) as avg_latency,
        MIN(duration_ms) as min_latency,
        MAX(duration_ms) as max_latency,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens
      FROM bulwark_audit
      WHERE provider IS NOT NULL AND timestamp >= ?
      GROUP BY provider
      ORDER BY total DESC`,
      [cutoff]
    );

    // Get latency values for percentile calculation
    const providers: ProviderHealth[] = [];
    for (const row of rows) {
      const latencies = await this.db.queryAll<{ duration_ms: number }>(
        `SELECT duration_ms FROM bulwark_audit
         WHERE provider = ? AND timestamp >= ? AND duration_ms IS NOT NULL AND action = 'chat'
         ORDER BY duration_ms ASC`,
        [row.provider, cutoff]
      );
      const latencyValues = latencies.map(l => l.duration_ms);

      providers.push({
        provider: row.provider,
        window,
        totalRequests: row.total,
        successCount: row.successes,
        errorCount: row.errors,
        errorRate: row.total > 0 ? Math.round((row.errors / row.total) * 1000) / 1000 : 0,
        avgLatencyMs: Math.round(row.avg_latency || 0),
        p50LatencyMs: this.percentile(latencyValues, 50),
        p95LatencyMs: this.percentile(latencyValues, 95),
        p99LatencyMs: this.percentile(latencyValues, 99),
        minLatencyMs: Math.round(row.min_latency || 0),
        maxLatencyMs: Math.round(row.max_latency || 0),
        totalCostUsd: Math.round((row.total_cost || 0) * 100) / 100,
        avgCostPerRequest: row.total > 0 ? Math.round(((row.total_cost || 0) / row.total) * 10000) / 10000 : 0,
        totalTokens: row.total_tokens || 0,
      });
    }

    return {
      window,
      generatedAt: new Date().toISOString(),
      providers,
    };
  }

  /**
   * Get health for a single provider.
   */
  async getProviderHealthSingle(provider: string, window: TimeWindow = "24h"): Promise<ProviderHealth | null> {
    const summary = await this.getProviderHealth(window);
    return summary.providers.find(p => p.provider === provider) || null;
  }

  /**
   * Check alert rules against current metrics.
   * Returns fired alerts and calls onAlert callback.
   */
  async checkAlerts(window: TimeWindow = "1h"): Promise<SLAAlert[]> {
    if (!this.config.alertRules?.length) return [];

    const summary = await this.getProviderHealth(window);
    const alerts: SLAAlert[] = [];

    for (const rule of this.config.alertRules) {
      const targets = rule.provider === "*"
        ? summary.providers
        : summary.providers.filter(p => p.provider === rule.provider);

      for (const provider of targets) {
        const value = this.getMetricValue(provider, rule.metric);
        if (value > rule.threshold) {
          const alert: SLAAlert = {
            provider: provider.provider,
            metric: rule.metric,
            value,
            threshold: rule.threshold,
            action: rule.action,
            message: `${provider.provider} ${rule.metric} is ${value} (threshold: ${rule.threshold})`,
            timestamp: new Date().toISOString(),
          };
          alerts.push(alert);
          if (this.config.onAlert) {
            await this.config.onAlert(alert);
          }
        }
      }
    }

    return alerts;
  }

  /**
   * Get latency trend — average latency per hour for the last N hours.
   */
  async getLatencyTrend(provider: string, hours = 24): Promise<{ hour: string; avgMs: number; count: number }[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = await this.db.queryAll<{ hour: string; avg_ms: number; count: number }>(
      `SELECT
        strftime('%Y-%m-%d %H:00', timestamp) as hour,
        AVG(duration_ms) as avg_ms,
        COUNT(*) as count
      FROM bulwark_audit
      WHERE provider = ? AND timestamp >= ? AND action = 'chat' AND duration_ms IS NOT NULL
      GROUP BY hour
      ORDER BY hour ASC`,
      [provider, cutoff]
    );
    return rows.map(r => ({ hour: r.hour, avgMs: Math.round(r.avg_ms), count: r.count }));
  }

  /**
   * Get error trend — error count per hour for the last N hours.
   */
  async getErrorTrend(provider: string, hours = 24): Promise<{ hour: string; errors: number; total: number }[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = await this.db.queryAll<{ hour: string; errors: number; total: number }>(
      `SELECT
        strftime('%Y-%m-%d %H:00', timestamp) as hour,
        SUM(CASE WHEN action != 'chat' THEN 1 ELSE 0 END) as errors,
        COUNT(*) as total
      FROM bulwark_audit
      WHERE provider = ? AND timestamp >= ?
      GROUP BY hour
      ORDER BY hour ASC`,
      [provider, cutoff]
    );
    return rows.map(r => ({ hour: r.hour, errors: r.errors, total: r.total }));
  }

  // --- Helpers ---

  private windowToCutoff(window: TimeWindow): string {
    const ms: Record<TimeWindow, number> = {
      "1h": 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    return new Date(Date.now() - ms[window]).toISOString();
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return Math.round(sorted[Math.max(0, index)]);
  }

  private getMetricValue(provider: ProviderHealth, metric: string): number {
    switch (metric) {
      case "error_rate": return provider.errorRate;
      case "p50_latency": return provider.p50LatencyMs;
      case "p95_latency": return provider.p95LatencyMs;
      case "p99_latency": return provider.p99LatencyMs;
      case "avg_latency": return provider.avgLatencyMs;
      default: return 0;
    }
  }
}
