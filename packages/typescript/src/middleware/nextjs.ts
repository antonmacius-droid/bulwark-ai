import type { AIGateway } from "../gateway";
import { BulwarkError } from "../gateway";
import type { ChatRequest } from "../types";

/**
 * Next.js App Router handler factory.
 * No `next` dependency required — uses Web API Response.
 *
 * @example
 * ```ts
 * // app/api/ai/chat/route.ts
 * import { createNextHandler } from "@bulwark-ai/gateway";
 * import { gateway } from "@/lib/bulwark";
 * export const POST = createNextHandler(gateway, {
 *   auth: (req) => ({ userId: req.headers.get("x-user-id") || undefined }),
 * });
 * ```
 */

interface RequestLike {
  json(): Promise<unknown>;
  headers: { get(key: string): string | null };
  nextUrl?: { searchParams: { get(key: string): string | null } };
  url?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createNextHandler(gateway: AIGateway, options?: {
  auth?: (req: RequestLike) => { userId?: string; teamId?: string; tenantId?: string } | null;
}) {
  return async function POST(req: RequestLike) {
    try {
      const body = await req.json() as Record<string, unknown>;
      const authCtx = options?.auth?.(req) || {};

      // SECURITY: Auth context ALWAYS overrides body — prevents auth bypass
      const { messages, model, temperature, maxTokens, topP, stop, knowledgeBase } = body as Record<string, unknown>;
      const response = await gateway.chat({
        messages, model, temperature, maxTokens, topP, stop, knowledgeBase,
        userId: authCtx.userId,
        teamId: authCtx.teamId,
        tenantId: authCtx.tenantId,
      } as ChatRequest);

      return jsonResponse(response);
    } catch (err: unknown) {
      if (err instanceof BulwarkError) {
        return jsonResponse(err.toJSON(), err.httpStatus);
      }
      return jsonResponse({ error: err instanceof Error ? err.message : "Internal server error", code: "INTERNAL_ERROR" }, 500);
    }
  };
}

export function createNextAuditHandler(gateway: AIGateway, options?: {
  auth?: (req: RequestLike) => { userId?: string; teamId?: string; tenantId?: string } | null;
}) {
  return async function GET(req: RequestLike) {
    const authCtx = options?.auth?.(req);
    if (!authCtx) return jsonResponse({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);

    const params = req.nextUrl?.searchParams || new URL(req.url || "http://localhost").searchParams;
    const limit = Math.min(Math.max(1, Number(params.get("limit")) || 50), 1000);
    const offset = Math.max(0, Number(params.get("offset")) || 0);

    const entries = await gateway.audit.query({
      userId: authCtx.userId || params.get("userId") || undefined,
      teamId: params.get("teamId") || undefined,
      tenantId: authCtx.tenantId || params.get("tenantId") || undefined,
      action: params.get("action") || undefined,
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      limit, offset,
    });

    return jsonResponse(entries);
  };
}
