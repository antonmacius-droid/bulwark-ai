"""
FastAPI middleware -- router factory for the Bulwark AI gateway.

Provides /chat, /stream, and /audit endpoints with auth context enforcement.

SECURITY: Auth context ALWAYS overrides body fields. The body fields ``pii``
and ``skip_policies`` are NEVER accepted from the client.
"""

from __future__ import annotations

import asyncio
import json
import traceback
from typing import Any, Awaitable, Callable, Dict, List, Optional

from ..types import ChatMessage, ChatRequest

# Type aliases -- the actual gateway is provided by the caller
AuthContext = Dict[str, Optional[str]]  # user_id, team_id, tenant_id
AuthFunc = Callable[..., AuthContext | Awaitable[AuthContext] | None]


def create_bulwark_router(
    gateway: Any,
    auth_func: AuthFunc | None = None,
    *,
    prefix: str = "",
    stream_timeout: float = 300.0,
) -> Any:
    """
    Create a FastAPI APIRouter with governed chat endpoints.

    Args:
        gateway: The Bulwark AI gateway instance (must have ``chat``, ``chat_stream``, ``audit`` attrs).
        auth_func: Async/sync callable that takes a ``Request`` and returns auth context dict,
                   or None if unauthenticated. Keys: ``user_id``, ``team_id``, ``tenant_id``.
        prefix: URL prefix for all routes.
        stream_timeout: Max seconds for streaming connections (default 300).

    Returns:
        A FastAPI ``APIRouter`` instance.

    Example::

        from fastapi import FastAPI
        from bulwark_ai.middleware import create_bulwark_router

        app = FastAPI()
        router = create_bulwark_router(gateway, auth_func=get_auth_context)
        app.include_router(router, prefix="/api/ai")
    """
    from fastapi import APIRouter, Request
    from fastapi.responses import JSONResponse, StreamingResponse

    router = APIRouter(prefix=prefix)

    async def _get_auth(request: Request) -> AuthContext:
        if auth_func is None:
            return {}
        result = auth_func(request)
        if asyncio.iscoroutine(result) or asyncio.isfuture(result):
            result = await result
        return result or {}

    @router.post("/chat")
    async def chat_endpoint(request: Request) -> JSONResponse:
        try:
            body = await request.json()
            auth_ctx = await _get_auth(request)

            # Build messages
            raw_messages = body.get("messages", [])
            messages = [
                ChatMessage(
                    role=m.get("role", "user"),
                    content=m.get("content", ""),
                    name=m.get("name"),
                )
                for m in raw_messages
            ]

            # SECURITY: Auth context ALWAYS overrides body.
            # NEVER accept pii or skip_policies from body.
            chat_request = ChatRequest(
                messages=messages,
                model=body.get("model"),
                temperature=body.get("temperature"),
                max_tokens=body.get("max_tokens"),
                top_p=body.get("top_p"),
                stop=body.get("stop"),
                knowledge_base=body.get("knowledge_base"),
                user_id=auth_ctx.get("user_id"),
                team_id=auth_ctx.get("team_id"),
                tenant_id=auth_ctx.get("tenant_id"),
            )

            response = await gateway.chat(chat_request)
            return JSONResponse(content=_serialize_response(response))

        except Exception as exc:
            status = getattr(exc, "http_status", 500)
            return JSONResponse(
                status_code=status,
                content={"error": str(exc) if hasattr(exc, "code") else "Internal server error", "code": getattr(exc, "code", "INTERNAL_ERROR")},
            )

    @router.post("/stream")
    async def stream_endpoint(request: Request) -> StreamingResponse:
        body = await request.json()
        auth_ctx = await _get_auth(request)

        raw_messages = body.get("messages", [])
        messages = [
            ChatMessage(
                role=m.get("role", "user"),
                content=m.get("content", ""),
                name=m.get("name"),
            )
            for m in raw_messages
        ]

        chat_request = ChatRequest(
            messages=messages,
            model=body.get("model"),
            temperature=body.get("temperature"),
            max_tokens=body.get("max_tokens"),
            top_p=body.get("top_p"),
            stop=body.get("stop"),
            knowledge_base=body.get("knowledge_base"),
            stream=True,
            user_id=auth_ctx.get("user_id"),
            team_id=auth_ctx.get("team_id"),
            tenant_id=auth_ctx.get("tenant_id"),
        )

        async def event_generator():
            try:
                async for event in gateway.chat_stream(chat_request):
                    data = json.dumps(_serialize_event(event))
                    yield f"event: {event.type}\ndata: {data}\n\n"
            except Exception as exc:
                error_data = json.dumps({"error": str(exc)})
                yield f"event: error\ndata: {error_data}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    @router.get("/audit")
    async def audit_endpoint(request: Request) -> JSONResponse:
        try:
            auth_ctx = await _get_auth(request)
            if not auth_ctx:
                return JSONResponse(
                    status_code=401,
                    content={"error": "Authentication required"},
                )

            params = request.query_params
            limit = min(max(1, int(params.get("limit", "50"))), 1000)
            offset = max(0, int(params.get("offset", "0")))

            entries = await gateway.audit.query(
                user_id=auth_ctx.get("user_id") or params.get("user_id"),
                team_id=params.get("team_id"),
                tenant_id=auth_ctx.get("tenant_id") or params.get("tenant_id"),
                action=params.get("action"),
                from_date=params.get("from"),
                to_date=params.get("to"),
                limit=limit,
                offset=offset,
            )
            return JSONResponse(content=entries)

        except Exception as exc:
            return JSONResponse(
                status_code=500,
                content={"error": str(exc)},
            )

    return router


def _serialize_response(response: Any) -> Dict[str, Any]:
    """Serialize a ChatResponse to a JSON-compatible dict."""
    from dataclasses import asdict
    if hasattr(response, "__dataclass_fields__"):
        return asdict(response)
    return dict(response) if hasattr(response, "__iter__") else {"content": str(response)}


def _serialize_event(event: Any) -> Dict[str, Any]:
    """Serialize a stream event to a JSON-compatible dict."""
    from dataclasses import asdict
    if hasattr(event, "__dataclass_fields__"):
        return asdict(event)
    return {"type": str(getattr(event, "type", "unknown")), "data": str(event)}
