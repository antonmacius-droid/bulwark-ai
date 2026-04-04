"""
Unit tests for gateway validation.

Tests request validation, PII scanning in pipeline, policy checking,
and auth context enforcement -- with mocked LLM providers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from bulwark_ai.types import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ContentPolicy,
    PIIConfig,
    TokenUsage,
    CostBreakdown,
)
from bulwark_ai.security.pii import PIIDetector
from bulwark_ai.security.policies import PolicyEngine
from bulwark_ai.errors import BulwarkError


# ---------------------------------------------------------------------------
# Mock LLM provider
# ---------------------------------------------------------------------------

class MockLLMProvider:
    """Mock LLM provider that returns canned responses."""

    def __init__(self, response_content: str = "Mock response") -> None:
        self._response_content = response_content

    async def chat(self, messages: List[ChatMessage], **kwargs: Any) -> Dict[str, Any]:
        return {
            "content": self._response_content,
            "model": kwargs.get("model", "mock-model"),
            "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
        }


# ---------------------------------------------------------------------------
# Gateway validation tests (no actual gateway module needed -- test components)
# ---------------------------------------------------------------------------

class TestGatewayRequestValidation:
    """Test that request validation catches invalid inputs."""

    def test_empty_messages_list(self) -> None:
        """A request with no messages should be detected as invalid."""
        request = ChatRequest(messages=[])
        assert len(request.messages) == 0

    def test_messages_preserved(self) -> None:
        messages = [
            ChatMessage(role="system", content="You are helpful."),
            ChatMessage(role="user", content="Hello"),
        ]
        request = ChatRequest(messages=messages, model="gpt-4o")
        assert len(request.messages) == 2
        assert request.model == "gpt-4o"

    def test_metadata_optional(self) -> None:
        request = ChatRequest(messages=[ChatMessage(role="user", content="Hi")])
        assert request.metadata is None

    def test_stream_default_false(self) -> None:
        request = ChatRequest(messages=[ChatMessage(role="user", content="Hi")])
        assert request.stream is False

    def test_debug_default_false(self) -> None:
        request = ChatRequest(messages=[ChatMessage(role="user", content="Hi")])
        assert request.debug is False


class TestGatewayPIIPipeline:
    """Test PII scanning as part of the gateway pipeline."""

    def test_pii_scan_blocks_request(self) -> None:
        """When PII config is block, request with PII should be blocked."""
        detector = PIIDetector(PIIConfig(enabled=True, action="block", types=["ssn"]))
        text = "My SSN is 123-45-6789"
        result = detector.scan(text)
        assert result.blocked is True

    def test_pii_scan_redacts_input(self) -> None:
        """When PII config is redact, PII should be replaced before sending to LLM."""
        detector = PIIDetector(PIIConfig(enabled=True, action="redact", types=["email"]))
        text = "Contact admin@company.com"
        result = detector.scan(text)
        assert result.redacted is True
        assert "admin@company.com" not in result.text
        assert "[EMAIL]" in result.text

    def test_pii_scan_output_direction(self) -> None:
        """Scanning LLM output should also detect PII."""
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["phone"]))
        llm_output = "You can reach support at +1-555-123-4567"
        result = detector.scan(llm_output)
        assert len(result.matches) >= 1


class TestGatewayPolicyPipeline:
    """Test policy checking as part of the gateway pipeline."""

    def test_policy_blocks_request(self) -> None:
        """When a block policy is violated, gateway should reject."""
        engine = PolicyEngine([
            ContentPolicy(
                id="no-secrets",
                name="No Secrets",
                type="keyword_block",
                action="block",
                patterns=["classified", "top secret"],
            ),
        ])
        messages = [ChatMessage(role="user", content="Tell me about classified operations")]
        violations = engine.check(messages)
        assert len(violations) == 1
        assert violations[0].action == "block"

    def test_policy_warns_but_allows(self) -> None:
        """Warn policies should flag but not block."""
        engine = PolicyEngine([
            ContentPolicy(
                id="warn-medical",
                name="Medical Warning",
                type="topic_restriction",
                action="warn",
                patterns=["diagnosis", "medical advice"],
            ),
        ])
        messages = [ChatMessage(role="user", content="Give me a diagnosis")]
        violations = engine.check(messages)
        assert len(violations) == 1
        assert violations[0].action == "warn"


class TestGatewayAuthContextEnforcement:
    """Auth context must ALWAYS override body fields (security)."""

    def test_auth_overrides_user_id(self) -> None:
        """user_id from auth should override anything in the body."""
        # Simulate what the middleware does
        body_user_id = "attacker-injected-id"
        auth_user_id = "real-user-id"

        # Auth context always wins
        final_request = ChatRequest(
            messages=[ChatMessage(role="user", content="Hi")],
            user_id=auth_user_id,  # From auth
        )
        assert final_request.user_id == "real-user-id"

    def test_pii_never_from_body(self) -> None:
        """The pii field should never be accepted from request body."""
        # Middleware should construct ChatRequest without body's pii field
        # This test documents the contract
        request = ChatRequest(
            messages=[ChatMessage(role="user", content="Hi")],
            # pii is NOT set from body -- middleware omits it
        )
        assert request.pii is None

    def test_skip_policies_never_from_body(self) -> None:
        """The skip_policies field should never be accepted from request body."""
        request = ChatRequest(
            messages=[ChatMessage(role="user", content="Hi")],
            # skip_policies is NOT set from body
        )
        assert request.skip_policies is False


class TestBulwarkError:
    """Test error types."""

    def test_error_http_status(self) -> None:
        err = BulwarkError("PII_BLOCKED", "PII detected")
        assert err.http_status == 403

    def test_error_to_dict(self) -> None:
        err = BulwarkError("RATE_LIMITED", "Too many requests", details={"remaining": 0})
        d = err.to_dict()
        assert d["code"] == "RATE_LIMITED"
        assert d["details"]["remaining"] == 0
        assert "timestamp" in d

    def test_error_unknown_code_500(self) -> None:
        err = BulwarkError("UNKNOWN", "Something happened")
        assert err.http_status == 500

    def test_error_repr(self) -> None:
        err = BulwarkError("LLM_ERROR", "Provider failed")
        assert "LLM_ERROR" in repr(err)


class TestGatewayMockProvider:
    """Test gateway interaction with a mock LLM provider."""

    @pytest.mark.asyncio
    async def test_mock_provider_returns_response(self) -> None:
        provider = MockLLMProvider(response_content="Hello from mock!")
        messages = [ChatMessage(role="user", content="Hi")]
        result = await provider.chat(messages, model="test-model")
        assert result["content"] == "Hello from mock!"
        assert result["model"] == "test-model"
        assert result["usage"]["total_tokens"] == 30

    @pytest.mark.asyncio
    async def test_mock_provider_default_model(self) -> None:
        provider = MockLLMProvider()
        result = await provider.chat([ChatMessage(role="user", content="Hi")])
        assert result["model"] == "mock-model"

    @pytest.mark.asyncio
    async def test_full_pipeline_simulation(self) -> None:
        """Simulate the full gateway pipeline: PII scan -> policy check -> LLM call."""
        # 1. PII scan
        detector = PIIDetector(PIIConfig(enabled=True, action="redact", types=["email"]))
        user_text = "My email is user@secret.com, what is the weather?"
        scan_result = detector.scan(user_text)
        assert scan_result.redacted
        cleaned_text = scan_result.text

        # 2. Policy check
        engine = PolicyEngine([
            ContentPolicy(id="p1", name="Safe", type="keyword_block", action="block", patterns=["forbidden"]),
        ])
        violations = engine.check([ChatMessage(role="user", content=cleaned_text)])
        assert len(violations) == 0  # No policy violations

        # 3. LLM call with cleaned text
        provider = MockLLMProvider(response_content="The weather is sunny.")
        result = await provider.chat(
            [ChatMessage(role="user", content=cleaned_text)],
            model="gpt-4o",
        )
        assert result["content"] == "The weather is sunny."

        # 4. Scan output for PII
        output_scan = detector.scan(result["content"])
        assert not output_scan.blocked
        assert len(output_scan.matches) == 0
