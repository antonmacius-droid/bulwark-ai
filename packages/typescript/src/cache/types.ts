/**
 * Cache and rate limiting abstraction.
 * In-memory by default, Redis for production multi-instance deployments.
 */

export interface CacheStore {
  /** Get a cached value */
  get<T>(key: string): Promise<T | null>;
  /** Set a value with optional TTL in seconds */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  /** Delete a key */
  del(key: string): Promise<void>;
  /** Increment a counter, returns new value */
  incr(key: string, by?: number): Promise<number>;
  /** Get counter value */
  getCounter(key: string): Promise<number>;
  /** Set expiry on a key */
  expire(key: string, ttlSeconds: number): Promise<void>;
}

export interface RateLimitConfig {
  enabled: boolean;
  /** Requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSeconds: number;
  /** Scope: per-user, per-team, per-tenant, or per-ip */
  scope: "user" | "team" | "tenant" | "ip";
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface ResponseCacheConfig {
  enabled: boolean;
  /** TTL for cached responses in seconds */
  ttlSeconds: number;
  /** Only cache responses below this token count */
  maxTokens?: number;
  /** Cache key includes: model, messages hash */
}
