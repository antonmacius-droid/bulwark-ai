"""
PII (Personally Identifiable Information) detector.

Built-in regex-based detection for 14 PII types, Luhn validation for credit cards,
custom pattern support with ReDoS rejection.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from ..types import PIIConfig

# --- PII type literal ---
PIIType = Literal[
    "email", "phone", "ssn", "credit_card", "iban",
    "ip_address", "passport", "drivers_license",
    "date_of_birth", "address", "name",
    "vat_number", "national_id", "medical_id",
]

ALL_PII_TYPES: list[str] = [
    "email", "phone", "ssn", "credit_card", "iban",
    "ip_address", "passport", "drivers_license",
    "date_of_birth", "address", "name",
    "vat_number", "national_id", "medical_id",
]

DEFAULT_PII_TYPES: list[str] = ["email", "phone", "ssn", "credit_card", "iban"]


@dataclass
class PIIMatch:
    type: str
    value: str  # Always "[REDACTED]" — never store raw PII
    redacted: str
    start: int
    end: int


@dataclass
class ScanResult:
    text: str
    matches: list[PIIMatch] = field(default_factory=list)
    blocked: bool = False
    redacted: bool = False


# --- Built-in PII patterns (no ML dependencies) ---
PII_PATTERNS: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"),
    "phone": re.compile(r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}"),
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d[ \-]*?){13,19}\b"),
    "iban": re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b"),
    "ip_address": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    "passport": re.compile(r"\b[A-Z]{1,2}\d{6,9}\b"),
    "drivers_license": re.compile(r"\b[A-Z]{1,2}\d{5,8}\b"),
    "date_of_birth": re.compile(r"\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b"),
    "address": re.compile(
        r"\b\d{1,5}\s+\w+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|"
        r"Lane|Ln|Way|Court|Ct|Circle|Cir|gatv[eė]|g\.|pr\.|al\.)\b",
        re.IGNORECASE,
    ),
    "name": re.compile(
        r"\b[A-Z\u00C4\u00D6\u00DC\u0160\u017D\u010C\u0118\u0116\u012E\u016A\u0172]"
        r"[a-z\u00E4\u00F6\u00FC\u0161\u017E\u010D\u0119\u0117\u012F\u016B\u0173]+"
        r"\s+"
        r"[A-Z\u00C4\u00D6\u00DC\u0160\u017D\u010C\u0118\u0116\u012E\u016A\u0172]"
        r"[a-z\u00E4\u00F6\u00FC\u0161\u017E\u010D\u0119\u0117\u012F\u016B\u0173]+\b"
    ),
    "vat_number": re.compile(r"\b[A-Z]{2}\d{8,12}\b"),
    "national_id": re.compile(r"\b\d{6,11}[-/]?\d{0,4}\b"),
    "medical_id": re.compile(r"\b(?:NHS|EHIC|SVN|AMM)[-\s]?\d{6,12}\b", re.IGNORECASE),
}

# ReDoS detection patterns
_REDOS_NESTED_QUANTIFIER = re.compile(r"\([^)]*[+*][^)]*\)[+*]")
_REDOS_EXCESSIVE_WILDCARDS = re.compile(r"(\.\*){3,}")


def _luhn_check(num: str) -> bool:
    """Luhn algorithm -- validates credit card numbers."""
    digits = re.sub(r"[\s\-]", "", num)
    if not digits.isdigit() or len(digits) < 13:
        return False
    total = 0
    alternate = False
    for ch in reversed(digits):
        n = int(ch)
        if alternate:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alternate = not alternate
    return total % 10 == 0


def _is_redos_pattern(pattern: str) -> bool:
    """Reject patterns with known ReDoS structures."""
    if _REDOS_NESTED_QUANTIFIER.search(pattern):
        return True
    if _REDOS_EXCESSIVE_WILDCARDS.search(pattern):
        return True
    return False


class PIIDetector:
    """
    Regex-based PII detector with Luhn validation and custom pattern support.

    Supports 14 built-in PII types, custom regex patterns (with ReDoS rejection),
    and three actions: block, redact, warn.
    """

    def __init__(self, config: PIIConfig) -> None:
        self._config = config
        self._active_types: list[str] = list(config.types or DEFAULT_PII_TYPES)

    @property
    def config(self) -> PIIConfig:
        return self._config

    def scan(self, text: str) -> ScanResult:
        """Scan text for PII. Returns matches and optionally redacted text."""
        if not self._config.enabled:
            return ScanResult(text=text)

        matches: list[PIIMatch] = []

        # Built-in patterns
        for pii_type in self._active_types:
            pattern = PII_PATTERNS.get(pii_type)
            if pattern is None:
                continue
            for m in pattern.finditer(text):
                # Validate credit card numbers with Luhn
                if pii_type == "credit_card" and not _luhn_check(m.group(0)):
                    continue
                matches.append(PIIMatch(
                    type=pii_type,
                    value="[REDACTED]",  # SECURITY: Never store raw PII
                    redacted=f"[{pii_type.upper()}]",
                    start=m.start(),
                    end=m.end(),
                ))

        # Custom patterns
        if self._config.custom_patterns:
            for custom in self._config.custom_patterns:
                pattern_str = custom.get("pattern", "")
                name = custom.get("name", "custom")
                if not pattern_str:
                    continue
                # ReDoS protection
                if _is_redos_pattern(pattern_str):
                    continue
                try:
                    regex = re.compile(pattern_str, re.IGNORECASE)
                    count = 0
                    for m in regex.finditer(text):
                        count += 1
                        if count > 100:
                            break
                        if m.end() == m.start():
                            continue  # skip zero-length matches
                        matches.append(PIIMatch(
                            type=name,
                            value="[REDACTED]",
                            redacted=f"[{name.upper()}]",
                            start=m.start(),
                            end=m.end(),
                        ))
                except re.error:
                    pass  # Invalid regex -- skip silently

        if not matches:
            return ScanResult(text=text)

        action = self._config.action or "warn"

        if action == "block":
            return ScanResult(text=text, matches=matches, blocked=True)

        if action == "redact":
            # Apply redactions from end to start to preserve indices
            redacted_text = text
            sorted_matches = sorted(matches, key=lambda m: m.start, reverse=True)
            for match in sorted_matches:
                redacted_text = redacted_text[:match.start] + match.redacted + redacted_text[match.end:]
            return ScanResult(text=redacted_text, matches=matches, redacted=True)

        # warn -- return matches but don't modify text
        return ScanResult(text=text, matches=matches)
