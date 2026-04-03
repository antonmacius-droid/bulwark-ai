import type { AIGateway } from "../gateway";
import { BulwarkError } from "../gateway";

/**
 * Fastify plugin for Bulwark AI.
 *
 * @example
 * ```ts
 * import Fastify from "fastify";
 * import { bulwarkPlugin } from "@bulwark-ai/gateway/middleware/fastify";
 *
 * const app = Fastify();
 * app.register(bulwarkPlugin, {
 *   gateway,
 *   prefix: "/api/ai",
 *   auth: (req) => ({ userId: req.headers["x-user-id"] }),
 * });
 * ```
 */
export function bulwarkPlugin(
  fastify: FastifyLike,
  options: {
    gateway: AIGateway;
    prefix?: string;
    auth?: (req: unknown) => { userId?: string; teamId?: string; tenantId?: string } | null;
  },
  done: () => void
) {
  const { gateway, auth } = options;

  fastify.post(`${options.prefix || ""}/chat`, async (req: unknown, reply: FastifyReply) => {
    try {
      const request = req as { body: Record<string, unknown> };
      const authCtx = auth?.(req) || {};
      const body = request.body;
      // SECURITY: Auth context ALWAYS overrides body — prevents auth bypass
      const { messages, model, temperature, maxTokens, topP, stop, knowledgeBase } = body as Record<string, unknown>;
      const response = await gateway.chat({
        messages, model, temperature, maxTokens, topP, stop, knowledgeBase,
        userId: authCtx.userId,
        teamId: authCtx.teamId,
        tenantId: authCtx.tenantId,
      } as Parameters<typeof gateway.chat>[0]);
      return reply.send(response);
    } catch (err: unknown) {
      if (err instanceof BulwarkError) {
        return reply.status(err.httpStatus).send(err.toJSON());
      }
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  fastify.get(`${options.prefix || ""}/audit`, async (req: unknown, reply: FastifyReply) => {
    const authCtx = auth?.(req);
    if (!authCtx) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const q = (req as { query: Record<string, string> }).query;
    const entries = await gateway.audit.query({
      userId: authCtx.userId || q.userId, teamId: q.teamId,
      tenantId: authCtx.tenantId || q.tenantId,
      action: q.action, from: q.from, to: q.to,
      limit: Math.min(Number(q.limit) || 50, 1000),
      offset: Math.max(Number(q.offset) || 0, 0),
    });
    return reply.send(entries);
  });

  done();
}

/** Minimal Fastify interfaces to avoid requiring fastify as dependency */
interface FastifyLike {
  post(path: string, handler: (req: unknown, reply: FastifyReply) => Promise<unknown>): void;
  get(path: string, handler: (req: unknown, reply: FastifyReply) => Promise<unknown>): void;
}
interface FastifyReply {
  status(code: number): FastifyReply;
  send(data: unknown): FastifyReply;
}
