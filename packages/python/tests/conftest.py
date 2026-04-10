"""Shared fixtures for Bulwark AI Python SDK tests."""

from __future__ import annotations

import os
import tempfile
from typing import Any, Dict, List, Optional

import pytest

from bulwark_ai.types import (
    ChatMessage,
    ChatRequest,
    ContentPolicy,
    PIIConfig,
    RateLimitConfig,
)
from bulwark_ai.security.pii import PIIDetector
from bulwark_ai.security.policies import PolicyEngine
from bulwark_ai.cache.memory import MemoryCacheStore
from bulwark_ai.cache.rate_limiter import RateLimiter


# ---------------------------------------------------------------------------
# PII fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def pii_config_warn() -> PIIConfig:
    """PII config with warn action and common types."""
    return PIIConfig(
        enabled=True,
        action="warn",
        types=["email", "phone", "ssn", "credit_card", "iban"],
    )


@pytest.fixture
def pii_config_redact() -> PIIConfig:
    """PII config with redact action and all types."""
    return PIIConfig(
        enabled=True,
        action="redact",
        types=[
            "email", "phone", "ssn", "credit_card", "iban",
            "ip_address", "passport", "drivers_license",
            "date_of_birth", "address", "name",
            "vat_number", "national_id", "medical_id",
        ],
    )


@pytest.fixture
def pii_config_block() -> PIIConfig:
    """PII config with block action."""
    return PIIConfig(enabled=True, action="block", types=["ssn", "credit_card"])


@pytest.fixture
def pii_detector_warn(pii_config_warn: PIIConfig) -> PIIDetector:
    return PIIDetector(pii_config_warn)


@pytest.fixture
def pii_detector_redact(pii_config_redact: PIIConfig) -> PIIDetector:
    return PIIDetector(pii_config_redact)


@pytest.fixture
def pii_detector_block(pii_config_block: PIIConfig) -> PIIDetector:
    return PIIDetector(pii_config_block)


# ---------------------------------------------------------------------------
# Policy fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_policies() -> List[ContentPolicy]:
    """A representative set of content policies."""
    return [
        ContentPolicy(
            id="block-profanity",
            name="Block Profanity",
            type="keyword_block",
            action="block",
            patterns=["badword", "offensive"],
        ),
        ContentPolicy(
            id="block-ssn-regex",
            name="Block SSN in regex",
            type="regex_block",
            action="block",
            regex=r"\d{3}-\d{2}-\d{4}",
        ),
        ContentPolicy(
            id="topic-restrict",
            name="Restrict Violence",
            type="topic_restriction",
            action="warn",
            patterns=["violence", "weapons"],
        ),
        ContentPolicy(
            id="max-tokens",
            name="Max Tokens",
            type="max_tokens",
            action="block",
            max_tokens=100,
        ),
        ContentPolicy(
            id="team-only",
            name="Team Policy",
            type="keyword_block",
            action="block",
            patterns=["secret-team-keyword"],
            apply_to={"teams": ["team-a"]},
        ),
        ContentPolicy(
            id="tenant-scoped",
            name="Tenant Policy",
            type="keyword_block",
            action="block",
            patterns=["tenant-secret"],
            tenant_id="tenant-1",
        ),
    ]


@pytest.fixture
def policy_engine(sample_policies: List[ContentPolicy]) -> PolicyEngine:
    return PolicyEngine(sample_policies)


# ---------------------------------------------------------------------------
# Cache / rate limiter fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def memory_cache() -> MemoryCacheStore:
    return MemoryCacheStore(max_entries=100)


@pytest.fixture
def rate_limit_config() -> RateLimitConfig:
    return RateLimitConfig(enabled=True, max_requests=5, window_seconds=60, scope="user")


# ---------------------------------------------------------------------------
# Message fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def simple_messages() -> List[ChatMessage]:
    return [
        ChatMessage(role="system", content="You are a helpful assistant."),
        ChatMessage(role="user", content="Hello, how are you?"),
    ]


@pytest.fixture
def messages_with_pii() -> List[ChatMessage]:
    return [
        ChatMessage(role="user", content="My email is test@example.com and SSN is 123-45-6789"),
    ]


# ---------------------------------------------------------------------------
# Temp DB fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_db_path(tmp_path) -> str:
    """Return path to a temporary SQLite database."""
    return str(tmp_path / "test_bulwark.db")
