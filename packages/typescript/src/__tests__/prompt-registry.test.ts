import { describe, it, expect, beforeEach } from "vitest";
import { PromptRegistry } from "../prompts/registry";
import { createDatabase, type Database } from "../database";

describe("PromptRegistry", () => {
  let db: Database;
  let registry: PromptRegistry;

  beforeEach(() => {
    db = createDatabase(":memory:");
    db.init();
    registry = new PromptRegistry(db);
  });

  it("registers a new prompt", async () => {
    const version = await registry.register("test-prompt", {
      systemPrompt: "You are a helpful assistant.",
      model: "gpt-4o",
    });
    expect(version.version).toBe(1);
    expect(version.active).toBe(true);
    expect(version.systemPrompt).toBe("You are a helpful assistant.");
  });

  it("creates new version on re-register", async () => {
    await registry.register("test-prompt", { systemPrompt: "Version 1" });
    const v2 = await registry.register("test-prompt", { systemPrompt: "Version 2" });
    expect(v2.version).toBe(2);
  });

  it("getActive returns current version", async () => {
    await registry.register("test-prompt", { systemPrompt: "V1" });
    await registry.register("test-prompt", { systemPrompt: "V2" });

    const active = await registry.getActive("test-prompt");
    expect(active).toBeDefined();
    expect(active!.version).toBe(2);
    expect(active!.systemPrompt).toBe("V2");
  });

  it("listVersions returns all versions", async () => {
    await registry.register("test-prompt", { systemPrompt: "V1" });
    await registry.register("test-prompt", { systemPrompt: "V2" });
    await registry.register("test-prompt", { systemPrompt: "V3" });

    const versions = await registry.listVersions("test-prompt");
    expect(versions.length).toBe(3);
    expect(versions[0].version).toBe(3); // descending
    expect(versions[0].active).toBe(true);
    expect(versions[1].active).toBe(false);
  });

  it("rollback swaps to previous version (hot standby)", async () => {
    await registry.register("test-prompt", { systemPrompt: "V1" });
    await registry.register("test-prompt", { systemPrompt: "V2" });

    const result = await registry.rollback("test-prompt");
    expect(result).toBeDefined();
    expect(result!.rolledBackTo).toBe(1);

    const active = await registry.getActive("test-prompt");
    expect(active!.version).toBe(1);
    expect(active!.systemPrompt).toBe("V1");
  });

  it("rollback returns null when no previous version", async () => {
    await registry.register("test-prompt", { systemPrompt: "V1" });
    const result = await registry.rollback("test-prompt");
    expect(result).toBeNull();
  });

  it("manages test cases", async () => {
    await registry.register("test-prompt", { systemPrompt: "V1" });

    const tc = await registry.addTestCase("test-prompt", {
      input: "What are the payment terms?",
      expectedOutput: "Payment is due within 30 days.",
      weight: 2.0,
      tags: ["finance"],
    });

    expect(tc.input).toBe("What are the payment terms?");
    expect(tc.weight).toBe(2.0);

    const cases = await registry.listTestCases("test-prompt");
    expect(cases.length).toBe(1);
  });

  it("lists all registered prompts", async () => {
    await registry.register("prompt-a", { systemPrompt: "A" });
    await registry.register("prompt-b", { systemPrompt: "B" });

    const prompts = await registry.list();
    expect(prompts.length).toBe(2);
  });

  it("returns null for non-existent prompt", async () => {
    const active = await registry.getActive("nonexistent");
    expect(active).toBeNull();
  });
});
