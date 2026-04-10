import type { CacheStore } from "./types";

/**
 * Redis cache store — for production multi-instance deployments.
 * Requires `ioredis` as a peer dependency.
 *
 * @example
 * ```ts
 * import Redis from "ioredis";
 * import { RedisCacheStore } from "@bulwark-ai/gateway/cache";
 *
 * const gateway = new AIGateway({
 *   cache: new RedisCacheStore(new Redis("redis://localhost:6379")),
 * });
 * ```
 */
export class RedisCacheStore implements CacheStore {
  private client: RedisLike;
  private prefix: string;

  constructor(client: RedisLike, prefix = "bulwark:") {
    this.client = client;
    this.prefix = prefix;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const val = await this.client.get(this.key(key));
    if (val === null || val === undefined) return null;
    try { return JSON.parse(val) as T; } catch { return val as T; }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(this.key(key), ttlSeconds, serialized);
    } else {
      await this.client.set(this.key(key), serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async incr(key: string, by = 1): Promise<number> {
    if (by === 1) return this.client.incr(this.key(key));
    return this.client.incrby(this.key(key), by);
  }

  async getCounter(key: string): Promise<number> {
    const val = await this.client.get(this.key(key));
    return val ? parseInt(val, 10) : 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(this.key(key), ttlSeconds);
  }

  /**
   * Atomic increment + expire via Lua script.
   * Guarantees the key always has a TTL, even under concurrent access.
   */
  async incrWithExpire(key: string, ttlSeconds: number, by = 1): Promise<number> {
    const lua = `
      local current = redis.call('INCRBY', KEYS[1], ARGV[1])
      if current == tonumber(ARGV[1]) then
        redis.call('EXPIRE', KEYS[1], ARGV[2])
      end
      return current
    `;
    const result = await this.client.eval(lua, 1, this.key(key), by.toString(), ttlSeconds.toString());
    return typeof result === "number" ? result : parseInt(String(result), 10);
  }
}

/** Minimal Redis client interface — compatible with ioredis and node-redis */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
}
