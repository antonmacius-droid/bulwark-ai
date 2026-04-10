"""
Sliding window rate limiter using the cache store abstraction.
"""

from __future__ import annotations

import math
import time
from typing import Any, Optional

from ..types import RateLimitConfig, RateLimitResult


class RateLimiter:
    """
    Rate limiter with sliding window algorithm.

    Uses any async cache store (MemoryCacheStore or Redis) for state.
    Supports per-user, per-team, per-tenant, and per-IP scoping.
    """

    def __init__(self, store: Any, config: RateLimitConfig) -> None:
        self._store = store
        self._config = config

    async def check(
        self,
        *,
        user_id: str | None = None,
        team_id: str | None = None,
        tenant_id: str | None = None,
        ip: str | None = None,
    ) -> RateLimitResult:
        """
        Check and consume a rate limit token.

        Returns whether the request is allowed, remaining tokens, and reset time.
        """
        if not self._config.enabled:
            return RateLimitResult(allowed=True, remaining=999999, reset_at=0)

        scope_id = self._get_scope_id(
            user_id=user_id, team_id=team_id, tenant_id=tenant_id, ip=ip
        )
        if scope_id is None:
            return RateLimitResult(allowed=True, remaining=999999, reset_at=0)

        window = self._current_window()
        window_key = f"ratelimit:{self._config.scope}:{scope_id}:{window}"

        count = await self._store.incr(window_key)
        # Always set/refresh expiry to ensure the key is cleaned up
        await self._store.expire(window_key, self._config.window_seconds)

        remaining = max(0, self._config.max_requests - count)
        reset_at = int(
            math.ceil(time.time() / self._config.window_seconds)
            * self._config.window_seconds
            * 1000
        )

        return RateLimitResult(
            allowed=count <= self._config.max_requests,
            remaining=remaining,
            reset_at=reset_at,
        )

    def _get_scope_id(
        self,
        *,
        user_id: str | None,
        team_id: str | None,
        tenant_id: str | None,
        ip: str | None,
    ) -> str | None:
        scope = self._config.scope
        if scope == "user":
            return user_id
        elif scope == "team":
            return team_id
        elif scope == "tenant":
            return tenant_id
        elif scope == "ip":
            return ip
        return None

    def _current_window(self) -> int:
        return int(time.time() / self._config.window_seconds)
