"""
Ollama provider — run LLMs locally (Llama, Phi, Qwen, DeepSeek, etc).

Zero data leaves your machine. Uses httpx to talk to the Ollama REST API.
"""

from __future__ import annotations

import json as json_mod
import logging
from typing import AsyncIterator

import httpx

from ..types import ProviderConfig
from .base import LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk, validate_base_url

logger = logging.getLogger("bulwark_ai.providers.ollama")

__all__ = ["OllamaProvider"]


class OllamaProvider(LLMProvider):
    """Ollama local LLM provider."""

    def __init__(self, config: ProviderConfig) -> None:
        if config.base_url:
            validate_base_url(config.base_url)
        self._base_url = (config.base_url or "http://localhost:11434").rstrip("/")

    async def chat(self, request: LLMRequest) -> LLMResponse:
        options: dict = {}
        if request.temperature is not None:
            options["temperature"] = request.temperature
        if request.top_p is not None:
            options["top_p"] = request.top_p
        if request.max_tokens is not None:
            options["num_predict"] = request.max_tokens
        if request.stop:
            options["stop"] = request.stop

        payload = {
            "model": request.model,
            "messages": [{"role": m["role"], "content": m["content"]} for m in request.messages],
            "stream": False,
        }
        if options:
            payload["options"] = options

        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{self._base_url}/api/chat",
                headers={"Content-Type": "application/json"},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        prompt_eval_count = data.get("prompt_eval_count", 0)
        eval_count = data.get("eval_count", 0)

        return LLMResponse(
            content=data.get("message", {}).get("content", ""),
            usage={
                "inputTokens": prompt_eval_count,
                "outputTokens": eval_count,
                "totalTokens": prompt_eval_count + eval_count,
            },
            finish_reason="stop" if data.get("done") else None,
        )

    async def chat_stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        options: dict = {}
        if request.temperature is not None:
            options["temperature"] = request.temperature
        if request.top_p is not None:
            options["top_p"] = request.top_p
        if request.max_tokens is not None:
            options["num_predict"] = request.max_tokens
        if request.stop:
            options["stop"] = request.stop

        payload = {
            "model": request.model,
            "messages": [{"role": m["role"], "content": m["content"]} for m in request.messages],
            "stream": True,
        }
        if options:
            payload["options"] = options

        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/api/chat",
                headers={"Content-Type": "application/json"},
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk_data = json_mod.loads(line)
                    except (json_mod.JSONDecodeError, ValueError):
                        continue

                    content = chunk_data.get("message", {}).get("content", "")
                    done = chunk_data.get("done", False)
                    usage = None
                    if done:
                        prompt_eval = chunk_data.get("prompt_eval_count", 0)
                        eval_ct = chunk_data.get("eval_count", 0)
                        usage = {
                            "inputTokens": prompt_eval,
                            "outputTokens": eval_ct,
                            "totalTokens": prompt_eval + eval_ct,
                        }

                    yield LLMStreamChunk(content=content, done=done, usage=usage)
