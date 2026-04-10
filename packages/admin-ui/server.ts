/**
 * Demo backend server for the admin UI.
 * Runs the Bulwark gateway with mock data so the UI has something to show.
 *
 * Run: npx tsx server.ts
 */

import express from "express";
import cors from "cors";
import { AIGateway, createAdminRouter, bulwarkRouter } from "../typescript/src/index";

const app = express();
app.use(cors({ origin: ["http://localhost:3100", "http://127.0.0.1:3100", "http://localhost:3101", "http://127.0.0.1:3101"], credentials: true }));
app.use(express.json());

// Create gateway (OpenAI key optional — UI works without it)
const gateway = new AIGateway({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY || "sk-demo" },
  },
  database: "demo-bulwark.db",
  pii: { enabled: true, action: "redact", types: ["email", "phone", "credit_card", "ssn"] },
  budgets: { enabled: true, defaultUserLimit: 500_000 },
  audit: true,
  policies: [
    { id: "no-secrets", name: "Block secrets", type: "keyword_block", patterns: ["password", "api_key", "secret"], action: "block" },
    { id: "no-competitors", name: "Block competitor names", type: "keyword_block", patterns: ["competitor-x"], action: "warn" },
  ],
});

// Seed some demo audit data
async function seedDemo() {
  await gateway.init();
  const db = gateway.database;

  // Check if already seeded
  const existing = db.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM bulwark_audit");
  if (existing && existing.c > 0) return;

  const models = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-6", "mistral-large-latest"];
  const users = ["alice", "bob", "carol", "dave", "eve"];
  const teams = ["engineering", "marketing", "sales"];

  for (let i = 0; i < 200; i++) {
    const model = models[Math.floor(Math.random() * models.length)];
    const user = users[Math.floor(Math.random() * users.length)];
    const team = teams[Math.floor(Math.random() * teams.length)];
    const inputTokens = Math.floor(Math.random() * 2000) + 100;
    const outputTokens = Math.floor(Math.random() * 1000) + 50;
    const cost = model.includes("4o-mini") ? 0.001 : model.includes("claude") ? 0.02 : 0.01;

    const daysAgo = Math.floor(Math.random() * 30);
    const timestamp = new Date(Date.now() - daysAgo * 86400000).toISOString();

    db.run(
      "INSERT OR IGNORE INTO bulwark_audit (id, user_id, team_id, action, model, provider, input_tokens, output_tokens, cost_usd, duration_ms, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [`demo-${i}`, user, team, "chat", model, model.includes("claude") ? "anthropic" : "openai", inputTokens, outputTokens, cost * (inputTokens + outputTokens) / 1000, Math.floor(Math.random() * 3000) + 200, timestamp]
    );
    db.run(
      "INSERT INTO bulwark_usage (user_id, team_id, model, input_tokens, output_tokens, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [user, team, model, inputTokens, outputTokens, cost * (inputTokens + outputTokens) / 1000, timestamp]
    );
  }

  // Add some PII and policy events
  for (let i = 0; i < 15; i++) {
    db.run("INSERT OR IGNORE INTO bulwark_audit (id, user_id, action, model, pii_detections, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      [`pii-${i}`, users[i % 5], "pii_detected", "gpt-4o", Math.floor(Math.random() * 3) + 1, new Date(Date.now() - i * 3600000).toISOString()]);
  }
  for (let i = 0; i < 5; i++) {
    db.run("INSERT OR IGNORE INTO bulwark_audit (id, user_id, action, policy_violations, timestamp) VALUES (?, ?, ?, ?, ?)",
      [`policy-${i}`, users[i], "policy_block", JSON.stringify(["no-secrets"]), new Date(Date.now() - i * 7200000).toISOString()]);
  }

  console.log("Seeded 200 chat + 15 PII + 5 policy demo entries");
}

seedDemo().then(() => {
  // Gateway status & circuit breaker mock endpoints
  app.get("/api/bulwark-admin/status", (_req, res) => {
    res.json({ enabled: true, activeRequests: 3, circuitBreaker: { openai: { state: "closed", failures: 0 }, anthropic: { state: "closed", failures: 0 } } });
  });
  app.get("/api/bulwark-admin/circuits", (_req, res) => {
    res.json({ enabled: true, providers: { openai: { state: "closed", failures: 0 }, anthropic: { state: "closed", failures: 0 } } });
  });
  app.get("/api/bulwark-admin/tenants/:id/governance", (_req, res) => {
    res.json({ governance: {} });
  });
  app.put("/api/bulwark-admin/tenants/:id/governance", (_req, res) => {
    res.json({ success: true });
  });
  app.post("/api/bulwark-admin/circuits/:provider/reset", (_req, res) => {
    res.json({ success: true });
  });

  // Mount admin API
  app.use("/api/bulwark-admin", createAdminRouter(gateway, {
    auth: () => true, // demo — no auth
  }));

  // Mount chat API (for playground)
  app.use("/api/ai", bulwarkRouter(gateway, {
    auth: (req) => ({ userId: req.headers["x-user-id"] as string || "playground-user" }),
  }));

  app.listen(3101, () => {
    console.log("Bulwark demo API running on http://localhost:3101");
    console.log("Admin UI: http://localhost:3100 (set VITE_API_BASE=http://localhost:3101/api/bulwark-admin)");
  });
});
