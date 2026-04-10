import type { PIIConfig, ContentPolicy } from "./security/types";
import type { BudgetConfig } from "./billing/types";
import type { RAGConfig } from "./rag/types";

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export type GatewayProvider = "openai" | "anthropic" | "mistral" | "google" | "ollama" | "azure" | "custom";

/**
 * Quick-start presets — use instead of manual config.
 * - `strict`: All protections on, PII blocked, low budgets, injection guard high sensitivity
 * - `balanced`: PII redacted, moderate budgets, injection guard medium (default behavior)
 * - `dev`: Minimal protections, no budgets, audit only — for development/testing
 */
export type GatewayMode = "strict" | "balanced" | "dev";

/**
 * What happens when the governance system itself fails (e.g., DB down, PII scan crashes).
 * - `fail-closed`: Block the request (safe default — no request passes without governance)
 * - `fail-open`: Allow the request through (availability-first — log the failure, don't block users)
 */
export type FailMode = "fail-closed" | "fail-open";

export interface GatewayConfig {
  /** Quick-start preset — sets sensible defaults for all options. Individual settings override. */
  mode?: GatewayMode;

  /** What happens when governance checks fail (default: "fail-closed") */
  failMode?: FailMode;

  /** Global kill switch — set to false to block ALL requests instantly */
  enabled?: boolean;

  /** LLM provider credentials */
  providers: Partial<Record<GatewayProvider, ProviderConfig>>;

  /** Database connection — SQLite path or Postgres URL */
  database: string;

  /** PII detection config */
  pii?: PIIConfig | boolean;

  /** Content policies */
  policies?: ContentPolicy[];

  /** Budget enforcement */
  budgets?: BudgetConfig | boolean;

  /** Audit logging — true = enabled with defaults */
  audit?: boolean;

  /** RAG knowledge base */
  rag?: RAGConfig;

  /** Multi-tenant mode */
  multiTenant?: boolean;

  /** Default model to use if not specified per request */
  defaultModel?: string;

  /** Model pricing overrides (per million tokens) */
  modelPricing?: Record<string, { input: number; output: number }>;

  /** Prompt injection guard config */
  promptGuard?: { enabled?: boolean; action?: "block" | "warn"; sensitivity?: "low" | "medium" | "high" };

  /** LLM call timeout in ms (default: 120000) */
  timeoutMs?: number;

  /** Cache store for rate limiting + response caching */
  cache?: unknown;

  /** Rate limiting config */
  rateLimit?: { enabled?: boolean; maxRequests?: number; windowSeconds?: number; scope?: "user" | "team" | "tenant" | "ip" };

  /** Retry config for failed LLM calls */
  retry?: {
    /** Max retry attempts (default: 2) */
    maxRetries?: number;
    /** Base delay in ms before retry (default: 1000). Doubles each attempt (exponential backoff). */
    baseDelayMs?: number;
    /** Retry on these HTTP status codes (default: [429, 500, 502, 503, 504]) */
    retryableStatuses?: number[];
  };

  /** Response caching — caches identical deterministic requests (temperature=0) */
  responseCache?: {
    enabled: boolean;
    /** TTL for cached responses in seconds (default: 3600) */
    ttlSeconds?: number;
    /** Only cache responses below this token count */
    maxTokens?: number;
  };

  /** Circuit breaker — auto-trips after repeated provider failures */
  circuitBreaker?: {
    enabled: boolean;
    /** Consecutive failures before tripping (default: 5) */
    failureThreshold?: number;
    /** Cooldown in ms before allowing a test request (default: 30000) */
    cooldownMs?: number;
  };

  /** Max concurrent LLM requests — returns 429 when at capacity (0 = unlimited) */
  maxConcurrentRequests?: number;

  /**
   * Fallback models — tried in order when the primary model fails.
   * Maps a model name to a list of fallback models.
   *
   * @example
   * ```ts
   * fallbacks: {
   *   "gpt-4o": ["gpt-4o-mini", "claude-sonnet-4-20250514"],
   *   "claude-opus-4-20250514": ["gpt-4o", "gemini-1.5-pro"],
   * }
   * ```
   */
  fallbacks?: Record<string, string[]>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ChatRequest {
  /** Model name — auto-routes to correct provider */
  model?: string;
  messages: ChatMessage[];

  /** User ID for budget/audit tracking */
  userId?: string;
  /** Team ID for team-level budgets */
  teamId?: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId?: string;

  /** RAG knowledge base — set to true to enable, or pass a source ID to search specific source */
  knowledgeBase?: boolean | string;

  /** Override PII settings for this request */
  pii?: boolean;
  /** Override policies for this request */
  skipPolicies?: boolean;

  /** Streaming */
  stream?: boolean;

  /** Debug mode — returns pipeline trace showing what each governance step did */
  debug?: boolean;

  /** Custom metadata — stored in audit log for analytics (e.g., feature, product, environment) */
  metadata?: Record<string, string | number | boolean>;

  /** Pass-through params (temperature, max_tokens, etc) */
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
}

export interface ChatResponse {
  /** Generated text */
  content: string;

  /** Model used */
  model: string;
  /** Provider used */
  provider: GatewayProvider;

  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** Cost in USD */
  cost: {
    input: number;
    output: number;
    total: number;
  };

  /** PII detections (if any were found and redacted) */
  piiDetections?: { type: string; redacted: boolean; direction?: "input" | "output" }[];

  /** Policy violations (if any) */
  policyViolations?: { policy: string; action: "blocked" | "warned" }[];

  /** RAG sources used */
  sources?: { content: string; source: string; score: number }[];

  /** Audit log entry ID */
  auditId?: string;

  /** Request duration in ms */
  durationMs: number;

  /** Debug trace — only present when `debug: true` in request */
  trace?: { stage: string; result: string; durationMs: number; details?: unknown }[];
}
