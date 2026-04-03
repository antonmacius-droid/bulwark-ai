/**
 * Bulwark AI — Fastify Multi-Tenant Example
 *
 * Run: npx tsx index.ts
 *
 * Shows multi-tenant setup where each organization has:
 * - Isolated data (RAG, audit, budgets)
 * - Per-tenant rate limiting
 * - Separate budget tracking
 */

import Fastify from "fastify";
import { AIGateway, bulwarkPlugin } from "@bulwark-ai/gateway";

const app = Fastify({ logger: true });

const gateway = new AIGateway({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY! },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
  },
  database: "multi-tenant.db",
  multiTenant: true,
  pii: { enabled: true, action: "redact" },
  budgets: { enabled: true, defaultUserLimit: 100_000 },
  audit: true,

  // Retry + fallback: if OpenAI fails, try Anthropic
  retry: { maxRetries: 2, baseDelayMs: 1000 },
  fallbacks: {
    "gpt-4o": ["gpt-4o-mini", "claude-sonnet-4-20250514"],
  },

  // Rate limiting
  rateLimit: { enabled: true, maxRequests: 100, windowSeconds: 60, scope: "user" },
});

// Register Bulwark plugin — adds /api/ai/chat and /api/ai/audit
app.register(bulwarkPlugin, {
  gateway,
  prefix: "/api/ai",
  auth: (req) => {
    const r = req as { headers: Record<string, string> };
    // In production: verify JWT, extract org/user from token
    return {
      userId: r.headers["x-user-id"],
      teamId: r.headers["x-team-id"],
      tenantId: r.headers["x-tenant-id"], // org isolation
    };
  },
});

// Create tenants on startup
app.addHook("onReady", async () => {
  await gateway.init();
  const tenants = gateway.tenants!;

  // Create example tenants
  if (tenants.list().length === 0) {
    tenants.create({ name: "Acme Corp", settings: { maxUsers: 50 } });
    tenants.create({ name: "Globex Inc", settings: { maxUsers: 20 } });
    console.log("Created example tenants");
  }
});

app.listen({ port: 3000 }, () => {
  console.log("Multi-tenant gateway on http://localhost:3000");
});
