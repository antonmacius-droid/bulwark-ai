import type { GatewayConfig, ChatRequest, ChatResponse, GatewayProvider } from "./types";
import type { PIIMatch } from "./security/types";
import { PIIDetector } from "./security/pii";
import { PolicyEngine } from "./security/policies";
import { PromptGuard, hardenSystemPrompt, type PromptGuardConfig } from "./security/prompt-guard";
import { CostCalculator } from "./billing/costs";
import { BudgetManager } from "./billing/budgets";
import { createAuditStore } from "./audit/store";
import { createDatabase, type Database } from "./database";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { MistralProvider } from "./providers/mistral";
import { GoogleProvider } from "./providers/google";
import { OllamaProvider } from "./providers/ollama";
import { AzureOpenAIProvider } from "./providers/azure-openai";
import type { LLMProvider } from "./providers/base";
import type { AuditStore } from "./audit/types";
import { KnowledgeBase } from "./rag/knowledge-base";
import { MemoryCacheStore } from "./cache/memory";
import { RateLimiter } from "./cache/rate-limiter";
import type { CacheStore, RateLimitConfig } from "./cache/types";
import { TenantManager, type TenantGovConfig } from "./tenant";
import { CircuitBreaker, type CircuitBreakerConfig } from "./circuit-breaker";
import { ResponseCache } from "./cache/response-cache";
import { PromptGuardML, type PromptGuardMLConfig } from "./security/prompt-guard-ml";
import { OpenAIEmbeddings } from "./rag/embeddings";

/** Max message content length (characters) — prevents OOM from huge payloads */
const MAX_MESSAGE_LENGTH = 200_000;
/** Max messages per request */
const MAX_MESSAGES = 200;
/** Default LLM call timeout in ms */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Bulwark AI Gateway
 *
 * Enterprise AI governance layer — drop into any Node.js app.
 * PII detection, budget control, audit logging, multi-tenant, RAG.
 *
 * @example
 * ```ts
 * const gateway = new AIGateway({
 *   providers: { openai: { apiKey: process.env.OPENAI_API_KEY! } },
 *   database: "bulwark.db",
 *   pii: { enabled: true, action: "redact" },
 *   budgets: true,
 *   audit: true,
 * });
 *
 * const res = await gateway.chat({
 *   model: "gpt-4o",
 *   userId: "user-123",
 *   messages: [{ role: "user", content: "Hello" }],
 * });
 * ```
 */
export class AIGateway {
  private readonly db: Database;
  private readonly providers: Map<GatewayProvider, LLMProvider> = new Map();
  private readonly piiDetector: PIIDetector;
  private readonly promptGuard: PromptGuard;
  private readonly _policyEngine: PolicyEngine;
  private readonly costCalculator: CostCalculator;
  private readonly budgetManager: BudgetManager;
  private readonly auditStore: AuditStore;
  private readonly kb: KnowledgeBase | null = null;
  private readonly cache: CacheStore;
  private readonly rateLimiter: RateLimiter | null = null;
  private readonly _tenantManager: TenantManager | null = null;
  private readonly timeoutMs: number;
  private readonly retryConfig: { maxRetries: number; baseDelayMs: number; retryableStatuses: number[] };
  private readonly fallbacks: Record<string, string[]>;
  private readonly failMode: "fail-closed" | "fail-open";
  private readonly circuitBreaker: CircuitBreaker | null = null;
  private readonly responseCache: ResponseCache | null = null;
  private readonly promptGuardML: PromptGuardML | null = null;
  private readonly maxConcurrent: number;
  private _enabled: boolean;
  private initialized = false;
  private shutdownRequested = false;
  private activeRequests = 0;
  /** Per-tenant config cache: tenantId → { config, expiresAt } */
  private readonly tenantConfigCache = new Map<string, { config: TenantGovConfig; expiresAt: number }>();
  private readonly tenantConfigTtlMs = 60_000; // 1 minute cache

  constructor(config: GatewayConfig) {
    // Apply mode presets (individual settings override)
    if (config.mode) {
      const presets = {
        strict: { pii: { enabled: true, action: "block" as const }, budgets: { enabled: true, defaultUserLimit: 100_000, onExceeded: "block" as const }, promptGuard: { enabled: true, action: "block" as const, sensitivity: "high" as const }, audit: true },
        balanced: { pii: { enabled: true, action: "redact" as const }, budgets: { enabled: true, defaultUserLimit: 500_000 }, audit: true },
        dev: { pii: { enabled: false }, budgets: { enabled: false }, audit: true },
      };
      const preset = presets[config.mode];
      config = { ...preset, ...config, pii: config.pii ?? preset.pii, budgets: config.budgets ?? preset.budgets };
    }

    this.failMode = config.failMode || "fail-closed";
    this._enabled = config.enabled !== false; // default: enabled

    // Validate required config
    if (!config.providers || Object.keys(config.providers).length === 0) {
      throw new BulwarkError("INVALID_CONFIG", "At least one provider must be configured");
    }
    if (!config.database) {
      throw new BulwarkError("INVALID_CONFIG", "Database connection string is required");
    }

    this.db = createDatabase(config.database);
    this.piiDetector = new PIIDetector(
      typeof config.pii === "boolean" ? { enabled: config.pii, action: "warn" } : config.pii || { enabled: false }
    );
    this.promptGuard = new PromptGuard(
      config.promptGuard as PromptGuardConfig || { enabled: true, action: "block", sensitivity: "medium" }
    );

    // ML-based prompt injection detection (requires OpenAI API key for embeddings)
    const mlConfig = config.promptGuard?.ml as PromptGuardMLConfig | undefined;
    if (mlConfig?.enabled && config.providers.openai?.apiKey) {
      const embedder = new OpenAIEmbeddings(config.providers.openai.apiKey);
      this.promptGuardML = new PromptGuardML(embedder, mlConfig);
    }

    this._policyEngine = new PolicyEngine(config.policies || []);
    this.costCalculator = new CostCalculator(config.modelPricing);
    this.budgetManager = new BudgetManager(
      this.db,
      typeof config.budgets === "boolean" ? { enabled: config.budgets } : config.budgets || { enabled: false }
    );
    this.auditStore = createAuditStore(this.db);
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? 2,
      baseDelayMs: config.retry?.baseDelayMs ?? 1000,
      retryableStatuses: config.retry?.retryableStatuses ?? [429, 500, 502, 503, 504],
    };
    this.fallbacks = config.fallbacks || {};

    // Circuit breaker
    if (config.circuitBreaker?.enabled) {
      this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    }

    // Concurrency limit
    this.maxConcurrent = config.maxConcurrentRequests || 0; // 0 = unlimited

    // Response cache (initialized after cache store below)

    // Cache — Redis or in-memory
    this.cache = (config.cache as CacheStore) || new MemoryCacheStore();

    // Rate limiter
    const rlConfig = config.rateLimit as RateLimitConfig | undefined;
    if (rlConfig?.enabled) {
      this.rateLimiter = new RateLimiter(this.cache, rlConfig);
    }

    // Response cache
    if (config.responseCache?.enabled) {
      this.responseCache = new ResponseCache(this.cache, {
        enabled: true,
        ttlSeconds: config.responseCache.ttlSeconds ?? 3600,
        maxTokens: config.responseCache.maxTokens,
      });
    }

    // Initialize providers — API keys are passed through, never stored on gateway
    if (config.providers.openai) this.providers.set("openai", new OpenAIProvider(config.providers.openai));
    if (config.providers.anthropic) this.providers.set("anthropic", new AnthropicProvider(config.providers.anthropic));
    if (config.providers.mistral) this.providers.set("mistral", new MistralProvider(config.providers.mistral));
    if (config.providers.google) this.providers.set("google", new GoogleProvider(config.providers.google));
    if (config.providers.ollama) this.providers.set("ollama", new OllamaProvider(config.providers.ollama));
    if (config.providers.azure) this.providers.set("azure", new AzureOpenAIProvider(config.providers.azure));

    // Knowledge base
    if (config.rag?.enabled && config.providers.openai?.apiKey) {
      this.kb = new KnowledgeBase(this.db, config.rag, config.providers.openai.apiKey);
    }

    // Multi-tenant
    if (config.multiTenant) {
      this._tenantManager = new TenantManager(this.db);
    }
  }

  /** Initialize database tables. Called automatically on first request. */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.db.init();
    this.initialized = true;
  }

  /**
   * Send a chat completion request through the governance pipeline.
   *
   * Pipeline: Validate → PII scan → Policy check → Rate limit → Budget check → [RAG augment] → LLM call (with timeout) → Token count → Cost calc → Audit log
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Kill switch
    if (this._enabled === false) {
      throw new BulwarkError("GATEWAY_DISABLED", "AI gateway is disabled. Set enabled: true to resume.");
    }
    if (this.shutdownRequested) {
      throw new BulwarkError("SHUTTING_DOWN", "Gateway is shutting down, not accepting new requests");
    }

    await this.init();

    // Concurrency limit
    if (this.maxConcurrent > 0 && this.activeRequests >= this.maxConcurrent) {
      throw new BulwarkError("CONCURRENCY_EXCEEDED", `Max concurrent requests (${this.maxConcurrent}) reached. Try again later.`);
    }

    this.activeRequests++;
    const start = Date.now();
    const trace: ChatResponse["trace"] = request.debug ? [] : undefined;

    try {
      // 0. Input Validation
      this.validateRequest(request);
      const model = request.model || "gpt-4o";

      // 0b. Resolve per-tenant governance overrides
      const tenantGov = this.resolveTenantGov(request.tenantId);
      const effectivePii = this.resolvePiiDetector(tenantGov);
      const effectiveGuard = this.resolvePromptGuard(tenantGov);

      // 0c. Model restriction — check tenant allowed models
      if (tenantGov?.allowedModels && tenantGov.allowedModels.length > 0) {
        if (!tenantGov.allowedModels.some(m => model.toLowerCase().startsWith(m.toLowerCase()))) {
          throw new BulwarkError("MODEL_NOT_ALLOWED", `Model "${model}" is not allowed for this tenant. Allowed: ${tenantGov.allowedModels.join(", ")}`);
        }
      }

      // 2. Prompt Injection Detection — scan ALL user messages, not just last
      let messages = [...request.messages]; // defensive copy
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === "user") {
          const guardResult = effectiveGuard.scan(msg.content);
          if (!guardResult.safe) {
            if (guardResult.sanitizedText) {
              messages = [...messages.slice(0, i), { ...msg, content: guardResult.sanitizedText }, ...messages.slice(i + 1)];
            } else {
              await this.auditStore.log({
                tenantId: request.tenantId, userId: request.userId, teamId: request.teamId,
                action: "policy_block", model,
                policyViolations: guardResult.injections.map(j => `prompt_injection:${j.pattern}`),
                metadata: { injections: guardResult.injections, messageIndex: i },
              });
              throw new BulwarkError("PROMPT_INJECTION", `Prompt injection detected in message ${i}: ${guardResult.injections.map(j => j.pattern).join(", ")}`, { injections: guardResult.injections });
            }
          }
        }
      }

      // 2b. ML-based injection detection — second layer after regex
      if (this.promptGuardML) {
        for (const msg of messages) {
          if (msg.role !== "user") continue;
          const mlResult = await this.promptGuardML.scan(msg.content);
          if (mlResult.isInjection) {
            await this.auditStore.log({
              tenantId: request.tenantId, userId: request.userId, teamId: request.teamId,
              action: "policy_block", model,
              policyViolations: [`ml_injection:${mlResult.matchedCategory}`],
              metadata: { similarity: mlResult.maxSimilarity, confidence: mlResult.confidence, category: mlResult.matchedCategory },
            });
            throw new BulwarkError("PROMPT_INJECTION", `ML-based injection detected (${mlResult.matchedCategory}, similarity: ${mlResult.maxSimilarity}, confidence: ${mlResult.confidence})`, { mlDetection: mlResult });
          }
        }
      }

      // 3. PII Detection — scan ALL user messages
      const piiDetections: PIIMatch[] = [];
      if (request.pii !== false) {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          if (msg.role !== "user") continue;
          const result = effectivePii.scan(msg.content);
          piiDetections.push(...result.matches);
          if (result.blocked) {
            await this.auditStore.log({
              tenantId: request.tenantId, userId: request.userId, teamId: request.teamId,
              action: "pii_detected", model,
              piiDetections: result.matches.length,
              metadata: { types: result.matches.map(m => m.type), messageIndex: i },
            });
            throw new BulwarkError("PII_BLOCKED", `PII detected and blocked in message ${i}: ${result.matches.map(m => m.type).join(", ")}`, { piiDetections: result.matches });
          }
          if (result.redacted) {
            messages = [...messages.slice(0, i), { ...msg, content: result.text }, ...messages.slice(i + 1)];
          }
        }
      }

      // 3. Content Policy Check
      if (!request.skipPolicies) {
        const violations = this._policyEngine.check(messages, { userId: request.userId, teamId: request.teamId, tenantId: request.tenantId });
        const blocked = violations.filter(v => v.action === "block");
        if (blocked.length > 0) {
          await this.auditStore.log({
            tenantId: request.tenantId, userId: request.userId, teamId: request.teamId,
            action: "policy_block", model,
            policyViolations: blocked.map(v => v.policyId),
          });
          throw new BulwarkError("POLICY_BLOCKED", `Content policy violated: ${blocked.map(v => v.policyName).join(", ")}`, { violations: blocked });
        }
      }

      // 4. Rate Limiting
      if (this.rateLimiter) {
        const rl = await this.rateLimiter.check({ userId: request.userId, teamId: request.teamId, tenantId: request.tenantId });
        if (!rl.allowed) {
          throw new BulwarkError("RATE_LIMITED", `Rate limit exceeded. Retry after ${Math.ceil((rl.resetAt - Date.now()) / 1000)}s`, { remaining: rl.remaining, resetAt: rl.resetAt });
        }
      }

      // 5. Budget Check
      if (this.budgetManager.enabled) {
        const allowed = await this.budgetManager.checkBudget({ userId: request.userId, teamId: request.teamId, tenantId: request.tenantId });
        if (!allowed.ok) {
          await this.auditStore.log({
            tenantId: request.tenantId, userId: request.userId, teamId: request.teamId,
            action: "budget_exceeded", model,
            metadata: { used: allowed.used, limit: allowed.limit },
          });
          throw new BulwarkError("BUDGET_EXCEEDED", `Budget exceeded: ${allowed.used}/${allowed.limit} tokens used`, { used: allowed.used, limit: allowed.limit });
        }
      }

      // 6. System prompt hardening + RAG Augmentation
      let sources: ChatResponse["sources"] = undefined;
      const hasSystemMsg = messages.some(m => m.role === "system");

      // Harden existing system prompt or inject one
      if (hasSystemMsg) {
        messages = messages.map(m => m.role === "system"
          ? { ...m, content: hardenSystemPrompt(m.content, { preventExtraction: true, enforceGDPR: effectivePii.config?.enabled ?? false }) }
          : m
        );
      }

      // RAG: search KB and inject context into system prompt
      if (request.knowledgeBase && this.kb) {
        const results = await this.kb.search(
          messages[messages.length - 1]?.content || "",
          { tenantId: request.tenantId, topK: 6 }
        );
        if (results.length > 0) {
          sources = results.map(r => ({ content: r.chunk.content, source: r.chunk.sourceName, score: r.score }));
          const context = results.map((r, i) => `[${i + 1}] ${r.chunk.sourceName}: ${r.chunk.content}`).join("\n\n");
          const ragInstruction = `\n\nUse ONLY the following knowledge base context to answer. Cite sources using [1], [2] etc. If the context doesn't contain the answer, say so — do not make up information.\n\n--- KNOWLEDGE BASE CONTEXT ---\n${context}\n--- END CONTEXT ---`;

          if (hasSystemMsg) {
            messages = messages.map(m => m.role === "system" ? { ...m, content: m.content + ragInstruction } : m);
          } else {
            const basePrompt = hardenSystemPrompt("You are a helpful assistant.", { preventExtraction: true, enforceGDPR: effectivePii.config?.enabled ?? false });
            messages = [{ role: "system", content: basePrompt + ragInstruction }, ...messages];
          }
        }
      }

      // 6b. Response cache check — before LLM call
      if (this.responseCache) {
        const cached = await this.responseCache.get(request);
        if (cached) {
          const durationMs = Date.now() - start;
          await this.auditStore.log({
            tenantId: request.tenantId, userId: request.userId, teamId: request.teamId,
            action: "chat", model: cached.model, provider: cached.provider,
            inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs,
            metadata: { ...request.metadata, cached: true },
          });
          return { ...cached, durationMs, trace };
        }
      }

      // 7. LLM Call with Retry + Fallback
      const llmResult = await this.callWithRetryAndFallback(model, messages, request);
      const llmResponse = llmResult.response;
      const actualModel = llmResult.model;
      const actualProvider = llmResult.provider;

      // 8. Cost Calculation
      const cost = this.costCalculator.calculate(actualModel, llmResponse.usage.inputTokens, llmResponse.usage.outputTokens);

      // 9. Record Usage
      if (this.budgetManager.enabled) {
        await this.budgetManager.recordUsage({
          userId: request.userId, teamId: request.teamId, tenantId: request.tenantId,
          model, inputTokens: llmResponse.usage.inputTokens, outputTokens: llmResponse.usage.outputTokens,
          costUsd: cost.totalCost, timestamp: new Date().toISOString(),
        });
      }

      // 10. Output PII Scanning — redact PII from LLM response
      let outputContent = llmResponse.content;
      const outputPiiDetections: PIIMatch[] = [];
      if (request.pii !== false) {
        const outputScan = effectivePii.scan(outputContent);
        outputPiiDetections.push(...outputScan.matches);
        if (outputScan.redacted) outputContent = outputScan.text;
      }

      // 11. Audit Log
      const durationMs = Date.now() - start;
      const totalPii = piiDetections.length + outputPiiDetections.length;
      const auditId = await this.auditStore.log({
        tenantId: request.tenantId, userId: request.userId, teamId: request.teamId,
        action: "chat", model: actualModel, provider: actualProvider,
        inputTokens: llmResponse.usage.inputTokens, outputTokens: llmResponse.usage.outputTokens,
        costUsd: cost.totalCost, durationMs,
        piiDetections: totalPii || undefined,
        metadata: request.metadata,
      });

      const result: ChatResponse = {
        content: outputContent,
        model: actualModel, provider: actualProvider,
        usage: llmResponse.usage,
        cost: { input: cost.inputCost, output: cost.outputCost, total: cost.totalCost },
        piiDetections: totalPii > 0 ? [
          ...piiDetections.map(m => ({ type: m.type, redacted: true, direction: "input" as const })),
          ...outputPiiDetections.map(m => ({ type: m.type, redacted: true, direction: "output" as const })),
        ] : undefined,
        sources, auditId, durationMs, trace,
      };

      // 12. Store in response cache
      if (this.responseCache) {
        await this.responseCache.set(request, result);
      }

      return result;
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Streaming chat — runs the full governance pipeline, then streams the LLM response.
   * Pre-flight checks (PII, policies, budget, rate limit) run BEFORE streaming starts.
   * Output PII scanning runs on the accumulated full response after streaming ends.
   *
   * @example
   * ```ts
   * const stream = gateway.chatStream({ model: "gpt-4o", userId: "user-1", messages: [...] });
   * for await (const chunk of stream) {
   *   if (chunk.type === "delta") process.stdout.write(chunk.content);
   *   if (chunk.type === "done") console.log("Cost:", chunk.cost);
   * }
   * ```
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<{
    type: "delta" | "sources" | "pii_warning" | "usage" | "done" | "error";
    content?: string;
    sources?: ChatResponse["sources"];
    piiTypes?: string[];
    usage?: ChatResponse["usage"];
    cost?: ChatResponse["cost"];
    auditId?: string;
    durationMs?: number;
  }> {
    if (this.shutdownRequested) throw new BulwarkError("SHUTTING_DOWN", "Gateway is shutting down");
    await this.init();

    // Concurrency limit
    if (this.maxConcurrent > 0 && this.activeRequests >= this.maxConcurrent) {
      throw new BulwarkError("CONCURRENCY_EXCEEDED", `Max concurrent requests (${this.maxConcurrent}) reached. Try again later.`);
    }

    this.activeRequests++;
    const start = Date.now();

    try {
      // Run all pre-flight checks — IDENTICAL to non-streaming chat()
      this.validateRequest(request);
      const model = request.model || "gpt-4o";

      // Resolve per-tenant governance overrides
      const tenantGov = this.resolveTenantGov(request.tenantId);
      const effectivePii = this.resolvePiiDetector(tenantGov);
      const effectiveGuard = this.resolvePromptGuard(tenantGov);

      // Model restriction — check tenant allowed models
      if (tenantGov?.allowedModels && tenantGov.allowedModels.length > 0) {
        if (!tenantGov.allowedModels.some(m => model.toLowerCase().startsWith(m.toLowerCase()))) {
          throw new BulwarkError("MODEL_NOT_ALLOWED", `Model "${model}" is not allowed for this tenant. Allowed: ${tenantGov.allowedModels.join(", ")}`);
        }
      }

      // Prompt injection — scan ALL user messages (not just last)
      let messages = [...request.messages];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === "user") {
          const guardResult = effectiveGuard.scan(msg.content);
          if (!guardResult.safe) {
            if (guardResult.sanitizedText) {
              messages = [...messages.slice(0, i), { ...msg, content: guardResult.sanitizedText }, ...messages.slice(i + 1)];
            } else {
              throw new BulwarkError("PROMPT_INJECTION", `Prompt injection detected in message ${i}: ${guardResult.injections.map(j => j.pattern).join(", ")}`, { injections: guardResult.injections });
            }
          }
        }
      }

      // ML-based injection detection — second layer after regex
      if (this.promptGuardML) {
        for (const msg of messages) {
          if (msg.role !== "user") continue;
          const mlResult = await this.promptGuardML.scan(msg.content);
          if (mlResult.isInjection) {
            throw new BulwarkError("PROMPT_INJECTION", `ML-based injection detected (${mlResult.matchedCategory}, similarity: ${mlResult.maxSimilarity})`, { mlDetection: mlResult });
          }
        }
      }

      // PII scan — scan ALL user messages (not just last)
      const piiTypes: string[] = [];
      if (request.pii !== false) {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          if (msg.role !== "user") continue;
          const result = effectivePii.scan(msg.content);
          piiTypes.push(...result.matches.map(m => m.type));
          if (result.blocked) throw new BulwarkError("PII_BLOCKED", `PII detected and blocked in message ${i}`);
          if (result.redacted) {
            messages = [...messages.slice(0, i), { ...msg, content: result.text }, ...messages.slice(i + 1)];
          }
        }
      }

      // Policy check
      if (!request.skipPolicies) {
        const violations = this._policyEngine.check(messages, { userId: request.userId, teamId: request.teamId, tenantId: request.tenantId });
        const blocked = violations.filter(v => v.action === "block");
        if (blocked.length > 0) throw new BulwarkError("POLICY_BLOCKED", `Policy violated: ${blocked.map(v => v.policyName).join(", ")}`);
      }

      // Rate limit + budget
      if (this.rateLimiter) {
        const rl = await this.rateLimiter.check({ userId: request.userId, teamId: request.teamId, tenantId: request.tenantId });
        if (!rl.allowed) throw new BulwarkError("RATE_LIMITED", "Rate limit exceeded");
      }
      if (this.budgetManager.enabled) {
        const allowed = await this.budgetManager.checkBudget({ userId: request.userId, teamId: request.teamId, tenantId: request.tenantId });
        if (!allowed.ok) throw new BulwarkError("BUDGET_EXCEEDED", "Budget exceeded");
      }

      // System prompt hardening (was missing in streaming mode)
      const hasSystemMsg = messages.some(m => m.role === "system");
      if (hasSystemMsg) {
        messages = messages.map(m => m.role === "system"
          ? { ...m, content: hardenSystemPrompt(m.content, { preventExtraction: true, enforceGDPR: effectivePii.config?.enabled ?? false }) }
          : m
        );
      }

      // RAG
      let sources: ChatResponse["sources"] = undefined;
      if (request.knowledgeBase && this.kb) {
        const results = await this.kb.search(messages[messages.length - 1]?.content || "", { tenantId: request.tenantId, topK: 6 });
        if (results.length > 0) {
          sources = results.map(r => ({ content: r.chunk.content, source: r.chunk.sourceName, score: r.score }));
          const context = results.map((r, i) => `[${i + 1}] ${r.chunk.sourceName}: ${r.chunk.content}`).join("\n\n");
          const ragInstruction = `\n\nUse ONLY the following knowledge base context to answer. Cite sources using [1], [2] etc.\n\n--- KNOWLEDGE BASE CONTEXT ---\n${context}\n--- END CONTEXT ---`;
          if (hasSystemMsg) {
            messages = messages.map(m => m.role === "system" ? { ...m, content: m.content + ragInstruction } : m);
          } else {
            const basePrompt = hardenSystemPrompt("You are a helpful assistant.", { preventExtraction: true, enforceGDPR: effectivePii.config?.enabled ?? false });
            messages = [{ role: "system", content: basePrompt + ragInstruction }, ...messages];
          }
        }
      }

      // Resolve provider for streaming
      const { provider, providerInstance } = this.resolveProvider(model);

      // Emit pre-flight results
      if (sources) yield { type: "sources", sources };
      if (piiTypes.length > 0) yield { type: "pii_warning", piiTypes };

      // Stream from provider
      if (!providerInstance.chatStream) {
        // Fallback: non-streaming provider, emit as single chunk
        const resp = await providerInstance.chat({ model, messages, temperature: request.temperature, maxTokens: request.maxTokens });
        yield { type: "delta", content: resp.content };
        const cost = this.costCalculator.calculate(model, resp.usage.inputTokens, resp.usage.outputTokens);
        const auditId = await this.auditStore.log({ tenantId: request.tenantId, userId: request.userId, teamId: request.teamId, action: "chat", model, provider, inputTokens: resp.usage.inputTokens, outputTokens: resp.usage.outputTokens, costUsd: cost.totalCost, durationMs: Date.now() - start });
        yield { type: "done", usage: resp.usage, cost: { input: cost.inputCost, output: cost.outputCost, total: cost.totalCost }, auditId, durationMs: Date.now() - start };
        return;
      }

      // Stream with governance
      let fullContent = "";
      let finalUsage: ChatResponse["usage"] | undefined;
      const piiAction = effectivePii.config?.action || "warn";
      const bufferForPii = request.pii !== false && (piiAction === "redact" || piiAction === "block");

      for await (const chunk of providerInstance.chatStream({ model, messages, temperature: request.temperature, maxTokens: request.maxTokens, topP: request.topP, stop: request.stop })) {
        if (chunk.content) {
          fullContent += chunk.content;
          // Only emit chunks immediately if we're NOT buffering for PII redaction
          if (!bufferForPii) {
            yield { type: "delta", content: chunk.content };
          }
        }
        if (chunk.usage) finalUsage = chunk.usage;
        if (chunk.done && !finalUsage) finalUsage = chunk.usage;
      }

      // Post-stream: output PII scan
      if (request.pii !== false) {
        const outScan = effectivePii.scan(fullContent);
        if (outScan.matches.length > 0) {
          piiTypes.push(...outScan.matches.map(m => `output:${m.type}`));
        }
        if (bufferForPii) {
          if (outScan.blocked) {
            // PII action is "block" and PII found in output — emit error instead of content
            yield { type: "error", content: `Output blocked: PII detected (${outScan.matches.map(m => m.type).join(", ")})` };
          } else {
            // Emit the redacted (or clean) content as a single chunk
            yield { type: "delta", content: outScan.redacted ? outScan.text : fullContent };
          }
        }
      }

      // Cost + audit
      const usage = finalUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      const cost = this.costCalculator.calculate(model, usage.inputTokens, usage.outputTokens);

      if (this.budgetManager.enabled) {
        await this.budgetManager.recordUsage({ userId: request.userId, teamId: request.teamId, tenantId: request.tenantId, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: cost.totalCost, timestamp: new Date().toISOString() });
      }

      const durationMs = Date.now() - start;
      const auditId = await this.auditStore.log({ tenantId: request.tenantId, userId: request.userId, teamId: request.teamId, action: "chat", model, provider, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: cost.totalCost, durationMs, piiDetections: piiTypes.length || undefined });

      yield { type: "done", usage, cost: { input: cost.inputCost, output: cost.outputCost, total: cost.totalCost }, auditId, durationMs };
    } finally {
      this.activeRequests--;
    }
  }

  /** Validate chat request inputs */
  private validateRequest(request: ChatRequest): void {
    if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
      throw new BulwarkError("INVALID_REQUEST", "messages array is required and must not be empty");
    }
    if (request.messages.length > MAX_MESSAGES) {
      throw new BulwarkError("INVALID_REQUEST", `Too many messages: ${request.messages.length} (max: ${MAX_MESSAGES})`);
    }
    for (const msg of request.messages) {
      if (!msg.role || !["system", "user", "assistant", "tool"].includes(msg.role)) {
        throw new BulwarkError("INVALID_REQUEST", `Invalid message role: ${msg.role}`);
      }
      if (typeof msg.content !== "string") {
        throw new BulwarkError("INVALID_REQUEST", "Message content must be a string");
      }
      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        throw new BulwarkError("INVALID_REQUEST", `Message too long: ${msg.content.length} chars (max: ${MAX_MESSAGE_LENGTH})`);
      }
    }
    if (request.temperature !== undefined && (request.temperature < 0 || request.temperature > 2)) {
      throw new BulwarkError("INVALID_REQUEST", "temperature must be between 0 and 2");
    }
    if (request.maxTokens !== undefined && (request.maxTokens < 1 || request.maxTokens > 200000)) {
      throw new BulwarkError("INVALID_REQUEST", "maxTokens must be between 1 and 200000");
    }
  }

  /**
   * Call LLM with retry + fallback chain.
   * Tries the primary model with retries, then falls back to configured alternatives.
   */
  private async callWithRetryAndFallback(
    model: string,
    messages: ChatRequest["messages"],
    request: ChatRequest
  ): Promise<{ response: { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }; model: string; provider: GatewayProvider }> {
    const modelsToTry = [model, ...(this.fallbacks[model] || [])];
    let lastError: Error | undefined;

    for (const currentModel of modelsToTry) {
      let resolved: { provider: GatewayProvider; providerInstance: LLMProvider };
      try {
        resolved = this.resolveProvider(currentModel);
      } catch {
        continue; // provider not configured, try next fallback
      }

      // Circuit breaker: skip provider if circuit is open
      if (this.circuitBreaker && !this.circuitBreaker.isAvailable(resolved.provider)) {
        continue;
      }

      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        try {
          const response = await this.callWithTimeout(
            resolved.providerInstance.chat({
              model: currentModel, messages,
              temperature: request.temperature, maxTokens: request.maxTokens,
              topP: request.topP, stop: request.stop, stream: request.stream,
            }),
            this.timeoutMs,
            currentModel
          );
          // Circuit breaker: record success
          if (this.circuitBreaker) this.circuitBreaker.recordSuccess(resolved.provider);
          return { response, model: currentModel, provider: resolved.provider };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));

          // Circuit breaker: record failure
          if (this.circuitBreaker) this.circuitBreaker.recordFailure(resolved.provider);

          // Don't retry on non-retryable errors (auth, validation, etc.)
          const isRetryable = err instanceof BulwarkError
            ? this.retryConfig.retryableStatuses.includes(err.httpStatus)
            : true; // Unknown errors are retryable

          if (!isRetryable || attempt === this.retryConfig.maxRetries) break;

          // Exponential backoff
          const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All models exhausted
    throw lastError instanceof BulwarkError
      ? lastError
      : new BulwarkError("LLM_ERROR", `All models failed. Last error: ${lastError?.message || "Unknown"}`, { triedModels: modelsToTry });
  }

  /** Call LLM with timeout */
  private async callWithTimeout<T>(promise: Promise<T>, timeoutMs: number, model: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new BulwarkError("LLM_TIMEOUT", `LLM call to ${model} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then(result => { clearTimeout(timer); resolve(result); })
        .catch(err => { clearTimeout(timer); reject(err instanceof BulwarkError ? err : new BulwarkError("LLM_ERROR", `LLM call failed: ${err instanceof Error ? err.message : "Unknown error"}`)); });
    });
  }

  /** Resolve which provider handles a given model */
  private resolveProvider(model: string): { provider: GatewayProvider; providerInstance: LLMProvider } {
    const m = model.toLowerCase();

    // Anthropic
    if (m.startsWith("claude")) return this.getProvider("anthropic");
    // Mistral
    if (m.startsWith("mistral") || m.startsWith("codestral") || m.startsWith("pixtral")) return this.getProvider("mistral");
    // Google
    if (m.startsWith("gemini") || m.startsWith("palm")) return this.getProvider("google");
    // Ollama (local models)
    if (m.startsWith("llama") || m.startsWith("phi") || m.startsWith("qwen") || m.startsWith("deepseek") || m.startsWith("codellama")) return this.getProvider("ollama");
    // Azure — if configured and model doesn't match any other prefix, prefer Azure over OpenAI
    if (this.providers.has("azure")) return this.getProvider("azure");
    // Default: OpenAI
    return this.getProvider("openai");
  }

  private getProvider(name: GatewayProvider): { provider: GatewayProvider; providerInstance: LLMProvider } {
    const instance = this.providers.get(name);
    if (!instance) throw new BulwarkError("PROVIDER_NOT_CONFIGURED", `${name} provider not configured. Add providers.${name} to your config.`);
    return { provider: name, providerInstance: instance };
  }

  /**
   * Resolve per-tenant governance config.
   * Returns tenant overrides if tenantId is set and multi-tenant is enabled, undefined otherwise.
   * Results are cached for tenantConfigTtlMs.
   */
  private resolveTenantGov(tenantId?: string): TenantGovConfig | undefined {
    if (!tenantId || !this._tenantManager) return undefined;

    const now = Date.now();
    const cached = this.tenantConfigCache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached.config;

    const config = this._tenantManager.getGovernance(tenantId);
    if (config) {
      this.tenantConfigCache.set(tenantId, { config, expiresAt: now + this.tenantConfigTtlMs });
    }
    return config;
  }

  /**
   * Create a PII detector scoped to tenant overrides.
   * Returns the tenant-specific detector, or the global one if no overrides.
   */
  private resolvePiiDetector(tenantGov?: TenantGovConfig): PIIDetector {
    if (!tenantGov?.pii) return this.piiDetector;
    return new PIIDetector({
      enabled: tenantGov.pii.enabled ?? this.piiDetector.config.enabled,
      action: tenantGov.pii.action ?? this.piiDetector.config.action,
      types: tenantGov.pii.types ?? this.piiDetector.config.types,
    });
  }

  /**
   * Create a prompt guard scoped to tenant overrides.
   * Returns the tenant-specific guard, or the global one if no overrides.
   */
  private resolvePromptGuard(tenantGov?: TenantGovConfig): PromptGuard {
    if (!tenantGov?.promptGuard) return this.promptGuard;
    return new PromptGuard({
      enabled: tenantGov.promptGuard.enabled ?? this.promptGuard["config"].enabled,
      action: tenantGov.promptGuard.action ?? this.promptGuard["config"].action,
      sensitivity: tenantGov.promptGuard.sensitivity ?? this.promptGuard["config"].sensitivity,
    } as PromptGuardConfig);
  }

  /** Graceful shutdown — wait for in-flight requests, close connections */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    // Wait for active requests (max 30s)
    const deadline = Date.now() + 30_000;
    while (this.activeRequests > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Close cache
    if (this.cache && "close" in this.cache && typeof (this.cache as { close?: () => void }).close === "function") {
      (this.cache as { close: () => void }).close();
    }

    // Close database
    this.db.close();
  }

  /** Get the audit store for direct queries */
  get audit(): AuditStore { return this.auditStore; }

  /** Get the knowledge base for document ingestion and search */
  get rag(): KnowledgeBase | null { return this.kb; }

  /** Get database instance for admin operations */
  get database(): Database { return this.db; }

  /** Get the policy engine for runtime policy management */
  get policies(): PolicyEngine { return this._policyEngine; }

  /** Get the tenant manager (multi-tenant mode only) */
  get tenants(): TenantManager | null { return this._tenantManager; }

  /** Kill switch — disable/enable the gateway at runtime */
  get enabled(): boolean { return this._enabled; }
  set enabled(value: boolean) { this._enabled = value; }

  /** Circuit breaker instance — for health checks and admin resets */
  get circuits(): CircuitBreaker | null { return this.circuitBreaker; }

  /** Current active request count */
  get activeRequestCount(): number { return this.activeRequests; }
}

/** Bulwark-specific error with code and metadata */
export class BulwarkError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly timestamp: string;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BulwarkError";
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();

    // Preserve stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BulwarkError);
    }
  }

  /** HTTP status code for this error */
  get httpStatus(): number {
    const map: Record<string, number> = {
      INVALID_REQUEST: 400, INVALID_CONFIG: 400,
      PII_BLOCKED: 403, POLICY_BLOCKED: 403, PROMPT_INJECTION: 400,
      PROVIDER_NOT_CONFIGURED: 404, MODEL_NOT_ALLOWED: 403,
      RATE_LIMITED: 429, BUDGET_EXCEEDED: 429, CONCURRENCY_EXCEEDED: 429,
      LLM_TIMEOUT: 504, LLM_ERROR: 502,
      SHUTTING_DOWN: 503,
    };
    return map[this.code] || 500;
  }

  /** JSON-serializable representation */
  toJSON() {
    return { error: this.message, code: this.code, details: this.details, timestamp: this.timestamp };
  }
}
