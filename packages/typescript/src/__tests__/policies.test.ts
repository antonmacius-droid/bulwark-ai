import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../security/policies";

describe("PolicyEngine", () => {
  it("should block keyword matches", () => {
    const engine = new PolicyEngine([
      { id: "p1", name: "Block competitor", type: "keyword_block", patterns: ["competitor-name"], action: "block" },
    ]);
    const violations = engine.check([{ role: "user", content: "Tell me about competitor-name" }], {});
    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe("block");
    expect(violations[0].policyId).toBe("p1");
  });

  it("should warn without blocking", () => {
    const engine = new PolicyEngine([
      { id: "p1", name: "Warn secrets", type: "keyword_block", patterns: ["password"], action: "warn" },
    ]);
    const violations = engine.check([{ role: "user", content: "my password is 123" }], {});
    expect(violations).toHaveLength(1);
    expect(violations[0].action).toBe("warn");
  });

  it("should scope policies to specific teams", () => {
    const engine = new PolicyEngine([
      { id: "p1", name: "Marketing only", type: "keyword_block", patterns: ["secret"], action: "block", applyTo: { teams: ["marketing"] } },
    ]);
    const devResult = engine.check([{ role: "user", content: "This is a secret" }], { teamId: "engineering" });
    expect(devResult).toHaveLength(0); // doesn't apply to engineering

    const mktResult = engine.check([{ role: "user", content: "This is a secret" }], { teamId: "marketing" });
    expect(mktResult).toHaveLength(1); // applies to marketing
  });

  it("should enforce max_tokens policy", () => {
    const engine = new PolicyEngine([
      { id: "p1", name: "Limit size", type: "max_tokens", maxTokens: 10, action: "block" },
    ]);
    const violations = engine.check([{ role: "user", content: "A".repeat(200) }], {});
    expect(violations).toHaveLength(1);
  });

  it("should not allow duplicate policy IDs", () => {
    const engine = new PolicyEngine([]);
    engine.addPolicy({ id: "p1", name: "Test", type: "keyword_block", patterns: ["test"], action: "warn" });
    expect(() => engine.addPolicy({ id: "p1", name: "Dupe", type: "keyword_block", patterns: ["test"], action: "warn" })).toThrow("already exists");
  });

  it("should validate policy fields", () => {
    const engine = new PolicyEngine([]);
    expect(() => engine.addPolicy({ id: "", name: "Test", type: "keyword_block", patterns: [], action: "warn" })).toThrow("must have id");
  });

  it("should return copy from getPolicies", () => {
    const engine = new PolicyEngine([{ id: "p1", name: "Test", type: "keyword_block", patterns: ["a"], action: "warn" }]);
    const policies = engine.getPolicies();
    policies.push({ id: "injected", name: "Injected", type: "keyword_block", patterns: ["b"], action: "block" });
    expect(engine.getPolicies()).toHaveLength(1); // original not mutated
  });
});
