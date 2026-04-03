import { v4 as uuid } from "uuid";
import type { Database } from "./database";

export interface TenantConfig {
  id: string;
  name: string;
  providerKeys?: Record<string, string>;
  allowedModels?: string[];
  monthlyBudgetUsd?: number;
  policies?: string[];
  settings?: Record<string, unknown>;
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
  create(name: string, settings?: Record<string, unknown>): TenantConfig {
    const id = `tenant_${uuid().slice(0, 8)}`;
    this.db.run(
      "INSERT INTO bulwark_tenants (id, name, settings) VALUES (?, ?, ?)",
      [id, name, settings ? JSON.stringify(settings) : null]
    );
    return { id, name, settings, createdAt: new Date().toISOString() };
  }

  /** Get a tenant by ID */
  get(id: string): TenantConfig | null {
    const row = this.db.queryOne<{ id: string; name: string; settings: string; created_at: string }>(
      "SELECT * FROM bulwark_tenants WHERE id = ?", [id]
    );
    if (!row) return null;
    return { id: row.id, name: row.name, settings: row.settings ? JSON.parse(row.settings) : undefined, createdAt: row.created_at };
  }

  /** List all tenants */
  list(): TenantConfig[] {
    const rows = this.db.queryAll<{ id: string; name: string; settings: string; created_at: string }>(
      "SELECT * FROM bulwark_tenants ORDER BY created_at DESC"
    );
    return rows.map(r => ({ id: r.id, name: r.name, settings: r.settings ? JSON.parse(r.settings) : undefined, createdAt: r.created_at }));
  }

  /** Update tenant settings */
  update(id: string, updates: { name?: string; settings?: Record<string, unknown> }): void {
    if (updates.name) this.db.run("UPDATE bulwark_tenants SET name = ? WHERE id = ?", [updates.name, id]);
    if (updates.settings) this.db.run("UPDATE bulwark_tenants SET settings = ? WHERE id = ?", [JSON.stringify(updates.settings), id]);
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
  getUsage(id: string): { requests: number; tokens: number; costUsd: number; activeUsers: number } {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStr = monthStart.toISOString();

    const usage = this.db.queryOne<{ requests: number; tokens: number; cost: number }>(
      "SELECT COUNT(*) as requests, COALESCE(SUM(input_tokens + output_tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM bulwark_usage WHERE tenant_id = ? AND timestamp >= ?",
      [id, monthStr]
    );
    const users = this.db.queryOne<{ c: number }>(
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
