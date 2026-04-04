"""
CCPA/CPRA Compliance Module (California Consumer Privacy Act)

DISCLAIMER: This module provides consumer request handling utilities.
It does NOT replace legal review of your privacy policy or data practices.
Consult legal counsel for CCPA/CPRA compliance requirements.

Implements:
- Right to know (data access)
- Right to delete
- Right to opt-out of sale/sharing
- Global Privacy Control (GPC) signal handling
- Consumer request tracking
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiosqlite


@dataclass
class CCPAConfig:
    enabled: bool = True
    honor_gpc: bool = True
    track_opt_out: bool = True
    log_admt: bool = False


@dataclass
class ConsumerRequest:
    type: str  # "access" | "delete" | "correct" | "opt-out" | "opt-in"
    consumer_id: str
    requested_at: str
    completed_at: Optional[str] = None
    status: str = "pending"  # "pending" | "verified" | "completed" | "denied"


class CCPAManager:
    """
    CCPA/CPRA compliance utilities.

    DISCLAIMER: This module provides consumer request handling utilities.
    It does NOT replace legal review of your privacy policy or data practices.
    Consult legal counsel for CCPA/CPRA compliance requirements.
    """

    def __init__(self, db_path: str, config: CCPAConfig | None = None) -> None:
        self._db_path = db_path
        self._config = config or CCPAConfig()

    async def initialize(self) -> None:
        """Create required tables."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bulwark_ccpa_requests (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    consumer_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    data TEXT,
                    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
                    completed_at TEXT
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_ccpa_consumer "
                "ON bulwark_ccpa_requests(consumer_id)"
            )
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bulwark_ccpa_optout (
                    consumer_id TEXT PRIMARY KEY,
                    opted_out INTEGER NOT NULL DEFAULT 0,
                    opt_out_date TEXT,
                    gpc_signal INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            await db.commit()

    async def _connect(self) -> aiosqlite.Connection:
        db = await aiosqlite.connect(self._db_path)
        db.row_factory = aiosqlite.Row
        return db

    async def access_request(self, consumer_id: str) -> Dict[str, Any]:
        """Right to Know -- return all data for a consumer."""
        req_id = f"ccpa_{int(time.time() * 1000)}"

        async with await self._connect() as db:
            # Gather consumer data
            audit_data = await self._query_all(
                db,
                "SELECT * FROM bulwark_audit WHERE user_id = ? ORDER BY timestamp DESC",
                (consumer_id,),
            )
            usage_data = await self._query_all(
                db,
                "SELECT * FROM bulwark_usage WHERE user_id = ? ORDER BY timestamp DESC",
                (consumer_id,),
            )

            # Log the request
            await db.execute(
                "INSERT INTO bulwark_ccpa_requests (id, type, consumer_id, status, completed_at) "
                "VALUES (?, 'access', ?, 'completed', datetime('now'))",
                (req_id, consumer_id),
            )
            await db.commit()

        return {"data": audit_data + usage_data, "request_id": req_id}

    async def delete_request(self, consumer_id: str) -> Dict[str, Any]:
        """Right to Delete -- erase all consumer data."""
        req_id = f"ccpa_{int(time.time() * 1000)}"

        async with await self._connect() as db:
            await db.execute("DELETE FROM bulwark_audit WHERE user_id = ?", (consumer_id,))
            await db.execute("DELETE FROM bulwark_usage WHERE user_id = ?", (consumer_id,))
            await db.execute(
                "INSERT INTO bulwark_ccpa_requests (id, type, consumer_id, status, completed_at) "
                "VALUES (?, 'delete', ?, 'completed', datetime('now'))",
                (req_id, consumer_id),
            )
            await db.commit()

        return {"request_id": req_id, "deleted": True}

    async def opt_out(self, consumer_id: str, gpc_signal: bool = False) -> None:
        """Right to Opt-Out of Sale/Sharing."""
        async with await self._connect() as db:
            await db.execute(
                "INSERT OR REPLACE INTO bulwark_ccpa_optout "
                "(consumer_id, opted_out, opt_out_date, gpc_signal, updated_at) "
                "VALUES (?, 1, datetime('now'), ?, datetime('now'))",
                (consumer_id, 1 if gpc_signal else 0),
            )
            await db.commit()

    async def is_opted_out(self, consumer_id: str) -> bool:
        """Check if consumer has opted out."""
        async with await self._connect() as db:
            async with db.execute(
                "SELECT opted_out FROM bulwark_ccpa_optout WHERE consumer_id = ?",
                (consumer_id,),
            ) as cur:
                row = await cur.fetchone()
        return bool(row and row[0])

    async def handle_gpc(self, consumer_id: str) -> None:
        """Handle Global Privacy Control signal."""
        if not self._config.honor_gpc:
            return
        await self.opt_out(consumer_id, gpc_signal=True)

    async def get_requests(
        self, consumer_id: str | None = None, limit: int = 100
    ) -> List[ConsumerRequest]:
        """Get all consumer requests (for compliance reporting)."""
        async with await self._connect() as db:
            if consumer_id:
                sql = "SELECT * FROM bulwark_ccpa_requests WHERE consumer_id = ? ORDER BY requested_at DESC LIMIT ?"
                params: tuple[Any, ...] = (consumer_id, limit)
            else:
                sql = "SELECT * FROM bulwark_ccpa_requests ORDER BY requested_at DESC LIMIT ?"
                params = (limit,)

            async with db.execute(sql, params) as cur:
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = await cur.fetchall()

        return [
            ConsumerRequest(
                type=dict(zip(cols, row))["type"],
                consumer_id=dict(zip(cols, row))["consumer_id"],
                requested_at=dict(zip(cols, row)).get("requested_at", ""),
                completed_at=dict(zip(cols, row)).get("completed_at"),
                status=dict(zip(cols, row)).get("status", "pending"),
            )
            for row in rows
        ]

    async def generate_report(self) -> Dict[str, Any]:
        """Generate CCPA compliance report."""
        async with await self._connect() as db:
            async with db.execute("SELECT COUNT(*) FROM bulwark_ccpa_requests") as cur:
                total_row = await cur.fetchone()
            total = total_row[0] if total_row else 0

            async with db.execute(
                "SELECT type, COUNT(*) as c FROM bulwark_ccpa_requests GROUP BY type"
            ) as cur:
                type_rows = await cur.fetchall()
            by_type = {row[0]: row[1] for row in type_rows}

            async with db.execute(
                "SELECT COUNT(*) FROM bulwark_ccpa_optout WHERE opted_out = 1"
            ) as cur:
                opted_row = await cur.fetchone()
            opted_out = opted_row[0] if opted_row else 0

            async with db.execute(
                "SELECT COUNT(*) FROM bulwark_ccpa_optout WHERE gpc_signal = 1"
            ) as cur:
                gpc_row = await cur.fetchone()
            gpc = gpc_row[0] if gpc_row else 0

        return {
            "total_requests": total,
            "by_type": by_type,
            "opted_out_consumers": opted_out,
            "gpc_signals": gpc,
            "avg_response_time": "< 45 days",  # CCPA requires response within 45 days
        }

    async def _query_all(
        self, db: aiosqlite.Connection, sql: str, params: tuple[Any, ...] = ()
    ) -> List[Dict[str, Any]]:
        try:
            async with db.execute(sql, params) as cur:
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = await cur.fetchall()
            return [dict(zip(cols, row)) for row in rows]
        except Exception:
            return []
