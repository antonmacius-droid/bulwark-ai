"""
Flask middleware -- Blueprint factory for the Bulwark AI gateway.

Provides /chat, /stream, and /audit endpoints with auth context enforcement.

SECURITY: Auth context ALWAYS overrides body fields. The body fields ``pii``
and ``skip_policies`` are NEVER accepted from the client.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable, Dict, Optional

from ..types import ChatMessage, ChatRequest

AuthContext = Dict[str, Optional[str]]
AuthFunc = Callable[..., AuthContext | None]


def _run_async(coro: Any) -> Any:
    """Run an async coroutine from sync Flask context."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # We're already in an async context -- create a new loop in a thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, coro).result()
    else:
        return asyncio.run(coro)


def create_bulwark_blueprint(
    gateway: Any,
    auth_func: AuthFunc | None = None,
    *,
    name: str = "bulwark",
    url_prefix: str = "",
) -> Any:
    """
    Create a Flask Blueprint with governed chat endpoints.

    Args:
        gateway: The Bulwark AI gateway instance.
        auth_func: Callable that takes a Flask ``request`` and returns auth context dict,
                   or None. Keys: ``user_id``, ``team_id``, ``tenant_id``.
        name: Blueprint name.
        url_prefix: URL prefix for all routes.

    Returns:
        A Flask ``Blueprint`` instance.

    Example::

        from flask import Flask
        from bulwark_ai.middleware import create_bulwark_blueprint

        app = Flask(__name__)
        bp = create_bulwark_blueprint(gateway, auth_func=get_auth_context)
        app.register_blueprint(bp, url_prefix="/api/ai")
    """
    from flask import Blueprint, request, jsonify, Response

    bp = Blueprint(name, __name__, url_prefix=url_prefix)

    def _get_auth() -> AuthContext:
        if auth_func is None:
            return {}
        result = auth_func(request)
        return result or {}

    @bp.route("/chat", methods=["POST"])
    def chat_endpoint():
        try:
            body = request.get_json(force=True) or {}
            auth_ctx = _get_auth()

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

            response = _run_async(gateway.chat(chat_request))
            return jsonify(_serialize_response(response))

        except Exception as exc:
            code = getattr(exc, "code", "INTERNAL_ERROR")
            status = getattr(exc, "http_status", 500)
            # Only expose error details for BulwarkError; sanitize internal errors
            msg = str(exc) if hasattr(exc, "code") else "Internal server error"
            return jsonify({"error": msg, "code": code}), status

    @bp.route("/stream", methods=["POST"])
    def stream_endpoint():
        body = request.get_json(force=True) or {}
        auth_ctx = _get_auth()

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

        def generate():
            try:
                # Use sync iteration over async generator
                stream = _run_async(_collect_stream(gateway, chat_request))
                for event in stream:
                    data = json.dumps(_serialize_event(event))
                    yield f"event: {getattr(event, 'type', 'data')}\ndata: {data}\n\n"
            except Exception as exc:
                error_data = json.dumps({"error": str(exc)})
                yield f"event: error\ndata: {error_data}\n\n"

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    @bp.route("/audit", methods=["GET"])
    def audit_endpoint():
        try:
            auth_ctx = _get_auth()
            if not auth_ctx:
                return jsonify({"error": "Authentication required"}), 401

            limit = min(max(1, int(request.args.get("limit", 50))), 1000)
            offset = max(0, int(request.args.get("offset", 0)))

            entries = _run_async(gateway.audit.query(
                user_id=auth_ctx.get("user_id") or request.args.get("user_id"),
                team_id=request.args.get("team_id"),
                tenant_id=auth_ctx.get("tenant_id") or request.args.get("tenant_id"),
                action=request.args.get("action"),
                from_date=request.args.get("from"),
                to_date=request.args.get("to"),
                limit=limit,
                offset=offset,
            ))
            return jsonify(entries)

        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    return bp


async def _collect_stream(gateway: Any, chat_request: ChatRequest) -> list:
    """Collect all stream events into a list (for sync Flask context)."""
    events = []
    async for event in gateway.chat_stream(chat_request):
        events.append(event)
    return events


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
