"""
Unit tests for the content policy engine.

Covers: keyword_block, regex_block, topic_restriction, max_tokens,
tenant scoping, team/user scoping, add/remove policies, ReDoS protection.
"""

from __future__ import annotations

from typing import List

import pytest

from bulwark_ai.types import ChatMessage, ContentPolicy
from bulwark_ai.security.policies import PolicyEngine, PolicyViolation


class TestPolicyEngineKeyword:
    """keyword_block policy type."""

    def test_block_on_keyword(self, policy_engine: PolicyEngine, simple_messages: List[ChatMessage]) -> None:
        messages = [ChatMessage(role="user", content="This contains a badword")]
        violations = policy_engine.check(messages)
        assert len(violations) >= 1
        assert any(v.policy_id == "block-profanity" for v in violations)

    def test_keyword_case_insensitive(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="This is OFFENSIVE content")]
        violations = policy_engine.check(messages)
        assert any(v.policy_id == "block-profanity" for v in violations)

    def test_no_violation_clean_text(self, policy_engine: PolicyEngine, simple_messages: List[ChatMessage]) -> None:
        violations = policy_engine.check(simple_messages)
        # "Hello, how are you?" should not trigger profanity or SSN policies
        profanity = [v for v in violations if v.policy_id == "block-profanity"]
        assert len(profanity) == 0


class TestPolicyEngineRegex:
    """regex_block policy type."""

    def test_regex_match(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="My SSN is 123-45-6789")]
        violations = policy_engine.check(messages)
        assert any(v.policy_id == "block-ssn-regex" for v in violations)

    def test_regex_no_match(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="No SSN here")]
        violations = policy_engine.check(messages)
        ssn_violations = [v for v in violations if v.policy_id == "block-ssn-regex"]
        assert len(ssn_violations) == 0

    def test_redos_regex_rejected(self) -> None:
        """Regex policies with nested quantifiers should be skipped."""
        engine = PolicyEngine([
            ContentPolicy(
                id="evil-regex",
                name="Evil Regex",
                type="regex_block",
                action="block",
                regex="(a+)+$",
            ),
        ])
        messages = [ChatMessage(role="user", content="a" * 100)]
        violations = engine.check(messages)
        assert len(violations) == 0  # Evil pattern was skipped

    def test_invalid_regex_skipped(self) -> None:
        """Invalid regex should be silently skipped."""
        engine = PolicyEngine([
            ContentPolicy(
                id="broken-regex",
                name="Broken Regex",
                type="regex_block",
                action="block",
                regex="[invalid",
            ),
        ])
        messages = [ChatMessage(role="user", content="anything")]
        violations = engine.check(messages)
        assert len(violations) == 0


class TestPolicyEngineTopicRestriction:
    """topic_restriction policy type."""

    def test_topic_violation(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="Tell me about violence")]
        violations = policy_engine.check(messages)
        assert any(v.policy_id == "topic-restrict" for v in violations)
        topic_v = next(v for v in violations if v.policy_id == "topic-restrict")
        assert topic_v.action == "warn"

    def test_topic_case_insensitive(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="I need WEAPONS info")]
        violations = policy_engine.check(messages)
        assert any(v.policy_id == "topic-restrict" for v in violations)


class TestPolicyEngineMaxTokens:
    """max_tokens policy type."""

    def test_exceed_max_tokens(self, policy_engine: PolicyEngine) -> None:
        # max_tokens = 100, 1 token ~ 3 chars, so 400 chars ~ 134 tokens
        long_text = "x" * 400
        messages = [ChatMessage(role="user", content=long_text)]
        violations = policy_engine.check(messages)
        assert any(v.policy_id == "max-tokens" for v in violations)

    def test_within_max_tokens(self, policy_engine: PolicyEngine) -> None:
        short_text = "Hello"
        messages = [ChatMessage(role="user", content=short_text)]
        violations = policy_engine.check(messages)
        token_violations = [v for v in violations if v.policy_id == "max-tokens"]
        assert len(token_violations) == 0


class TestPolicyEngineScoping:
    """Tenant and team/user scoping."""

    def test_tenant_scoped_policy_matches(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="tenant-secret data")]
        violations = policy_engine.check(messages, tenant_id="tenant-1")
        assert any(v.policy_id == "tenant-scoped" for v in violations)

    def test_tenant_scoped_policy_skipped_wrong_tenant(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="tenant-secret data")]
        violations = policy_engine.check(messages, tenant_id="tenant-2")
        assert not any(v.policy_id == "tenant-scoped" for v in violations)

    def test_tenant_scoped_policy_skipped_no_tenant(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="tenant-secret data")]
        violations = policy_engine.check(messages)
        assert not any(v.policy_id == "tenant-scoped" for v in violations)

    def test_team_scoped_policy_matches(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="secret-team-keyword")]
        violations = policy_engine.check(messages, team_id="team-a")
        assert any(v.policy_id == "team-only" for v in violations)

    def test_team_scoped_policy_skipped_wrong_team(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="secret-team-keyword")]
        violations = policy_engine.check(messages, team_id="team-b")
        assert not any(v.policy_id == "team-only" for v in violations)


class TestPolicyEngineManagement:
    """Add/remove policy at runtime."""

    def test_add_policy(self) -> None:
        engine = PolicyEngine()
        engine.add_policy(ContentPolicy(
            id="new-policy", name="New", type="keyword_block",
            action="warn", patterns=["test"],
        ))
        assert len(engine.get_policies()) == 1

    def test_add_duplicate_policy_raises(self) -> None:
        engine = PolicyEngine([
            ContentPolicy(id="p1", name="P1", type="keyword_block", action="warn"),
        ])
        with pytest.raises(ValueError, match="already exists"):
            engine.add_policy(ContentPolicy(id="p1", name="P1 dup", type="keyword_block", action="warn"))

    def test_add_invalid_policy_raises(self) -> None:
        engine = PolicyEngine()
        with pytest.raises(ValueError, match="must have"):
            engine.add_policy(ContentPolicy(id="", name="", type="keyword_block", action="warn"))

    def test_remove_policy(self, policy_engine: PolicyEngine) -> None:
        initial_count = len(policy_engine.get_policies())
        policy_engine.remove_policy("block-profanity")
        assert len(policy_engine.get_policies()) == initial_count - 1

    def test_get_policies_returns_copy(self, policy_engine: PolicyEngine) -> None:
        policies = policy_engine.get_policies()
        policies.clear()
        assert len(policy_engine.get_policies()) > 0  # Original unaffected


class TestPolicyEngineViolationDetails:
    """Violation output format."""

    def test_violation_has_matched_pattern(self, policy_engine: PolicyEngine) -> None:
        messages = [ChatMessage(role="user", content="badword in message")]
        violations = policy_engine.check(messages)
        v = next(v for v in violations if v.policy_id == "block-profanity")
        assert v.matched_pattern == "badword"
        assert v.action == "block"
        assert v.policy_name == "Block Profanity"

    def test_violation_action_preserved(self) -> None:
        engine = PolicyEngine([
            ContentPolicy(id="w", name="Warn", type="keyword_block", action="warn", patterns=["warning"]),
            ContentPolicy(id="b", name="Block", type="keyword_block", action="block", patterns=["blocking"]),
        ])
        messages = [ChatMessage(role="user", content="warning and blocking")]
        violations = engine.check(messages)
        actions = {v.policy_id: v.action for v in violations}
        assert actions["w"] == "warn"
        assert actions["b"] == "block"
