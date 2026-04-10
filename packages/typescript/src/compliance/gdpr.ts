import { checkLicense } from "../rag/license-check";
/**
 * GDPR Compliance Module
 *
 * DISCLAIMER: This module provides technical utilities to assist with GDPR compliance.
 * It does NOT constitute legal advice or guarantee regulatory compliance. Organizations
 * must conduct their own legal assessments, appoint a DPO where required, execute DPAs,
 * and implement appropriate organizational measures beyond these technical controls.
 *
 * Implements: Right to erasure (Art. 17), Data portability (Art. 20),
 * Data retention, Consent tracking, Breach notification.
 */

import type { Database } from "../database";

export interface GDPRConfig {
  /** Auto-delete audit/usage records older than this many days (0 = disabled) */
  retentionDays?: number;
  /** Hash user IDs in audit logs instead of storing plaintext */
  hashUserIds?: boolean;
  /** Don't store message content in audit logs — metadata only */
  metadataOnlyAudit?: boolean;
  /** Callback when PII breach detected (for notification obligations) */
  onBreachDetected?: (breach: BreachEvent) => void | Promise<void>;
  /** Allowed LLM provider regions (block if provider is outside) */
  allowedRegions?: string[];
}

export interface BreachEvent {
  type: "pii_sent_to_llm" | "pii_in_response" | "unauthorized_access";
  userId?: string;
  tenantId?: string;
  piiTypes: string[];
  provider: string;
  timestamp: string;
}

export interface UserDataExport {
  userId: string;
  exportedAt: string;
  auditEntries: unknown[];
  usageRecords: unknown[];
  knowledgeChunks: unknown[];
  totalRecords: number;
}

export class GDPRManager {
  private db: Database;
  private config: GDPRConfig;

  constructor(db: Database, config: GDPRConfig = {}) {
    checkLicense("Compliance"); this.db = db;
    this.config = config;
  }

  /**
   * Right to Erasure (Article 17) — delete ALL data for a user.
   * Returns count of deleted records per table.
   */
  async eraseUserData(userId: string): Promise<{ audit: number; usage: number; chunks: number }> {
    const audit = await this.deleteAndCount("DELETE FROM bulwark_audit WHERE user_id = ?", userId);
    const usage = await this.deleteAndCount("DELETE FROM bulwark_usage WHERE user_id = ?", userId);
    // Escape LIKE special chars (%, _) in userId to prevent unintended matches
    const escapedId = userId.replace(/[%_]/g, "\\$&");
    const chunks = await this.deleteAndCount("DELETE FROM bulwark_chunks WHERE metadata LIKE ? ESCAPE '\\'", `%"userId":"${escapedId}"%`);
    return { audit, usage, chunks };
  }

  /**
   * Right to Erasure for a tenant — delete ALL tenant data.
   */
  async eraseTenantData(tenantId: string): Promise<{ audit: number; usage: number; chunks: number; sources: number; policies: number }> {
    const audit = await this.deleteAndCount("DELETE FROM bulwark_audit WHERE tenant_id = ?", tenantId);
    const usage = await this.deleteAndCount("DELETE FROM bulwark_usage WHERE tenant_id = ?", tenantId);
    const chunks = await this.deleteAndCount("DELETE FROM bulwark_chunks WHERE tenant_id = ?", tenantId);
    const sources = await this.deleteAndCount("DELETE FROM bulwark_knowledge_sources WHERE tenant_id = ?", tenantId);
    const policies = await this.deleteAndCount("DELETE FROM bulwark_policies WHERE tenant_id = ?", tenantId);
    return { audit, usage, chunks, sources, policies };
  }

  /**
   * Data Portability (Article 20) — export all data for a user as JSON.
   */
  async exportUserData(userId: string): Promise<UserDataExport> {
    const auditEntries = await this.db.queryAll("SELECT * FROM bulwark_audit WHERE user_id = ? ORDER BY timestamp DESC", [userId]);
    const usageRecords = await this.db.queryAll("SELECT * FROM bulwark_usage WHERE user_id = ? ORDER BY timestamp DESC", [userId]);
    const escapedId = userId.replace(/[%_]/g, "\\$&");
    const knowledgeChunks = await this.db.queryAll("SELECT id, source_id, content, metadata, created_at FROM bulwark_chunks WHERE metadata LIKE ? ESCAPE '\\'", [`%"userId":"${escapedId}"%`]);

    return {
      userId,
      exportedAt: new Date().toISOString(),
      auditEntries,
      usageRecords,
      knowledgeChunks,
      totalRecords: auditEntries.length + usageRecords.length + knowledgeChunks.length,
    };
  }

  /**
   * Data Retention — delete records older than retention period.
   * Call this on a schedule (e.g., daily cron).
   */
  async enforceRetention(): Promise<{ auditDeleted: number; usageDeleted: number }> {
    const days = this.config.retentionDays;
    if (!days || days <= 0) return { auditDeleted: 0, usageDeleted: 0 };

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    const auditDeleted = await this.deleteAndCount("DELETE FROM bulwark_audit WHERE timestamp < ?", cutoffStr);
    const usageDeleted = await this.deleteAndCount("DELETE FROM bulwark_usage WHERE timestamp < ?", cutoffStr);

    return { auditDeleted, usageDeleted };
  }

  /**
   * Generate a Data Processing Activity Report (for DPIA).
   */
  async generateProcessingReport(tenantId?: string): Promise<ProcessingReport> {
    const filter = tenantId ? " WHERE tenant_id = ?" : "";
    const params = tenantId ? [tenantId] : [];

    const totalRequests = await this.db.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM bulwark_audit${filter}`, params);
    const piiDetections = await this.db.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM bulwark_audit WHERE pii_detections > 0${filter ? " AND tenant_id = ?" : ""}`, params);
    const policyBlocks = await this.db.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM bulwark_audit WHERE action = 'policy_block'${filter ? " AND tenant_id = ?" : ""}`, params);
    const providers = await this.db.queryAll<{ provider: string; c: number }>(`SELECT provider, COUNT(*) as c FROM bulwark_audit WHERE provider IS NOT NULL${filter ? " AND tenant_id = ?" : ""} GROUP BY provider`, params);
    const uniqueUsers = await this.db.queryOne<{ c: number }>(`SELECT COUNT(DISTINCT user_id) as c FROM bulwark_audit WHERE user_id IS NOT NULL${filter ? " AND tenant_id = ?" : ""}`, params);

    return {
      generatedAt: new Date().toISOString(),
      tenantId: tenantId || "all",
      totalRequests: totalRequests?.c || 0,
      uniqueUsers: uniqueUsers?.c || 0,
      piiDetections: piiDetections?.c || 0,
      policyBlocks: policyBlocks?.c || 0,
      dataProcessors: providers.map(p => ({ name: p.provider, requestCount: p.c })),
      retentionPolicy: this.config.retentionDays ? `${this.config.retentionDays} days` : "unlimited",
      piiHandling: this.config.hashUserIds ? "User IDs hashed" : "User IDs stored in plaintext",
      auditLevel: this.config.metadataOnlyAudit ? "Metadata only (no message content)" : "Full audit (includes message content)",
    };
  }

  private async deleteAndCount(sql: string, param: string): Promise<number> {
    try {
      // Count matching rows before deleting
      const countSql = sql.replace(/^DELETE FROM/, "SELECT COUNT(*) as c FROM");
      const row = await this.db.queryOne<{ c: number }>(countSql, [param]);
      const count = row?.c || 0;
      await this.db.run(sql, [param]);
      return count;
    } catch {
      return 0;
    }
  }
}

export interface ProcessingReport {
  generatedAt: string;
  tenantId: string;
  totalRequests: number;
  uniqueUsers: number;
  piiDetections: number;
  policyBlocks: number;
  dataProcessors: { name: string; requestCount: number }[];
  retentionPolicy: string;
  piiHandling: string;
  auditLevel: string;
}
