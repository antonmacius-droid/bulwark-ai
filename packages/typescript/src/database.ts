/**
 * Pluggable database abstraction.
 * SQLite by default (zero-config), Postgres for production.
 */

export interface Database {
  init(): void | Promise<void>;
  run(sql: string, params?: unknown[]): void | Promise<void>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  queryAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): void | Promise<void>;
}

const SCHEMA = `
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
  cost_usd REAL,
  duration_ms INTEGER,
  pii_detections INTEGER,
  policy_violations TEXT,
  metadata TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bulwark_audit_user ON bulwark_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_bulwark_audit_tenant ON bulwark_audit(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bulwark_audit_timestamp ON bulwark_audit(timestamp);
CREATE INDEX IF NOT EXISTS idx_bulwark_audit_action_ts ON bulwark_audit(action, timestamp);
CREATE INDEX IF NOT EXISTS idx_bulwark_audit_provider ON bulwark_audit(provider, timestamp);

CREATE TABLE IF NOT EXISTS bulwark_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  team_id TEXT,
  tenant_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bulwark_usage_user ON bulwark_usage(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_bulwark_usage_team ON bulwark_usage(team_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_bulwark_usage_tenant ON bulwark_usage(tenant_id, timestamp);

CREATE TABLE IF NOT EXISTS bulwark_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'warn',
  apply_to TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulwark_budgets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  monthly_token_limit INTEGER NOT NULL DEFAULT 0,
  monthly_cost_limit REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulwark_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  settings TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulwark_knowledge_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulwark_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  tenant_id TEXT,
  content TEXT NOT NULL,
  embedding BLOB,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bulwark_chunks_source ON bulwark_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_bulwark_chunks_tenant ON bulwark_chunks(tenant_id);
`;

/** SQLite implementation using better-sqlite3 */
class SQLiteDatabase implements Database {
  private db: import("better-sqlite3").Database | null = null;
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  init(): void {
    if (this.db) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require("better-sqlite3");
    this.db = new BetterSqlite3(this.path);
    (this.db as import("better-sqlite3").Database).pragma("journal_mode = WAL");
    (this.db as import("better-sqlite3").Database).exec(SCHEMA);
  }

  run(sql: string, params?: unknown[]): void {
    this.ensureInit();
    (this.db as import("better-sqlite3").Database).prepare(sql).run(...(params || []));
  }

  async queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    this.ensureInit();
    return (this.db as import("better-sqlite3").Database).prepare(sql).get(...(params || [])) as T | undefined;
  }

  async queryAll<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.ensureInit();
    return (this.db as import("better-sqlite3").Database).prepare(sql).all(...(params || [])) as T[];
  }

  close(): void {
    if (this.db) (this.db as import("better-sqlite3").Database).close();
    this.db = null;
  }

  private ensureInit(): void {
    if (!this.db) this.init();
  }
}

/** Create database instance based on connection string */
export function createDatabase(connection: string): Database {
  if (connection.startsWith("postgres://") || connection.startsWith("postgresql://")) {
    console.warn("[bulwark] WARNING: Postgres adapter is EXPERIMENTAL and NOT production-ready. Governance controls may not work reliably. Use SQLite for production until async DB layer ships in v0.2.");
    const { PostgresDatabase } = require("./database-postgres");
    return new PostgresDatabase(connection);
  }

  // Default: SQLite
  const path = connection.replace("sqlite://", "").replace("sqlite:///", "");
  return new SQLiteDatabase(path || "bulwark.db");
}
