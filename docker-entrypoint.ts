/**
 * Docker entrypoint — serves the Bulwark AI gateway API and admin dashboard.
 *
 * Gateway API:  http://0.0.0.0:{GATEWAY_PORT}  (default 3100)
 * Admin UI:     http://0.0.0.0:{ADMIN_PORT}    (default 3101)
 */

import express from "express";
import path from "node:path";
import { AIGateway, bulwarkRouter, createAdminRouter } from "./dist/index.js";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT) || 3100;
const ADMIN_PORT = Number(process.env.ADMIN_PORT) || 3101;

// ---------------------------------------------------------------------------
// Build provider config from environment variables
// ---------------------------------------------------------------------------
const providers: Record<string, { apiKey: string; baseUrl?: string }> = {};

if (process.env.OPENAI_API_KEY) {
  providers.openai = {
    apiKey: process.env.OPENAI_API_KEY,
    ...(process.env.OPENAI_BASE_URL && { baseUrl: process.env.OPENAI_BASE_URL }),
  };
}
if (process.env.ANTHROPIC_API_KEY) {
  providers.anthropic = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_BASE_URL && { baseUrl: process.env.ANTHROPIC_BASE_URL }),
  };
}
if (process.env.MISTRAL_API_KEY) {
  providers.mistral = { apiKey: process.env.MISTRAL_API_KEY };
}
if (process.env.GOOGLE_API_KEY) {
  providers.google = { apiKey: process.env.GOOGLE_API_KEY };
}

if (Object.keys(providers).length === 0) {
  console.warn("[bulwark] No provider API keys found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
}

// ---------------------------------------------------------------------------
// Create gateway instance
// ---------------------------------------------------------------------------
const gateway = new AIGateway({
  providers,
  database: process.env.DATABASE_PATH || "/app/data/bulwark.db",
  pii: { enabled: true, action: "redact", types: ["email", "phone", "credit_card", "ssn"] },
  budgets: { enabled: true, defaultUserLimit: 1_000_000 },
  audit: true,
});

async function start() {
  await gateway.init();

  // -------------------------------------------------------------------------
  // Gateway API server
  // -------------------------------------------------------------------------
  const api = express();

  api.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "bulwark-gateway", timestamp: new Date().toISOString() });
  });

  api.use("/v1", bulwarkRouter(gateway, {
    auth: (req) => ({
      userId: req.headers["x-user-id"] as string || undefined,
      teamId: req.headers["x-team-id"] as string || undefined,
      tenantId: req.headers["x-tenant-id"] as string || undefined,
    }),
  }));

  api.use("/admin", createAdminRouter(gateway, {
    auth: () => true, // TODO: add proper admin auth via BULWARK_ADMIN_TOKEN
  }));

  api.listen(GATEWAY_PORT, "0.0.0.0", () => {
    console.log(`[bulwark] Gateway API listening on http://0.0.0.0:${GATEWAY_PORT}`);
  });

  // -------------------------------------------------------------------------
  // Admin UI static server
  // -------------------------------------------------------------------------
  const ui = express();
  const uiPath = path.resolve(__dirname, "admin-ui");

  ui.use(express.static(uiPath));

  // SPA fallback — serve index.html for client-side routing
  ui.get("*", (_req, res) => {
    res.sendFile(path.join(uiPath, "index.html"));
  });

  ui.listen(ADMIN_PORT, "0.0.0.0", () => {
    console.log(`[bulwark] Admin UI listening on http://0.0.0.0:${ADMIN_PORT}`);
  });
}

start().catch((err) => {
  console.error("[bulwark] Fatal error during startup:", err);
  process.exit(1);
});
