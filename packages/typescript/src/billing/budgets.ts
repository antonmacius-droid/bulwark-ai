import type { BudgetConfig, UsageRecord } from "./types";
import type { Database } from "../database";

interface BudgetCheck {
  ok: boolean;
  used: number;
  limit: number;
  costUsd: number;
}

export class BudgetManager {
  enabled: boolean;
  private config: BudgetConfig;
  private db: Database;
  /** Tracks which thresholds have already been crossed per scope to avoid duplicate alerts */
  private crossedThresholds = new Map<string, Set<number>>();

  constructor(db: Database, config: BudgetConfig) {
    this.db = db;
    this.config = config;
    this.enabled = config.enabled;
  }

  /** Check if a user/team has budget remaining this month */
  async checkBudget(scope: { userId?: string; teamId?: string; tenantId?: string }): Promise<BudgetCheck> {
    if (!this.enabled) return { ok: true, used: 0, limit: 0, costUsd: 0 };

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStr = monthStart.toISOString();

    // Check user budget
    if (scope.userId) {
      const row = this.db.queryOne<{ total_tokens: number; total_cost: number }>(
        "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens, COALESCE(SUM(cost_usd), 0) as total_cost FROM bulwark_usage WHERE user_id = ? AND timestamp >= ?",
        [scope.userId, monthStr]
      );
      const used = row?.total_tokens || 0;
      const limit = this.config.defaultUserLimit || 0;
      if (limit > 0 && used >= limit) {
        return { ok: this.config.onExceeded !== "block", used, limit, costUsd: row?.total_cost || 0 };
      }

      // Check alert thresholds — only fire on first crossing
      if (limit > 0 && this.config.alertThresholds && this.config.onAlert) {
        const scopeKey = `user:${scope.userId}`;
        if (!this.crossedThresholds.has(scopeKey)) this.crossedThresholds.set(scopeKey, new Set());
        const crossed = this.crossedThresholds.get(scopeKey)!;
        for (const threshold of this.config.alertThresholds) {
          if (used / limit >= threshold && !crossed.has(threshold)) {
            crossed.add(threshold);
            this.config.onAlert({ type: "user", id: scope.userId, threshold, used, limit, costUsd: row?.total_cost || 0 });
          }
        }
      }
    }

    // Check team budget
    if (scope.teamId) {
      const row = this.db.queryOne<{ total_tokens: number; total_cost: number }>(
        "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens, COALESCE(SUM(cost_usd), 0) as total_cost FROM bulwark_usage WHERE team_id = ? AND timestamp >= ?",
        [scope.teamId, monthStr]
      );
      const used = row?.total_tokens || 0;
      const limit = this.config.defaultTeamLimit || 0;
      if (limit > 0 && used >= limit) {
        return { ok: this.config.onExceeded !== "block", used, limit, costUsd: row?.total_cost || 0 };
      }
    }

    return { ok: true, used: 0, limit: 0, costUsd: 0 };
  }

  /** Record token usage */
  async recordUsage(record: UsageRecord): Promise<void> {
    this.db.run(
      "INSERT INTO bulwark_usage (user_id, team_id, tenant_id, model, input_tokens, output_tokens, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [record.userId || null, record.teamId || null, record.tenantId || null, record.model, record.inputTokens, record.outputTokens, record.costUsd, record.timestamp]
    );
  }
}
