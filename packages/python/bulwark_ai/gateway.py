"""
Bulwark AI Gateway — Enterprise AI governance layer.

Drop into any Python app. Provides PII detection, prompt injection guard,
content policies, budget control, rate limiting, audit logging, and
retry/fallback across multiple LLM providers.

Usage::

    gateway = AIGateway(GatewayConfig(
        providers={"openai": ProviderConfig(api_key="sk-...")},
        database="bulwark.db",
        pii=PIIConfig(enabled=True, action="redact"),
        budgets=BudgetConfig(enabled=True),
        audit=True,
    ))
    await gateway.init()

    response = await gateway.chat(ChatRequest(
        model="gpt-4o",
        user_id="user-123",
        messages=[ChatMessage(role="user", content="Hello")],
    ))
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import (
    Any,
    AsyncIterator,
    Dict,
    List,
    Optional,
    Tuple,
)

from .audit import AuditStore
from .billing.budgets import BudgetManager
from .billing.costs import CostCalculator
from .database import Database
from .errors import BulwarkError
from .providers.base import LLMProvider, LLMRequest, LLMResponse
from .providers.openai_provider import OpenAIProvider
from .providers.anthropic_provider import AnthropicProvider
from .providers.mistral_provider import MistralProvider
from .providers.google_provider import GoogleProvider
from .providers.ollama_provider import OllamaProvider
from .rag.knowledge_base import KnowledgeBase
from .security.pii import PIIDetector, PIIMatch, ScanResult
from .security.policies import PolicyEngine
from .security.prompt_guard import PromptGuard, harden_system_prompt
from .types import (
    BudgetConfig,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    CostBreakdown,
    GatewayConfig,
    PIIConfig,
    PIIDetectionInfo,
    PromptGuardConfig,
    SourceInfo,
    StreamEvent,
    TokenUsage,
    TraceStep,
    UsageRecord,
)

logger = logging.getLogger("bulwark_ai.gateway")

__all__ = ["AIGateway"]

# Limits
MAX_MESSAGE_LENGTH = 200_000
MAX_MESSAGES = 200
DEFAULT_TIMEOUT_MS = 120_000


class AIGateway:
    """
    Bulwark AI Gateway — enterprise AI governance layer.

    Full pipeline: validate -> injection scan -> PII scan -> policy check ->
    rate limit -> budget -> RAG -> LLM call (with retry+fallback) ->
    output PII scan -> cost -> audit
    """

    def __init__(self, config: GatewayConfig) -> None:
        # Apply mode presets (individual settings override)
        resolved = self._apply_mode_presets(config)

        self._fail_mode = resolved.fail_mode
        self._enabled = resolved.enabled

        # Validate required config
        if not resolved.providers:
            raise BulwarkError("INVALID_CONFIG", "At least one provider must be configured")
        if not resolved.database:
            raise BulwarkError("INVALID_CONFIG", "Database connection string is required")

        # Database
        db_path = resolved.database.replace("sqlite://", "").replace("sqlite:///", "") or "bulwark.db"
        self._db = Database(db_path)

        # PII
        if isinstance(resolved.pii, bool):
            pii_config = PIIConfig(enabled=resolved.pii, action="warn")
        elif isinstance(resolved.pii, PIIConfig):
            pii_config = resolved.pii
        else:
            pii_config = PIIConfig(enabled=False)
        self._pii_detector = PIIDetector(pii_config)

        # Prompt guard
        self._prompt_guard = PromptGuard(
            resolved.prompt_guard or PromptGuardConfig(enabled=True, action="block", sensitivity="medium")
        )

        # Policies
        self._policy_engine = PolicyEngine(resolved.policies or [])

        # Cost calculator
        self._cost_calculator = CostCalculator(resolved.model_pricing)

        # Budget manager
        if isinstance(resolved.budgets, bool):
            budget_config = BudgetConfig(enabled=resolved.budgets)
        elif isinstance(resolved.budgets, BudgetConfig):
            budget_config = resolved.budgets
        else:
            budget_config = BudgetConfig(enabled=False)
        self._budget_manager = BudgetManager(self._db, budget_config)

        # Audit
        self._audit_store = AuditStore(self._db)

        # Timeout, retry, fallback
        self._timeout_ms = resolved.timeout_ms or DEFAULT_TIMEOUT_MS
        retry_cfg = resolved.retry
        self._retry_config = {
            "max_retries": retry_cfg.max_retries if retry_cfg else 2,
            "base_delay_ms": retry_cfg.base_delay_ms if retry_cfg else 1000,
            "retryable_statuses": retry_cfg.retryable_statuses if retry_cfg else [429, 500, 502, 503, 504],
        }
        self._fallbacks: Dict[str, List[str]] = resolved.fallbacks or {}
        self._default_model = resolved.default_model

        # Providers — API keys are passed through, never stored on gateway
        self._providers: Dict[str, LLMProvider] = {}
        for name, provider_cfg in resolved.providers.items():
            if name == "openai":
                self._providers["openai"] = OpenAIProvider(provider_cfg)
            elif name == "anthropic":
                self._providers["anthropic"] = AnthropicProvider(provider_cfg)
            elif name == "mistral":
                self._providers["mistral"] = MistralProvider(provider_cfg)
            elif name == "google":
                self._providers["google"] = GoogleProvider(provider_cfg)
            elif name == "ollama":
                self._providers["ollama"] = OllamaProvider(provider_cfg)

        # Knowledge base (RAG)
        self._kb: Optional[KnowledgeBase] = None
        openai_key = resolved.providers.get("openai")
        if resolved.rag and resolved.rag.enabled and openai_key:
            self._kb = KnowledgeBase(
                db_path=db_path,
                config=resolved.rag,
                openai_api_key=openai_key.api_key,
            )

        self._initialized = False
        self._shutdown_requested = False
        self._active_requests = 0

    # ------------------------------------------------------------------
    # Mode presets
    # ------------------------------------------------------------------

    @staticmethod
    def _apply_mode_presets(config: GatewayConfig) -> GatewayConfig:
        """Apply mode presets — individual settings override preset values."""
        if not config.mode:
            return config

        presets = {
            "strict": {
                "pii": PIIConfig(enabled=True, action="block"),
                "budgets": BudgetConfig(enabled=True, default_user_limit=100_000, on_exceeded="block"),
                "prompt_guard": PromptGuardConfig(enabled=True, action="block", sensitivity="high"),
                "audit": True,
            },
            "balanced": {
                "pii": PIIConfig(enabled=True, action="redact"),
                "budgets": BudgetConfig(enabled=True, default_user_limit=500_000),
                "audit": True,
            },
            "dev": {
                "pii": PIIConfig(enabled=False),
                "budgets": BudgetConfig(enabled=False),
                "audit": True,
            },
        }
        preset = presets.get(config.mode, {})
        if config.pii is None:
            config.pii = preset.get("pii")
        if config.budgets is None:
            config.budgets = preset.get("budgets")
        if config.prompt_guard is None:
            config.prompt_guard = preset.get("prompt_guard")
        return config

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def init(self) -> None:
        """Initialize database tables. Called automatically on first request."""
        if self._initialized:
            return
        await self._db.init()
        if self._kb:
            await self._kb.initialize()
        self._initialized = True
        logger.info("AIGateway initialized")

    async def shutdown(self) -> None:
        """Graceful shutdown — wait for in-flight requests, close connections."""
        self._shutdown_requested = True
        deadline = time.monotonic() + 30
        while self._active_requests > 0 and time.monotonic() < deadline:
            await asyncio.sleep(0.1)
        await self._db.close()
        logger.info("AIGateway shut down")

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def audit(self) -> AuditStore:
        """Get the audit store for direct queries."""
        return self._audit_store

    @property
    def policies(self) -> PolicyEngine:
        """Get the policy engine for runtime policy management."""
        return self._policy_engine

    @property
    def database(self) -> Database:
        """Get the database instance."""
        return self._db

    @property
    def rag(self) -> Optional[KnowledgeBase]:
        """Get the knowledge base for document ingestion and search."""
        return self._kb

    @property
    def enabled(self) -> bool:
        """Kill switch — disable/enable the gateway at runtime."""
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        self._enabled = value

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------

    async def chat(self, request: ChatRequest) -> ChatResponse:
        """
        Send a chat completion request through the full governance pipeline.

        Pipeline: Validate -> Injection scan -> PII scan -> Policy check ->
        Rate limit -> Budget check -> RAG augment -> LLM call (with timeout) ->
        Output PII scan -> Cost calc -> Audit log
        """
        if not self._enabled:
            raise BulwarkError("GATEWAY_DISABLED", "AI gateway is disabled. Set enabled=True to resume.")
        if self._shutdown_requested:
            raise BulwarkError("SHUTTING_DOWN", "Gateway is shutting down, not accepting new requests")

        await self.init()
        self._active_requests += 1
        start = time.monotonic()
        trace: Optional[List[TraceStep]] = [] if request.debug else None

        try:
            # 0. Input Validation
            self._validate_request(request)
            model = request.model or self._default_model or "gpt-4o"

            # 1. Prompt Injection Detection — scan ALL user messages
            messages = list(request.messages)
            for i, msg in enumerate(messages):
                if msg.role == "user":
                    guard_result = self._prompt_guard.scan(msg.content)
                    if not guard_result.safe:
                        if guard_result.sanitized_text:
                            messages[i] = ChatMessage(
                                role=msg.role,
                                content=guard_result.sanitized_text,
                                name=msg.name,
                            )
                        else:
                            await self._audit_store.log(
                                action="policy_block",
                                tenant_id=request.tenant_id,
                                user_id=request.user_id,
                                team_id=request.team_id,
                                model=model,
                                policy_violations=[
                                    f"prompt_injection:{inj.pattern}"
                                    for inj in guard_result.injections
                                ],
                            )
                            patterns = ", ".join(inj.pattern for inj in guard_result.injections)
                            raise BulwarkError(
                                "PROMPT_INJECTION",
                                f"Prompt injection detected in message {i}: {patterns}",
                                details={"injections": [
                                    {"pattern": inj.pattern, "severity": inj.severity}
                                    for inj in guard_result.injections
                                ]},
                            )

            # 2. PII Detection — scan ALL user messages
            pii_detections: List[PIIMatch] = []
            if request.pii is not False:
                for i, msg in enumerate(messages):
                    if msg.role != "user":
                        continue
                    result = self._pii_detector.scan(msg.content)
                    pii_detections.extend(result.matches)
                    if result.blocked:
                        await self._audit_store.log(
                            action="pii_detected",
                            tenant_id=request.tenant_id,
                            user_id=request.user_id,
                            team_id=request.team_id,
                            model=model,
                            pii_detections=len(result.matches),
                        )
                        types = ", ".join(m.type for m in result.matches)
                        raise BulwarkError(
                            "PII_BLOCKED",
                            f"PII detected and blocked in message {i}: {types}",
                            details={"piiDetections": [m.type for m in result.matches]},
                        )
                    if result.redacted:
                        messages[i] = ChatMessage(
                            role=msg.role,
                            content=result.text,
                            name=msg.name,
                        )

            # 3. Content Policy Check
            if not request.skip_policies:
                violations = self._policy_engine.check(
                    messages,
                    user_id=request.user_id,
                    team_id=request.team_id,
                    tenant_id=request.tenant_id,
                )
                blocked = [v for v in violations if v.action == "block"]
                if blocked:
                    await self._audit_store.log(
                        action="policy_block",
                        tenant_id=request.tenant_id,
                        user_id=request.user_id,
                        team_id=request.team_id,
                        model=model,
                        policy_violations=[v.policy_id for v in blocked],
                    )
                    names = ", ".join(v.policy_name for v in blocked)
                    raise BulwarkError(
                        "POLICY_BLOCKED",
                        f"Content policy violated: {names}",
                        details={"violations": [
                            {"policyId": v.policy_id, "policyName": v.policy_name}
                            for v in blocked
                        ]},
                    )

            # 4. Budget Check
            if self._budget_manager.enabled:
                budget_result = await self._budget_manager.check_budget(
                    user_id=request.user_id,
                    team_id=request.team_id,
                    tenant_id=request.tenant_id,
                )
                if not budget_result.ok:
                    await self._audit_store.log(
                        action="budget_exceeded",
                        tenant_id=request.tenant_id,
                        user_id=request.user_id,
                        team_id=request.team_id,
                        model=model,
                        metadata={"used": budget_result.used, "limit": budget_result.limit},
                    )
                    raise BulwarkError(
                        "BUDGET_EXCEEDED",
                        f"Budget exceeded: {budget_result.used}/{budget_result.limit} tokens used",
                        details={"used": budget_result.used, "limit": budget_result.limit},
                    )

            # 5. System prompt hardening
            has_system = any(m.role == "system" for m in messages)
            pii_enabled = self._pii_detector.config.enabled
            if has_system:
                messages = [
                    ChatMessage(
                        role=m.role,
                        content=harden_system_prompt(
                            m.content,
                            prevent_extraction=True,
                            enforce_gdpr=pii_enabled,
                        ) if m.role == "system" else m.content,
                        name=m.name,
                    )
                    for m in messages
                ]

            # 5b. RAG Augmentation — search KB and inject context into system prompt
            sources: Optional[List[SourceInfo]] = None
            if request.knowledge_base and self._kb:
                last_content = messages[-1].content if messages else ""
                rag_results = await self._kb.search(
                    last_content,
                    tenant_id=request.tenant_id,
                    top_k=6,
                )
                if rag_results:
                    sources = [
                        SourceInfo(content=r.chunk.content, source=r.chunk.source_name, score=r.score)
                        for r in rag_results
                    ]
                    context = "\n\n".join(
                        f"[{i + 1}] {r.chunk.source_name}: {r.chunk.content}"
                        for i, r in enumerate(rag_results)
                    )
                    rag_instruction = (
                        "\n\nUse ONLY the following knowledge base context to answer. "
                        "Cite sources using [1], [2] etc. If the context doesn't contain "
                        "the answer, say so — do not make up information.\n\n"
                        f"--- KNOWLEDGE BASE CONTEXT ---\n{context}\n--- END CONTEXT ---"
                    )
                    if has_system:
                        messages = [
                            ChatMessage(
                                role=m.role,
                                content=m.content + rag_instruction if m.role == "system" else m.content,
                                name=m.name,
                            )
                            for m in messages
                        ]
                    else:
                        base_prompt = harden_system_prompt(
                            "You are a helpful assistant.",
                            prevent_extraction=True,
                            enforce_gdpr=pii_enabled,
                        )
                        messages = [
                            ChatMessage(role="system", content=base_prompt + rag_instruction),
                            *messages,
                        ]

            # 6. LLM Call with Retry + Fallback
            llm_result = await self._call_with_retry_and_fallback(model, messages, request)
            llm_response = llm_result["response"]
            actual_model = llm_result["model"]
            actual_provider = llm_result["provider"]

            # 7. Cost Calculation
            cost_record = self._cost_calculator.calculate(
                actual_model,
                llm_response.input_tokens,
                llm_response.output_tokens,
            )

            # 8. Record Usage
            if self._budget_manager.enabled:
                await self._budget_manager.record_usage(UsageRecord(
                    user_id=request.user_id,
                    team_id=request.team_id,
                    tenant_id=request.tenant_id,
                    model=actual_model,
                    input_tokens=llm_response.input_tokens,
                    output_tokens=llm_response.output_tokens,
                    cost_usd=cost_record.total_cost,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                ))

            # 9. Output PII Scanning
            output_content = llm_response.content
            output_pii: List[PIIMatch] = []
            if request.pii is not False:
                output_scan = self._pii_detector.scan(output_content)
                output_pii.extend(output_scan.matches)
                if output_scan.redacted:
                    output_content = output_scan.text

            # 10. Audit Log
            duration_ms = (time.monotonic() - start) * 1000
            total_pii = len(pii_detections) + len(output_pii)
            audit_id = await self._audit_store.log(
                action="chat",
                tenant_id=request.tenant_id,
                user_id=request.user_id,
                team_id=request.team_id,
                model=actual_model,
                provider=actual_provider,
                input_tokens=llm_response.input_tokens,
                output_tokens=llm_response.output_tokens,
                cost_usd=cost_record.total_cost,
                duration_ms=duration_ms,
                pii_detections=total_pii or None,
                metadata=request.metadata,
            )

            # Build PII detection list for response
            pii_info: Optional[List[PIIDetectionInfo]] = None
            if total_pii > 0:
                pii_info = [
                    *(PIIDetectionInfo(type=m.type, redacted=True, direction="input") for m in pii_detections),
                    *(PIIDetectionInfo(type=m.type, redacted=True, direction="output") for m in output_pii),
                ]

            return ChatResponse(
                content=output_content,
                model=actual_model,
                provider=actual_provider,
                usage=TokenUsage(
                    input_tokens=llm_response.input_tokens,
                    output_tokens=llm_response.output_tokens,
                    total_tokens=llm_response.total_tokens,
                ),
                cost=CostBreakdown(
                    input=cost_record.input_cost,
                    output=cost_record.output_cost,
                    total=cost_record.total_cost,
                ),
                pii_detections=pii_info,
                sources=sources,
                audit_id=audit_id,
                duration_ms=duration_ms,
                trace=trace,
            )

        finally:
            self._active_requests -= 1

    # ------------------------------------------------------------------
    # Streaming Chat
    # ------------------------------------------------------------------

    async def chat_stream(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        """
        Streaming chat — runs the full governance pipeline, then streams the LLM response.

        Pre-flight checks (PII, policies, budget, rate limit) run BEFORE streaming starts.
        Output PII scanning runs on the accumulated full response after streaming ends.
        """
        if self._shutdown_requested:
            raise BulwarkError("SHUTTING_DOWN", "Gateway is shutting down")
        if not self._enabled:
            raise BulwarkError("GATEWAY_DISABLED", "AI gateway is disabled")

        await self.init()
        self._active_requests += 1
        start = time.monotonic()

        try:
            self._validate_request(request)
            model = request.model or self._default_model or "gpt-4o"

            # Prompt injection scan
            messages = list(request.messages)
            pii_types: List[str] = []
            for i, msg in enumerate(messages):
                if msg.role == "user":
                    guard_result = self._prompt_guard.scan(msg.content)
                    if not guard_result.safe:
                        if guard_result.sanitized_text:
                            messages[i] = ChatMessage(role=msg.role, content=guard_result.sanitized_text, name=msg.name)
                        else:
                            patterns = ", ".join(inj.pattern for inj in guard_result.injections)
                            raise BulwarkError("PROMPT_INJECTION", f"Prompt injection detected in message {i}: {patterns}")

            # PII scan
            if request.pii is not False:
                for i, msg in enumerate(messages):
                    if msg.role != "user":
                        continue
                    result = self._pii_detector.scan(msg.content)
                    pii_types.extend(m.type for m in result.matches)
                    if result.blocked:
                        raise BulwarkError("PII_BLOCKED", f"PII detected and blocked in message {i}")
                    if result.redacted:
                        messages[i] = ChatMessage(role=msg.role, content=result.text, name=msg.name)

            # Policy check
            if not request.skip_policies:
                violations = self._policy_engine.check(
                    messages, user_id=request.user_id, team_id=request.team_id, tenant_id=request.tenant_id
                )
                blocked = [v for v in violations if v.action == "block"]
                if blocked:
                    names = ", ".join(v.policy_name for v in blocked)
                    raise BulwarkError("POLICY_BLOCKED", f"Policy violated: {names}")

            # Budget check
            if self._budget_manager.enabled:
                budget_result = await self._budget_manager.check_budget(
                    user_id=request.user_id, team_id=request.team_id, tenant_id=request.tenant_id
                )
                if not budget_result.ok:
                    raise BulwarkError("BUDGET_EXCEEDED", "Budget exceeded")

            # System prompt hardening
            has_system = any(m.role == "system" for m in messages)
            pii_enabled = self._pii_detector.config.enabled
            if has_system:
                messages = [
                    ChatMessage(
                        role=m.role,
                        content=harden_system_prompt(m.content, prevent_extraction=True, enforce_gdpr=pii_enabled)
                        if m.role == "system" else m.content,
                        name=m.name,
                    )
                    for m in messages
                ]

            # Resolve provider
            provider_name, provider_instance = self._resolve_provider(model)

            # Emit pre-flight results
            if pii_types:
                yield StreamEvent(type="pii_warning", pii_types=pii_types)

            # Stream from provider
            llm_request = LLMRequest(
                model=model,
                messages=[{"role": m.role, "content": m.content} for m in messages],
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                top_p=request.top_p,
                stop=request.stop,
            )

            full_content = ""
            final_usage: Optional[dict] = None

            async for chunk in provider_instance.chat_stream(llm_request):
                if chunk.content:
                    full_content += chunk.content
                    yield StreamEvent(type="delta", content=chunk.content)
                if chunk.usage:
                    final_usage = chunk.usage

            # Post-stream: output PII scan
            if request.pii is not False:
                out_scan = self._pii_detector.scan(full_content)
                if out_scan.matches:
                    pii_types.extend(f"output:{m.type}" for m in out_scan.matches)

            # Cost + audit
            usage = final_usage or {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
            input_t = usage.get("inputTokens", 0)
            output_t = usage.get("outputTokens", 0)
            total_t = usage.get("totalTokens", 0)
            cost_record = self._cost_calculator.calculate(model, input_t, output_t)

            if self._budget_manager.enabled:
                await self._budget_manager.record_usage(UsageRecord(
                    user_id=request.user_id, team_id=request.team_id, tenant_id=request.tenant_id,
                    model=model, input_tokens=input_t, output_tokens=output_t,
                    cost_usd=cost_record.total_cost, timestamp=datetime.now(timezone.utc).isoformat(),
                ))

            duration_ms = (time.monotonic() - start) * 1000
            audit_id = await self._audit_store.log(
                action="chat", tenant_id=request.tenant_id, user_id=request.user_id,
                team_id=request.team_id, model=model, provider=provider_name,
                input_tokens=input_t, output_tokens=output_t,
                cost_usd=cost_record.total_cost, duration_ms=duration_ms,
                pii_detections=len(pii_types) or None,
            )

            yield StreamEvent(
                type="done",
                usage=TokenUsage(input_tokens=input_t, output_tokens=output_t, total_tokens=total_t),
                cost=CostBreakdown(input=cost_record.input_cost, output=cost_record.output_cost, total=cost_record.total_cost),
                audit_id=audit_id,
                duration_ms=duration_ms,
            )

        finally:
            self._active_requests -= 1

    # ------------------------------------------------------------------
    # Request Validation
    # ------------------------------------------------------------------

    def _validate_request(self, request: ChatRequest) -> None:
        """Validate chat request inputs."""
        if not request.messages or len(request.messages) == 0:
            raise BulwarkError("INVALID_REQUEST", "messages array is required and must not be empty")
        if len(request.messages) > MAX_MESSAGES:
            raise BulwarkError("INVALID_REQUEST", f"Too many messages: {len(request.messages)} (max: {MAX_MESSAGES})")

        valid_roles = {"system", "user", "assistant", "tool"}
        for msg in request.messages:
            if msg.role not in valid_roles:
                raise BulwarkError("INVALID_REQUEST", f"Invalid message role: {msg.role}")
            if not isinstance(msg.content, str):
                raise BulwarkError("INVALID_REQUEST", "Message content must be a string")
            if len(msg.content) > MAX_MESSAGE_LENGTH:
                raise BulwarkError("INVALID_REQUEST", f"Message too long: {len(msg.content)} chars (max: {MAX_MESSAGE_LENGTH})")

        if request.temperature is not None and (request.temperature < 0 or request.temperature > 2):
            raise BulwarkError("INVALID_REQUEST", "temperature must be between 0 and 2")
        if request.max_tokens is not None and (request.max_tokens < 1 or request.max_tokens > 200_000):
            raise BulwarkError("INVALID_REQUEST", "max_tokens must be between 1 and 200000")

    # ------------------------------------------------------------------
    # Provider Resolution
    # ------------------------------------------------------------------

    def _resolve_provider(self, model: str) -> Tuple[str, LLMProvider]:
        """Resolve which provider handles a given model."""
        m = model.lower()
        if m.startswith("claude"):
            return self._get_provider("anthropic")
        if m.startswith(("mistral", "codestral", "pixtral")):
            return self._get_provider("mistral")
        if m.startswith(("gemini", "palm")):
            return self._get_provider("google")
        if m.startswith(("llama", "phi", "qwen", "deepseek", "codellama")):
            return self._get_provider("ollama")
        return self._get_provider("openai")

    def _get_provider(self, name: str) -> Tuple[str, LLMProvider]:
        instance = self._providers.get(name)
        if instance is None:
            raise BulwarkError(
                "PROVIDER_NOT_CONFIGURED",
                f"{name} provider not configured. Add providers['{name}'] to your config.",
            )
        return name, instance

    # ------------------------------------------------------------------
    # Retry + Fallback
    # ------------------------------------------------------------------

    async def _call_with_retry_and_fallback(
        self,
        model: str,
        messages: List[ChatMessage],
        request: ChatRequest,
    ) -> Dict[str, Any]:
        """Call LLM with retry + fallback chain."""
        models_to_try = [model] + self._fallbacks.get(model, [])
        last_error: Optional[Exception] = None

        for current_model in models_to_try:
            try:
                provider_name, provider_instance = self._resolve_provider(current_model)
            except BulwarkError:
                continue  # Provider not configured, try next fallback

            max_retries = self._retry_config["max_retries"]
            base_delay = self._retry_config["base_delay_ms"]
            retryable = self._retry_config["retryable_statuses"]

            for attempt in range(max_retries + 1):
                try:
                    llm_request = LLMRequest(
                        model=current_model,
                        messages=[{"role": m.role, "content": m.content} for m in messages],
                        temperature=request.temperature,
                        max_tokens=request.max_tokens,
                        top_p=request.top_p,
                        stop=request.stop,
                    )
                    response = await asyncio.wait_for(
                        provider_instance.chat(llm_request),
                        timeout=self._timeout_ms / 1000,
                    )
                    return {"response": response, "model": current_model, "provider": provider_name}

                except asyncio.TimeoutError:
                    last_error = BulwarkError(
                        "LLM_TIMEOUT",
                        f"LLM call to {current_model} timed out after {self._timeout_ms}ms",
                    )
                    if attempt == max_retries:
                        break
                except BulwarkError as e:
                    last_error = e
                    is_retryable = e.http_status in retryable
                    if not is_retryable or attempt == max_retries:
                        break
                except Exception as e:
                    last_error = BulwarkError("LLM_ERROR", f"LLM call failed: {e}")
                    if attempt == max_retries:
                        break

                # Exponential backoff
                delay = (base_delay / 1000) * (2 ** attempt)
                await asyncio.sleep(delay)

        # All models exhausted
        if isinstance(last_error, BulwarkError):
            raise last_error
        raise BulwarkError(
            "LLM_ERROR",
            f"All models failed. Last error: {last_error}",
            details={"tried_models": models_to_try},
        )
