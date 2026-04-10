// Core
export { AIGateway, BulwarkError } from "./gateway";
export type { GatewayConfig, GatewayMode, FailMode, ChatRequest, ChatResponse, ChatMessage, GatewayProvider, ProviderConfig } from "./types";

// Security
export { PIIDetector } from "./security/pii";
export { PolicyEngine } from "./security/policies";
export type { PIIConfig, PIIMatch, PIIType, ContentPolicy } from "./security/types";
export { PromptGuard, hardenSystemPrompt } from "./security/prompt-guard";
export type { PromptGuardConfig, PromptGuardResult } from "./security/prompt-guard";

// Billing
export { CostCalculator } from "./billing/costs";
export { BudgetManager } from "./billing/budgets";
export { MODEL_PRICING } from "./billing/types";
export type { BudgetConfig, UsageRecord, CostRecord, BudgetAlert } from "./billing/types";

// Audit
export { createAuditStore } from "./audit/store";
export type { AuditEntry, AuditStore, AuditQuery } from "./audit/types";

// RAG
export { KnowledgeBase } from "./rag/knowledge-base";
export { chunkText } from "./rag/chunker";
export { OpenAIEmbeddings, cosineSimilarity } from "./rag/embeddings";
export { parsePDF, parseHTML, parseCSV, parseMarkdown, parseDocument } from "./rag/parsers";
export type { RAGConfig, SearchResult, Chunk, KnowledgeSource } from "./rag/types";

// Cache & Rate Limiting
export { MemoryCacheStore } from "./cache/memory";
export { RedisCacheStore } from "./cache/redis";
export { RateLimiter } from "./cache/rate-limiter";
export { ResponseCache } from "./cache/response-cache";
export type { CacheStore, RateLimitConfig, RateLimitResult, ResponseCacheConfig } from "./cache/types";

// Circuit Breaker
export { CircuitBreaker } from "./circuit-breaker";
export type { CircuitBreakerConfig } from "./circuit-breaker";

// Streaming
export type { StreamEvent } from "./streaming";

// Multi-tenant
export { TenantManager } from "./tenant";
export type { TenantConfig, TenantGovConfig } from "./tenant";

// Compliance
export { GDPRManager } from "./compliance/gdpr";
export type { GDPRConfig, BreachEvent, UserDataExport, ProcessingReport } from "./compliance/gdpr";
export { SOC2Manager } from "./compliance/soc2";
export type { SOC2Config, AnomalyEvent, HealthStatus, ChangeLogEntry, VendorReport } from "./compliance/soc2";
export { HIPAAManager, HIPAA_IDENTIFIERS } from "./compliance/hipaa";
export type { HIPAAConfig, PHIAccessLog } from "./compliance/hipaa";
export { CCPAManager } from "./compliance/ccpa";
export type { CCPAConfig, ConsumerRequest } from "./compliance/ccpa";
export { DataResidencyManager, PROVIDER_REGIONS } from "./compliance/data-residency";
export type { DataResidencyConfig, TransferAssessment } from "./compliance/data-residency";

// Database
export { createDatabase } from "./database";
export type { Database } from "./database";

// Providers
export type { LLMProvider, LLMRequest, LLMResponse } from "./providers/base";
export { OpenAIProvider } from "./providers/openai";
export { AnthropicProvider } from "./providers/anthropic";
export { MistralProvider } from "./providers/mistral";
export { GoogleProvider } from "./providers/google";
export { OllamaProvider } from "./providers/ollama";
export { AzureOpenAIProvider } from "./providers/azure-openai";

// Middleware
export { bulwarkMiddleware, bulwarkRouter } from "./middleware/express";
export { createNextHandler, createNextAuditHandler } from "./middleware/nextjs";
export { bulwarkPlugin } from "./middleware/fastify";

// Admin
export { createAdminRouter, getDashboard } from "./admin/api";
export type { AdminDashboard } from "./admin/api";
