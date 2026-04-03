/**
 * Bulwark AI — Basic Express Example
 *
 * Run: npx tsx index.ts
 * Test: curl -X POST http://localhost:3000/api/ai/chat \
 *   -H "Content-Type: application/json" \
 *   -d '{"messages":[{"role":"user","content":"Hello"}]}'
 */

import express from "express";
import { AIGateway, bulwarkRouter, createAdminRouter } from "@bulwark-ai/gateway";

const app = express();
app.use(express.json());

// Initialize gateway
const gateway = new AIGateway({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY! },
    // anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
  },
  database: "bulwark.db",

  // PII: redact emails, phones, credit cards before sending to LLM
  pii: {
    enabled: true,
    action: "redact",
    types: ["email", "phone", "credit_card", "ssn", "iban"],
  },

  // Budgets: 500K tokens/user/month
  budgets: {
    enabled: true,
    defaultUserLimit: 500_000,
    onExceeded: "block",
    alertThresholds: [0.7, 0.9],
    onAlert: (alert) => {
      console.log(`⚠️ Budget alert: ${alert.type} ${alert.id} at ${Math.round(alert.threshold * 100)}%`);
    },
  },

  // Content policies
  policies: [
    {
      id: "no-secrets",
      name: "Block secret sharing",
      type: "keyword_block",
      patterns: ["password", "api_key", "secret_key", "private_key"],
      action: "block",
    },
  ],

  // Audit logging
  audit: true,

  // RAG knowledge base
  rag: { enabled: true, chunkSize: 1000, topK: 6, minScore: 0.3 },
});

// Mount chat API — every request goes through the governance pipeline
app.use("/api/ai", bulwarkRouter(gateway, {
  auth: (req) => ({
    userId: (req as express.Request).headers["x-user-id"] as string || "anonymous",
    teamId: (req as express.Request).headers["x-team-id"] as string,
  }),
}));

// Mount admin panel API (protected)
app.use("/admin/ai", createAdminRouter(gateway, {
  auth: (req) => {
    const r = req as express.Request;
    return r.headers["x-admin-key"] === process.env.ADMIN_KEY;
  },
}));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await gateway.shutdown();
  process.exit(0);
});

app.listen(3000, () => {
  console.log("🛡️ Bulwark AI gateway running on http://localhost:3000");
  console.log("   Chat:  POST /api/ai/chat");
  console.log("   Audit: GET  /api/ai/audit");
  console.log("   Admin: GET  /admin/ai/dashboard");
});
