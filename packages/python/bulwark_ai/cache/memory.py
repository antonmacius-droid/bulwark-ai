"""
In-memory cache store with TTL, LRU eviction, and background cleanup.

Suitable for single-instance deployments. For multi-instance, use Redis.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from typing import Any, Generic, Optional, TypeVar

T = TypeVar("T")


class _Entry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: Any, expires_at: float | None = None) -> None:
        self.value = value
        self.expires_at = expires_at


class MemoryCacheStore:
    """
    Async in-memory cache with TTL, LRU eviction (max 10K entries), and background cleanup.

    Provides get/set/del/incr operations. All methods are async for interface
    compatibility with Redis-based stores.
    """

    def __init__(self, *, max_entries: int = 10_000, cleanup_interval: float = 60.0) -> None:
        self._max_entries = max_entries
        self._store: OrderedDict[str, _Entry] = OrderedDict()
        self._counters: dict[str, _Entry] = {}
        self._cleanup_interval = cleanup_interval
        self._cleanup_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start background cleanup task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._background_cleanup())

    async def close(self) -> None:
        """Stop background cleanup and clear all data."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        self._store.clear()
        self._counters.clear()

    async def _background_cleanup(self) -> None:
        """Periodically remove expired entries."""
        while True:
            try:
                await asyncio.sleep(self._cleanup_interval)
                self._cleanup()
            except asyncio.CancelledError:
                break

    def _cleanup(self) -> None:
        now = time.time()
        expired_keys = [
            k for k, e in self._store.items()
            if e.expires_at is not None and now > e.expires_at
        ]
        for k in expired_keys:
            del self._store[k]

        expired_counters = [
            k for k, e in self._counters.items()
            if e.expires_at is not None and now > e.expires_at
        ]
        for k in expired_counters:
            del self._counters[k]

    async def get(self, key: str) -> Any | None:
        """Get a cached value. Returns None if not found or expired."""
        entry = self._store.get(key)
        if entry is None:
            return None
        if entry.expires_at is not None and time.time() > entry.expires_at:
            del self._store[key]
            return None
        # Move to end (most recently used)
        self._store.move_to_end(key)
        return entry.value

    async def set(self, key: str, value: Any, ttl_seconds: float | None = None) -> None:
        """Set a value with optional TTL in seconds."""
        # LRU eviction: if at capacity, delete oldest (first) entry
        if len(self._store) >= self._max_entries and key not in self._store:
            self._store.popitem(last=False)

        expires_at = time.time() + ttl_seconds if ttl_seconds else None
        self._store[key] = _Entry(value=value, expires_at=expires_at)
        self._store.move_to_end(key)

    async def delete(self, key: str) -> None:
        """Delete a key from both store and counters."""
        self._store.pop(key, None)
        self._counters.pop(key, None)

    async def incr(self, key: str, by: int = 1) -> int:
        """Increment a counter. Returns the new value."""
        existing = self._counters.get(key)
        current = existing.value if existing else 0
        # Check expiry
        if existing and existing.expires_at is not None and time.time() > existing.expires_at:
            current = 0
        new_val = current + by
        expires_at = existing.expires_at if existing else None
        self._counters[key] = _Entry(value=new_val, expires_at=expires_at)
        return new_val

    async def get_counter(self, key: str) -> int:
        """Get counter value."""
        entry = self._counters.get(key)
        if entry is None:
            return 0
        if entry.expires_at is not None and time.time() > entry.expires_at:
            del self._counters[key]
            return 0
        return entry.value

    async def expire(self, key: str, ttl_seconds: float) -> None:
        """Set expiry on a key (works for both store and counter keys)."""
        expires_at = time.time() + ttl_seconds
        store_entry = self._store.get(key)
        if store_entry:
            store_entry.expires_at = expires_at
        counter_entry = self._counters.get(key)
        if counter_entry:
            counter_entry.expires_at = expires_at
