import type { CacheStore, RateLimitConfig, RateLimitResult } from "./types";

export class RateLimiter {
  private store: CacheStore;
  private config: RateLimitConfig;

  constructor(store: CacheStore, config: RateLimitConfig) {
    this.store = store;
    this.config = config;
  }

  /** Check and consume a rate limit token. Returns whether the request is allowed. */
  async check(scope: { userId?: string; teamId?: string; tenantId?: string; ip?: string }): Promise<RateLimitResult> {
    if (!this.config.enabled) return { allowed: true, remaining: Infinity, resetAt: 0 };

    const scopeId = this.getScopeId(scope);
    if (!scopeId) return { allowed: true, remaining: Infinity, resetAt: 0 };

    const windowKey = `ratelimit:${this.config.scope}:${scopeId}:${this.currentWindow()}`;
    const count = await this.store.incr(windowKey);

    // Set expiry on first request in window
    if (count === 1) {
      await this.store.expire(windowKey, this.config.windowSeconds);
    }

    const remaining = Math.max(0, this.config.maxRequests - count);
    const resetAt = Math.ceil(Date.now() / 1000 / this.config.windowSeconds) * this.config.windowSeconds * 1000;

    return {
      allowed: count <= this.config.maxRequests,
      remaining,
      resetAt,
    };
  }

  private getScopeId(scope: { userId?: string; teamId?: string; tenantId?: string; ip?: string }): string | null {
    switch (this.config.scope) {
      case "user": return scope.userId || null;
      case "team": return scope.teamId || null;
      case "tenant": return scope.tenantId || null;
      case "ip": return scope.ip || null;
    }
  }

  private currentWindow(): number {
    return Math.floor(Date.now() / 1000 / this.config.windowSeconds);
  }
}
