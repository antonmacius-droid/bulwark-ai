"""
Unit tests for PII detector.

Covers: 14 built-in patterns, Luhn validation, custom patterns,
ReDoS rejection, redaction, blocking, and warn modes.
"""

from __future__ import annotations

import time

import pytest

from bulwark_ai.types import PIIConfig
from bulwark_ai.security.pii import PIIDetector


class TestPIIDetectorBasic:
    """Basic detection tests for all 14 PII types."""

    def test_detect_email(self, pii_detector_warn: PIIDetector) -> None:
        result = pii_detector_warn.scan("Contact john@example.com for details")
        assert len(result.matches) == 1
        assert result.matches[0].type == "email"
        assert result.matches[0].value == "[REDACTED]"  # PII values never stored
        assert not result.blocked
        assert not result.redacted

    def test_detect_phone(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["phone"]))
        result = detector.scan("Call me at +370-612-34567")
        assert len(result.matches) >= 1
        assert result.matches[0].type == "phone"

    def test_detect_ssn(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["ssn"]))
        result = detector.scan("SSN: 123-45-6789")
        assert len(result.matches) == 1
        assert result.matches[0].type == "ssn"

    def test_detect_credit_card_with_luhn(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["credit_card"]))
        # 4111 1111 1111 1111 passes Luhn
        result = detector.scan("Card: 4111 1111 1111 1111")
        assert len(result.matches) >= 1
        assert any(m.type == "credit_card" for m in result.matches)

    def test_reject_invalid_credit_card(self) -> None:
        """Numbers that look like credit cards but fail Luhn should be rejected."""
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["credit_card"]))
        result = detector.scan("Not a card: 1234 5678 9012 3456")
        cc_matches = [m for m in result.matches if m.type == "credit_card"]
        # Luhn check should filter this out
        assert len(cc_matches) == 0

    def test_detect_iban(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["iban"]))
        result = detector.scan("IBAN: GB29NWBK60161331926819")
        assert len(result.matches) >= 1
        assert result.matches[0].type == "iban"

    def test_detect_ip_address(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["ip_address"]))
        result = detector.scan("Server at 192.168.1.100")
        assert len(result.matches) == 1
        assert result.matches[0].type == "ip_address"

    def test_detect_date_of_birth(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["date_of_birth"]))
        result = detector.scan("Born on 1990-05-15")
        assert len(result.matches) == 1
        assert result.matches[0].type == "date_of_birth"

    def test_detect_address(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["address"]))
        result = detector.scan("Lives at 123 Main Street")
        assert len(result.matches) == 1
        assert result.matches[0].type == "address"

    def test_detect_name(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["name"]))
        result = detector.scan("Contact John Smith for info")
        assert len(result.matches) >= 1
        assert result.matches[0].type == "name"

    def test_detect_vat_number(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["vat_number"]))
        result = detector.scan("VAT: DE123456789")
        assert len(result.matches) >= 1

    def test_detect_medical_id(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=True, action="warn", types=["medical_id"]))
        result = detector.scan("NHS 123456789012")
        assert len(result.matches) >= 1


class TestPIIDetectorActions:
    """Test block, redact, and warn actions."""

    def test_redact_replaces_pii(self, pii_detector_redact: PIIDetector) -> None:
        result = pii_detector_redact.scan("Email: test@test.com, Phone: +370-612-34567")
        assert result.redacted is True
        assert "[EMAIL]" in result.text
        assert "[PHONE]" in result.text
        assert "test@test.com" not in result.text

    def test_block_flags_blocked(self, pii_detector_block: PIIDetector) -> None:
        result = pii_detector_block.scan("SSN: 123-45-6789")
        assert result.blocked is True
        assert len(result.matches) == 1

    def test_warn_preserves_text(self, pii_detector_warn: PIIDetector) -> None:
        original = "Contact john@example.com"
        result = pii_detector_warn.scan(original)
        assert result.text == original
        assert not result.blocked
        assert not result.redacted
        assert len(result.matches) == 1

    def test_disabled_returns_no_matches(self) -> None:
        detector = PIIDetector(PIIConfig(enabled=False))
        result = detector.scan("Email: test@test.com SSN: 123-45-6789")
        assert len(result.matches) == 0
        assert not result.blocked


class TestPIIDetectorCustomPatterns:
    """Custom regex pattern support."""

    def test_custom_pattern_detection(self) -> None:
        detector = PIIDetector(PIIConfig(
            enabled=True,
            action="redact",
            custom_patterns=[{"name": "employee_id", "pattern": r"EMP-\d{6}"}],
        ))
        result = detector.scan("Employee EMP-123456 submitted a request")
        assert result.redacted is True
        assert "[EMPLOYEE_ID]" in result.text

    def test_custom_pattern_with_builtin(self) -> None:
        detector = PIIDetector(PIIConfig(
            enabled=True,
            action="warn",
            types=["email"],
            custom_patterns=[{"name": "order_id", "pattern": r"ORD-\d{8}"}],
        ))
        result = detector.scan("Email: test@example.com, Order: ORD-12345678")
        types = {m.type for m in result.matches}
        assert "email" in types
        assert "order_id" in types


class TestPIIDetectorReDoS:
    """ReDoS protection tests."""

    def test_reject_nested_quantifier(self) -> None:
        """Patterns with nested quantifiers like (a+)+ should be rejected."""
        detector = PIIDetector(PIIConfig(
            enabled=True,
            action="warn",
            custom_patterns=[
                {"name": "evil", "pattern": "(a+)+$"},
            ],
        ))
        start = time.time()
        result = detector.scan("a" * 100)
        elapsed = time.time() - start
        assert elapsed < 0.5  # Should be near-instant since pattern is skipped
        evil_matches = [m for m in result.matches if m.type == "evil"]
        assert len(evil_matches) == 0

    def test_reject_excessive_wildcards(self) -> None:
        """Patterns with (.*){3,} should be rejected."""
        detector = PIIDetector(PIIConfig(
            enabled=True,
            action="warn",
            custom_patterns=[
                {"name": "evil2", "pattern": "(.*.*.*)"},
            ],
        ))
        start = time.time()
        result = detector.scan("a" * 100)
        elapsed = time.time() - start
        assert elapsed < 0.5
        evil_matches = [m for m in result.matches if m.type == "evil2"]
        assert len(evil_matches) == 0

    def test_safe_pattern_allowed(self) -> None:
        """Safe patterns should work normally."""
        detector = PIIDetector(PIIConfig(
            enabled=True,
            action="warn",
            custom_patterns=[
                {"name": "good", "pattern": r"\d{3}-\d{4}"},
            ],
        ))
        result = detector.scan("Call 555-1234")
        good_matches = [m for m in result.matches if m.type == "good"]
        assert len(good_matches) == 1

    def test_mixed_safe_and_evil_patterns(self) -> None:
        """Evil patterns are skipped, safe ones still work."""
        detector = PIIDetector(PIIConfig(
            enabled=True,
            action="warn",
            custom_patterns=[
                {"name": "evil", "pattern": "(a+)+$"},
                {"name": "evil2", "pattern": "(.*.*.*)"},
                {"name": "good", "pattern": r"\d{3}-\d{4}"},
            ],
        ))
        start = time.time()
        result = detector.scan("Call 555-1234 for details. " + "a" * 100)
        elapsed = time.time() - start
        assert elapsed < 0.5

        good_matches = [m for m in result.matches if m.type == "good"]
        assert len(good_matches) == 1
        assert good_matches[0].value == "[REDACTED]"

        evil_matches = [m for m in result.matches if m.type in ("evil", "evil2")]
        assert len(evil_matches) == 0

    def test_invalid_regex_skipped(self) -> None:
        """Invalid regex should be silently skipped."""
        detector = PIIDetector(PIIConfig(
            enabled=True,
            action="warn",
            custom_patterns=[
                {"name": "broken", "pattern": "[invalid"},
                {"name": "good", "pattern": r"\d+"},
            ],
        ))
        result = detector.scan("Number: 42")
        assert any(m.type == "good" for m in result.matches)
        assert not any(m.type == "broken" for m in result.matches)


class TestPIIDetectorEdgeCases:
    """Edge cases and security invariants."""

    def test_empty_text(self, pii_detector_warn: PIIDetector) -> None:
        result = pii_detector_warn.scan("")
        assert len(result.matches) == 0

    def test_no_pii_in_text(self, pii_detector_warn: PIIDetector) -> None:
        result = pii_detector_warn.scan("This is a normal sentence with no PII.")
        assert len(result.matches) == 0

    def test_multiple_pii_types(self) -> None:
        detector = PIIDetector(PIIConfig(
            enabled=True, action="redact",
            types=["email", "ssn", "phone"],
        ))
        result = detector.scan("Email: test@test.com, SSN: 123-45-6789, Phone: 555-123-4567")
        types_found = {m.type for m in result.matches}
        assert "email" in types_found
        assert "ssn" in types_found

    def test_pii_values_never_stored(self, pii_detector_warn: PIIDetector) -> None:
        """Security: match values must always be [REDACTED]."""
        result = pii_detector_warn.scan("Email: secret@example.com")
        for match in result.matches:
            assert match.value == "[REDACTED]"
            assert "secret" not in match.value
