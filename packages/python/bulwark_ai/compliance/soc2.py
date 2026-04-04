"""
SOC 2 Compliance Module

DISCLAIMER: This module provides audit logging, anomaly detection, and change tracking.
It does NOT replace a SOC 2 Type I or Type II audit by an accredited CPA firm.
Use these tools as part of your broader compliance program.

Implements: Immutable audit logs, Change tracking, Health monitoring,
Anomaly detection, Vendor tracking.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

import aiosqlite


BULWARK_VERSION = "0.1.0"

PROVIDER_REGIONS: Dict[str, str] = {
    "openai": "US (Azure regions configurable)",
    "anthropic": "US / EU (region configurable)",
    "mistral": "EU (France)",
    "google": "US / EU (multi-region)",
}


@dataclass
class SOC2Config:
    """SOC 2 configuration."""
    immutable_audit: bool = False
    anomaly_thresholds: Optional[Dict[str, int | float]] = None
    on_anomaly: Optional[Callable[..., Any]] = None


@dataclass
class AnomalyEvent:
    type: str  # "high_request_rate" | "pii_spike" | "cost_spike"
    severity: str  # "low" | "medium" | "high" | "critical"
    user_id: Optional[str] = None
    tenant_id: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = ""


@dataclass
class ChangeLogEntry:
    id: str
    entity_type: str  # "policy" | "budget" | "tenant" | "config"
    entity_id: str
    action: str  # "created" | "updated" | "deleted"
    changed_by: str
    previous_value: Optional[str] = None
    new_value: Optional[str] = None
    timestamp: str = ""


@dataclass
class HealthStatus:
    status: str  # "healthy" | "degraded" | "unhealthy"
    database: str  # "connected" | "error"
    providers: Dict[str, str] = field(default_factory=dict)
    uptime: int = 0
    last_request: Optional[str] = None
    active_requests: int = 0
    version: str = BULWARK_VERSION


@dataclass
class VendorReport:
    providers: List[Dict[str, Any]]
    generated_at: str


class SOC2Manager:
    """
    SOC 2 compliance utilities.

    DISCLAIMER: This module provides audit logging, anomaly detection, and change tracking.
    It does NOT replace a SOC 2 Type I or Type II audit by an accredited CPA firm.
    Use these tools as part of your broader compliance program.
    """

    def __init__(self, db_path: str, config: SOC2Config | None = None) -> None:
        self._db_path = db_path
        self._config = config or SOC2Config()
        self._start_time = time.time()

    async def initialize(self) -> None:
        """Create required tables."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bulwark_change_log (
                    id TEXT PRIMARY KEY,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    changed_by TEXT NOT NULL,
                    previous_value TEXT,
                    new_value TEXT,
                    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_bulwark_changelog_entity "
                "ON bulwark_change_log(entity_type, entity_id)"
            )
            await db.commit()

    async def _connect(self) -> aiosqlite.Connection:
        db = await aiosqlite.connect(self._db_path)
        db.row_factory = aiosqlite.Row
        return db

    async def log_change(
        self,
        *,
        entity_type: str,
        entity_id: str,
        action: str,
        changed_by: str,
        previous_value: str | None = None,
        new_value: str | None = None,
    ) -> None:
        """Log a configuration change (for change management audit trail)."""
        entry_id = f"chg_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        async with await self._connect() as db:
            await db.execute(
                "INSERT INTO bulwark_change_log "
                "(id, entity_type, entity_id, action, changed_by, previous_value, new_value) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (entry_id, entity_type, entity_id, action, changed_by, previous_value, new_value),
            )
            await db.commit()

    async def get_change_history(self, entity_type: str, entity_id: str) -> List[ChangeLogEntry]:
        """Get change history for an entity."""
        async with await self._connect() as db:
            async with db.execute(
                "SELECT * FROM bulwark_change_log WHERE entity_type = ? AND entity_id = ? "
                "ORDER BY timestamp DESC LIMIT 100",
                (entity_type, entity_id),
            ) as cur:
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = await cur.fetchall()

        return [
            ChangeLogEntry(**dict(zip(cols, row)))
            for row in rows
        ]

    async def detect_anomalies(self) -> List[AnomalyEvent]:
        """Run anomaly detection on recent activity."""
        anomalies: List[AnomalyEvent] = []
        thresholds = self._config.anomaly_thresholds or {}
        one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        one_day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

        async with await self._connect() as db:
            # High request rate per user
            max_req = thresholds.get("max_requests_per_user_per_hour")
            if max_req:
                async with db.execute(
                    "SELECT user_id, COUNT(*) as c FROM bulwark_audit "
                    "WHERE timestamp >= ? AND user_id IS NOT NULL GROUP BY user_id HAVING c > ?",
                    (one_hour_ago, max_req),
                ) as cur:
                    rows = await cur.fetchall()
                for row in rows:
                    user_id, count = row[0], row[1]
                    event = AnomalyEvent(
                        type="high_request_rate",
                        severity="critical" if count > max_req * 3 else "high",
                        user_id=user_id,
                        details={"request_count": count, "threshold": max_req, "period": "1h"},
                        timestamp=datetime.now(timezone.utc).isoformat(),
                    )
                    anomalies.append(event)
                    if self._config.on_anomaly:
                        await self._config.on_anomaly(event)

            # PII detection spike
            max_pii = thresholds.get("max_pii_per_hour")
            if max_pii:
                async with db.execute(
                    "SELECT COUNT(*) FROM bulwark_audit WHERE timestamp >= ? AND pii_detections > 0",
                    (one_hour_ago,),
                ) as cur:
                    row = await cur.fetchone()
                pii_count = row[0] if row else 0
                if pii_count > max_pii:
                    event = AnomalyEvent(
                        type="pii_spike",
                        severity="critical",
                        details={"pii_detections": pii_count, "threshold": max_pii, "period": "1h"},
                        timestamp=datetime.now(timezone.utc).isoformat(),
                    )
                    anomalies.append(event)
                    if self._config.on_anomaly:
                        await self._config.on_anomaly(event)

            # Cost spike per user per day
            max_cost = thresholds.get("max_cost_per_user_per_day")
            if max_cost:
                async with db.execute(
                    "SELECT user_id, SUM(cost_usd) as total_cost FROM bulwark_usage "
                    "WHERE timestamp >= ? AND user_id IS NOT NULL "
                    "GROUP BY user_id HAVING total_cost > ?",
                    (one_day_ago, max_cost),
                ) as cur:
                    rows = await cur.fetchall()
                for row in rows:
                    user_id, total_cost = row[0], row[1]
                    event = AnomalyEvent(
                        type="cost_spike",
                        severity="critical" if total_cost > max_cost * 2 else "high",
                        user_id=user_id,
                        details={"cost_usd": total_cost, "threshold": max_cost, "period": "24h"},
                        timestamp=datetime.now(timezone.utc).isoformat(),
                    )
                    anomalies.append(event)
                    if self._config.on_anomaly:
                        await self._config.on_anomaly(event)

        return anomalies

    async def generate_vendor_report(self) -> VendorReport:
        """Generate vendor/sub-processor report for SOC 2 auditors."""
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        async with await self._connect() as db:
            async with db.execute(
                "SELECT provider, COUNT(*) as c, "
                "COALESCE(SUM(input_tokens + output_tokens), 0) as tokens, "
                "COALESCE(SUM(cost_usd), 0) as cost "
                "FROM bulwark_audit WHERE provider IS NOT NULL AND timestamp >= ? "
                "GROUP BY provider",
                (month_start.isoformat(),),
            ) as cur:
                rows = await cur.fetchall()

        providers = [
            {
                "name": row[0],
                "region": PROVIDER_REGIONS.get(row[0], "Unknown"),
                "request_count": row[1],
                "total_tokens": row[2],
                "total_cost": round(row[3], 2),
                "data_types": ["user_prompts", "ai_responses"],
            }
            for row in rows
        ]

        return VendorReport(
            providers=providers,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    async def get_health_status(self, active_requests: int = 0) -> HealthStatus:
        """Health check endpoint data."""
        db_status = "error"
        try:
            async with aiosqlite.connect(self._db_path) as db:
                async with db.execute("SELECT 1") as cur:
                    await cur.fetchone()
                db_status = "connected"
        except Exception:
            pass

        return HealthStatus(
            status="healthy" if db_status == "connected" else "unhealthy",
            database=db_status,
            uptime=int(time.time() - self._start_time),
            active_requests=active_requests,
            version=BULWARK_VERSION,
        )
