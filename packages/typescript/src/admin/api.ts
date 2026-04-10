/**
 * Admin API — full CRUD endpoints for the admin panel.
 */

import type { AIGateway } from "../gateway";
import type { Database } from "../database";
import type { ContentPolicy } from "../security/types";

export interface AdminDashboard {
  requestsToday: number; requestsThisMonth: number;
  costToday: number; costThisMonth: number; activeUsers: number;
  topModels: { model: string; count: number; cost: number }[];
  topUsers: { userId: string; count: number; cost: number }[];
  costByTeam: { teamId: string; cost: number; tokens: number }[];
}

export async function getDashboard(db: Database, tenantId?: string): Promise<AdminDashboard> {
  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthStr = monthStart.toISOString();
  const tf = tenantId ? " AND tenant_id = ?" : "";
  const tp = tenantId ? [tenantId] : [];

  const todayRow = await db.queryOne<{ c: number; cost: number }>(`SELECT COUNT(*) as c, COALESCE(SUM(cost_usd), 0) as cost FROM bulwark_audit WHERE action = 'chat' AND timestamp >= ?${tf}`, [today, ...tp]);
  const monthRow = await db.queryOne<{ c: number; cost: number }>(`SELECT COUNT(*) as c, COALESCE(SUM(cost_usd), 0) as cost FROM bulwark_audit WHERE action = 'chat' AND timestamp >= ?${tf}`, [monthStr, ...tp]);
  const activeUsers = await db.queryOne<{ c: number }>(`SELECT COUNT(DISTINCT user_id) as c FROM bulwark_audit WHERE action = 'chat' AND timestamp >= ?${tf}`, [monthStr, ...tp]);
  const topModels = await db.queryAll<{ model: string; count: number; cost: number }>(`SELECT model, COUNT(*) as count, COALESCE(SUM(cost_usd), 0) as cost FROM bulwark_audit WHERE action = 'chat' AND timestamp >= ? AND model IS NOT NULL${tf} GROUP BY model ORDER BY count DESC LIMIT 10`, [monthStr, ...tp]);
  const topUsers = await db.queryAll<{ userId: string; count: number; cost: number }>(`SELECT user_id as userId, COUNT(*) as count, COALESCE(SUM(cost_usd), 0) as cost FROM bulwark_audit WHERE action = 'chat' AND timestamp >= ? AND user_id IS NOT NULL${tf} GROUP BY user_id ORDER BY cost DESC LIMIT 20`, [monthStr, ...tp]);
  const costByTeam = await db.queryAll<{ teamId: string; cost: number; tokens: number }>(`SELECT team_id as teamId, COALESCE(SUM(cost_usd), 0) as cost, COALESCE(SUM(input_tokens + output_tokens), 0) as tokens FROM bulwark_usage WHERE timestamp >= ?${tf.replace("tenant_id", "tenant_id")} GROUP BY team_id ORDER BY cost DESC`, [monthStr, ...tp]);

  return {
    requestsToday: todayRow?.c || 0, requestsThisMonth: monthRow?.c || 0,
    costToday: Math.round((todayRow?.cost || 0) * 100) / 100, costThisMonth: Math.round((monthRow?.cost || 0) * 100) / 100,
    activeUsers: activeUsers?.c || 0, topModels, topUsers, costByTeam,
  };
}

// Minimal Express types to avoid requiring express as a dependency
interface Req { query: Record<string, string>; body: Record<string, unknown>; method: string; }
interface Res { json(d: unknown): void; status(n: number): Res; }

export function createAdminRouter(gateway: AIGateway, options: { auth: (req: unknown) => boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require("express");
  const router = express.Router();
  router.use(express.json());

  // Auth
  router.use((req: unknown, res: Res, next: () => void) => {
    if (!options.auth(req)) return res.status(403).json({ error: "Forbidden" });
    next();
  });

  // ═══ DASHBOARD ═══
  router.get("/dashboard", async (_req: Req, res: Res) => res.json(await getDashboard(gateway.database)));

  // ═══ AUDIT ═══
  router.get("/audit", async (req: Req, res: Res) => {
    const entries = await gateway.audit.query({
      userId: req.query.userId, teamId: req.query.teamId, tenantId: req.query.tenantId,
      action: req.query.action, from: req.query.from, to: req.query.to,
      limit: Math.min(Number(req.query.limit) || 50, 1000), offset: Math.max(Number(req.query.offset) || 0, 0),
    });
    res.json(entries);
  });

  // ═══ KNOWLEDGE BASE ═══
  router.get("/knowledge", async (_req: Req, res: Res) => res.json({ sources: await gateway.rag?.listSources() || [] }));

  router.post("/knowledge/ingest", async (req: Req, res: Res) => {
    if (!gateway.rag) return res.status(400).json({ error: "RAG not enabled" });
    const { content, name, type, tenantId } = req.body as { content: string; name: string; type: string; tenantId?: string };
    if (!content || !name) return res.status(400).json({ error: "content and name required" });
    // Max content length: 10MB
    if (typeof content === "string" && content.length > 10 * 1024 * 1024) return res.status(400).json({ error: "Content too large (max 10MB)" });
    try {
      const result = await gateway.rag.ingest(content, { name, type: (type || "text") as "text", tenantId });
      res.json({ success: true, ...result });
    } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : "Ingest failed" }); }
  });

  router.delete("/knowledge/:sourceId", async (req: Req & { params: { sourceId: string } }, res: Res) => {
    if (!gateway.rag) return res.status(400).json({ error: "RAG not enabled" });
    try {
      await gateway.rag.deleteSource(req.params.sourceId);
      res.json({ success: true });
    } catch (err) { res.status(403).json({ error: err instanceof Error ? err.message : "Delete failed" }); }
  });

  router.post("/knowledge/search", async (req: Req, res: Res) => {
    if (!gateway.rag) return res.status(400).json({ error: "RAG not enabled" });
    const { query, tenantId, topK } = req.body as { query: string; tenantId?: string; topK?: number };
    if (!query) return res.status(400).json({ error: "query required" });
    const results = await gateway.rag.search(query, { tenantId, topK });
    res.json({ results });
  });

  // ═══ POLICIES ═══
  router.get("/policies", (_req: Req, res: Res) => res.json({ policies: gateway.policies.getPolicies() }));

  router.post("/policies", (req: Req, res: Res) => {
    const policy = req.body as Record<string, unknown>;
    if (!policy.id || !policy.name || !policy.type || !policy.action) {
      return res.status(400).json({ error: "Policy requires: id, name, type, action" });
    }
    try {
      gateway.policies.addPolicy(policy as unknown as ContentPolicy);
      res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Failed" }); }
  });

  router.delete("/policies/:id", (req: Req & { params: { id: string } }, res: Res) => {
    gateway.policies.removePolicy(req.params.id);
    res.json({ success: true });
  });

  // ═══ TENANTS ═══
  router.get("/tenants", async (_req: Req, res: Res) => {
    res.json({ tenants: await gateway.tenants?.list() || [] });
  });

  router.post("/tenants", async (req: Req, res: Res) => {
    if (!gateway.tenants) return res.status(400).json({ error: "Multi-tenant not enabled" });
    const { name, settings } = req.body as { name: string; settings?: Record<string, unknown> };
    if (!name) return res.status(400).json({ error: "name required" });
    const tenant = await gateway.tenants.create(name, settings);
    res.json({ success: true, tenant });
  });

  router.get("/tenants/:id/usage", async (req: Req & { params: { id: string } }, res: Res) => {
    if (!gateway.tenants) return res.status(400).json({ error: "Multi-tenant not enabled" });
    res.json(await gateway.tenants.getUsage(req.params.id));
  });

  router.delete("/tenants/:id", (req: Req & { params: { id: string } }, res: Res) => {
    if (!gateway.tenants) return res.status(400).json({ error: "Multi-tenant not enabled" });
    gateway.tenants.delete(req.params.id);
    res.json({ success: true });
  });

  // ═══ BUDGETS ═══
  router.get("/budgets", async (_req: Req, res: Res) => {
    const db = gateway.database;
    const budgets = await db.queryAll("SELECT * FROM bulwark_budgets ORDER BY created_at DESC");
    res.json({ budgets });
  });

  router.post("/budgets", (req: Req, res: Res) => {
    const { scopeType, scopeId, monthlyTokenLimit, monthlyCostLimit, tenantId } = req.body as {
      scopeType: string; scopeId: string; monthlyTokenLimit: number; monthlyCostLimit?: number; tenantId?: string;
    };
    if (!scopeType || !scopeId) return res.status(400).json({ error: "scopeType and scopeId required" });
    if (monthlyTokenLimit !== undefined && (typeof monthlyTokenLimit !== "number" || monthlyTokenLimit < 0)) {
      return res.status(400).json({ error: "monthlyTokenLimit must be a non-negative number" });
    }
    if (monthlyCostLimit !== undefined && (typeof monthlyCostLimit !== "number" || monthlyCostLimit < 0)) {
      return res.status(400).json({ error: "monthlyCostLimit must be a non-negative number" });
    }
    const id = `budget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    gateway.database.run(
      "INSERT INTO bulwark_budgets (id, tenant_id, scope_type, scope_id, monthly_token_limit, monthly_cost_limit) VALUES (?, ?, ?, ?, ?, ?)",
      [id, tenantId || null, scopeType, scopeId, monthlyTokenLimit || 0, monthlyCostLimit || 0]
    );
    res.json({ success: true, id });
  });

  router.delete("/budgets/:id", (req: Req & { params: { id: string } }, res: Res) => {
    gateway.database.run("DELETE FROM bulwark_budgets WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  });

  // ═══ TENANT GOVERNANCE ═══
  router.get("/tenants/:id/governance", async (req: Req & { params: { id: string } }, res: Res) => {
    if (!gateway.tenants) return res.status(400).json({ error: "Multi-tenant not enabled" });
    const gov = await gateway.tenants.getGovernance(req.params.id);
    res.json({ governance: gov || {} });
  });

  router.put("/tenants/:id/governance", async (req: Req & { params: { id: string } }, res: Res) => {
    if (!gateway.tenants) return res.status(400).json({ error: "Multi-tenant not enabled" });
    try {
      await gateway.tenants.setGovernance(req.params.id, req.body as Record<string, unknown>);
      res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Failed" }); }
  });

  // ═══ CIRCUIT BREAKER ═══
  router.get("/circuits", (_req: Req, res: Res) => {
    if (!gateway.circuits) return res.json({ enabled: false, providers: {} });
    res.json({ enabled: true, providers: gateway.circuits.getAllStates() });
  });

  router.post("/circuits/:provider/reset", (req: Req & { params: { provider: string } }, res: Res) => {
    if (!gateway.circuits) return res.status(400).json({ error: "Circuit breaker not enabled" });
    gateway.circuits.reset(req.params.provider);
    res.json({ success: true });
  });

  // ═══ GATEWAY STATUS ═══
  router.get("/status", (_req: Req, res: Res) => {
    res.json({
      enabled: gateway.enabled,
      activeRequests: gateway.activeRequestCount,
      circuitBreaker: gateway.circuits ? gateway.circuits.getAllStates() : null,
    });
  });

  // ═══ SETTINGS ═══
  router.get("/settings", async (_req: Req, res: Res) => {
    const db = gateway.database;
    // Return current configuration (without sensitive keys)
    const policies = gateway.policies.getPolicies();
    const sources = await gateway.rag?.listSources() || [];
    const budgets = await db.queryAll("SELECT * FROM bulwark_budgets");
    const tenants = await gateway.tenants?.list() || [];

    const monthStr = new Date(new Date().setDate(1)).toISOString();
    const usage = await db.queryOne<{ requests: number; tokens: number; cost: number }>(
      "SELECT COUNT(*) as requests, COALESCE(SUM(input_tokens + output_tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM bulwark_usage WHERE timestamp >= ?",
      [monthStr]
    );

    res.json({
      policyCount: policies.length,
      sourceCount: sources.length,
      budgetCount: budgets.length,
      tenantCount: tenants.length,
      circuitBreakerEnabled: !!gateway.circuits,
      activeRequests: gateway.activeRequestCount,
      monthlyUsage: { requests: usage?.requests || 0, tokens: usage?.tokens || 0, cost: Math.round((usage?.cost || 0) * 100) / 100 },
    });
  });

  // ═══ EXPORT ═══
  router.get("/export/audit", async (req: Req, res: Res) => {
    const entries = await gateway.audit.query({
      from: req.query.from, to: req.query.to,
      limit: 10000, offset: 0,
    });
    res.json(entries);
  });

  return router;
}
