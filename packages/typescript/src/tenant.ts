import { v4 as uuid } from "uuid";
import type { Database } from "./database";
import type { PIIType } from "./security/types";

/**
 * Per-tenant governance overrides.
 * Any field left undefined inherits from the global gateway config.
 */
export interface TenantGovConfig {
  /** PII detection overrides */
  pii?: {
    enabled?: boolean;
    action?: "block" | "redact" | "warn";
    types?: PIIType[];
  };
  /** Budget overrides */
  budgets?: {
    enabled?: boolean;
    monthlyTokenLimit?: number;
    monthlyCostLimitUsd?: number;
    onExceeded?: "block" | "warn";
  };
  /** Prompt guard overrides */
  promptGuard?: {
    enabled?: boolean;
    action?: "block" | "warn" | "sanitize";
    sensitivity?: "low" | "medium" | "high";
  };
  /** Allowed models — restricts which models this tenant can use */
  allowedModels?: string[];
  /** Rate limit overrides */
  rateLimit?: {
    enabled?: boolean;
    maxRequests?: number;
    windowSeconds?: number;
  };
  /** Gateway mode override */
  mode?: "strict" | "balanced" | "dev";
  /** Fail mode override */
  failMode?: "fail-closed" | "fail-open";
}

export interface TenantConfig {
  id: string;
  name: string;
  providerKeys?: Record<string, string>;
  allowedModels?: string[];
  monthlyBudgetUsd?: number;
  policies?: string[];
  settings?: Record<string, unknown>;
  /** Typed governance config — stored in settings.governance */
  governance?: TenantGovConfig;
  createdAt?: string;
}

/**
 * Multi-tenant management.
 * Handles tenant CRUD and ensures all queries are scoped by tenant_id.
 */
export class TenantManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Create a new tenant */
  async create(name: string, settings?: Record<string, unknown>): Promise<TenantConfig> {
    const id = `tenant_${uuid().slice(0, 8)}`;
    this.db.run(
      "INSERT INTO bulwark_tenants (id, name, settings) VALUES (?, ?, ?)",
      [id, name, settings ? JSON.stringify(settings) : null]
    );
    return { id, name, settings, createdAt: new Date().toISOString() };
  }

  /** Parse settings JSON into TenantConfig */
  private parseRow(row: { id: string; name: string; settings: string; created_at: string }): TenantConfig {
    const settings = row.settings ? JSON.parse(row.settings) : undefined;
    return {
      id: row.id,
      name: row.name,
      settings,
      governance: settings?.governance as TenantGovConfig | undefined,
      createdAt: row.created_at,
    };
  }

  /** Get a tenant by ID */
  async get(id: string): Promise<TenantConfig | null> {
    const row = await this.db.queryOne<{ id: string; name: string; settings: string; created_at: string }>(
      "SELECT * FROM bulwark_tenants WHERE id = ?", [id]
    );
    if (!row) return null;
    return this.parseRow(row);
  }

  /** List all tenants */
  async list(): Promise<TenantConfig[]> {
    const rows = await this.db.queryAll<{ id: string; name: string; settings: string; created_at: string }>(
      "SELECT * FROM bulwark_tenants ORDER BY created_at DESC"
    );
    return rows.map(r => this.parseRow(r));
  }

  /** Update tenant settings */
  update(id: string, updates: { name?: string; settings?: Record<string, unknown> }): void {
    if (updates.name) this.db.run("UPDATE bulwark_tenants SET name = ? WHERE id = ?", [updates.name, id]);
    if (updates.settings) this.db.run("UPDATE bulwark_tenants SET settings = ? WHERE id = ?", [JSON.stringify(updates.settings), id]);
  }

  /** Get governance config for a tenant */
  async getGovernance(id: string): Promise<TenantGovConfig | undefined> {
    return (await this.get(id))?.governance;
  }

  /** Set governance config for a tenant (merges with existing settings) */
  async setGovernance(id: string, governance: TenantGovConfig): Promise<void> {
    const tenant = await this.get(id);
    if (!tenant) throw new Error(`Tenant not found: ${id}`);
    const settings = { ...(tenant.settings || {}), governance };
    this.db.run("UPDATE bulwark_tenants SET settings = ? WHERE id = ?", [JSON.stringify(settings), id]);
  }

  /** Delete a tenant and ALL its data (transactional) */
  delete(id: string): void {
    this.db.run("BEGIN TRANSACTION", []);
    try {
      this.db.run("DELETE FROM bulwark_chunks WHERE tenant_id = ?", [id]);
      this.db.run("DELETE FROM bulwark_knowledge_sources WHERE tenant_id = ?", [id]);
      this.db.run("DELETE FROM bulwark_usage WHERE tenant_id = ?", [id]);
      this.db.run("DELETE FROM bulwark_audit WHERE tenant_id = ?", [id]);
      this.db.run("DELETE FROM bulwark_policies WHERE tenant_id = ?", [id]);
      this.db.run("DELETE FROM bulwark_budgets WHERE tenant_id = ?", [id]);
      this.db.run("DELETE FROM bulwark_tenants WHERE id = ?", [id]);
      this.db.run("COMMIT", []);
    } catch (err) {
      this.db.run("ROLLBACK", []);
      throw err;
    }
  }

  /** Get usage stats for a tenant */
  async getUsage(id: string): Promise<{ requests: number; tokens: number; costUsd: number; activeUsers: number }> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStr = monthStart.toISOString();

    const usage = await this.db.queryOne<{ requests: number; tokens: number; cost: number }>(
      "SELECT COUNT(*) as requests, COALESCE(SUM(input_tokens + output_tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM bulwark_usage WHERE tenant_id = ? AND timestamp >= ?",
      [id, monthStr]
    );
    const users = await this.db.queryOne<{ c: number }>(
      "SELECT COUNT(DISTINCT user_id) as c FROM bulwark_audit WHERE tenant_id = ? AND timestamp >= ?",
      [id, monthStr]
    );

    return {
      requests: usage?.requests || 0,
      tokens: usage?.tokens || 0,
      costUsd: Math.round((usage?.cost || 0) * 100) / 100,
      activeUsers: users?.c || 0,
    };
  }
}
