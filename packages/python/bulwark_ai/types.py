"""Core type definitions for the Bulwark AI Python SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Union,
)


# ---------------------------------------------------------------------------
# Provider config
# ---------------------------------------------------------------------------

@dataclass
class ProviderConfig:
    """Configuration for an LLM provider."""
    api_key: str
    base_url: Optional[str] = None
    default_model: Optional[str] = None


GatewayProvider = Literal["openai", "anthropic", "mistral", "google", "ollama", "custom"]
GatewayMode = Literal["strict", "balanced", "dev"]
FailMode = Literal["fail-closed", "fail-open"]


# ---------------------------------------------------------------------------
# Security types
# ---------------------------------------------------------------------------

PIIType = Literal[
    "email", "phone", "ssn", "credit_card", "iban",
    "ip_address", "passport", "drivers_license",
    "date_of_birth", "address", "name",
    "vat_number", "national_id", "medical_id",
]


@dataclass
class CustomPIIPattern:
    """Custom regex pattern for PII detection."""
    name: str
    pattern: str
    action: Optional[Literal["block", "redact", "warn"]] = None


@dataclass
class PIIConfig:
    """PII detection configuration."""
    enabled: bool = False
    action: Literal["block", "redact", "warn"] = "warn"
    types: Optional[List[str]] = None
    custom_patterns: Optional[List[Dict[str, str]]] = None


@dataclass
class ContentPolicy:
    """Content policy definition."""
    id: str
    name: str
    type: Literal["topic_restriction", "keyword_block", "regex_block", "max_tokens"]
    action: Literal["block", "warn"]
    patterns: Optional[List[str]] = None
    regex: Optional[str] = None
    max_tokens: Optional[int] = None
    apply_to: Optional[Dict[str, List[str]]] = None
    tenant_id: Optional[str] = None


@dataclass
class PromptGuardConfig:
    """Prompt injection guard configuration."""
    enabled: bool = True
    action: Literal["block", "warn", "sanitize"] = "block"
    sensitivity: Literal["low", "medium", "high"] = "medium"


# ---------------------------------------------------------------------------
# Budget / billing types
# ---------------------------------------------------------------------------

@dataclass
class BudgetAlert:
    """Alert fired when budget threshold is crossed."""
    type: Literal["user", "team", "tenant"]
    id: str
    threshold: float
    used: int
    limit: int
    cost_usd: float


@dataclass
class BudgetConfig:
    """Budget enforcement configuration."""
    enabled: bool = False
    default_user_limit: int = 0
    default_team_limit: int = 0
    on_exceeded: Literal["block", "warn"] = "block"
    alert_thresholds: Optional[List[float]] = None
    on_alert: Optional[Callable[..., Any]] = None


@dataclass
class UsageRecord:
    """Token usage record for billing."""
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    timestamp: str
    user_id: Optional[str] = None
    team_id: Optional[str] = None
    tenant_id: Optional[str] = None


@dataclass
class CostRecord:
    """Calculated cost for a request."""
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    input_cost: float
    output_cost: float
    total_cost: float


# ---------------------------------------------------------------------------
# RAG types
# ---------------------------------------------------------------------------

@dataclass
class RAGConfig:
    """RAG knowledge base configuration."""
    enabled: bool = False
    top_k: int = 6
    min_score: float = 0.3


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

@dataclass
class RateLimitConfig:
    """Rate limiting configuration."""
    enabled: bool = False
    max_requests: int = 60
    window_seconds: int = 60
    scope: Literal["user", "team", "tenant", "ip"] = "user"


@dataclass
class RateLimitResult:
    """Result from a rate limit check."""
    allowed: bool
    remaining: int
    reset_at: int


# ---------------------------------------------------------------------------
# Retry / fallback
# ---------------------------------------------------------------------------

@dataclass
class RetryConfig:
    """Retry configuration for failed LLM calls."""
    max_retries: int = 2
    base_delay_ms: int = 1000
    retryable_statuses: List[int] = field(default_factory=lambda: [429, 500, 502, 503, 504])


# ---------------------------------------------------------------------------
# Chat messages / request / response
# ---------------------------------------------------------------------------

@dataclass
class ChatMessage:
    """A single message in a conversation."""
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    name: Optional[str] = None


@dataclass
class ChatRequest:
    """Request to the AI Gateway chat endpoint."""
    messages: List[ChatMessage]
    model: Optional[str] = None
    user_id: Optional[str] = None
    team_id: Optional[str] = None
    tenant_id: Optional[str] = None
    knowledge_base: Optional[Union[bool, str]] = None
    pii: Optional[bool] = None
    skip_policies: bool = False
    stream: bool = False
    debug: bool = False
    metadata: Optional[Dict[str, Any]] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    stop: Optional[List[str]] = None


@dataclass
class TokenUsage:
    """Token usage breakdown."""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


@dataclass
class CostBreakdown:
    """Cost breakdown in USD."""
    input: float = 0.0
    output: float = 0.0
    total: float = 0.0


@dataclass
class PIIDetectionInfo:
    """PII detection result for the response."""
    type: str
    redacted: bool
    direction: Optional[Literal["input", "output"]] = None


@dataclass
class PolicyViolationInfo:
    """Policy violation in the response."""
    policy: str
    action: Literal["blocked", "warned"]


@dataclass
class SourceInfo:
    """RAG source used in the response."""
    content: str
    source: str
    score: float


@dataclass
class TraceStep:
    """Debug trace step."""
    stage: str
    result: str
    duration_ms: float
    details: Optional[Any] = None


@dataclass
class ChatResponse:
    """Response from the AI Gateway."""
    content: str
    model: str
    provider: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    cost: CostBreakdown = field(default_factory=CostBreakdown)
    pii_detections: Optional[List[PIIDetectionInfo]] = None
    policy_violations: Optional[List[PolicyViolationInfo]] = None
    sources: Optional[List[SourceInfo]] = None
    audit_id: Optional[str] = None
    duration_ms: float = 0.0
    trace: Optional[List[TraceStep]] = None


@dataclass
class StreamEvent:
    """Event emitted during streaming chat."""
    type: Literal["delta", "sources", "pii_warning", "usage", "done", "error"]
    content: Optional[str] = None
    sources: Optional[List[SourceInfo]] = None
    pii_types: Optional[List[str]] = None
    usage: Optional[TokenUsage] = None
    cost: Optional[CostBreakdown] = None
    audit_id: Optional[str] = None
    duration_ms: Optional[float] = None


# ---------------------------------------------------------------------------
# Audit types
# ---------------------------------------------------------------------------

@dataclass
class AuditEntry:
    """Audit log entry."""
    id: str
    action: str
    timestamp: str
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None
    team_id: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    duration_ms: Optional[float] = None
    pii_detections: Optional[int] = None
    policy_violations: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class AuditQuery:
    """Filters for querying audit logs."""
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None
    team_id: Optional[str] = None
    action: Optional[str] = None
    from_time: Optional[str] = None
    to_time: Optional[str] = None
    limit: int = 50
    offset: int = 0


# ---------------------------------------------------------------------------
# Gateway config
# ---------------------------------------------------------------------------

@dataclass
class GatewayConfig:
    """Full configuration for the AI Gateway."""
    providers: Dict[str, ProviderConfig]
    database: str
    mode: Optional[GatewayMode] = None
    fail_mode: FailMode = "fail-closed"
    enabled: bool = True
    pii: Optional[Union[PIIConfig, bool]] = None
    policies: Optional[List[ContentPolicy]] = None
    budgets: Optional[Union[BudgetConfig, bool]] = None
    audit: bool = True
    rag: Optional[RAGConfig] = None
    multi_tenant: bool = False
    default_model: Optional[str] = None
    model_pricing: Optional[Dict[str, Dict[str, float]]] = None
    prompt_guard: Optional[PromptGuardConfig] = None
    timeout_ms: int = 120_000
    rate_limit: Optional[RateLimitConfig] = None
    retry: Optional[RetryConfig] = None
    fallbacks: Optional[Dict[str, List[str]]] = None
