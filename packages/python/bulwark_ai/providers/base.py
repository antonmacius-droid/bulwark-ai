"""
Abstract LLM provider interface and shared utilities.
"""

from __future__ import annotations

import abc
import ipaddress
import logging
from dataclasses import dataclass, field
from typing import AsyncIterator, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger("bulwark_ai.providers")

__all__ = ["LLMProvider", "LLMRequest", "LLMResponse", "LLMStreamChunk", "validate_base_url"]

# Hosts that must be blocked to prevent SSRF
_BLOCKED_HOSTS = frozenset({
    "169.254.169.254",
    "metadata.google.internal",
    "100.100.100.200",
})


def validate_base_url(url: str) -> None:
    """Validate a provider base URL to prevent SSRF attacks.

    Blocks:
    - Non-HTTPS (except localhost)
    - Cloud metadata endpoints
    - Private IP ranges (except localhost)
    """
    try:
        parsed = urlparse(url)
    except Exception:
        raise ValueError(f"Invalid baseUrl: {url}")

    hostname = parsed.hostname or ""
    is_localhost = hostname in ("localhost", "127.0.0.1", "::1")

    # Block non-HTTPS (except localhost for dev)
    if parsed.scheme != "https" and not is_localhost:
        raise ValueError(f"Insecure protocol: {parsed.scheme}. Use HTTPS.")

    # Block cloud metadata endpoints
    if hostname in _BLOCKED_HOSTS:
        raise ValueError(f"Blocked host: {hostname}")

    # Block private IP ranges (except localhost)
    if not is_localhost:
        try:
            addr = ipaddress.ip_address(hostname)
            if addr.is_private:
                raise ValueError(f"Private IP blocked: {hostname}")
        except ValueError as e:
            if "Private IP blocked" in str(e):
                raise
            # Not an IP literal (it's a hostname) -- that's fine


@dataclass
class LLMRequest:
    """Request to an LLM provider."""
    model: str
    messages: List[dict]  # List of {"role": str, "content": str}
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    stop: Optional[List[str]] = None
    stream: bool = False


@dataclass
class LLMResponse:
    """Response from an LLM provider."""
    content: str
    usage: dict = field(default_factory=lambda: {
        "inputTokens": 0, "outputTokens": 0, "totalTokens": 0
    })
    finish_reason: Optional[str] = None

    @property
    def input_tokens(self) -> int:
        return self.usage.get("inputTokens", 0)

    @property
    def output_tokens(self) -> int:
        return self.usage.get("outputTokens", 0)

    @property
    def total_tokens(self) -> int:
        return self.usage.get("totalTokens", 0)


@dataclass
class LLMStreamChunk:
    """A single chunk from a streaming LLM response."""
    content: str
    done: bool = False
    usage: Optional[dict] = None


class LLMProvider(abc.ABC):
    """Abstract base class for LLM providers."""

    @abc.abstractmethod
    async def chat(self, request: LLMRequest) -> LLMResponse:
        """Send a chat completion request and return the full response."""
        ...

    async def chat_stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        """Stream a chat completion. Default fallback: call chat() and yield single chunk."""
        response = await self.chat(request)
        yield LLMStreamChunk(content=response.content, done=True, usage=response.usage)
