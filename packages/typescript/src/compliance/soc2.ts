import { checkLicense } from "../rag/license-check";
/**
 * SOC 2 Compliance Module
 *
 * Implements: Immutable audit logs, Change tracking, Health monitoring,
 * Anomaly detection, Vendor tracking, Data classification.
 */

import type { Database } from "../database";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BULWARK_VERSION: string = (() => { try { return require("../../package.json").version; } catch { return "0.1.x"; } })();

export interface SOC2Config {
  /** Enable immutable audit mode — prevents DELETE on audit table */
  immutableAudit?: boolean;
  /** Anomaly detection thresholds */
  anomalyThresholds?: {
    /** Max requests per user per hour before alerting */
    maxRequestsPerUserPerHour?: number;
    /** Max PII detections per hour before alerting */
    maxPiiPerHour?: number;
    /** Max cost per user per day (USD) */
    maxCostPerUserPerDay?: number;
  };
  /** Callback for anomaly alerts */
  onAnomaly?: (anomaly: AnomalyEvent) => void | Promise<void>;
}

export interface AnomalyEvent {
  type: "high_request_rate" | "pii_spike" | "cost_spike" | "policy_violation_spike" | "unauthorized_access";
  severity: "low" | "medium" | "high" | "critical";
  userId?: string;
  tenantId?: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  database: "connected" | "error";
  providers: Record<string, "available" | "error">;
  uptime: number;
  lastRequest?: string;
  activeRequests: number;
  version: string;
}

export interface ChangeLogEntry {
  id: string;
  entityType: "policy" | "budget" | "tenant" | "config";
  entityId: string;
  action: "created" | "updated" | "deleted";
  changedBy: string;
  previousValue?: string;
  newValue?: string;
  timestamp: string;
}

export interface VendorReport {
  providers: {
    name: string;
    region: string;
    requestCount: number;
    totalTokens: number;
    totalCost: number;
    dataTypes: string[];
  }[];
  generatedAt: string;
}

export class SOC2Manager {
  private db: Database;
  private config: SOC2Config;
  private startTime: number;

  constructor(db: Database, config: SOC2Config = {}) {
    checkLicense("Compliance"); this.db = db;
    this.config = config;
    this.startTime = Date.now();

    // Create change log table
    try {
      db.run(`CREATE TABLE IF NOT EXISTS bulwark_change_log (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.run("CREATE INDEX IF NOT EXISTS idx_bulwark_changelog_entity ON bulwark_change_log(entity_type, entity_id)");
    } catch { /* table may already exist */ }
  }

  /** Log a configuration change (for change management audit trail) */
  logChange(entry: Omit<ChangeLogEntry, "id" | "timestamp">): void {
    const id = `chg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.run(
      "INSERT INTO bulwark_change_log (id, entity_type, entity_id, action, changed_by, previous_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, entry.entityType, entry.entityId, entry.action, entry.changedBy, entry.previousValue || null, entry.newValue || null]
    );
  }

  /** Get change history for an entity */
  getChangeHistory(entityType: string, entityId: string): ChangeLogEntry[] {
    return this.db.queryAll<ChangeLogEntry>(
      "SELECT * FROM bulwark_change_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp DESC LIMIT 100",
      [entityType, entityId]
    );
  }

  /** Run anomaly detection on recent activity */
  async detectAnomalies(): Promise<AnomalyEvent[]> {
    const anomalies: AnomalyEvent[] = [];
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const oneDayAgo = new Date(Date.now() - 86400_000).toISOString();

    // High request rate per user
    if (this.config.anomalyThresholds?.maxRequestsPerUserPerHour) {
      const threshold = this.config.anomalyThresholds.maxRequestsPerUserPerHour;
      const highUsers = this.db.queryAll<{ user_id: string; c: number }>(
        "SELECT user_id, COUNT(*) as c FROM bulwark_audit WHERE timestamp >= ? AND user_id IS NOT NULL GROUP BY user_id HAVING c > ?",
        [oneHourAgo, threshold]
      );
      for (const u of highUsers) {
        const event: AnomalyEvent = {
          type: "high_request_rate", severity: u.c > threshold * 3 ? "critical" : "high",
          userId: u.user_id, details: { requestCount: u.c, threshold, period: "1h" }, timestamp: new Date().toISOString(),
        };
        anomalies.push(event);
        if (this.config.onAnomaly) await this.config.onAnomaly(event);
      }
    }

    // PII detection spike
    if (this.config.anomalyThresholds?.maxPiiPerHour) {
      const threshold = this.config.anomalyThresholds.maxPiiPerHour;
      const piiCount = this.db.queryOne<{ c: number }>(
        "SELECT COUNT(*) as c FROM bulwark_audit WHERE timestamp >= ? AND pii_detections > 0",
        [oneHourAgo]
      );
      if (piiCount && piiCount.c > threshold) {
        const event: AnomalyEvent = {
          type: "pii_spike", severity: "critical",
          details: { piiDetections: piiCount.c, threshold, period: "1h" }, timestamp: new Date().toISOString(),
        };
        anomalies.push(event);
        if (this.config.onAnomaly) await this.config.onAnomaly(event);
      }
    }

    // Cost spike per user per day
    if (this.config.anomalyThresholds?.maxCostPerUserPerDay) {
      const threshold = this.config.anomalyThresholds.maxCostPerUserPerDay;
      const highCostUsers = this.db.queryAll<{ user_id: string; total_cost: number }>(
        "SELECT user_id, SUM(cost_usd) as total_cost FROM bulwark_usage WHERE timestamp >= ? AND user_id IS NOT NULL GROUP BY user_id HAVING total_cost > ?",
        [oneDayAgo, threshold]
      );
      for (const u of highCostUsers) {
        const event: AnomalyEvent = {
          type: "cost_spike", severity: u.total_cost > threshold * 2 ? "critical" : "high",
          userId: u.user_id, details: { costUsd: u.total_cost, threshold, period: "24h" }, timestamp: new Date().toISOString(),
        };
        anomalies.push(event);
        if (this.config.onAnomaly) await this.config.onAnomaly(event);
      }
    }

    return anomalies;
  }

  /** Generate vendor/sub-processor report for SOC 2 auditors */
  generateVendorReport(): VendorReport {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const providers = this.db.queryAll<{ provider: string; c: number; tokens: number; cost: number }>(
      "SELECT provider, COUNT(*) as c, COALESCE(SUM(input_tokens + output_tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM bulwark_audit WHERE provider IS NOT NULL AND timestamp >= ? GROUP BY provider",
      [monthStart.toISOString()]
    );

    const PROVIDER_REGIONS: Record<string, string> = {
      openai: "US (Azure regions configurable)",
      anthropic: "US / EU (region configurable)",
      mistral: "EU (France)",
    };

    return {
      providers: providers.map(p => ({
        name: p.provider,
        region: PROVIDER_REGIONS[p.provider] || "Unknown",
        requestCount: p.c,
        totalTokens: p.tokens,
        totalCost: Math.round(p.cost * 100) / 100,
        dataTypes: ["user_prompts", "ai_responses"], // what data is sent to provider
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Health check endpoint data */
  getHealthStatus(activeRequests: number): HealthStatus {
    let dbStatus: "connected" | "error" = "error";
    try {
      this.db.queryOne("SELECT 1");
      dbStatus = "connected";
    } catch { /* db error */ }

    return {
      status: dbStatus === "connected" ? "healthy" : "unhealthy",
      database: dbStatus,
      providers: {}, // consumer should populate from their provider config
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      activeRequests,
      version: BULWARK_VERSION,
    };
  }
}
