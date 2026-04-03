import { describe, it, expect } from "vitest";
import { PIIDetector } from "../security/pii";

describe("PIIDetector", () => {
  it("should detect emails", () => {
    const detector = new PIIDetector({ enabled: true, action: "warn", types: ["email"] });
    const result = detector.scan("Contact john@example.com for details");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe("email");
    expect(result.matches[0].value).toBe("john@example.com");
    expect(result.blocked).toBe(false);
    expect(result.redacted).toBe(false);
  });

  it("should redact PII when action is redact", () => {
    const detector = new PIIDetector({ enabled: true, action: "redact", types: ["email", "phone"] });
    const result = detector.scan("Email: test@test.com, Phone: +370-612-34567");
    expect(result.redacted).toBe(true);
    expect(result.text).toContain("[EMAIL]");
    expect(result.text).toContain("[PHONE]");
    expect(result.text).not.toContain("test@test.com");
  });

  it("should block when action is block", () => {
    const detector = new PIIDetector({ enabled: true, action: "block", types: ["ssn"] });
    const result = detector.scan("SSN: 123-45-6789");
    expect(result.blocked).toBe(true);
    expect(result.matches).toHaveLength(1);
  });

  it("should not detect when disabled", () => {
    const detector = new PIIDetector({ enabled: false });
    const result = detector.scan("Email: test@test.com SSN: 123-45-6789");
    expect(result.matches).toHaveLength(0);
    expect(result.blocked).toBe(false);
  });

  it("should detect credit cards", () => {
    const detector = new PIIDetector({ enabled: true, action: "warn", types: ["credit_card"] });
    const result = detector.scan("Card: 4111 1111 1111 1111");
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle custom patterns", () => {
    const detector = new PIIDetector({
      enabled: true, action: "redact",
      customPatterns: [{ name: "employee_id", pattern: "EMP-\\d{6}" }],
    });
    const result = detector.scan("Employee EMP-123456 submitted a request");
    expect(result.redacted).toBe(true);
    expect(result.text).toContain("[EMPLOYEE_ID]");
  });

  it("should reject ReDoS patterns and allow safe ones", () => {
    const detector = new PIIDetector({
      enabled: true, action: "warn",
      customPatterns: [
        { name: "evil", pattern: "(a+)+$" },           // nested quantifier — rejected
        { name: "evil2", pattern: "(.*.*.*)" },          // excessive wildcards — rejected
        { name: "good", pattern: "\\d{3}-\\d{4}" },     // safe pattern
      ],
    });
    const start = Date.now();
    const result = detector.scan("Call 555-1234 for details. " + "a".repeat(100));
    expect(Date.now() - start).toBeLessThan(100); // fast because evil patterns skipped

    const goodMatches = result.matches.filter(m => m.type === "good");
    expect(goodMatches).toHaveLength(1);
    expect(goodMatches[0].value).toBe("555-1234");

    // Evil patterns should NOT have any matches (they were skipped)
    const evilMatches = result.matches.filter(m => m.type === "evil" || m.type === "evil2");
    expect(evilMatches).toHaveLength(0);
  });
});
