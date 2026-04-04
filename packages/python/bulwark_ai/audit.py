"""
Audit logging — records all gateway activity for compliance and analytics.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from .database import Database
from .types import AuditEntry, AuditQuery

logger = logging.getLogger("bulwark_ai.audit")

__all__ = ["AuditStore"]


class AuditStore:
    """Async audit log backed by the bulwark_audit table."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def log(
        self,
        *,
        action: str,
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
        team_id: Optional[str] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        cost_usd: Optional[float] = None,
        duration_ms: Optional[float] = None,
        pii_detections: Optional[int] = None,
        policy_violations: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Write an audit log entry and return its ID."""
        entry_id = str(uuid.uuid4())
        await self._db.run(
            """INSERT INTO bulwark_audit
               (id, tenant_id, user_id, team_id, action, model, provider,
                input_tokens, output_tokens, cost_usd, duration_ms,
                pii_detections, policy_violations, metadata, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            [
                entry_id,
                tenant_id,
                user_id,
                team_id,
                action,
                model,
                provider,
                input_tokens,
                output_tokens,
                cost_usd,
                int(duration_ms) if duration_ms is not None else None,
                pii_detections,
                json.dumps(policy_violations) if policy_violations else None,
                json.dumps(metadata) if metadata else None,
            ],
        )
        logger.debug("Audit log: %s action=%s user=%s", entry_id, action, user_id)
        return entry_id

    async def query(self, filters: AuditQuery) -> Dict[str, Any]:
        """Query audit logs with filters. Returns {entries: [...], total: int}."""
        where = "WHERE 1=1"
        params: List[Any] = []

        if filters.tenant_id:
            where += " AND tenant_id = ?"
            params.append(filters.tenant_id)
        if filters.user_id:
            where += " AND user_id = ?"
            params.append(filters.user_id)
        if filters.team_id:
            where += " AND team_id = ?"
            params.append(filters.team_id)
        if filters.action:
            where += " AND action = ?"
            params.append(filters.action)
        if filters.from_time:
            where += " AND timestamp >= ?"
            params.append(filters.from_time)
        if filters.to_time:
            where += " AND timestamp <= ?"
            params.append(filters.to_time)

        total_row = await self._db.query_one(
            f"SELECT COUNT(*) as c FROM bulwark_audit {where}", params
        )
        total = total_row["c"] if total_row else 0

        rows = await self._db.query_all(
            f"SELECT * FROM bulwark_audit {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            [*params, filters.limit, filters.offset],
        )

        entries: List[AuditEntry] = []
        for row in rows:
            pv = None
            if row.get("policy_violations"):
                try:
                    pv = json.loads(row["policy_violations"])
                except (json.JSONDecodeError, TypeError):
                    pv = None
            md = None
            if row.get("metadata"):
                try:
                    md = json.loads(row["metadata"])
                except (json.JSONDecodeError, TypeError):
                    md = None

            entries.append(AuditEntry(
                id=row["id"],
                action=row["action"],
                timestamp=row["timestamp"],
                tenant_id=row.get("tenant_id"),
                user_id=row.get("user_id"),
                team_id=row.get("team_id"),
                model=row.get("model"),
                provider=row.get("provider"),
                input_tokens=row.get("input_tokens"),
                output_tokens=row.get("output_tokens"),
                cost_usd=row.get("cost_usd"),
                duration_ms=row.get("duration_ms"),
                pii_detections=row.get("pii_detections"),
                policy_violations=pv,
                metadata=md,
            ))

        return {"entries": entries, "total": total}
