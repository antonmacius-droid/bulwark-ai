import { describe, it, expect } from "vitest";
import { AIGateway, BulwarkError } from "../gateway";

describe("AIGateway", () => {
  it("should throw on missing providers", () => {
    expect(() => new AIGateway({ providers: {}, database: "test.db" })).toThrow("At least one provider");
  });

  it("should throw on missing database", () => {
    expect(() => new AIGateway({ providers: { openai: { apiKey: "test" } }, database: "" })).toThrow("Database connection string");
  });

  it("should validate empty messages", async () => {
    const gateway = new AIGateway({
      providers: { openai: { apiKey: "test" } },
      database: ":memory:",
    });
    await expect(gateway.chat({ messages: [] })).rejects.toThrow("must not be empty");
  });

  it("should validate message roles", async () => {
    const gateway = new AIGateway({
      providers: { openai: { apiKey: "test" } },
      database: ":memory:",
    });
    await expect(gateway.chat({ messages: [{ role: "invalid" as "user", content: "test" }] })).rejects.toThrow("Invalid message role");
  });

  it("should validate message length", async () => {
    const gateway = new AIGateway({
      providers: { openai: { apiKey: "test" } },
      database: ":memory:",
    });
    await expect(gateway.chat({ messages: [{ role: "user", content: "a".repeat(300_000) }] })).rejects.toThrow("Message too long");
  });

  it("should validate temperature range", async () => {
    const gateway = new AIGateway({
      providers: { openai: { apiKey: "test" } },
      database: ":memory:",
    });
    await expect(gateway.chat({ messages: [{ role: "user", content: "hi" }], temperature: 5 })).rejects.toThrow("temperature must be between");
  });

  it("should reject requests during shutdown", async () => {
    const gateway = new AIGateway({
      providers: { openai: { apiKey: "test" } },
      database: ":memory:",
    });
    // Start shutdown
    const shutdownPromise = gateway.shutdown();
    await expect(gateway.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow("shutting down");
    await shutdownPromise;
  });
});

describe("BulwarkError", () => {
  it("should have correct HTTP status codes", () => {
    expect(new BulwarkError("PII_BLOCKED", "test").httpStatus).toBe(403);
    expect(new BulwarkError("RATE_LIMITED", "test").httpStatus).toBe(429);
    expect(new BulwarkError("LLM_TIMEOUT", "test").httpStatus).toBe(504);
    expect(new BulwarkError("UNKNOWN", "test").httpStatus).toBe(500);
  });

  it("should serialize to JSON", () => {
    const err = new BulwarkError("PII_BLOCKED", "PII found", { types: ["email"] });
    const json = err.toJSON();
    expect(json.code).toBe("PII_BLOCKED");
    expect(json.error).toBe("PII found");
    expect(json.details).toEqual({ types: ["email"] });
    expect(json.timestamp).toBeDefined();
  });
});
