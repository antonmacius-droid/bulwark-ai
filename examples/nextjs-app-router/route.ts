/**
 * Bulwark AI — Next.js App Router Example
 *
 * File: app/api/ai/chat/route.ts
 *
 * Adds AI governance to any Next.js app in ~20 lines.
 * PII redaction, budget control, audit logging — all automatic.
 */

import { AIGateway, createNextHandler, createNextAuditHandler } from "@bulwark-ai/gateway";
import { auth } from "@/lib/auth"; // your auth solution

// Create gateway once (module-level singleton)
const gateway = new AIGateway({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY! },
  },
  database: "bulwark.db",
  pii: { enabled: true, action: "redact" },
  budgets: { enabled: true, defaultUserLimit: 500_000 },
  audit: true,
});

// Chat endpoint — full governance pipeline
export const POST = createNextHandler(gateway, {
  auth: (req) => {
    const session = auth(); // your auth check
    if (!session) return null; // returns 401
    return {
      userId: session.user.id,
      teamId: session.user.teamId,
      tenantId: session.user.orgId,
    };
  },
});

// Audit endpoint — app/api/ai/audit/route.ts
// export const GET = createNextAuditHandler(gateway, {
//   auth: (req) => {
//     const session = auth();
//     if (!session) return null;
//     return { userId: session.user.id, tenantId: session.user.orgId };
//   },
// });
