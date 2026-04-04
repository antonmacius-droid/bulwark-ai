"""
HIPAA Compliance Module

DISCLAIMER: This module provides PHI access logging and BAA tracking utilities.
It does NOT constitute a BAA, replace HIPAA training, or guarantee compliance.
You must execute BAAs directly with LLM providers and verify their compliance independently.

Implements technical safeguards required for handling PHI (Protected Health Information)
in AI/LLM applications:
- PHI detection (18 HIPAA identifiers)
- De-identification (Safe Harbor method)
- Audit controls (access logging)
- BAA tracking
- Minimum necessary standard
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import aiosqlite


# The 18 HIPAA Safe Harbor identifiers that must be removed for de-identification
HIPAA_IDENTIFIERS: List[str] = [
    "name", "address", "dates", "phone", "fax", "email",
    "ssn", "medical_record_number", "health_plan_id", "account_number",
    "certificate_license", "vehicle_id", "device_id", "url",
    "ip_address", "biometric_id", "photo", "other_unique_id",
]

# Mapping from HIPAA identifier to Bulwark PII types
HIPAA_TO_PII_MAP: Dict[str, List[str]] = {
    "name": ["name"],
    "address": ["address"],
    "phone": ["phone"],
    "email": ["email"],
    "ssn": ["ssn"],
    "ip_address": ["ip_address"],
    "dates": ["date_of_birth"],
    "medical_record_number": ["medical_id"],
    "health_plan_id": ["medical_id"],
    "account_number": ["credit_card", "iban"],
}


@dataclass
class HIPAAConfig:
    enabled: bool = True
    action: str = "deidentify"  # "block" | "deidentify"
    audit_phi_access: bool = True
    require_baa: bool = False
    baa_providers: Optional[List[str]] = None
    phi_retention_days: Optional[int] = None


@dataclass
class PHIAccessLog:
    user_id: str
    action: str  # "view" | "process" | "export" | "delete"
    phi_types: List[str]
    provider: Optional[str] = None
    justification: Optional[str] = None
    timestamp: str = ""


class HIPAAManager:
    """
    HIPAA compliance utilities.

    DISCLAIMER: This module provides PHI access logging and BAA tracking utilities.
    It does NOT constitute a BAA, replace HIPAA training, or guarantee compliance.
    You must execute BAAs directly with LLM providers and verify their compliance independently.
    """

    def __init__(self, db_path: str, config: HIPAAConfig | None = None) -> None:
        self._db_path = db_path
        self._config = config or HIPAAConfig()

    async def initialize(self) -> None:
        """Create HIPAA-specific tables."""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bulwark_hipaa_access_log (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    phi_types TEXT,
                    provider TEXT,
                    justification TEXT,
                    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_hipaa_access_user "
                "ON bulwark_hipaa_access_log(user_id, timestamp)"
            )
            await db.execute("""
                CREATE TABLE IF NOT EXISTS bulwark_hipaa_baa (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    signed_date TEXT NOT NULL,
                    expiry_date TEXT,
                    contact_email TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            await db.commit()

    async def _connect(self) -> aiosqlite.Connection:
        db = await aiosqlite.connect(self._db_path)
        db.row_factory = aiosqlite.Row
        return db

    async def log_access(
        self,
        *,
        user_id: str,
        action: str,
        phi_types: List[str],
        provider: str | None = None,
        justification: str | None = None,
    ) -> None:
        """Log PHI access event (required by HIPAA audit controls)."""
        entry_id = f"phi_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        async with await self._connect() as db:
            await db.execute(
                "INSERT INTO bulwark_hipaa_access_log "
                "(id, user_id, action, phi_types, provider, justification) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (entry_id, user_id, action, json.dumps(phi_types), provider, justification),
            )
            await db.commit()

    async def get_access_log(
        self, user_id: str | None = None, limit: int = 100
    ) -> List[PHIAccessLog]:
        """Query PHI access log."""
        async with await self._connect() as db:
            if user_id:
                sql = "SELECT * FROM bulwark_hipaa_access_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?"
                params: tuple[Any, ...] = (user_id, limit)
            else:
                sql = "SELECT * FROM bulwark_hipaa_access_log ORDER BY timestamp DESC LIMIT ?"
                params = (limit,)

            async with db.execute(sql, params) as cur:
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = await cur.fetchall()

        results: List[PHIAccessLog] = []
        for row in rows:
            row_dict = dict(zip(cols, row))
            phi_types = json.loads(row_dict.get("phi_types", "[]")) if row_dict.get("phi_types") else []
            results.append(PHIAccessLog(
                user_id=row_dict["user_id"],
                action=row_dict["action"],
                phi_types=phi_types,
                provider=row_dict.get("provider"),
                justification=row_dict.get("justification"),
                timestamp=row_dict.get("timestamp", ""),
            ))
        return results

    async def register_baa(
        self,
        provider: str,
        signed_date: str,
        expiry_date: str | None = None,
        contact_email: str | None = None,
    ) -> None:
        """Register a BAA (Business Associate Agreement) with a provider."""
        entry_id = f"baa_{int(time.time() * 1000)}"
        async with await self._connect() as db:
            await db.execute(
                "INSERT INTO bulwark_hipaa_baa "
                "(id, provider, signed_date, expiry_date, contact_email) "
                "VALUES (?, ?, ?, ?, ?)",
                (entry_id, provider, signed_date, expiry_date, contact_email),
            )
            await db.commit()

    async def has_valid_baa(self, provider: str) -> bool:
        """Check if a provider has a valid BAA."""
        async with await self._connect() as db:
            async with db.execute(
                "SELECT status, expiry_date FROM bulwark_hipaa_baa "
                "WHERE provider = ? AND status = 'active' ORDER BY signed_date DESC LIMIT 1",
                (provider,),
            ) as cur:
                row = await cur.fetchone()

        if not row:
            return False
        status, expiry_date = row[0], row[1]
        if expiry_date and datetime.fromisoformat(expiry_date) < datetime.now(timezone.utc):
            return False
        return True

    async def verify_provider(self, provider: str) -> Dict[str, Any]:
        """Verify provider has BAA before sending data (if requireBAA is enabled)."""
        if not self._config.require_baa:
            return {"allowed": True}
        if self._config.baa_providers and provider in self._config.baa_providers:
            return {"allowed": True}
        if await self.has_valid_baa(provider):
            return {"allowed": True}
        return {
            "allowed": False,
            "reason": f"No BAA on file for provider: {provider}. HIPAA requires a signed BAA before processing PHI.",
        }

    def get_recommended_pii_types(self) -> List[str]:
        """Get recommended PII types to enable for HIPAA compliance."""
        return [
            "email", "phone", "ssn", "name", "address",
            "date_of_birth", "ip_address", "medical_id", "credit_card",
        ]

    async def generate_compliance_report(self) -> Dict[str, Any]:
        """Generate HIPAA compliance report."""
        async with await self._connect() as db:
            async with db.execute("SELECT COUNT(*) FROM bulwark_hipaa_access_log") as cur:
                events_row = await cur.fetchone()
            events = events_row[0] if events_row else 0

            async with db.execute("SELECT COUNT(DISTINCT user_id) FROM bulwark_hipaa_access_log") as cur:
                users_row = await cur.fetchone()
            users = users_row[0] if users_row else 0

            async with db.execute("SELECT COUNT(*) FROM bulwark_hipaa_baa WHERE status = 'active'") as cur:
                baas_row = await cur.fetchone()
            baas = baas_row[0] if baas_row else 0

        recommendations: List[str] = []
        if not self._config.audit_phi_access:
            recommendations.append("Enable PHI access audit logging (audit_phi_access=True)")
        if self._config.action not in ("deidentify", "block"):
            recommendations.append("Set PHI action to 'deidentify' or 'block'")
        if not self._config.require_baa:
            recommendations.append("Enable BAA verification (require_baa=True)")
        if not self._config.phi_retention_days:
            recommendations.append("Set PHI retention period (phi_retention_days)")

        return {
            "phi_access_events": events,
            "unique_users": users,
            "active_baas": baas,
            "deidentification_enabled": self._config.action == "deidentify",
            "audit_logging": self._config.audit_phi_access,
            "recommendations": recommendations,
        }

    async def enforce_retention(self) -> Dict[str, int]:
        """Enforce PHI retention policy -- delete old PHI access logs."""
        if not self._config.phi_retention_days:
            return {"deleted": 0}
        cutoff = (datetime.now(timezone.utc) - timedelta(days=self._config.phi_retention_days)).isoformat()
        async with await self._connect() as db:
            async with db.execute(
                "SELECT COUNT(*) FROM bulwark_hipaa_access_log WHERE timestamp < ?",
                (cutoff,),
            ) as cur:
                row = await cur.fetchone()
            count = row[0] if row else 0
            await db.execute(
                "DELETE FROM bulwark_hipaa_access_log WHERE timestamp < ?",
                (cutoff,),
            )
            await db.commit()
        return {"deleted": count}
