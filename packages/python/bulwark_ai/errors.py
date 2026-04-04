"""Bulwark AI error types."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional


# HTTP status code mapping for error codes
_HTTP_STATUS_MAP: Dict[str, int] = {
    "INVALID_REQUEST": 400,
    "INVALID_CONFIG": 400,
    "PII_BLOCKED": 403,
    "POLICY_BLOCKED": 403,
    "PROMPT_INJECTION": 400,
    "PROVIDER_NOT_CONFIGURED": 404,
    "RATE_LIMITED": 429,
    "BUDGET_EXCEEDED": 429,
    "LLM_TIMEOUT": 504,
    "LLM_ERROR": 502,
    "SHUTTING_DOWN": 503,
    "GATEWAY_DISABLED": 503,
    "DATABASE_ERROR": 500,
}


class BulwarkError(Exception):
    """Bulwark-specific error with code, HTTP status, and optional details."""

    def __init__(
        self,
        code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = details
        self.timestamp = datetime.now(timezone.utc).isoformat()

    @property
    def http_status(self) -> int:
        """HTTP status code for this error."""
        return _HTTP_STATUS_MAP.get(self.code, 500)

    def to_dict(self) -> Dict[str, Any]:
        """JSON-serializable representation."""
        return {
            "error": str(self),
            "code": self.code,
            "details": self.details,
            "timestamp": self.timestamp,
        }

    def __repr__(self) -> str:
        return f"BulwarkError(code={self.code!r}, message={str(self)!r})"
