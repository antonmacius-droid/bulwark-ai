<p align="center">
  <img src="banner.svg" alt="Bulwark AI" width="100%">
</p>

<p align="center">
  <strong>Enterprise AI governance for any app.</strong><br>
  Drop-in LLM gateway with PII detection, prompt injection guard, budget control,<br>
  audit logging, RAG knowledge base, GDPR/SOC 2/HIPAA/CCPA compliance, and multi-tenant support.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#features">Features</a> · <a href="#comparison">Comparison</a> · <a href="#test-suite">Tests</a> · <a href="#license">License</a>
</p>

<p align="center">
  The only TypeScript-native, self-hosted, embeddable AI governance package. Your data never leaves your infrastructure.
</p>

```bash
npm install @bulwark-ai/gateway
```

**136 tests passing** (42 unit + 94 integration with real LLM calls) | **Zero type errors** | MIT + BSL 1.1

<p align="center">
  <img src="demo.svg" alt="Bulwark AI Pipeline" width="100%">
</p>

## Quick Start

```typescript
import { AIGateway } from "@bulwark-ai/gateway";

// Option A: Use a preset (recommended)
const gateway = new AIGateway({
  mode: "balanced",                  // "strict" | "balanced" | "dev"
  failMode: "fail-closed",          // "fail-closed" | "fail-open"
  providers: { openai: { apiKey: process.env.OPENAI_API_KEY! } },
  database: "bulwark.db",
});

// Option B: Full control
const gateway = new AIGateway({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY! },
  },
  database: "bulwark.db",           // SQLite — zero config
  pii: { enabled: true, action: "redact" },
  budgets: { enabled: true, defaultUserLimit: 500_000 },
  audit: true,
});

const response = await gateway.chat({
  model: "gpt-4o",                  // auto-routes to correct provider
  userId: "user-123",
  messages: [{ role: "user", content: "Analyze this contract..." }],
});

// Pipeline ran: Input validation → Prompt injection scan → PII redaction →
// Policy check → Rate limit → Budget check → RAG augment → LLM call →
// Output PII scan → Cost calculate → Audit log
```

## Why Bulwark?

| Problem | Solution |
|---------|---------|
| Employees send PII to ChatGPT | Auto-detect & redact 14 PII types (input AND output) |
| No visibility into AI spend | Per-user/team budgets with real-time cost tracking |
| Prompt injection attacks | Built-in guard with 20+ detection patterns |
| No audit trail | Every request logged — user, model, tokens, cost, duration |
| GDPR/SOC 2 compliance | Right to erasure, data export, retention, anomaly detection |
| Different teams use different tools | One gateway, 6 LLM providers, unified policies |

## Config Presets

| Mode | PII | Budgets | Injection Guard | Best For |
|------|-----|---------|----------------|----------|
| `strict` | Block | 100K tokens, block | High sensitivity | Healthcare, finance, regulated |
| `balanced` | Redact | 500K tokens | Medium sensitivity | General production use |
| `dev` | Off | Off | On (audit only) | Development and testing |

```typescript
// Strict mode — blocks PII, tight budgets, aggressive injection detection
new AIGateway({ mode: "strict", providers: { ... }, database: "bulwark.db" });

// Fail strategy — what happens when governance itself breaks
new AIGateway({ failMode: "fail-open", ... });   // availability-first (log failure, allow request)
new AIGateway({ failMode: "fail-closed", ... });  // security-first (block request if governance fails)
```

## Features

### 6 LLM Providers — Auto-Routing

```typescript
const gateway = new AIGateway({
  providers: {
    openai:    { apiKey: "sk-..." },              // GPT-4o, GPT-4o-mini, o1, o3
    anthropic: { apiKey: "sk-ant-..." },          // Claude Opus, Sonnet, Haiku
    mistral:   { apiKey: "..." },                 // Mistral Large, Small, Codestral
    google:    { apiKey: "..." },                 // Gemini 2.0 Flash/Pro
    ollama:    { apiKey: "", baseUrl: "http://localhost:11434" }, // Local LLMs (zero data leaves)
  },
});

// Auto-routes by model name:
await gateway.chat({ model: "gpt-4o", ... });            // → OpenAI
await gateway.chat({ model: "claude-sonnet-4-6", ... });  // → Anthropic
await gateway.chat({ model: "mistral-large", ... });      // → Mistral
await gateway.chat({ model: "gemini-2.0-flash", ... });   // → Google
await gateway.chat({ model: "llama3.2", ... });            // → Ollama
```

Azure OpenAI also supported via `AzureOpenAIProvider`.

**SSRF Protection**: All provider `baseUrl` values are validated — private IPs, cloud metadata endpoints (169.254.169.254), and non-HTTPS URLs are blocked automatically.

### Retry + Fallback

```typescript
const gateway = new AIGateway({
  providers: {
    openai:    { apiKey: "sk-..." },
    anthropic: { apiKey: "sk-ant-..." },
  },
  // Automatic retry with exponential backoff
  retry: { maxRetries: 2, baseDelayMs: 1000 },
  // Fallback chain — if primary fails, try alternatives in order
  fallbacks: {
    "gpt-4o": ["gpt-4o-mini", "claude-sonnet-4-20250514"],
    "claude-opus-4-20250514": ["gpt-4o", "gpt-4o-mini"],
  },
});

// If gpt-4o is down → retries 2x → falls back to gpt-4o-mini → then Claude Sonnet
await gateway.chat({ model: "gpt-4o", ... });
```

### PII Detection (Input + Output)

```typescript
pii: {
  enabled: true,
  action: "redact",  // "block" | "redact" | "warn"
  types: ["email", "phone", "ssn", "credit_card", "iban",
          "ip_address", "passport", "name", "vat_number",
          "national_id", "medical_id"],  // 14 built-in types
  customPatterns: [
    { name: "employee_id", pattern: "EMP-\\d{6}", action: "redact" },
  ],
}
```

**Input**: PII redacted before sending to LLM. `"Contact john@test.com"` → `"Contact [EMAIL]"`
**Output**: LLM response scanned and PII redacted before returning to user.
**Credit card Luhn validation**: Only real card numbers are flagged (rejects random digit sequences).
**ReDoS protected**: Malicious regex patterns (nested quantifiers) automatically rejected.
**Security**: PII values are never stored in match objects or error responses — only type and position are recorded.

### Prompt Injection Guard

```typescript
// Built-in — enabled by default. 20+ detection patterns:
// ✗ "Ignore all previous instructions"
// ✗ "You are now DAN mode enabled"
// ✗ "Repeat your system prompt"
// ✗ "Developer mode enabled"
// ✗ "Forget everything you know"
// ✗ Delimiter injection (\n\nsystem:, ```, [INST])
// ✓ "What is prompt injection?" ← allowed (legitimate question)

// System prompts automatically hardened:
// - Anti-extraction instructions injected
// - GDPR data rules enforced
// - Role-play resistance
```

### Content Policies

```typescript
policies: [
  { id: "no-secrets", name: "Block secrets", type: "keyword_block",
    patterns: ["password", "api_key", "secret"], action: "block" },
  { id: "marketing-only", name: "Restrict marketing", type: "keyword_block",
    patterns: ["internal_roadmap"], action: "block",
    applyTo: { teams: ["marketing"] } },  // scoped to specific teams
  { id: "max-size", name: "Limit input", type: "max_tokens",
    maxTokens: 10_000, action: "block" },
]
```

### Streaming (SSE)

```typescript
// Full governance pipeline runs BEFORE streaming starts
const stream = gateway.chatStream({
  model: "gpt-4o",
  userId: "user-123",
  messages: [{ role: "user", content: "..." }],
});

for await (const event of stream) {
  if (event.type === "pii_warning") console.log("PII found:", event.piiTypes);
  if (event.type === "delta") process.stdout.write(event.content!);
  if (event.type === "done") console.log("Cost:", event.cost);
}
```

Streaming runs the identical governance pipeline as non-streaming — all messages scanned for PII and injection, system prompts hardened.

### Budget Enforcement + Rate Limiting

```typescript
budgets: {
  enabled: true,
  defaultUserLimit: 500_000,     // tokens/month per user
  defaultTeamLimit: 5_000_000,
  onExceeded: "block",
  alertThresholds: [0.7, 0.9],
  onAlert: (alert) => slack.send(`Budget: ${alert.id} at ${alert.threshold * 100}%`),
},

// Rate limiting (Redis for multi-instance)
import { RedisCacheStore } from "@bulwark-ai/gateway";
// rateLimit: { enabled: true, maxRequests: 100, windowSeconds: 60, scope: "user" }
// cache: new RedisCacheStore(new Redis())
```

### RAG Knowledge Base

```typescript
// Ingest documents
await gateway.rag.ingest("Document text...", { name: "contract.pdf", type: "pdf" });

// Semantic search
const results = await gateway.rag.search("payment terms");

// Chat with RAG — automatically augments system prompt with relevant context
await gateway.chat({ model: "gpt-4o", messages: [...], knowledgeBase: true });
```

Document parsers included: PDF, HTML, CSV, Markdown, plain text.
Chunking strategies: paragraph, sentence, markdown, fixed.

### GDPR Compliance

```typescript
import { GDPRManager } from "@bulwark-ai/gateway";

const gdpr = new GDPRManager(gateway.database, { retentionDays: 365 });

gdpr.eraseUserData("user-123");         // Right to Erasure (Art. 17)
gdpr.exportUserData("user-123");        // Data Portability (Art. 20)
gdpr.enforceRetention();                // Auto-delete old records
gdpr.generateProcessingReport();        // DPIA support
```

### SOC 2 Controls

```typescript
import { SOC2Manager } from "@bulwark-ai/gateway";

const soc2 = new SOC2Manager(gateway.database, {
  anomalyThresholds: { maxRequestsPerUserPerHour: 200, maxPiiPerHour: 50 },
  onAnomaly: (event) => pagerduty.alert(event),
});

await soc2.detectAnomalies();           // Anomaly detection
soc2.logChange({ entityType, action }); // Change management
soc2.generateVendorReport();            // Sub-processor report
soc2.getHealthStatus(activeRequests);   // Health check
```

### Multi-Tenant

```typescript
const gateway = new AIGateway({ multiTenant: true, ... });

// Data isolation per tenant
await gateway.chat({ tenantId: "org_acme", userId: "alice", ... });
await gateway.chat({ tenantId: "org_globex", userId: "bob", ... });

// Tenant management
gateway.tenants.create("Acme Corp");
gateway.tenants.getUsage("tenant_xxx");
gateway.tenants.delete("tenant_xxx");  // deletes ALL tenant data
```

### Framework Integration

```typescript
// Express
import { bulwarkRouter, createAdminRouter } from "@bulwark-ai/gateway";
app.use("/api/ai", bulwarkRouter(gateway, { auth: (req) => ({ userId: req.user.id }) }));
app.use("/admin/ai", createAdminRouter(gateway, { auth: (req) => req.user?.role === "admin" }));

// Next.js App Router
import { createNextHandler } from "@bulwark-ai/gateway";
export const POST = createNextHandler(gateway, { auth: (req) => ({ userId: req.headers.get("x-user-id") }) });

// Fastify
import { bulwarkPlugin } from "@bulwark-ai/gateway";
app.register(bulwarkPlugin, { gateway, prefix: "/api/ai" });
```

### Admin Panel

Standalone admin UI with: Dashboard, Playground, Users & Teams, Knowledge Base, Policies, Audit Log, Cost Center, Settings, Documentation.

```bash
cd packages/admin-ui && npm run dev  # http://localhost:3100
```

## Docker

```bash
# Quick start with Docker Compose
git clone https://github.com/antonmacius-droid/bulwark-ai.git
cd bulwark-ai

# Set your API keys
echo "OPENAI_API_KEY=sk-your-key" > .env

# Start gateway + Redis
docker compose up -d

# Gateway API:  http://localhost:3100
# Admin UI:     http://localhost:3101
# Health check: http://localhost:3100/health
```

```bash
# Send a request
curl http://localhost:3100/v1/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user-123" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Integration Guides

### Add to Existing Express App (5 min)

```typescript
// 1. Install
// npm install @bulwark-ai/gateway

// 2. Create gateway (once, at app startup)
import { AIGateway, bulwarkRouter } from "@bulwark-ai/gateway";

const gateway = new AIGateway({
  providers: { openai: { apiKey: process.env.OPENAI_API_KEY! } },
  database: "bulwark.db",
  pii: { enabled: true, action: "redact" },
  budgets: { enabled: true, defaultUserLimit: 500_000 },
  audit: true,
});

// 3. Mount (one line)
app.use("/api/ai", bulwarkRouter(gateway, {
  auth: (req) => ({ userId: req.user.id, teamId: req.user.team }),
}));

// That's it. POST /api/ai/chat now has full governance.
```

### Add to Next.js App Router (5 min)

```typescript
// app/api/ai/chat/route.ts
import { AIGateway, createNextHandler } from "@bulwark-ai/gateway";

const gateway = new AIGateway({ /* same config */ });

export const POST = createNextHandler(gateway, {
  auth: (req) => ({
    userId: req.headers.get("x-user-id") || undefined,
  }),
});
```

### Add to Fastify (5 min)

```typescript
import { AIGateway, bulwarkPlugin } from "@bulwark-ai/gateway";

const gateway = new AIGateway({ /* same config */ });

app.register(bulwarkPlugin, {
  gateway,
  prefix: "/api/ai",
  auth: (req) => ({ userId: req.headers["x-user-id"] }),
});
```

### Programmatic Usage (No Framework)

```typescript
// Use the gateway directly — no HTTP framework needed
const gateway = new AIGateway({ /* config */ });
await gateway.init();

const response = await gateway.chat({
  model: "gpt-4o",
  userId: "user-123",
  messages: [{ role: "user", content: "Hello" }],
});

// Streaming
for await (const event of gateway.chatStream({ /* same params */ })) {
  if (event.type === "delta") process.stdout.write(event.content);
}
```

## Best Practices

**Start small, add incrementally:**
1. Start with `pii` + `audit` — instant visibility into what data flows through your AI
2. Add `budgets` when you need cost control — set generous limits first, tighten later
3. Add `policies` for specific compliance needs (block secrets, restrict topics)
4. Add `rag` when you need document-grounded answers
5. Add `fallbacks` for production reliability

**Multi-tenant SaaS:**
- Always pass `tenantId` from your auth layer — never from the request body
- Each tenant's data is isolated: RAG, audit, budgets, usage
- Use `gateway.tenants` API to manage tenant lifecycle

**Production checklist:**
- [ ] SQLite database with regular backups (Postgres support is experimental)
- [ ] PII detection enabled with `action: "redact"`
- [ ] Budget limits set per user and team
- [ ] Auth function validates tokens (never trust request body for identity)
- [ ] `BULWARK_LICENSE_KEY` set if using RAG/compliance modules commercially
- [ ] Graceful shutdown: `process.on("SIGTERM", () => gateway.shutdown())`
- [ ] Monitor audit logs for anomalies (see SOC 2 module)

## Use Cases

| Use Case | Key Features |
|----------|-------------|
| **Internal AI chatbot** | PII redaction, audit trail, budget per department |
| **Customer-facing AI** | Prompt injection guard, content policies, rate limiting |
| **Multi-tenant SaaS** | Tenant isolation, per-org budgets, separate KB per tenant |
| **Healthcare AI** | HIPAA PHI logging, PII blocking, audit immutability |
| **EU compliance** | GDPR erasure/export, data residency checks, PII redaction |
| **Document Q&A** | RAG knowledge base, source citations, chunking strategies |
| **AI cost management** | Per-user budgets, alert thresholds, cost tracking per model |
| **Security-first AI** | Prompt hardening, injection guard, SSRF protection |

## KB Chat — "Chat with Your Docs"

Standalone knowledge base chat app included. Upload documents, chat with AI that references them.

```bash
cd packages/kb-chat
npm install
npx tsx server.ts    # API on :3200
npm run dev          # UI on :3201
```

Enter your OpenAI key → drag-and-drop documents → chat with source citations. Self-hosted, private, your data never leaves your machine.

## Architecture

```
Your App
  │
  ▼
┌─────────────────────────────────┐
│       Bulwark AI Gateway         │
│                                  │
│  Request ──┬── Input Validation  │
│            ├── Prompt Injection  │
│            ├── PII Scan (input)  │
│            ├── Policy Check      │
│            ├── Rate Limit        │
│            ├── Budget Check      │
│            ├── RAG Augment       │
│            ├── LLM Call (timeout)│
│            ├── PII Scan (output) │
│            ├── Cost Calculate    │
│            └── Audit Log         │
└──────────────┬───────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
 OpenAI   Anthropic   Mistral
    ▼          ▼          ▼
 Google    Ollama     Azure
```

## Storage

| Store | Use Case | Config |
|-------|----------|--------|
| **SQLite** | Development, single instance | `database: "bulwark.db"` |
| **PostgreSQL** | Production, pgvector for RAG (experimental — use SQLite for production) | `database: "postgres://..."` |
| **Redis** | Rate limiting, response caching | `cache: new RedisCacheStore(redis)` |
| **In-Memory** | Testing | Default |

## Test Suite

**136 tests, 100% pass rate.**

| Suite | Tests | What |
|-------|-------|------|
| Unit: PII | 7 | All pattern types, ReDoS protection, custom patterns |
| Unit: Policies | 7 | Keyword/regex/topic/max_tokens, team scoping, CRUD |
| Unit: Costs | 4 | Model pricing, custom overrides, fallback |
| Unit: Gateway | 9 | Validation, shutdown, error codes |
| Unit: Chunker | 6 | Paragraph/sentence/markdown, overlap, empty |
| Unit: Cache | 9 | Memory store, Redis, rate limiter, TTL |
| Integration: Basic | 5 | Metadata, system messages, multi-turn, determinism |
| Integration: PII Input | 8 | All 6 types + multiple + disable |
| Integration: PII Output | 1 | Output scanning |
| Integration: PII Edge | 5 | Start/end, punctuation, unicode, empty |
| Integration: Policies | 8 | All keywords, team scoping, max tokens |
| Integration: Injection | 12 | 12 attack patterns blocked, legitimate allowed |
| Integration: Budget | 2 | Usage tracking, cumulative |
| Integration: Audit | 5 | Metadata, PII count, filters, pagination |
| Integration: Streaming | 5 | Chunks, done event, PII warning, blocking |
| Integration: Multi-tenant | 2 | Create/delete, isolation |
| Integration: Cost | 3 | Non-zero, scaling, audit match |
| Integration: Errors | 8 | Invalid params, HTTP status, JSON serialization |
| Integration: GDPR | 3 | Erasure, export, processing report |
| Integration: SOC 2 | 4 | Change tracking, anomalies, vendor report, health |
| Integration: Concurrent | 1 | 10 parallel requests |
| Integration: Hardening | 2 | Secret protection, impersonation resistance |
| Integration: International | 3 | German, French, international phone PII |
| Integration: Streaming Edge | 2 | System messages, audit recording |
| Integration: RAG E2E | 3 | Ingest → search → chat with KB, tenant isolation, delete |
| Integration: Retry + Fallback | 3 | Provider fallback, retry success, exhaustion |
| Integration: Runtime Policies | 2 | Add/remove at runtime |
| Integration: Security Regression | 5 | Streaming PII/injection scan, prompt hardening, PII value protection |

Run integration tests: `OPENAI_API_KEY=sk-xxx npx vitest run src/__tests__/integration.test.ts`

## Comparison

| Feature | Bulwark | LiteLLM | Portkey | Helicone |
|---------|---------|---------|---------|----------|
| **Deployment** | | | | |
| Self-hosted | Yes | Yes | No (SaaS) | Partial |
| Embeddable (`npm install`) | Yes | No (proxy) | No | No |
| Docker Compose | Yes | Yes | No | No |
| TypeScript-native | Yes | No (Python) | No | No |
| **Security** | | | | |
| PII Detection | 14 types + custom + Luhn | Plugin | Partial | No |
| Output PII Scan | Yes (input + output) | No | No | No |
| Prompt Injection Guard | 20+ patterns | No | No | No |
| System Prompt Hardening | Yes | No | No | No |
| SSRF Protection | Yes | No | N/A | N/A |
| Content Policies | 4 types, team-scoped | Plugin | Partial | No |
| ReDoS Protection | Yes (PII + policies) | No | No | No |
| Auth Bypass Prevention | Yes (whitelist body) | No | N/A | N/A |
| **Governance** | | | | |
| Budget Control | Per-user/team/tenant | Yes | Yes | No |
| Rate Limiting | Yes (memory + Redis) | Yes | Yes | No |
| Audit Log | Yes (immutable) | Yes | Yes | Yes |
| Multi-Tenant Isolation | Yes (data + query) | No | No | No |
| Config Presets | strict/balanced/dev | No | No | No |
| Fail Mode | fail-open/fail-closed | No | No | No |
| Kill Switch | Yes (runtime toggle) | No | No | No |
| Debug/Trace Mode | Yes | No | No | Yes |
| **AI Features** | | | | |
| LLM Providers | 6 + Azure | 100+ | Many | Many |
| Retry + Fallback | Yes (cross-provider) | Yes | Yes | No |
| RAG Knowledge Base | Built-in | No | No | No |
| KB Chat App | Yes (standalone) | No | No | No |
| Streaming (SSE) | Yes | Yes | Yes | Yes |
| Metadata Tagging | Yes | No | Yes | Yes |
| **Compliance** | | | | |
| GDPR | Yes (erasure, export, retention) | No | No | No |
| SOC 2 | Yes (anomaly, vendor, change log) | No | No | No |
| HIPAA | Yes (PHI logging, BAA tracking) | No | No | No |
| CCPA | Yes (access, delete, opt-out, GPC) | No | No | No |
| Data Residency | Yes (region checks, TIA) | No | No | No |
| **Developer Experience** | | | | |
| Admin UI | Yes (9 pages) | Separate | SaaS | SaaS |
| Express/Next.js/Fastify | Yes (3 middleware) | No | No | No |
| Test Suite | 136 real LLM tests | ? | ? | ? |
| Integration Examples | 4 (Express, Next, Fastify, RAG) | Yes | Yes | Yes |

## Legal & Compliance Disclaimer

Bulwark AI provides tools and features that can assist with security, privacy, and compliance workflows (e.g., GDPR, SOC 2, HIPAA, CCPA).

**Use of this software does not by itself ensure compliance with any laws or regulations.**

Users are responsible for:
- Configuring the system appropriately for their use case
- Validating outputs and behavior against their requirements
- Ensuring compliance with applicable laws and internal policies

Bulwark AI processes data based on user configuration and does not control how it is used or what data is submitted to LLM providers.

## Security Notice

Bulwark AI includes protections such as PII detection, prompt injection filtering, content policies, and SSRF protection. These mechanisms are **best-effort safeguards** and are not guaranteed to detect or prevent all threats.

Users should not rely solely on Bulwark AI for security-critical or safety-critical systems without additional controls and validation.

## Third-Party LLM Providers

Bulwark AI integrates with third-party LLM providers (e.g., OpenAI, Anthropic, Google, Mistral).

**Data sent through the gateway may be transmitted to these providers depending on configuration.**

Users are responsible for:
- Reviewing provider terms of service and data handling policies
- Ensuring that sensitive data is handled appropriately
- Configuring PII redaction and content policies as required

Bulwark AI does not control or assume responsibility for third-party data processing.

## Limitation of Liability

This software is provided "as is", without warranty of any kind. In no event shall the authors or contributors be liable for any damages arising from the use of this software, including but not limited to data loss, security incidents, or regulatory non-compliance.

For commercial licensing or compliance consulting: **info@afkzonagroup.lt**

## Part of the AFKzona AI Platform

Bulwark AI is part of a suite of AI governance tools by AFKzona Group:

| Product | Purpose | Repo |
|---------|---------|------|
| **Bulwark AI** | AI governance gateway — PII, injection, budgets, audit | [bulwark-ai](https://github.com/antonmacius-droid/bulwark-ai) |
| **Comply AI** | EU AI Act compliance — risk classification, Annex IV docs, monitoring | [comply-ai](https://github.com/antonmacius-droid/comply-ai) |

**How they connect:** Comply AI pulls audit data, PII reports, and cost data from Bulwark AI to auto-populate compliance evidence and discover AI systems in use. Configure the connection in Comply AI's Settings → Bulwark Integration.

## Licensing

**Core modules** (gateway, providers, security, billing, audit, cache, middleware) are **MIT** — use anywhere, no license key needed.

**Premium modules** (RAG, compliance, admin panel) are **BSL 1.1** — free for development, testing, and non-commercial use. Commercial production use requires a license key.

### Getting a License Key

1. Purchase a license at [afkzonagroup.lt/license](https://afkzonagroup.lt/license)
2. You will receive a key in the format: `BULWARK-TEAM-acme-20270401-a1b2c3d4e5f6a1b2`
3. Add it to your `.env` file:

```bash
# Bulwark AI license key
BULWARK_LICENSE_KEY=BULWARK-TEAM-acme-20270401-a1b2c3d4e5f6a1b2

# Required for signature verification
LICENSE_SIGNING_SECRET=your-shared-secret
```

4. Restart your application

### How It Works

- **Offline verification** — the key is HMAC-SHA256 signed. Verification recomputes the signature locally. No phone-home, no telemetry, no network calls.
- **No functionality is blocked** — an invalid or missing key only shows a console notice. The software remains fully functional.
- **Legacy mode** — setting `BULWARK_LICENSE_KEY` to any truthy value (e.g., `BULWARK_LICENSE_KEY=1`) still suppresses the notice for backward compatibility.

### Plans

| Plan | Use Case |
|------|----------|
| **Pro** | Small teams, single deployment |
| **Team** | Multiple deployments, priority support |
| **Enterprise** | Unlimited deployments, custom terms, SLA |

For custom licensing or compliance consulting: **info@afkzonagroup.lt**

## License

**Core** (gateway, providers, security, billing, audit, cache, middleware): **MIT** — use anywhere.

**Premium modules** (RAG, compliance, admin panel): **BSL 1.1** — free for development and non-commercial use. Commercial production requires a license. Converts to MIT on 2029-04-01.

Copyright (c) 2026 AFKzona Group — info@afkzonagroup.lt
