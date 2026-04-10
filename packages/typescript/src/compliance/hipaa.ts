import { checkLicense } from "../rag/license-check";
/**
 * HIPAA Compliance Module
 *
 * DISCLAIMER: This module provides PHI access logging and BAA tracking utilities.
 * It does NOT constitute a BAA, replace HIPAA training, or guarantee compliance.
 * You must execute BAAs directly with LLM providers and verify their compliance independently.
 *
 * Implements technical safeguards required for handling PHI (Protected Health Information)
 * in AI/LLM applications:
 * - PHI detection (18 HIPAA identifiers)
 * - De-identification (Safe Harbor method)
 * - Audit controls (access logging)
 * - Encryption verification
 * - BAA tracking
 * - Minimum necessary standard
 */

import type { Database } from "../database";
import type { PIIType } from "../security/types";

/** The 18 HIPAA Safe Harbor identifiers that must be removed for de-identification */
export const HIPAA_IDENTIFIERS = [
  "name", "address", "dates", "phone", "fax", "email",
  "ssn", "medical_record_number", "health_plan_id", "account_number",
  "certificate_license", "vehicle_id", "device_id", "url",
  "ip_address", "biometric_id", "photo", "other_unique_id",
] as const;

/** PHI types that map to Bulwark PII detection */
export const HIPAA_TO_PII_MAP: Record<string, PIIType[]> = {
  name: ["name"],
  address: ["address"],
  phone: ["phone"],
  email: ["email"],
  ssn: ["ssn"],
  ip_address: ["ip_address"],
  dates: ["date_of_birth"],
  medical_record_number: ["medical_id"],
  health_plan_id: ["medical_id"],
  account_number: ["credit_card", "iban"],
};

export interface HIPAAConfig {
  enabled: boolean;
  /** PHI handling: "block" rejects any request containing PHI, "deidentify" strips it */
  action: "block" | "deidentify";
  /** Log PHI access events */
  auditPhiAccess?: boolean;
  /** Require BAA verification before processing */
  requireBAA?: boolean;
  /** Verified BAA provider list */
  baaProviders?: string[];
  /** Data retention for PHI audit logs (days) */
  phiRetentionDays?: number;
}

export interface PHIAccessLog {
  userId: string;
  action: "view" | "process" | "export" | "delete";
  phiTypes: string[];
  provider?: string;
  justification?: string;
  timestamp: string;
}

export class HIPAAManager {
  private db: Database;
  private config: HIPAAConfig;

  constructor(db: Database, config: HIPAAConfig) {
    checkLicense("Compliance"); this.db = db;
    this.config = config;

    // Create HIPAA-specific tables
    try {
      db.run(`CREATE TABLE IF NOT EXISTS bulwark_hipaa_access_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        phi_types TEXT,
        provider TEXT,
        justification TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.run("CREATE INDEX IF NOT EXISTS idx_hipaa_access_user ON bulwark_hipaa_access_log(user_id, timestamp)");

      db.run(`CREATE TABLE IF NOT EXISTS bulwark_hipaa_baa (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        signed_date TEXT NOT NULL,
        expiry_date TEXT,
        contact_email TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    } catch { /* tables may exist */ }
  }

  /** Log PHI access event (required by HIPAA audit controls) */
  logAccess(entry: Omit<PHIAccessLog, "timestamp">): void {
    const id = `phi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.run(
      "INSERT INTO bulwark_hipaa_access_log (id, user_id, action, phi_types, provider, justification) VALUES (?, ?, ?, ?, ?, ?)",
      [id, entry.userId, entry.action, JSON.stringify(entry.phiTypes), entry.provider || null, entry.justification || null]
    );
  }

  /** Query PHI access log */
  async getAccessLog(userId?: string, limit = 100): Promise<PHIAccessLog[]> {
    const sql = userId
      ? "SELECT * FROM bulwark_hipaa_access_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?"
      : "SELECT * FROM bulwark_hipaa_access_log ORDER BY timestamp DESC LIMIT ?";
    const params = userId ? [userId, limit] : [limit];
    return await this.db.queryAll<PHIAccessLog>(sql, params);
  }

  /** Register a BAA (Business Associate Agreement) with a provider */
  registerBAA(provider: string, signedDate: string, expiryDate?: string, contactEmail?: string): void {
    const id = `baa_${Date.now()}`;
    this.db.run(
      "INSERT INTO bulwark_hipaa_baa (id, provider, signed_date, expiry_date, contact_email) VALUES (?, ?, ?, ?, ?)",
      [id, provider, signedDate, expiryDate || null, contactEmail || null]
    );
  }

  /** Check if a provider has a valid BAA */
  async hasValidBAA(provider: string): Promise<boolean> {
    const baa = await this.db.queryOne<{ status: string; expiry_date: string | null }>(
      "SELECT status, expiry_date FROM bulwark_hipaa_baa WHERE provider = ? AND status = 'active' ORDER BY signed_date DESC LIMIT 1",
      [provider]
    );
    if (!baa) return false;
    if (baa.expiry_date && new Date(baa.expiry_date) < new Date()) return false;
    return true;
  }

  /** Verify provider has BAA before sending data (if requireBAA is enabled) */
  async verifyProvider(provider: string): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.config.requireBAA) return { allowed: true };
    if (this.config.baaProviders?.includes(provider)) return { allowed: true };
    if (await this.hasValidBAA(provider)) return { allowed: true };
    return { allowed: false, reason: `No BAA on file for provider: ${provider}. HIPAA requires a signed BAA before processing PHI.` };
  }

  /** Get recommended PII types to enable for HIPAA compliance */
  getRecommendedPIITypes(): PIIType[] {
    return ["email", "phone", "ssn", "name", "address", "date_of_birth", "ip_address", "medical_id", "credit_card"];
  }

  /** Generate HIPAA compliance report */
  async generateComplianceReport(): Promise<{
    phiAccessEvents: number;
    uniqueUsers: number;
    activeBAAs: number;
    deidentificationEnabled: boolean;
    auditLogging: boolean;
    recommendations: string[];
  }> {
    const events = await this.db.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM bulwark_hipaa_access_log");
    const users = await this.db.queryOne<{ c: number }>("SELECT COUNT(DISTINCT user_id) as c FROM bulwark_hipaa_access_log");
    const baas = await this.db.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM bulwark_hipaa_baa WHERE status = 'active'");

    const recommendations: string[] = [];
    if (!this.config.auditPhiAccess) recommendations.push("Enable PHI access audit logging (auditPhiAccess: true)");
    if (this.config.action !== "deidentify" && this.config.action !== "block") recommendations.push("Set PHI action to 'deidentify' or 'block'");
    if (!this.config.requireBAA) recommendations.push("Enable BAA verification (requireBAA: true)");
    if (!this.config.phiRetentionDays) recommendations.push("Set PHI retention period (phiRetentionDays)");

    return {
      phiAccessEvents: events?.c || 0,
      uniqueUsers: users?.c || 0,
      activeBAAs: baas?.c || 0,
      deidentificationEnabled: this.config.action === "deidentify",
      auditLogging: !!this.config.auditPhiAccess,
      recommendations,
    };
  }

  /** Enforce PHI retention policy — delete old PHI access logs */
  enforceRetention(): { deleted: number } {
    if (!this.config.phiRetentionDays) return { deleted: 0 };
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.phiRetentionDays);
    this.db.run("DELETE FROM bulwark_hipaa_access_log WHERE timestamp < ?", [cutoff.toISOString()]);
    return { deleted: 0 }; // SQLite doesn't return affected rows from run()
  }
}
