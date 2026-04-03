/**
 * PostgreSQL database adapter.
 * Requires `pg` as a peer dependency.
 *
 * @example
 * ```ts
 * const gateway = new AIGateway({
 *   database: "postgres://user:pass@localhost/bulwark",
 * });
 * ```
 */

import type { Database } from "./database";

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS bulwark_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  user_id TEXT,
  team_id TEXT,
  action TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd DOUBLE PRECISION,
  duration_ms INTEGER,
  pii_detections INTEGER,
  policy_violations JSONB,
  metadata JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bulwark_audit_user ON bulwark_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_bulwark_audit_tenant ON bulwark_audit(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bulwark_audit_ts ON bulwark_audit(timestamp);

CREATE TABLE IF NOT EXISTS bulwark_usage (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  team_id TEXT,
  tenant_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bulwark_usage_user ON bulwark_usage(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_bulwark_usage_team ON bulwark_usage(team_id, timestamp);

CREATE TABLE IF NOT EXISTS bulwark_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config JSONB NOT NULL,
  action TEXT NOT NULL DEFAULT 'warn',
  apply_to JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bulwark_budgets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  monthly_token_limit INTEGER NOT NULL DEFAULT 0,
  monthly_cost_limit DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bulwark_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  settings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bulwark_knowledge_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bulwark_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES bulwark_knowledge_sources(id),
  tenant_id TEXT,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bulwark_chunks_source ON bulwark_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_bulwark_chunks_tenant ON bulwark_chunks(tenant_id);
`;

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

export class PostgresDatabase implements Database {
  private pool: PgPool | null = null;
  private connectionString: string;
  private poolConfig: { max: number; idleTimeoutMillis: number; connectionTimeoutMillis: number };
  private _initialized = false;
  private _initPromise: Promise<void> | null = null;

  constructor(connectionString: string, poolConfig?: { max?: number; idleTimeoutMillis?: number; connectionTimeoutMillis?: number }) {
    this.connectionString = connectionString;
    this.poolConfig = {
      max: poolConfig?.max || 20,
      idleTimeoutMillis: poolConfig?.idleTimeoutMillis || 30_000,
      connectionTimeoutMillis: poolConfig?.connectionTimeoutMillis || 5_000,
    };
  }

  init(): void {
    if (this._initialized) return;
    if (this._initPromise) return; // Already initializing

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg");
    this.pool = new Pool({
      connectionString: this.connectionString,
      ...this.poolConfig,
    }) as PgPool;

    // Run schema — store promise so callers can await if needed
    this._initPromise = this.runAsync(PG_SCHEMA)
      .then(() => { this._initialized = true; })
      .catch(err => {
        console.error("[Bulwark] Postgres schema initialization failed:", err);
        this._initPromise = null; // Allow retry
      });
  }

  run(sql: string, params?: unknown[]): void {
    if (!this.pool) throw new Error("[Bulwark] Postgres not initialized — call init() first");
    this.pool.query(sql, params).catch(err => console.error("[Bulwark] Postgres write error:", err));
  }

  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    // Note: sync interface limitation with Postgres — use queryOneAsync for production
    // This blocks the event loop and should be avoided in hot paths
    if (!this.pool) return undefined;
    let result: T | undefined;
    this.pool.query(sql, params)
      .then(r => { result = (r.rows as T[])[0]; })
      .catch(() => {});
    return result;
  }

  queryAll<T>(sql: string, params?: unknown[]): T[] {
    if (!this.pool) return [];
    let result: T[] = [];
    this.pool.query(sql, params)
      .then(r => { result = r.rows as T[]; })
      .catch(() => {});
    return result;
  }

  close(): void {
    if (this.pool) this.pool.end().catch(() => {});
    this.pool = null;
  }

  /** Async query — preferred for Postgres */
  async runAsync(sql: string, params?: unknown[]): Promise<void> {
    if (!this.pool) throw new Error("[Bulwark] Postgres not initialized");
    await this.pool.query(sql, params);
  }

  async queryOneAsync<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    if (!this.pool) throw new Error("[Bulwark] Postgres not initialized");
    const result = await this.pool.query(sql, params);
    return (result.rows as T[])[0];
  }

  async queryAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.pool) throw new Error("[Bulwark] Postgres not initialized");
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }
}
