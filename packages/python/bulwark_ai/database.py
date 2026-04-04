"""
Async SQLite database adapter using aiosqlite.

Creates all bulwark_* tables on init. Provides async run/query helpers.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence

import aiosqlite

logger = logging.getLogger("bulwark_ai.database")

SCHEMA = """
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
"""


class Database:
    """Async SQLite database wrapper using aiosqlite."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: Optional[aiosqlite.Connection] = None

    async def init(self) -> None:
        """Open connection and create schema tables."""
        if self._conn is not None:
            return
        self._conn = await aiosqlite.connect(self._path)
        await self._conn.execute("PRAGMA journal_mode=WAL")
        # Execute each statement separately (aiosqlite.executescript is not async-safe
        # in all versions, so we split and execute)
        for statement in SCHEMA.split(";"):
            stmt = statement.strip()
            if stmt:
                await self._conn.execute(stmt)
        await self._conn.commit()
        logger.debug("Database initialized at %s", self._path)

    async def run(self, sql: str, params: Optional[Sequence[Any]] = None) -> None:
        """Execute a write query (INSERT, UPDATE, DELETE)."""
        assert self._conn is not None, "Database not initialized. Call init() first."
        await self._conn.execute(sql, params or [])
        await self._conn.commit()

    async def query_one(self, sql: str, params: Optional[Sequence[Any]] = None) -> Optional[Dict[str, Any]]:
        """Execute a read query and return the first row as a dict, or None."""
        assert self._conn is not None, "Database not initialized. Call init() first."
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute(sql, params or [])
        row = await cursor.fetchone()
        if row is None:
            return None
        return dict(row)

    async def query_all(self, sql: str, params: Optional[Sequence[Any]] = None) -> List[Dict[str, Any]]:
        """Execute a read query and return all rows as list of dicts."""
        assert self._conn is not None, "Database not initialized. Call init() first."
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute(sql, params or [])
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def close(self) -> None:
        """Close the database connection."""
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
            logger.debug("Database connection closed")
