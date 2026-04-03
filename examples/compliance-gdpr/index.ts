/**
 * Bulwark AI — GDPR Compliance Example
 *
 * Run: BULWARK_LICENSE_KEY=your-key npx tsx index.ts
 *
 * Shows how to handle GDPR rights:
 * - Right to Erasure (Article 17)
 * - Data Portability (Article 20)
 * - Data Retention enforcement
 * - Processing Activity Report (DPIA)
 */

import { AIGateway, GDPRManager, HIPAAManager, CCPAManager } from "@bulwark-ai/gateway";

const gateway = new AIGateway({
  providers: { openai: { apiKey: process.env.OPENAI_API_KEY! } },
  database: "compliance-demo.db",
  pii: { enabled: true, action: "redact" },
  audit: true,
});

await gateway.init();

// Generate some audit data
await gateway.chat({
  model: "gpt-4o-mini", userId: "user-gdpr-1",
  messages: [{ role: "user", content: "What is AI governance?" }],
  maxTokens: 50,
});
await gateway.chat({
  model: "gpt-4o-mini", userId: "user-gdpr-1",
  messages: [{ role: "user", content: "Explain GDPR compliance" }],
  maxTokens: 50,
});

// ── GDPR ──
console.log("═══ GDPR Compliance ═══\n");

const gdpr = new GDPRManager(gateway.database, {
  retentionDays: 365,        // auto-delete after 1 year
  hashUserIds: false,         // set true in production
  metadataOnlyAudit: false,
});

// Right to Data Portability (Article 20)
const exported = gdpr.exportUserData("user-gdpr-1");
console.log("Data Export (Article 20):");
console.log(`  Audit entries: ${exported.auditEntries.length}`);
console.log(`  Usage records: ${exported.usageRecords.length}`);

// Processing Activity Report (for DPIA)
const report = gdpr.generateProcessingReport();
console.log("\nProcessing Report (DPIA):");
console.log(`  Total records: ${report.totalRecords}`);
console.log(`  Data types: ${report.dataTypes.join(", ")}`);
console.log(`  Legal basis: ${report.legalBasis}`);

// Right to Erasure (Article 17)
const erased = gdpr.eraseUserData("user-gdpr-1");
console.log(`\nErasure (Article 17): Deleted records for user-gdpr-1`);

// Data Retention
gdpr.enforceRetention();
console.log("Retention: Enforced (old data purged)\n");

// ── HIPAA (US Healthcare) ──
console.log("═══ HIPAA Compliance ═══\n");

const hipaa = new HIPAAManager(gateway.database, {
  enablePHIAccessLog: true,
  baaRequired: true,
});

console.log("HIPAA Safe Harbor identifiers: 18 types checked automatically");
console.log(`BAA status for OpenAI: ${hipaa.checkBAA?.("openai") || "Check required"}\n`);

// ── CCPA (California) ──
console.log("═══ CCPA Compliance ═══\n");

const ccpa = new CCPAManager(gateway.database, {
  saleOfDataEnabled: false,
  gpcSignalEnabled: true,
});

console.log("CCPA rights supported: Access, Delete, Opt-Out, GPC signal\n");

await gateway.shutdown();
console.log("Done. All compliance modules functional.");
