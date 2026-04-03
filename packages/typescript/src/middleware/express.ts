import { AIGateway, BulwarkError } from "../gateway";
import type { Request, Response, NextFunction, Router } from "express";

/**
 * Express middleware that adds gateway to req.
 *
 * @example
 * ```ts
 * app.use(bulwarkMiddleware(gateway));
 * app.post("/api/chat", async (req, res) => {
 *   const response = await req.bulwark.chat({ ... });
 * });
 * ```
 */
export function bulwarkMiddleware(gateway: AIGateway) {
  return (req: Request & { bulwark?: AIGateway }, _res: Response, next: NextFunction) => {
    req.bulwark = gateway;
    next();
  };
}

/**
 * Mount a complete chat API endpoint with governance pipeline.
 *
 * @example
 * ```ts
 * app.use("/api/ai", bulwarkRouter(gateway, {
 *   auth: (req) => ({ userId: req.user.id, teamId: req.user.team }),
 *   maxBodySize: "1mb",
 * }));
 * // POST /api/ai/chat — governed chat completion
 * // GET  /api/ai/audit — query audit log
 * ```
 */
export function bulwarkRouter(gateway: AIGateway, options?: {
  auth?: (req: Request) => { userId?: string; teamId?: string; tenantId?: string } | null;
  maxBodySize?: string;
}): Router {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require("express");
  const router = express.Router();

  // Body size limit — default 1MB
  router.use(express.json({ limit: options?.maxBodySize || "1mb" }));

  router.post("/chat", async (req: Request, res: Response) => {
    try {
      const authCtx = options?.auth?.(req) || {};
      // Auth context ALWAYS overrides body — prevents auth bypass via JSON
      const { messages, model, temperature, maxTokens, topP, stop, knowledgeBase, pii, skipPolicies, stream: _stream } = req.body;
      const response = await gateway.chat({
        messages, model, temperature, maxTokens, topP, stop, knowledgeBase, pii, skipPolicies,
        userId: authCtx.userId,
        teamId: authCtx.teamId,
        tenantId: authCtx.tenantId,
      });
      res.json(response);
    } catch (err: unknown) {
      if (err instanceof BulwarkError) {
        res.status(err.httpStatus).json(err.toJSON());
      } else {
        const message = err instanceof Error ? err.message : "Internal server error";
        res.status(500).json({ error: message, code: "INTERNAL_ERROR" });
      }
    }
  });

  // Streaming chat endpoint (SSE)
  router.post("/stream", async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // No wildcard CORS — consumer must configure their own CORS middleware
    res.flushHeaders();

    // Timeout: close connection after 5 minutes
    const timeout = setTimeout(() => { res.write("event: error\ndata: {\"error\":\"Stream timeout\"}\n\n"); res.end(); }, 300_000);

    try {
      const authCtx = options?.auth?.(req) || {};
      const { messages, model, temperature, maxTokens, topP, stop, knowledgeBase, pii, skipPolicies } = req.body;
      const stream = gateway.chatStream({
        messages, model, temperature, maxTokens, topP, stop, knowledgeBase, pii, skipPolicies,
        userId: authCtx.userId,
        teamId: authCtx.teamId,
        tenantId: authCtx.tenantId,
      });

      for await (const event of stream) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err: unknown) {
      if (err instanceof BulwarkError) {
        res.write(`event: error\ndata: ${JSON.stringify(err.toJSON())}\n\n`);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" })}\n\n`);
      }
    }
    clearTimeout(timeout);
    res.end();
  });

  // Audit endpoint — scoped to authenticated user unless admin
  router.get("/audit", async (req: Request, res: Response) => {
    try {
      const authCtx = options?.auth?.(req);
      if (!authCtx) return res.status(401).json({ error: "Authentication required" });

      const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 1000);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      // Non-admin users can only query their own audit entries
      const entries = await gateway.audit.query({
        userId: authCtx.userId || (typeof req.query.userId === "string" ? req.query.userId : undefined),
        teamId: typeof req.query.teamId === "string" ? req.query.teamId : undefined,
        tenantId: authCtx.tenantId || (typeof req.query.tenantId === "string" ? req.query.tenantId : undefined),
        action: typeof req.query.action === "string" ? req.query.action : undefined,
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        limit,
        offset,
      });
      res.json(entries);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
    }
  });

  return router;
}
