"""
Budget enforcement — per-user and per-team monthly token limits.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from ..database import Database
from ..types import BudgetAlert, BudgetConfig, UsageRecord

logger = logging.getLogger("bulwark_ai.billing.budgets")

__all__ = ["BudgetManager"]


@dataclass
class BudgetCheck:
    """Result of a budget check."""
    ok: bool
    used: int
    limit: int
    cost_usd: float


class BudgetManager:
    """
    Budget enforcement manager.

    Checks per-user and per-team monthly token budgets.
    Supports alert thresholds with callbacks and block/warn actions.
    """

    def __init__(self, db: Database, config: BudgetConfig) -> None:
        self._db = db
        self._config = config
        self.enabled = config.enabled
        # Tracks which thresholds have already fired per scope to avoid duplicate alerts
        self._crossed_thresholds: Dict[str, Set[float]] = {}

    async def check_budget(
        self,
        *,
        user_id: Optional[str] = None,
        team_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
    ) -> BudgetCheck:
        """Check if a user/team has budget remaining this month."""
        if not self.enabled:
            return BudgetCheck(ok=True, used=0, limit=0, cost_usd=0)

        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        month_str = month_start.isoformat()

        # Check user budget
        if user_id:
            row = await self._db.query_one(
                "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens, "
                "COALESCE(SUM(cost_usd), 0) as total_cost "
                "FROM bulwark_usage WHERE user_id = ? AND timestamp >= ?",
                [user_id, month_str],
            )
            used = int(row["total_tokens"]) if row else 0
            cost = float(row["total_cost"]) if row else 0.0
            limit = self._config.default_user_limit or 0

            if limit > 0 and used >= limit:
                return BudgetCheck(
                    ok=self._config.on_exceeded != "block",
                    used=used,
                    limit=limit,
                    cost_usd=cost,
                )

            # Alert thresholds
            if limit > 0 and self._config.alert_thresholds and self._config.on_alert:
                scope_key = f"user:{user_id}"
                if scope_key not in self._crossed_thresholds:
                    self._crossed_thresholds[scope_key] = set()
                crossed = self._crossed_thresholds[scope_key]
                for threshold in self._config.alert_thresholds:
                    if used / limit >= threshold and threshold not in crossed:
                        crossed.add(threshold)
                        alert = BudgetAlert(
                            type="user",
                            id=user_id,
                            threshold=threshold,
                            used=used,
                            limit=limit,
                            cost_usd=cost,
                        )
                        result = self._config.on_alert(alert)
                        # Support both sync and async callbacks
                        if asyncio.iscoroutine(result):
                            await result

        # Check team budget
        if team_id:
            row = await self._db.query_one(
                "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens, "
                "COALESCE(SUM(cost_usd), 0) as total_cost "
                "FROM bulwark_usage WHERE team_id = ? AND timestamp >= ?",
                [team_id, month_str],
            )
            used = int(row["total_tokens"]) if row else 0
            cost = float(row["total_cost"]) if row else 0.0
            limit = self._config.default_team_limit or 0

            if limit > 0 and used >= limit:
                return BudgetCheck(
                    ok=self._config.on_exceeded != "block",
                    used=used,
                    limit=limit,
                    cost_usd=cost,
                )

        return BudgetCheck(ok=True, used=0, limit=0, cost_usd=0)

    async def record_usage(self, record: UsageRecord) -> None:
        """Record token usage for budget tracking."""
        await self._db.run(
            "INSERT INTO bulwark_usage "
            "(user_id, team_id, tenant_id, model, input_tokens, output_tokens, cost_usd, timestamp) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                record.user_id,
                record.team_id,
                record.tenant_id,
                record.model,
                record.input_tokens,
                record.output_tokens,
                record.cost_usd,
                record.timestamp,
            ],
        )
