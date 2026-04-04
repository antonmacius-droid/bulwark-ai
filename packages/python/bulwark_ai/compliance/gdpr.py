"""
GDPR Compliance Module

DISCLAIMER: This module provides technical utilities to ASSIST with GDPR compliance.
It does NOT constitute legal advice or guarantee regulatory compliance. Organizations
must conduct their own legal assessments, appoint a DPO where required, execute DPAs,
and implement appropriate organizational measures beyond these technical controls.

Implements: Right to erasure (Art. 17), Data portability (Art. 20),
Data retention, Processing activity reports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Coroutine, Optional, List, Dict

import aiosqlite


@dataclass
class GDPRConfig:
    """GDPR configuration."""
    retention_days: int = 0  # 0 = disabled
    hash_user_ids: bool = False
    metadata_only_audit: bool = False
    on_breach_detected: Optional[Callable[..., Any]] = None
    allowed_regions: Optional[List[str]] = None


@dataclass
class BreachEvent:
    type: str  # "pii_sent_to_llm" | "pii_in_response" | "unauthorized_access"
    user_id: Optional[str] = None
    tenant_id: Optional[str] = None
    pii_types: List[str] = field(default_factory=list)
    provider: str = ""
    timestamp: str = ""


@dataclass
class UserDataExport:
    user_id: str
    exported_at: str
    audit_entries: List[Dict[str, Any]]
    usage_records: List[Dict[str, Any]]
    knowledge_chunks: List[Dict[str, Any]]
    total_records: int


@dataclass
class ProcessingReport:
    generated_at: str
    tenant_id: str
    total_requests: int
    unique_users: int
    pii_detections: int
    policy_blocks: int
    data_processors: List[Dict[str, Any]]
    retention_policy: str
    pii_handling: str
    audit_level: str


class GDPRManager:
    """
    GDPR compliance utilities.

    DISCLAIMER: This module provides technical utilities to ASSIST with GDPR compliance.
    It does NOT constitute legal advice or guarantee regulatory compliance. Organizations
    must conduct their own legal assessments, appoint a DPO where required, execute DPAs,
    and implement appropriate organizational measures beyond these technical controls.
    """

    def __init__(self, db_path: str, config: GDPRConfig | None = None) -> None:
        self._db_path = db_path
        self._config = config or GDPRConfig()

    async def _connect(self) -> aiosqlite.Connection:
        db = await aiosqlite.connect(self._db_path)
        db.row_factory = aiosqlite.Row
        return db

    async def erase_user_data(self, user_id: str) -> Dict[str, int]:
        """
        Right to Erasure (Article 17) -- delete ALL data for a user.

        Returns count of deleted records per table.
        """
        async with await self._connect() as db:
            audit = await self._delete_and_count(db, "bulwark_audit", "user_id", user_id)
            usage = await self._delete_and_count(db, "bulwark_usage", "user_id", user_id)
            # chunks don't reliably store userId -- best-effort match via metadata
            chunks = await self._delete_and_count_like(
                db, "bulwark_chunks", "metadata", f'%"userId":"{user_id}"%'
            )
            await db.commit()
            return {"audit": audit, "usage": usage, "chunks": chunks}

    async def erase_tenant_data(self, tenant_id: str) -> Dict[str, int]:
        """Right to Erasure for a tenant -- delete ALL tenant data."""
        async with await self._connect() as db:
            audit = await self._delete_and_count(db, "bulwark_audit", "tenant_id", tenant_id)
            usage = await self._delete_and_count(db, "bulwark_usage", "tenant_id", tenant_id)
            chunks = await self._delete_and_count(db, "bulwark_chunks", "tenant_id", tenant_id)
            sources = await self._delete_and_count(db, "bulwark_knowledge_sources", "tenant_id", tenant_id)
            policies = await self._delete_and_count(db, "bulwark_policies", "tenant_id", tenant_id)
            await db.commit()
            return {
                "audit": audit,
                "usage": usage,
                "chunks": chunks,
                "sources": sources,
                "policies": policies,
            }

    async def export_user_data(self, user_id: str) -> UserDataExport:
        """Data Portability (Article 20) -- export all data for a user as structured data."""
        async with await self._connect() as db:
            audit_entries = await self._query_all(
                db,
                "SELECT * FROM bulwark_audit WHERE user_id = ? ORDER BY timestamp DESC",
                (user_id,),
            )
            usage_records = await self._query_all(
                db,
                "SELECT * FROM bulwark_usage WHERE user_id = ? ORDER BY timestamp DESC",
                (user_id,),
            )
            knowledge_chunks = await self._query_all(
                db,
                "SELECT id, source_id, content, metadata, created_at FROM bulwark_chunks WHERE metadata LIKE ?",
                (f'%"userId":"{user_id}"%',),
            )

        return UserDataExport(
            user_id=user_id,
            exported_at=datetime.now(timezone.utc).isoformat(),
            audit_entries=audit_entries,
            usage_records=usage_records,
            knowledge_chunks=knowledge_chunks,
            total_records=len(audit_entries) + len(usage_records) + len(knowledge_chunks),
        )

    async def enforce_retention(self) -> Dict[str, int]:
        """
        Data Retention -- delete records older than retention period.

        Call this on a schedule (e.g., daily cron).
        """
        days = self._config.retention_days
        if not days or days <= 0:
            return {"audit_deleted": 0, "usage_deleted": 0}

        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        async with await self._connect() as db:
            audit_deleted = await self._delete_and_count_where(
                db, "bulwark_audit", "timestamp < ?", cutoff
            )
            usage_deleted = await self._delete_and_count_where(
                db, "bulwark_usage", "timestamp < ?", cutoff
            )
            await db.commit()
            return {"audit_deleted": audit_deleted, "usage_deleted": usage_deleted}

    async def generate_processing_report(self, tenant_id: str | None = None) -> ProcessingReport:
        """Generate a Data Processing Activity Report (for DPIA)."""
        async with await self._connect() as db:
            tenant_filter = " WHERE tenant_id = ?" if tenant_id else ""
            tenant_and = " AND tenant_id = ?" if tenant_id else ""
            params: tuple[Any, ...] = (tenant_id,) if tenant_id else ()

            total = await self._query_scalar(
                db, f"SELECT COUNT(*) FROM bulwark_audit{tenant_filter}", params
            )
            pii = await self._query_scalar(
                db,
                f"SELECT COUNT(*) FROM bulwark_audit WHERE pii_detections > 0{tenant_and}",
                params,
            )
            blocks = await self._query_scalar(
                db,
                f"SELECT COUNT(*) FROM bulwark_audit WHERE action = 'policy_block'{tenant_and}",
                params,
            )
            users = await self._query_scalar(
                db,
                f"SELECT COUNT(DISTINCT user_id) FROM bulwark_audit WHERE user_id IS NOT NULL{tenant_and}",
                params,
            )
            providers = await self._query_all(
                db,
                f"SELECT provider, COUNT(*) as c FROM bulwark_audit WHERE provider IS NOT NULL{tenant_and} GROUP BY provider",
                params,
            )

        return ProcessingReport(
            generated_at=datetime.now(timezone.utc).isoformat(),
            tenant_id=tenant_id or "all",
            total_requests=total,
            unique_users=users,
            pii_detections=pii,
            policy_blocks=blocks,
            data_processors=[{"name": p["provider"], "request_count": p["c"]} for p in providers],
            retention_policy=f"{self._config.retention_days} days" if self._config.retention_days else "unlimited",
            pii_handling="User IDs hashed" if self._config.hash_user_ids else "User IDs stored in plaintext",
            audit_level="Metadata only (no message content)" if self._config.metadata_only_audit else "Full audit (includes message content)",
        )

    # --- internal helpers ---

    async def _delete_and_count(
        self, db: aiosqlite.Connection, table: str, column: str, value: str
    ) -> int:
        try:
            async with db.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {column} = ?", (value,)
            ) as cur:
                row = await cur.fetchone()
            count = row[0] if row else 0
            await db.execute(f"DELETE FROM {table} WHERE {column} = ?", (value,))
            return count
        except Exception:
            return 0

    async def _delete_and_count_like(
        self, db: aiosqlite.Connection, table: str, column: str, pattern: str
    ) -> int:
        try:
            async with db.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {column} LIKE ?", (pattern,)
            ) as cur:
                row = await cur.fetchone()
            count = row[0] if row else 0
            await db.execute(f"DELETE FROM {table} WHERE {column} LIKE ?", (pattern,))
            return count
        except Exception:
            return 0

    async def _delete_and_count_where(
        self, db: aiosqlite.Connection, table: str, where: str, value: str
    ) -> int:
        try:
            async with db.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {where}", (value,)
            ) as cur:
                row = await cur.fetchone()
            count = row[0] if row else 0
            await db.execute(f"DELETE FROM {table} WHERE {where}", (value,))
            return count
        except Exception:
            return 0

    async def _query_all(
        self, db: aiosqlite.Connection, sql: str, params: tuple[Any, ...] = ()
    ) -> List[Dict[str, Any]]:
        try:
            async with db.execute(sql, params) as cur:
                columns = [d[0] for d in cur.description] if cur.description else []
                rows = await cur.fetchall()
            return [dict(zip(columns, row)) for row in rows]
        except Exception:
            return []

    async def _query_scalar(
        self, db: aiosqlite.Connection, sql: str, params: tuple[Any, ...] = ()
    ) -> int:
        try:
            async with db.execute(sql, params) as cur:
                row = await cur.fetchone()
            return row[0] if row else 0
        except Exception:
            return 0
