"""
Google Gemini provider — uses the Gemini REST API via httpx.

SECURITY: API key is sent in the x-goog-api-key header, not in the URL,
to prevent key leakage in logs and proxy servers.
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

import httpx

from ..types import ProviderConfig
from .base import LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk, validate_base_url

logger = logging.getLogger("bulwark_ai.providers.google")

__all__ = ["GoogleProvider"]


class GoogleProvider(LLMProvider):
    """Google Gemini chat provider."""

    def __init__(self, config: ProviderConfig) -> None:
        if config.base_url:
            validate_base_url(config.base_url)
        self._api_key = config.api_key
        self._base_url = (
            config.base_url or "https://generativelanguage.googleapis.com/v1beta"
        ).rstrip("/")

    async def chat(self, request: LLMRequest) -> LLMResponse:
        model = request.model or "gemini-2.0-flash"

        # Convert OpenAI format to Gemini format
        system_instruction = None
        contents = []
        for m in request.messages:
            if m["role"] == "system":
                system_instruction = {"parts": [{"text": m["content"]}]}
            else:
                role = "model" if m["role"] == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": m["content"]}]})

        body: dict = {"contents": contents}
        if system_instruction:
            body["systemInstruction"] = system_instruction

        generation_config: dict = {}
        if request.temperature is not None:
            generation_config["temperature"] = request.temperature
        if request.max_tokens is not None:
            generation_config["maxOutputTokens"] = request.max_tokens
        if request.top_p is not None:
            generation_config["topP"] = request.top_p
        if request.stop:
            generation_config["stopSequences"] = request.stop
        if generation_config:
            body["generationConfig"] = generation_config

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{self._base_url}/models/{model}:generateContent",
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": self._api_key,
                },
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()

        candidates = data.get("candidates", [])
        text = ""
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts)

        usage_meta = data.get("usageMetadata", {})
        input_tokens = usage_meta.get("promptTokenCount", 0)
        output_tokens = usage_meta.get("candidatesTokenCount", 0)
        total_tokens = usage_meta.get("totalTokenCount", 0)

        return LLMResponse(
            content=text,
            usage={
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "totalTokens": total_tokens,
            },
            finish_reason=candidates[0].get("finishReason") if candidates else None,
        )

    async def chat_stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        model = request.model or "gemini-2.0-flash"

        system_instruction = None
        contents = []
        for m in request.messages:
            if m["role"] == "system":
                system_instruction = {"parts": [{"text": m["content"]}]}
            else:
                role = "model" if m["role"] == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": m["content"]}]})

        body: dict = {"contents": contents}
        if system_instruction:
            body["systemInstruction"] = system_instruction

        generation_config: dict = {}
        if request.temperature is not None:
            generation_config["temperature"] = request.temperature
        if request.max_tokens is not None:
            generation_config["maxOutputTokens"] = request.max_tokens
        if request.top_p is not None:
            generation_config["topP"] = request.top_p
        if request.stop:
            generation_config["stopSequences"] = request.stop
        if generation_config:
            body["generationConfig"] = generation_config

        import json as json_mod

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/models/{model}:streamGenerateContent?alt=sse",
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": self._api_key,
                },
                json=body,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:]
                    if raw.strip() == "[DONE]":
                        break
                    try:
                        chunk_data = json_mod.loads(raw)
                    except (json_mod.JSONDecodeError, ValueError):
                        continue

                    candidates = chunk_data.get("candidates", [])
                    text = ""
                    done = False
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        text = "".join(p.get("text", "") for p in parts)
                        if candidates[0].get("finishReason"):
                            done = True

                    usage = None
                    usage_meta = chunk_data.get("usageMetadata")
                    if usage_meta:
                        usage = {
                            "inputTokens": usage_meta.get("promptTokenCount", 0),
                            "outputTokens": usage_meta.get("candidatesTokenCount", 0),
                            "totalTokens": usage_meta.get("totalTokenCount", 0),
                        }

                    yield LLMStreamChunk(content=text, done=done, usage=usage)
