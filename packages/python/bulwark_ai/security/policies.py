"""
Content Policy Engine.

Evaluates chat messages against keyword, regex, topic, and token-limit policies.
Supports tenant scoping and per-user/team targeting.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal

from ..types import ChatMessage, ContentPolicy


# ReDoS detection patterns (same as PII module)
_REDOS_NESTED_QUANTIFIER = re.compile(r"\([^)]*[+*][^)]*\)[+*]")
_REDOS_EXCESSIVE_WILDCARDS = re.compile(r"(\.\*){3,}")


@dataclass
class PolicyViolation:
    policy_id: str
    policy_name: str
    action: Literal["block", "warn"]
    matched_pattern: str | None = None


class PolicyEngine:
    """
    Evaluates messages against content policies.

    Supports four policy types:
    - keyword_block: block/warn on keyword matches
    - regex_block: block/warn on regex matches (with ReDoS protection)
    - topic_restriction: block/warn on topic keyword matches
    - max_tokens: block/warn when estimated token count exceeds limit
    """

    def __init__(self, policies: list[ContentPolicy] | None = None) -> None:
        self._policies: list[ContentPolicy] = list(policies or [])

    def get_policies(self) -> list[ContentPolicy]:
        """Return a copy of all policies."""
        return list(self._policies)

    def add_policy(self, policy: ContentPolicy) -> None:
        """Add a policy at runtime."""
        if not policy.id or not policy.name or not policy.type or not policy.action:
            raise ValueError("Policy must have id, name, type, and action")
        if any(p.id == policy.id for p in self._policies):
            raise ValueError(f'Policy with id "{policy.id}" already exists')
        self._policies.append(policy)

    def remove_policy(self, policy_id: str) -> None:
        """Remove a policy by ID."""
        self._policies = [p for p in self._policies if p.id != policy_id]

    def check(
        self,
        messages: list[ChatMessage],
        *,
        user_id: str | None = None,
        team_id: str | None = None,
        tenant_id: str | None = None,
    ) -> list[PolicyViolation]:
        """Check messages against all active policies."""
        violations: list[PolicyViolation] = []
        text = " ".join(m.content for m in messages)

        for policy in self._policies:
            # Tenant scope check
            if policy.tenant_id and policy.tenant_id != tenant_id:
                continue

            # Scope check -- if policy targets specific teams/users, skip if not in scope
            if policy.apply_to:
                users = policy.apply_to.get("users", [])
                teams = policy.apply_to.get("teams", [])
                if teams and (not team_id or team_id not in teams):
                    continue
                if users and (not user_id or user_id not in users):
                    continue

            violated = False
            matched_pattern: str | None = None

            if policy.type == "keyword_block":
                if policy.patterns:
                    lower_text = text.lower()
                    for kw in policy.patterns:
                        if kw.lower() in lower_text:
                            violated = True
                            matched_pattern = kw
                            break

            elif policy.type == "regex_block":
                if policy.regex:
                    # ReDoS protection
                    if _REDOS_NESTED_QUANTIFIER.search(policy.regex):
                        continue
                    if _REDOS_EXCESSIVE_WILDCARDS.search(policy.regex):
                        continue
                    try:
                        regex = re.compile(policy.regex, re.IGNORECASE)
                        m = regex.search(text)
                        if m:
                            violated = True
                            matched_pattern = m.group(0)
                    except re.error:
                        pass  # Invalid regex -- skip

            elif policy.type == "topic_restriction":
                if policy.patterns:
                    lower_text = text.lower()
                    for topic in policy.patterns:
                        if topic.lower() in lower_text:
                            violated = True
                            matched_pattern = topic
                            break

            elif policy.type == "max_tokens":
                if policy.max_tokens:
                    # Conservative estimate: 1 token ~ 3 chars
                    estimated_tokens = math.ceil(len(text) / 3)
                    if estimated_tokens > policy.max_tokens:
                        violated = True
                        matched_pattern = f"{estimated_tokens} tokens (max: {policy.max_tokens})"

            if violated:
                violations.append(PolicyViolation(
                    policy_id=policy.id,
                    policy_name=policy.name,
                    action=policy.action,
                    matched_pattern=matched_pattern,
                ))

        return violations
