import React, { useState } from "react";
import { PageHeader, card } from "../components/shared";

type DocSection = "quickstart" | "providers" | "retry" | "pii" | "policies" | "budgets" | "rag" | "audit" | "compliance" | "streaming" | "docker" | "api" | "tests";

const SECTIONS: { id: DocSection; title: string; icon: string }[] = [
  { id: "quickstart", title: "Quick Start", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "providers", title: "LLM Providers", icon: "M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" },
  { id: "retry", title: "Retry & Fallback", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
  { id: "pii", title: "PII Detection", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
  { id: "policies", title: "Content Policies", icon: "M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" },
  { id: "budgets", title: "Budgets & Rate Limits", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1" },
  { id: "rag", title: "RAG Knowledge Base", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253" },
  { id: "audit", title: "Audit Logging", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { id: "compliance", title: "Compliance", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
  { id: "streaming", title: "Streaming & Caching", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "docker", title: "Docker Deployment", icon: "M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" },
  { id: "api", title: "Admin API Reference", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "tests", title: "Test Suite", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
];

const codeBlock = { padding: "14px 16px", borderRadius: 10, background: "#0A2540", color: "#80E9FF", fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.7, overflow: "auto", whiteSpace: "pre" as const, marginBottom: 16 };
const h3 = { fontSize: 15, fontWeight: 700 as const, color: "#0A2540", marginBottom: 8, marginTop: 20 };
const p = { fontSize: 13, color: "#374151", lineHeight: 1.7, marginBottom: 12 };

const DOCS: Record<DocSection, () => React.ReactNode> = {
  quickstart: () => (
    <div>
      <h3 style={h3}>Installation</h3>
      <div style={codeBlock}>npm install @bulwark-ai/gateway</div>
      <h3 style={h3}>Basic Usage</h3>
      <div style={codeBlock}>{`import { AIGateway } from "@bulwark-ai/gateway";

const gateway = new AIGateway({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
  },
  database: "bulwark.db",
  pii: { enabled: true, action: "redact" },
  budgets: { enabled: true, defaultUserLimit: 500_000 },
  audit: true,
});

const response = await gateway.chat({
  model: "gpt-4o",
  userId: "user-123",
  messages: [{ role: "user", content: "Hello" }],
});

// response.content — LLM response
// response.cost    — { input, output, total } in USD
// response.auditId — unique audit log entry ID`}</div>
      <h3 style={h3}>Pipeline</h3>
      <p style={p}>Every <code>gateway.chat()</code> call goes through this pipeline:</p>
      <div style={p}>1. Input Validation → 2. Prompt Injection Detection → 3. PII Scan → 4. Content Policy Check → 5. Rate Limit → 6. Budget Check → 7. RAG Augment → 8. LLM Call (retry + fallback) → 9. Output PII Scan → 10. Cost Calculate → 11. Audit Log</div>
      <p style={p}><strong>Output PII Scan:</strong> LLM responses are scanned for PII before being returned to the user, using the same detection engine as input scanning.</p>
      <p style={p}><strong>Streaming:</strong> Streaming requests run the identical governance pipeline before any chunks are sent — there is no security difference between streaming and non-streaming.</p>
      <h3 style={h3}>Express Integration</h3>
      <div style={codeBlock}>{`import { bulwarkRouter, createAdminRouter } from "@bulwark-ai/gateway";

// Chat API with governance
app.use("/api/ai", bulwarkRouter(gateway, {
  auth: (req) => ({ userId: req.user.id }),
}));

// Admin panel API
app.use("/admin/ai", createAdminRouter(gateway, {
  auth: (req) => req.user?.role === "admin",
}));`}</div>
    </div>
  ),
  providers: () => (
    <div>
      <h3 style={h3}>Supported Providers</h3>
      <p style={p}>Bulwark auto-routes to the correct provider based on model name.</p>
      <div style={codeBlock}>{`const gateway = new AIGateway({
  providers: {
    openai:    { apiKey: "sk-..." },         // GPT-4o, GPT-4o-mini, o1, o3
    anthropic: { apiKey: "sk-ant-..." },     // Claude Opus, Sonnet, Haiku
    mistral:   { apiKey: "..." },            // Mistral Large, Small, Codestral
    google:    { apiKey: "..." },            // Gemini 2.0 Flash/Pro
    ollama:    { apiKey: "", baseUrl: "http://localhost:11434" }, // Local LLMs
  },
});

// Auto-routing:
await gateway.chat({ model: "gpt-4o", ... });           // → OpenAI
await gateway.chat({ model: "claude-sonnet-4-6", ... }); // → Anthropic
await gateway.chat({ model: "mistral-large", ... });     // → Mistral
await gateway.chat({ model: "gemini-2.0-flash", ... });  // → Google
await gateway.chat({ model: "llama3.2", ... });           // → Ollama (local)`}</div>
      <h3 style={h3}>Azure OpenAI</h3>
      <div style={codeBlock}>{`import { AzureOpenAIProvider } from "@bulwark-ai/gateway";

// Add as custom provider
const azure = new AzureOpenAIProvider({
  apiKey: process.env.AZURE_KEY,
  baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOY",
});`}</div>
      <h3 style={h3}>Retry & Fallback</h3>
      <p style={p}>If a provider fails, Bulwark automatically retries with exponential backoff, then falls back to configured alternatives. See the <strong>Retry & Fallback</strong> section for full configuration details.</p>
      <h3 style={h3}>Cost Tracking</h3>
      <p style={p}>Every model has built-in pricing. Costs are calculated automatically per request:</p>
      <div style={codeBlock}>{`// 30+ models with pricing (per million tokens):
// GPT-4o:          $2.50 input / $10.00 output
// GPT-4o-mini:     $0.15 / $0.60
// Claude Sonnet:   $3.00 / $15.00
// Mistral Large:   $2.00 / $6.00
// Gemini Flash:    $0.10 / $0.40
// Ollama (local):  $0 / $0`}</div>
    </div>
  ),
  retry: () => (
    <div>
      <h3 style={h3}>Automatic Retry</h3>
      <p style={p}>When an LLM call fails (timeout, rate limit, server error), Bulwark automatically retries with exponential backoff before giving up.</p>
      <div style={codeBlock}>{`const gateway = new AIGateway({
  providers: {
    openai:    { apiKey: "sk-..." },
    anthropic: { apiKey: "sk-ant-..." },
  },
  retry: {
    maxRetries: 2,           // retry up to 2 times (3 total attempts)
    baseDelayMs: 1000,       // 1s, then 2s, then 4s (exponential)
    retryableStatuses: [429, 500, 502, 503, 504],  // default
  },
});`}</div>
      <h3 style={h3}>Fallback Chains</h3>
      <p style={p}>Define fallback models that are tried in order when the primary model (and its retries) fail. Fallbacks can cross providers.</p>
      <div style={codeBlock}>{`const gateway = new AIGateway({
  providers: {
    openai:    { apiKey: "sk-..." },
    anthropic: { apiKey: "sk-ant-..." },
    mistral:   { apiKey: "..." },
  },
  fallbacks: {
    "gpt-4o": ["gpt-4o-mini", "claude-sonnet-4-20250514"],
    "claude-opus-4-20250514": ["gpt-4o", "mistral-large-latest"],
  },
  retry: { maxRetries: 1 },
});

// Request flow for model: "gpt-4o":
// 1. Try gpt-4o (OpenAI)      → fail → retry
// 2. Try gpt-4o (retry #1)    → fail
// 3. Try gpt-4o-mini (OpenAI) → fail → retry
// 4. Try gpt-4o-mini (retry)  → fail
// 5. Try claude-sonnet (Anthropic) → success!`}</div>
      <h3 style={h3}>How It Works</h3>
      <p style={p}><strong>Retryable errors:</strong> 429 (rate limit), 500, 502, 503, 504 (server errors), timeouts.</p>
      <p style={p}><strong>Non-retryable:</strong> 401 (auth), 400 (bad request), 403 (forbidden) — these fail immediately.</p>
      <p style={p}><strong>Fallback resolution:</strong> Each fallback model is auto-routed to its provider. If a provider isn't configured, that fallback is skipped.</p>
      <p style={p}><strong>Response metadata:</strong> <code>response.model</code> and <code>response.provider</code> reflect the actual model/provider that succeeded.</p>
    </div>
  ),
  pii: () => (
    <div>
      <h3 style={h3}>PII Detection</h3>
      <p style={p}>15 built-in PII patterns including EU-specific types. Three actions: block, redact, or warn.</p>
      <div style={codeBlock}>{`pii: {
  enabled: true,
  action: "redact",  // "block" | "redact" | "warn"
  types: [
    "email", "phone", "ssn", "credit_card", "iban",
    "ip_address", "passport", "drivers_license",
    "date_of_birth", "address", "name",
    "vat_number", "national_id", "medical_id"   // EU-specific
  ],
  customPatterns: [
    { name: "employee_id", pattern: "EMP-\\\\d{6}", action: "redact" },
  ],
}`}</div>
      <h3 style={h3}>How It Works</h3>
      <p style={p}><strong>Block:</strong> Request is rejected, PII types logged to audit.</p>
      <p style={p}><strong>Redact:</strong> PII is replaced before sending to LLM. Example: <code>"Contact john@test.com"</code> → <code>"Contact [EMAIL]"</code></p>
      <p style={p}><strong>Warn:</strong> PII is logged but request proceeds unchanged.</p>
      <h3 style={h3}>ReDoS Protection</h3>
      <p style={p}>Custom regex patterns are validated against catastrophic backtracking (ReDoS). Patterns with nested quantifiers like <code>(a+)+</code> are automatically rejected.</p>
      <h3 style={h3}>Privacy by Design</h3>
      <p style={p}>PII values are never stored in match objects or error responses. Only the PII type and position are recorded.</p>
    </div>
  ),
  policies: () => (
    <div>
      <h3 style={h3}>Content Policies</h3>
      <div style={codeBlock}>{`policies: [
  {
    id: "no-competitors",
    name: "Block competitor mentions",
    type: "keyword_block",
    patterns: ["competitor-name", "rival-product"],
    action: "block",
    applyTo: { teams: ["marketing"] },  // scope to specific teams
  },
  {
    id: "max-input",
    name: "Limit input size",
    type: "max_tokens",
    maxTokens: 10_000,
    action: "block",
  },
]`}</div>
      <h3 style={h3}>Policy Types</h3>
      <p style={p}><strong>keyword_block:</strong> Block messages containing specific keywords.</p>
      <p style={p}><strong>regex_block:</strong> Block messages matching a regex pattern.</p>
      <p style={p}><strong>topic_restriction:</strong> Block discussion of specific topics.</p>
      <p style={p}><strong>max_tokens:</strong> Limit input size.</p>
      <h3 style={h3}>Prompt Injection Guard</h3>
      <p style={p}>Built-in detection for 20+ injection patterns: instruction override, DAN mode, system prompt extraction, role-play, jailbreak, developer mode, delimiter injection, encoded payloads, forget/reset/disregard instructions. Configurable sensitivity (low/medium/high).</p>
      <p style={p}><strong>Note:</strong> <code>regex_block</code> policies include ReDoS protection — patterns with catastrophic backtracking (e.g. nested quantifiers) are automatically rejected at creation time.</p>
    </div>
  ),
  budgets: () => (
    <div>
      <h3 style={h3}>Budget Enforcement</h3>
      <div style={codeBlock}>{`budgets: {
  enabled: true,
  defaultUserLimit: 500_000,     // tokens/month per user
  defaultTeamLimit: 5_000_000,   // tokens/month per team
  onExceeded: "block",           // or "warn"
  alertThresholds: [0.7, 0.9],   // alert at 70% and 90%
  onAlert: (alert) => {
    slack.send(\`Budget: \${alert.id} at \${alert.threshold * 100}%\`);
  },
}`}</div>
      <h3 style={h3}>Rate Limiting</h3>
      <div style={codeBlock}>{`import { RedisCacheStore } from "@bulwark-ai/gateway";

rateLimit: {
  enabled: true,
  maxRequests: 100,      // per window
  windowSeconds: 60,     // 1 minute
  scope: "user",         // "user" | "team" | "tenant" | "ip"
}

// For multi-instance: use Redis
cache: new RedisCacheStore(new Redis("redis://localhost:6379"))`}</div>
    </div>
  ),
  rag: () => (
    <div>
      <h3 style={h3}>Knowledge Base (RAG)</h3>
      <div style={codeBlock}>{`const gateway = new AIGateway({
  rag: { enabled: true, chunkSize: 1000, topK: 8, minScore: 0.3 },
  providers: { openai: { apiKey: "..." } },
  database: "bulwark.db",
});

// Ingest documents
await gateway.rag.ingest(
  "Your document text content...",
  { name: "contract.pdf", type: "pdf" }
);

// Search
const results = await gateway.rag.search("payment terms");
// [{ chunk: { content, sourceName }, score: 0.87 }]

// Chat with RAG — automatically augments system prompt
await gateway.chat({
  model: "gpt-4o",
  messages: [{ role: "user", content: "What are the payment terms?" }],
  knowledgeBase: true,  // enables RAG for this request
});`}</div>
      <h3 style={h3}>Document Parsers</h3>
      <div style={codeBlock}>{`import { parsePDF, parseHTML, parseCSV, parseMarkdown, parseDocument } from "@bulwark-ai/gateway";

const text = await parsePDF(fs.readFileSync("contract.pdf"));
const text2 = parseHTML("<html>...</html>");
const text3 = await parseDocument(buffer, "report.pdf");  // auto-detect`}</div>
      <h3 style={h3}>Chunking Strategies</h3>
      <p style={p}><strong>paragraph:</strong> Split by double newlines (default).</p>
      <p style={p}><strong>sentence:</strong> Split by sentence endings.</p>
      <p style={p}><strong>markdown:</strong> Split by headers.</p>
      <p style={p}><strong>fixed:</strong> Fixed character count.</p>
    </div>
  ),
  audit: () => (
    <div>
      <h3 style={h3}>Audit Logging</h3>
      <p style={p}>Every request is automatically logged with: user, model, tokens, cost, duration, PII detections, policy violations.</p>
      <div style={codeBlock}>{`// Query audit log
const { entries, total } = await gateway.audit.query({
  userId: "user-123",
  action: "chat",           // "chat" | "pii_detected" | "policy_block" | "budget_exceeded"
  from: "2026-01-01",
  to: "2026-12-31",
  limit: 50,
  offset: 0,
});

// Each entry:
// { id, userId, teamId, tenantId, action, model, provider,
//   inputTokens, outputTokens, costUsd, durationMs,
//   piiDetections, policyViolations, metadata, timestamp }`}</div>
      <h3 style={h3}>SOC 2 Change Tracking</h3>
      <div style={codeBlock}>{`import { SOC2Manager } from "@bulwark-ai/gateway";

const soc2 = new SOC2Manager(gateway.database, {
  immutableAudit: true,
  anomalyThresholds: {
    maxRequestsPerUserPerHour: 200,
    maxPiiPerHour: 50,
    maxCostPerUserPerDay: 10,
  },
  onAnomaly: (event) => pagerduty.alert(event),
});

// Detect anomalies (run on schedule)
const anomalies = await soc2.detectAnomalies();`}</div>
    </div>
  ),
  compliance: () => (
    <div>
      <h3 style={h3}>5 Compliance Modules</h3>
      <p style={p}>Bulwark ships with GDPR, SOC 2, HIPAA, CCPA, and Data Residency modules. Each is independently configurable.</p>

      <h3 style={h3}>GDPR (EU)</h3>
      <div style={codeBlock}>{`import { GDPRManager } from "@bulwark-ai/gateway";

const gdpr = new GDPRManager(gateway.database, {
  retentionDays: 365,
  hashUserIds: true,
  metadataOnlyAudit: false,
});

gdpr.eraseUserData("user-123");          // Right to Erasure (Art. 17)
const data = gdpr.exportUserData("u-1"); // Data Portability (Art. 20)
gdpr.enforceRetention();                 // Run daily
gdpr.generateProcessingReport();         // DPIA report`}</div>

      <h3 style={h3}>SOC 2</h3>
      <div style={codeBlock}>{`import { SOC2Manager } from "@bulwark-ai/gateway";

const soc2 = new SOC2Manager(gateway.database, {
  anomalyThresholds: {
    maxRequestsPerUserPerHour: 200,
    maxPiiPerHour: 50,
    maxCostPerUserPerDay: 10,
  },
  onAnomaly: (event) => pagerduty.alert(event),
});

soc2.detectAnomalies();              // Run on schedule
soc2.generateVendorReport();         // For auditors
soc2.getHealthStatus(activeReqs);    // Health check
soc2.logChange({ entityType: "policy", entityId: "p-1",
  action: "updated", changedBy: "admin@co.com" });`}</div>

      <h3 style={h3}>HIPAA (US Healthcare)</h3>
      <div style={codeBlock}>{`import { HIPAAManager, HIPAA_IDENTIFIERS } from "@bulwark-ai/gateway";

const hipaa = new HIPAAManager(gateway.database, {
  enablePHIAccessLog: true,     // Log all PHI access
  baaRequired: true,            // Require BAA with providers
});

// 18 Safe Harbor identifiers checked automatically
// HIPAA_IDENTIFIERS: names, dates, phone, fax, email, SSN,
// medical record #, health plan #, account #, license #,
// vehicle ID, device ID, URLs, IPs, biometric, photos, etc.

hipaa.logPHIAccess({ userId: "doc-1", action: "view",
  patientId: "p-123", dataType: "diagnosis" });
hipaa.checkBAA("openai");   // Verify BAA exists for provider`}</div>

      <h3 style={h3}>CCPA (California)</h3>
      <div style={codeBlock}>{`import { CCPAManager } from "@bulwark-ai/gateway";

const ccpa = new CCPAManager(gateway.database, {
  saleOfDataEnabled: false,    // Honor "Do Not Sell"
  gpcSignalEnabled: true,      // Respect GPC browser signal
});

ccpa.handleAccessRequest("user-1");    // Right to Know
ccpa.handleDeleteRequest("user-1");    // Right to Delete
ccpa.handleOptOutRequest("user-1");    // Right to Opt-Out
ccpa.checkGPCSignal(requestHeaders);   // Auto-detect GPC`}</div>

      <h3 style={h3}>Data Residency</h3>
      <div style={codeBlock}>{`import { DataResidencyManager, PROVIDER_REGIONS } from "@bulwark-ai/gateway";

const residency = new DataResidencyManager(gateway.database, {
  allowedRegions: ["EU", "EEA"],
  blockCrossBorder: true,
});

// Check if a provider+model combo is allowed
residency.checkProvider("openai", "gpt-4o");

// Cross-border transfer assessment (for legal)
const tia = residency.generateTransferAssessment("openai");

// PROVIDER_REGIONS maps each provider to data processing regions
// OpenAI: US, Anthropic: US, Mistral: EU, Google: US/EU, Ollama: local`}</div>
    </div>
  ),
  streaming: () => (
    <div>
      <h3 style={h3}>SSE Streaming</h3>
      <div style={codeBlock}>{`// Gateway streaming — full governance pipeline runs BEFORE streaming starts
const stream = gateway.chatStream({
  model: "gpt-4o",
  userId: "user-123",
  messages: [{ role: "user", content: "Explain quantum computing" }],
});

for await (const event of stream) {
  if (event.type === "sources") console.log("RAG sources:", event.sources);
  if (event.type === "pii_warning") console.log("PII found:", event.piiTypes);
  if (event.type === "delta") process.stdout.write(event.content);
  if (event.type === "done") console.log("\\nCost:", event.cost);
}

// Express SSE endpoint — use bulwarkRouter for automatic streaming
// POST /api/ai/stream is included when you mount bulwarkRouter()`}</div>
      <h3 style={h3}>Response Caching</h3>
      <div style={codeBlock}>{`import { ResponseCache, RedisCacheStore } from "@bulwark-ai/gateway";

const cache = new ResponseCache(new RedisCacheStore(redis), {
  enabled: true,
  ttlSeconds: 3600,    // cache for 1 hour
  maxTokens: 5000,     // only cache short responses
});

// Only caches deterministic requests (temperature = 0)
// Uses SHA-256 hash of (model + messages) as cache key`}</div>
      <h3 style={h3}>Security Note</h3>
      <p style={p}>Streaming runs the FULL governance pipeline before streaming starts — identical to non-streaming. All user messages are scanned for PII and prompt injection before any chunks are sent to the client.</p>
    </div>
  ),
  docker: () => (
    <div>
      <h3 style={h3}>Docker Compose (Recommended)</h3>
      <p style={p}>The fastest way to deploy Bulwark AI in production. Includes the gateway API, admin UI, and Redis for rate limiting.</p>
      <div style={codeBlock}>{`# Clone and start
git clone https://github.com/antonmacius-droid/bulwark-ai.git
cd bulwark-ai

# Set your API keys
echo "OPENAI_API_KEY=sk-your-key" > .env
echo "ANTHROPIC_API_KEY=sk-ant-your-key" >> .env  # optional

# Start everything
docker compose up -d

# Services:
# Gateway API:  http://localhost:3100
# Admin UI:     http://localhost:3101
# Redis:        localhost:6379 (internal)
# Health:       http://localhost:3100/health`}</div>

      <h3 style={h3}>Making Requests</h3>
      <div style={codeBlock}>{`# Chat request
curl http://localhost:3100/v1/chat \\
  -H "Content-Type: application/json" \\
  -H "X-User-Id: user-123" \\
  -H "X-Team-Id: engineering" \\
  -H "X-Tenant-Id: acme-corp" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Admin dashboard data
curl http://localhost:3100/admin/dashboard

# Health check
curl http://localhost:3100/health`}</div>

      <h3 style={h3}>Environment Variables</h3>
      <div style={p}>
        <div><code>OPENAI_API_KEY</code> — OpenAI API key</div>
        <div style={{ marginTop: 4 }}><code>ANTHROPIC_API_KEY</code> — Anthropic API key (optional)</div>
        <div style={{ marginTop: 4 }}><code>MISTRAL_API_KEY</code> — Mistral API key (optional)</div>
        <div style={{ marginTop: 4 }}><code>GOOGLE_API_KEY</code> — Google AI API key (optional)</div>
        <div style={{ marginTop: 4 }}><code>BULWARK_LICENSE_KEY</code> — Suppresses BSL license notice for RAG/compliance modules</div>
        <div style={{ marginTop: 4 }}><code>DATABASE_PATH</code> — SQLite file path (default: <code>/app/data/bulwark.db</code>)</div>
        <div style={{ marginTop: 4 }}><code>REDIS_URL</code> — Redis connection URL (default: <code>redis://redis:6379</code>)</div>
        <div style={{ marginTop: 4 }}><code>GATEWAY_PORT</code> — API port (default: <code>3100</code>)</div>
        <div style={{ marginTop: 4 }}><code>ADMIN_PORT</code> — Admin UI port (default: <code>3101</code>)</div>
      </div>

      <h3 style={h3}>Data Persistence</h3>
      <p style={p}>SQLite data is stored in <code>./data/</code> on the host (mounted as a volume). Redis data uses a named Docker volume with AOF persistence.</p>
    </div>
  ),
  api: () => (
    <div>
      <h3 style={h3}>Admin API Endpoints</h3>
      <div style={{ ...p, fontSize: 13, lineHeight: 2.2 }}>
        <div><code style={{ background: "#EFF6FF", padding: "2px 6px", borderRadius: 4, color: "#2563EB", fontWeight: 600 }}>GET</code> <code>/dashboard</code> — KPI stats, top models/users/teams</div>
        <div><code style={{ background: "#EFF6FF", padding: "2px 6px", borderRadius: 4, color: "#2563EB", fontWeight: 600 }}>GET</code> <code>/audit</code> — Query audit log (filterable, paginated)</div>
        <div><code style={{ background: "#EFF6FF", padding: "2px 6px", borderRadius: 4, color: "#2563EB", fontWeight: 600 }}>GET</code> <code>/knowledge</code> — List KB sources</div>
        <div><code style={{ background: "#ECFDF5", padding: "2px 6px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>POST</code> <code>/knowledge/ingest</code> — Upload document</div>
        <div><code style={{ background: "#ECFDF5", padding: "2px 6px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>POST</code> <code>/knowledge/search</code> — Semantic search</div>
        <div><code style={{ background: "#FEF2F2", padding: "2px 6px", borderRadius: 4, color: "#DC2626", fontWeight: 600 }}>DEL</code> <code>/knowledge/:id</code> — Delete source</div>
        <div><code style={{ background: "#EFF6FF", padding: "2px 6px", borderRadius: 4, color: "#2563EB", fontWeight: 600 }}>GET</code> <code>/policies</code> — List policies</div>
        <div><code style={{ background: "#ECFDF5", padding: "2px 6px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>POST</code> <code>/policies</code> — Create policy</div>
        <div><code style={{ background: "#FEF2F2", padding: "2px 6px", borderRadius: 4, color: "#DC2626", fontWeight: 600 }}>DEL</code> <code>/policies/:id</code> — Delete policy</div>
        <div><code style={{ background: "#EFF6FF", padding: "2px 6px", borderRadius: 4, color: "#2563EB", fontWeight: 600 }}>GET</code> <code>/budgets</code> — List budgets</div>
        <div><code style={{ background: "#ECFDF5", padding: "2px 6px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>POST</code> <code>/budgets</code> — Create budget</div>
        <div><code style={{ background: "#FEF2F2", padding: "2px 6px", borderRadius: 4, color: "#DC2626", fontWeight: 600 }}>DEL</code> <code>/budgets/:id</code> — Delete budget</div>
        <div><code style={{ background: "#EFF6FF", padding: "2px 6px", borderRadius: 4, color: "#2563EB", fontWeight: 600 }}>GET</code> <code>/tenants</code> — List tenants</div>
        <div><code style={{ background: "#ECFDF5", padding: "2px 6px", borderRadius: 4, color: "#059669", fontWeight: 600 }}>POST</code> <code>/tenants</code> — Create tenant</div>
        <div><code style={{ background: "#FEF2F2", padding: "2px 6px", borderRadius: 4, color: "#DC2626", fontWeight: 600 }}>DEL</code> <code>/tenants/:id</code> — Delete tenant</div>
        <div><code style={{ background: "#EFF6FF", padding: "2px 6px", borderRadius: 4, color: "#2563EB", fontWeight: 600 }}>GET</code> <code>/settings</code> — Current config summary</div>
        <div><code style={{ background: "#EFF6FF", padding: "2px 6px", borderRadius: 4, color: "#2563EB", fontWeight: 600 }}>GET</code> <code>/export/audit</code> — Export full audit log</div>
      </div>
    </div>
  ),
  tests: () => (
    <div>
      <h3 style={h3}>Test Suite — 136 Tests, 100% Pass Rate</h3>
      <p style={p}>Bulwark AI ships with comprehensive unit and integration tests. Integration tests make real API calls to OpenAI to verify the full governance pipeline.</p>
      <h3 style={h3}>Running Tests</h3>
      <div style={codeBlock}>{`# Unit tests (no API key needed, instant)
npx vitest run

# Integration tests (requires OpenAI key, ~$2-3 cost)
OPENAI_API_KEY=sk-xxx npx vitest run src/__tests__/integration.test.ts

# All tests
OPENAI_API_KEY=sk-xxx npx vitest run`}</div>
      <h3 style={h3}>Unit Tests (42 tests, no API calls)</h3>
      <div style={p}>
        <div><strong>PII Detection (7)</strong> — Email, phone, SSN, credit card detection. Redact/block/warn modes. Custom patterns. ReDoS protection.</div>
        <div style={{ marginTop: 6 }}><strong>Content Policies (7)</strong> — Keyword block, regex, topic restriction, max tokens. Team scoping. Runtime add/remove. Immutable getPolicies.</div>
        <div style={{ marginTop: 6 }}><strong>Cost Calculator (4)</strong> — GPT-4o, Claude pricing. Custom overrides. Unknown model fallback.</div>
        <div style={{ marginTop: 6 }}><strong>Gateway Validation (9)</strong> — Empty messages, invalid roles, temperature range, maxTokens range, shutdown behavior.</div>
        <div style={{ marginTop: 6 }}><strong>Document Chunker (6)</strong> — Paragraph/sentence/markdown splitting. Chunk size, overlap, empty text, sequential indices.</div>
        <div style={{ marginTop: 6 }}><strong>Cache & Rate Limiter (9)</strong> — Memory store set/get/TTL. Counter increment/expire. Rate limiter allow/block/scope.</div>
      </div>
      <h3 style={h3}>Integration Tests (94 tests, real LLM calls)</h3>
      <div style={p}>
        <div><strong>1. Basic Gateway (5)</strong> — Request metadata, system messages, multi-turn, maxTokens, deterministic output.</div>
        <div style={{ marginTop: 6 }}><strong>2. PII Input Redaction (8)</strong> — Email, phone, credit card, SSN, IBAN, IP redacted before LLM sees them. Multiple PII. Disable option.</div>
        <div style={{ marginTop: 6 }}><strong>3. PII Output Scanning (1)</strong> — LLM response scanned for PII before returning to user.</div>
        <div style={{ marginTop: 6 }}><strong>4. PII Edge Cases (5)</strong> — PII at start/end of message, with punctuation, unicode (Lithuanian, German, French), empty messages.</div>
        <div style={{ marginTop: 6 }}><strong>5. Content Policies (8)</strong> — Password, secret_key, api_key, competitor blocking. Team-scoped policies. Max token enforcement.</div>
        <div style={{ marginTop: 6 }}><strong>6. Prompt Injection Guard (12)</strong> — 8 attack patterns (instruction override, DAN mode, system prompt extraction, developer mode, delimiter injection, forget/disregard) + 4 more variants. All blocked. Legitimate questions allowed.</div>
        <div style={{ marginTop: 6 }}><strong>7. Budget Enforcement (2)</strong> — Token usage tracked per user. Cumulative tracking across requests.</div>
        <div style={{ marginTop: 6 }}><strong>8. Audit Logging (5)</strong> — Complete metadata (user, team, model, tokens, cost, duration). PII detection count. Policy block events. Query filters. Pagination.</div>
        <div style={{ marginTop: 6 }}><strong>9. Streaming (5)</strong> — Multiple chunks received. Done event with cost and auditId. PII warning emitted before content. Policy and injection blocked before streaming starts.</div>
        <div style={{ marginTop: 6 }}><strong>10. Multi-tenant (2)</strong> — Create and list tenants. Delete tenant and verify data removed.</div>
        <div style={{ marginTop: 6 }}><strong>11. Cost Tracking (3)</strong> — Non-zero cost on every request. Cost scales with token count. Cost in audit matches response.</div>
        <div style={{ marginTop: 6 }}><strong>12. Error Handling (8)</strong> — Invalid model returns BulwarkError. Empty messages, invalid role, bad temperature/maxTokens, non-string content. HTTP status codes. JSON serialization.</div>
        <div style={{ marginTop: 6 }}><strong>13. GDPR (3)</strong> — Right to erasure deletes all user data. Data export returns complete JSON. Processing report generates correctly.</div>
        <div style={{ marginTop: 6 }}><strong>14. SOC 2 (4)</strong> — Change tracking logs changes. Anomaly detection runs. Vendor report lists providers. Health check returns status.</div>
        <div style={{ marginTop: 6 }}><strong>15. Concurrent (1)</strong> — 10 parallel requests all complete with unique audit IDs.</div>
        <div style={{ marginTop: 6 }}><strong>16. System Prompt Hardening (2)</strong> — Secret codes not revealed. Developer impersonation resisted.</div>
        <div style={{ marginTop: 6 }}><strong>17. More Injection Attacks (4)</strong> — "Do not follow rules", "Override safety", "Reset instructions", "Act as different AI" — all blocked.</div>
        <div style={{ marginTop: 6 }}><strong>18. International PII (3)</strong> — Email in German context, French context. International phone format.</div>
        <div style={{ marginTop: 6 }}><strong>19. Streaming Edge Cases (2)</strong> — Streaming with system message. Streaming records audit entry.</div>
        <div style={{ marginTop: 6 }}><strong>20. Runtime Policy Management (2)</strong> — Add policy at runtime and enforce it. Remove policy and verify enforcement stops.</div>
        <div style={{ marginTop: 6 }}><strong>21. RAG Knowledge Base E2E (3)</strong> — Ingest document, search with semantic similarity, chat with KB context and source citations. Tenant isolation verified. Source deletion cascades to chunks.</div>
        <div style={{ marginTop: 6 }}><strong>22. Retry + Fallback (3)</strong> — Falls back to alternate model when primary provider not configured. Retry succeeds on working model. All models exhausted throws error.</div>
        <div style={{ marginTop: 6 }}><strong>23. Security Regression Tests (5)</strong> — PII values not leaked in error responses. Output PII scan blocks sensitive data. Streaming governance parity with non-streaming. ReDoS patterns rejected. Injection detection across all 20+ patterns.</div>
      </div>
    </div>
  ),
};

export function DocsPage() {
  const [active, setActive] = useState<DocSection>("quickstart");

  return (
    <div>
      <PageHeader title="Documentation" subtitle="Everything you need to integrate and configure Bulwark AI" />
      <div style={{ display: "flex", gap: 20 }}>
        {/* Left nav */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <div style={{ position: "sticky", top: 20 }}>
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setActive(s.id)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                borderRadius: 8, border: "none", background: active === s.id ? "#EFF0FF" : "transparent",
                color: active === s.id ? "#635BFF" : "#6B7280", fontSize: 12, fontWeight: active === s.id ? 600 : 500,
                cursor: "pointer", textAlign: "left", fontFamily: "inherit", marginBottom: 2,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon} /></svg>
                {s.title}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, ...card, minHeight: 400 }}>
          {DOCS[active]?.()}
        </div>
      </div>
    </div>
  );
}
