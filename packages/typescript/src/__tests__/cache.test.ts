import { describe, it, expect, afterEach } from "vitest";
import { MemoryCacheStore } from "../cache/memory";
import { RateLimiter } from "../cache/rate-limiter";

describe("MemoryCacheStore", () => {
  let store: MemoryCacheStore;

  afterEach(() => { store?.close(); });

  it("should set and get values", async () => {
    store = new MemoryCacheStore();
    await store.set("key1", { data: "test" });
    const val = await store.get<{ data: string }>("key1");
    expect(val?.data).toBe("test");
  });

  it("should return null for missing keys", async () => {
    store = new MemoryCacheStore();
    expect(await store.get("nonexistent")).toBeNull();
  });

  it("should expire entries", async () => {
    store = new MemoryCacheStore();
    await store.set("key1", "value", 0.1); // 100ms TTL
    expect(await store.get("key1")).toBe("value");
    await new Promise(r => setTimeout(r, 150));
    expect(await store.get("key1")).toBeNull();
  });

  it("should increment counters", async () => {
    store = new MemoryCacheStore();
    expect(await store.incr("counter")).toBe(1);
    expect(await store.incr("counter")).toBe(2);
    expect(await store.incr("counter", 5)).toBe(7);
    expect(await store.getCounter("counter")).toBe(7);
  });

  it("should delete keys", async () => {
    store = new MemoryCacheStore();
    await store.set("key1", "value");
    await store.del("key1");
    expect(await store.get("key1")).toBeNull();
  });
});

describe("RateLimiter", () => {
  it("should allow requests within limit", async () => {
    const store = new MemoryCacheStore();
    const limiter = new RateLimiter(store, { enabled: true, maxRequests: 5, windowSeconds: 60, scope: "user" });

    const result = await limiter.check({ userId: "user1" });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    store.close();
  });

  it("should block requests over limit", async () => {
    const store = new MemoryCacheStore();
    const limiter = new RateLimiter(store, { enabled: true, maxRequests: 2, windowSeconds: 60, scope: "user" });

    await limiter.check({ userId: "user1" }); // 1
    await limiter.check({ userId: "user1" }); // 2
    const result = await limiter.check({ userId: "user1" }); // 3 — should block
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    store.close();
  });

  it("should pass when disabled", async () => {
    const store = new MemoryCacheStore();
    const limiter = new RateLimiter(store, { enabled: false, maxRequests: 0, windowSeconds: 0, scope: "user" });
    const result = await limiter.check({ userId: "user1" });
    expect(result.allowed).toBe(true);
    store.close();
  });

  it("should scope by different users", async () => {
    const store = new MemoryCacheStore();
    const limiter = new RateLimiter(store, { enabled: true, maxRequests: 1, windowSeconds: 60, scope: "user" });

    expect((await limiter.check({ userId: "user1" })).allowed).toBe(true);
    expect((await limiter.check({ userId: "user2" })).allowed).toBe(true);
    expect((await limiter.check({ userId: "user1" })).allowed).toBe(false); // user1 over limit
    expect((await limiter.check({ userId: "user2" })).allowed).toBe(false); // user2 over limit
    store.close();
  });
});
