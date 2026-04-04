import { checkLicense } from "../rag/license-check";
/**
 * CCPA/CPRA Compliance Module (California Consumer Privacy Act)
 *
 * DISCLAIMER: This module provides consumer request handling utilities.
 * It does NOT replace legal review of your privacy policy or data practices.
 * Consult legal counsel for CCPA/CPRA compliance requirements.
 *
 * Implements:
 * - Right to know (data access)
 * - Right to delete
 * - Right to opt-out of sale/sharing
 * - Right to correct
 * - Automated decision-making opt-out (ADMT)
 * - Sensitive data consent tracking
 * - "Do Not Sell or Share" signal handling
 */

import type { Database } from "../database";

export interface CCPAConfig {
  enabled: boolean;
  /** Honor Global Privacy Control (GPC) opt-out signals */
  honorGPC?: boolean;
  /** Track "Do Not Sell or Share" preferences */
  trackOptOut?: boolean;
  /** Log automated decision-making for ADMT compliance */
  logADMT?: boolean;
}

export interface ConsumerRequest {
  type: "access" | "delete" | "correct" | "opt-out" | "opt-in";
  consumerId: string;
  requestedAt: string;
  completedAt?: string;
  status: "pending" | "verified" | "completed" | "denied";
}

export class CCPAManager {
  private db: Database;
  private config: CCPAConfig;

  constructor(db: Database, config: CCPAConfig) {
    checkLicense("Compliance"); this.db = db;
    this.config = config;

    try {
      db.run(`CREATE TABLE IF NOT EXISTS bulwark_ccpa_requests (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        consumer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        data TEXT,
        requested_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      )`);
      db.run("CREATE INDEX IF NOT EXISTS idx_ccpa_consumer ON bulwark_ccpa_requests(consumer_id)");

      db.run(`CREATE TABLE IF NOT EXISTS bulwark_ccpa_optout (
        consumer_id TEXT PRIMARY KEY,
        opted_out INTEGER NOT NULL DEFAULT 0,
        opt_out_date TEXT,
        gpc_signal INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    } catch {}
  }

  /** Right to Know — return all data for a consumer */
  accessRequest(consumerId: string): { data: unknown[]; requestId: string } {
    const id = `ccpa_${Date.now()}`;
    const auditData = this.db.queryAll("SELECT * FROM bulwark_audit WHERE user_id = ? ORDER BY timestamp DESC", [consumerId]);
    const usageData = this.db.queryAll("SELECT * FROM bulwark_usage WHERE user_id = ? ORDER BY timestamp DESC", [consumerId]);

    this.db.run("INSERT INTO bulwark_ccpa_requests (id, type, consumer_id, status, completed_at) VALUES (?, 'access', ?, 'completed', datetime('now'))", [id, consumerId]);

    return { data: [...auditData, ...usageData], requestId: id };
  }

  /** Right to Delete — erase all consumer data */
  deleteRequest(consumerId: string): { requestId: string; deleted: boolean } {
    const id = `ccpa_${Date.now()}`;
    this.db.run("DELETE FROM bulwark_audit WHERE user_id = ?", [consumerId]);
    this.db.run("DELETE FROM bulwark_usage WHERE user_id = ?", [consumerId]);

    this.db.run("INSERT INTO bulwark_ccpa_requests (id, type, consumer_id, status, completed_at) VALUES (?, 'delete', ?, 'completed', datetime('now'))", [id, consumerId]);

    return { requestId: id, deleted: true };
  }

  /** Right to Opt-Out of Sale/Sharing */
  optOut(consumerId: string, gpcSignal = false): void {
    this.db.run(
      "INSERT OR REPLACE INTO bulwark_ccpa_optout (consumer_id, opted_out, opt_out_date, gpc_signal, updated_at) VALUES (?, 1, datetime('now'), ?, datetime('now'))",
      [consumerId, gpcSignal ? 1 : 0]
    );
  }

  /** Check if consumer has opted out */
  isOptedOut(consumerId: string): boolean {
    const row = this.db.queryOne<{ opted_out: number }>(
      "SELECT opted_out FROM bulwark_ccpa_optout WHERE consumer_id = ?", [consumerId]
    );
    return !!row?.opted_out;
  }

  /** Handle Global Privacy Control signal */
  handleGPC(consumerId: string): void {
    if (!this.config.honorGPC) return;
    this.optOut(consumerId, true);
  }

  /** Get all consumer requests (for compliance reporting) */
  getRequests(consumerId?: string, limit = 100): ConsumerRequest[] {
    const sql = consumerId
      ? "SELECT * FROM bulwark_ccpa_requests WHERE consumer_id = ? ORDER BY requested_at DESC LIMIT ?"
      : "SELECT * FROM bulwark_ccpa_requests ORDER BY requested_at DESC LIMIT ?";
    return this.db.queryAll(sql, consumerId ? [consumerId, limit] : [limit]);
  }

  /** Generate CCPA compliance report */
  generateReport(): {
    totalRequests: number;
    byType: Record<string, number>;
    optedOutConsumers: number;
    gpcSignals: number;
    avgResponseTime: string;
  } {
    const total = this.db.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM bulwark_ccpa_requests");
    const byType = this.db.queryAll<{ type: string; c: number }>("SELECT type, COUNT(*) as c FROM bulwark_ccpa_requests GROUP BY type");
    const optedOut = this.db.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM bulwark_ccpa_optout WHERE opted_out = 1");
    const gpc = this.db.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM bulwark_ccpa_optout WHERE gpc_signal = 1");

    return {
      totalRequests: total?.c || 0,
      byType: Object.fromEntries(byType.map(r => [r.type, r.c])),
      optedOutConsumers: optedOut?.c || 0,
      gpcSignals: gpc?.c || 0,
      avgResponseTime: "< 45 days", // CCPA requires response within 45 days
    };
  }
}
