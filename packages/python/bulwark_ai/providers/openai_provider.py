"""
OpenAI provider — uses the official openai Python SDK.
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

from openai import AsyncOpenAI

from ..types import ProviderConfig
from .base import LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk, validate_base_url

logger = logging.getLogger("bulwark_ai.providers.openai")

__all__ = ["OpenAIProvider"]


class OpenAIProvider(LLMProvider):
    """OpenAI chat completions provider."""

    def __init__(self, config: ProviderConfig) -> None:
        if config.base_url:
            validate_base_url(config.base_url)
        self._client = AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
        )

    async def chat(self, request: LLMRequest) -> LLMResponse:
        response = await self._client.chat.completions.create(
            model=request.model,
            messages=[{"role": m["role"], "content": m["content"]} for m in request.messages],
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            top_p=request.top_p,
            stop=request.stop,
        )
        choice = response.choices[0] if response.choices else None
        usage = response.usage
        return LLMResponse(
            content=choice.message.content or "" if choice else "",
            usage={
                "inputTokens": usage.prompt_tokens if usage else 0,
                "outputTokens": usage.completion_tokens if usage else 0,
                "totalTokens": usage.total_tokens if usage else 0,
            },
            finish_reason=choice.finish_reason if choice else None,
        )

    async def chat_stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        stream = await self._client.chat.completions.create(
            model=request.model,
            messages=[{"role": m["role"], "content": m["content"]} for m in request.messages],
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            top_p=request.top_p,
            stop=request.stop,
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            delta = ""
            done = False
            if chunk.choices:
                delta = chunk.choices[0].delta.content or ""
                done = chunk.choices[0].finish_reason is not None

            usage = None
            if chunk.usage:
                usage = {
                    "inputTokens": chunk.usage.prompt_tokens or 0,
                    "outputTokens": chunk.usage.completion_tokens or 0,
                    "totalTokens": chunk.usage.total_tokens or 0,
                }

            yield LLMStreamChunk(content=delta, done=done, usage=usage)
