"""
Mistral AI provider — EU-based LLM (France).

Uses the OpenAI-compatible API format via httpx.
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

import httpx

from ..types import ProviderConfig
from .base import LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk, validate_base_url

logger = logging.getLogger("bulwark_ai.providers.mistral")

__all__ = ["MistralProvider"]


class MistralProvider(LLMProvider):
    """Mistral AI chat completions provider (OpenAI-compatible API)."""

    def __init__(self, config: ProviderConfig) -> None:
        if config.base_url:
            validate_base_url(config.base_url)
        self._api_key = config.api_key
        self._base_url = (config.base_url or "https://api.mistral.ai/v1").rstrip("/")

    async def chat(self, request: LLMRequest) -> LLMResponse:
        payload = {
            "model": request.model,
            "messages": [{"role": m["role"], "content": m["content"]} for m in request.messages],
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.top_p is not None:
            payload["top_p"] = request.top_p
        if request.stop:
            payload["stop"] = request.stop

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._api_key}",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        choice = data.get("choices", [{}])[0]
        usage = data.get("usage", {})

        return LLMResponse(
            content=choice.get("message", {}).get("content", ""),
            usage={
                "inputTokens": usage.get("prompt_tokens", 0),
                "outputTokens": usage.get("completion_tokens", 0),
                "totalTokens": usage.get("total_tokens", 0),
            },
            finish_reason=choice.get("finish_reason"),
        )

    async def chat_stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        payload = {
            "model": request.model,
            "messages": [{"role": m["role"], "content": m["content"]} for m in request.messages],
            "stream": True,
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.top_p is not None:
            payload["top_p"] = request.top_p
        if request.stop:
            payload["stop"] = request.stop

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._api_key}",
                },
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:]
                    if raw.strip() == "[DONE]":
                        break
                    import json
                    chunk_data = json.loads(raw)
                    choices = chunk_data.get("choices", [])
                    delta = choices[0].get("delta", {}).get("content", "") if choices else ""
                    finish = choices[0].get("finish_reason") if choices else None
                    usage_data = chunk_data.get("usage")
                    usage = None
                    if usage_data:
                        usage = {
                            "inputTokens": usage_data.get("prompt_tokens", 0),
                            "outputTokens": usage_data.get("completion_tokens", 0),
                            "totalTokens": usage_data.get("total_tokens", 0),
                        }
                    yield LLMStreamChunk(
                        content=delta,
                        done=finish is not None,
                        usage=usage,
                    )
