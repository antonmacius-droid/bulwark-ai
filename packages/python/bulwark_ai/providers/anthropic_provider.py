"""
Anthropic provider — uses the official anthropic Python SDK.
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

import anthropic

from ..types import ProviderConfig
from .base import LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk, validate_base_url

logger = logging.getLogger("bulwark_ai.providers.anthropic")

__all__ = ["AnthropicProvider"]


class AnthropicProvider(LLMProvider):
    """Anthropic Claude chat provider."""

    def __init__(self, config: ProviderConfig) -> None:
        if config.base_url:
            validate_base_url(config.base_url)
        self._client = anthropic.AsyncAnthropic(
            api_key=config.api_key,
            base_url=config.base_url,
        )

    async def chat(self, request: LLMRequest) -> LLMResponse:
        # Anthropic uses a separate `system` parameter
        system_content: str | None = None
        messages = []
        for m in request.messages:
            if m["role"] == "system":
                system_content = m["content"]
            else:
                messages.append({"role": m["role"], "content": m["content"]})

        kwargs: dict = {
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_tokens or 4096,
        }
        if system_content is not None:
            kwargs["system"] = system_content
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if request.top_p is not None:
            kwargs["top_p"] = request.top_p
        if request.stop:
            kwargs["stop_sequences"] = request.stop

        response = await self._client.messages.create(**kwargs)

        content = "".join(
            block.text for block in response.content if block.type == "text"
        )
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        return LLMResponse(
            content=content,
            usage={
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "totalTokens": input_tokens + output_tokens,
            },
            finish_reason=response.stop_reason,
        )

    async def chat_stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        system_content: str | None = None
        messages = []
        for m in request.messages:
            if m["role"] == "system":
                system_content = m["content"]
            else:
                messages.append({"role": m["role"], "content": m["content"]})

        kwargs: dict = {
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_tokens or 4096,
        }
        if system_content is not None:
            kwargs["system"] = system_content
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if request.top_p is not None:
            kwargs["top_p"] = request.top_p
        if request.stop:
            kwargs["stop_sequences"] = request.stop

        async with self._client.messages.stream(**kwargs) as stream:
            async for event in stream:
                if hasattr(event, "type"):
                    if event.type == "content_block_delta" and hasattr(event, "delta"):
                        if hasattr(event.delta, "text"):
                            yield LLMStreamChunk(content=event.delta.text, done=False)
                    elif event.type == "message_stop":
                        final = await stream.get_final_message()
                        input_t = final.usage.input_tokens
                        output_t = final.usage.output_tokens
                        yield LLMStreamChunk(
                            content="",
                            done=True,
                            usage={
                                "inputTokens": input_t,
                                "outputTokens": output_t,
                                "totalTokens": input_t + output_t,
                            },
                        )
