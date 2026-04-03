import { createHash } from "crypto";
import type { CacheStore, ResponseCacheConfig } from "./types";
import type { ChatRequest, ChatResponse } from "../types";

/**
 * Response cache — caches identical LLM requests to save money.
 * Uses SHA-256 hash of (model + messages) as cache key.
 *
 * @example
 * ```ts
 * const cache = new ResponseCache(store, { enabled: true, ttlSeconds: 3600 });
 * const cached = await cache.get(request);
 * if (cached) return cached; // saved $0.01
 * const response = await llm.chat(request);
 * await cache.set(request, response);
 * ```
 */
export class ResponseCache {
  private store: CacheStore;
  private config: ResponseCacheConfig;

  constructor(store: CacheStore, config: ResponseCacheConfig) {
    this.store = store;
    this.config = config;
  }

  /** Generate deterministic cache key from request */
  private key(request: ChatRequest): string {
    const hashInput = JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
    const hash = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
    return `resp:${request.model || "default"}:${hash}`;
  }

  /** Check if a cached response exists */
  async get(request: ChatRequest): Promise<ChatResponse | null> {
    if (!this.config.enabled) return null;
    // Don't cache streaming requests
    if (request.stream) return null;
    // Don't cache requests with temperature > 0 (non-deterministic)
    if (request.temperature && request.temperature > 0) return null;

    return this.store.get<ChatResponse>(this.key(request));
  }

  /** Cache a response */
  async set(request: ChatRequest, response: ChatResponse): Promise<void> {
    if (!this.config.enabled) return;
    if (request.stream) return;
    if (request.temperature && request.temperature > 0) return;
    // Don't cache very long responses
    if (this.config.maxTokens && response.usage.totalTokens > this.config.maxTokens) return;

    await this.store.set(this.key(request), response, this.config.ttlSeconds);
  }
}
