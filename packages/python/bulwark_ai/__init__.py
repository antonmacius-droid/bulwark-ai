"""
Bulwark AI -- Enterprise AI Governance Gateway (Python SDK)

Provides PII detection, prompt injection guard, content policies,
budget control, audit logging, and multi-provider LLM routing.
"""

from .errors import BulwarkError
from .gateway import AIGateway
from .types import (
    AuditEntry,
    AuditQuery,
    BudgetAlert,
    BudgetConfig,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ContentPolicy,
    CostBreakdown,
    CostRecord,
    GatewayConfig,
    PIIConfig,
    PIIDetectionInfo,
    PolicyViolationInfo,
    PromptGuardConfig,
    ProviderConfig,
    RAGConfig,
    RateLimitConfig,
    RetryConfig,
    SourceInfo,
    StreamEvent,
    TokenUsage,
    TraceStep,
    UsageRecord,
)

__version__ = "0.1.0"

__all__ = [
    # Core
    "AIGateway",
    "BulwarkError",
    # Config
    "GatewayConfig",
    "ProviderConfig",
    "PIIConfig",
    "PromptGuardConfig",
    "BudgetConfig",
    "RAGConfig",
    "RateLimitConfig",
    "RetryConfig",
    "ContentPolicy",
    # Request / Response
    "ChatRequest",
    "ChatResponse",
    "ChatMessage",
    "TokenUsage",
    "CostBreakdown",
    "StreamEvent",
    # Response details
    "PIIDetectionInfo",
    "PolicyViolationInfo",
    "SourceInfo",
    "TraceStep",
    # Billing
    "BudgetAlert",
    "CostRecord",
    "UsageRecord",
    # Audit
    "AuditEntry",
    "AuditQuery",
]
