import type { CacheStore } from "./types";

/** In-memory cache store — works for single-instance deployments */
export class MemoryCacheStore implements CacheStore {
  private store = new Map<string, { value: unknown; expiresAt?: number }>();
  private counters = new Map<string, { value: number; expiresAt?: number }>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private maxEntries: number;

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries || 10_000;
    // Background cleanup every 60s to prevent memory leaks
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref(); // Don't keep process alive
  }

  /** Stop background cleanup — call on shutdown */
  close(): void {
    clearInterval(this.cleanupTimer);
    this.store.clear();
    this.counters.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && now > entry.expiresAt) this.store.delete(key);
    }
    for (const [key, entry] of this.counters) {
      if (entry.expiresAt && now > entry.expiresAt) this.counters.delete(key);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    // LRU eviction: if at capacity, delete oldest entry
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
    this.counters.delete(key);
  }

  async incr(key: string, by = 1): Promise<number> {
    const existing = this.counters.get(key);
    const current = existing?.value || 0;
    const next = current + by;
    this.counters.set(key, { value: next, expiresAt: existing?.expiresAt });
    return next;
  }

  async getCounter(key: string): Promise<number> {
    const entry = this.counters.get(key);
    if (!entry) return 0;
    if (entry.expiresAt && Date.now() > entry.expiresAt) { this.counters.delete(key); return 0; }
    return entry.value;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const storeEntry = this.store.get(key);
    if (storeEntry) storeEntry.expiresAt = expiresAt;
    const counterEntry = this.counters.get(key);
    if (counterEntry) counterEntry.expiresAt = expiresAt;
  }
}
