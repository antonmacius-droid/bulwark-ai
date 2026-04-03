/**
 * Bulwark AI — RAG Knowledge Base Example
 *
 * Run: npx tsx index.ts
 *
 * Ingest company documents, then chat with AI that references them.
 * Tenant-isolated: each org only sees their own documents.
 */

import { AIGateway } from "@bulwark-ai/gateway";

const gateway = new AIGateway({
  providers: { openai: { apiKey: process.env.OPENAI_API_KEY! } },
  database: "rag-demo.db",
  rag: { enabled: true, chunkSize: 500, chunkOverlap: 100, topK: 6, minScore: 0.3 },
  audit: true,
});

await gateway.init();
const kb = gateway.rag!;

// ── 1. Ingest documents ──
console.log("Ingesting documents...");

const { sourceId, chunks } = await kb.ingest(
  `Company Policy: Remote Work

  All employees may work remotely up to 3 days per week.
  Remote work requires manager approval submitted 24 hours in advance.
  Core collaboration hours are 10am-2pm in the employee's local timezone.
  Equipment allowance: $1,500 one-time for home office setup.
  Internet stipend: $75/month reimbursement with receipt.
  Employees must use the company VPN for all work activities.
  Performance reviews are conducted quarterly regardless of location.`,
  { name: "remote-work-policy.md", type: "markdown" }
);
console.log(`Ingested: ${chunks} chunks from remote-work-policy.md`);

await kb.ingest(
  `Benefits Summary 2025

  Health Insurance: PPO plan, company covers 90% of premiums.
  Dental: Full coverage for preventive, 80% for major procedures.
  Vision: Annual exam + $200 frame allowance.
  401(k): 4% company match, immediate vesting.
  PTO: 20 days/year + 10 company holidays.
  Parental Leave: 16 weeks paid for all parents.
  Professional Development: $2,000/year for courses and conferences.`,
  { name: "benefits-2025.md", type: "markdown" }
);
console.log("Ingested: benefits-2025.md");

// ── 2. Search the knowledge base ──
console.log("\nSearching...");
const results = await kb.search("How many days can I work from home?");
console.log(`Found ${results.length} relevant chunks:`);
results.slice(0, 3).forEach((r, i) => {
  console.log(`  [${i + 1}] Score: ${r.score.toFixed(3)} | ${r.chunk.sourceName}`);
  console.log(`      "${r.chunk.content.slice(0, 80)}..."`);
});

// ── 3. Chat with KB context ──
console.log("\nChatting with knowledge base...");
const response = await gateway.chat({
  model: "gpt-4o-mini",
  userId: "employee-1",
  messages: [
    { role: "user", content: "How many days can I work remotely and what equipment do I get?" },
  ],
  knowledgeBase: "true", // enables RAG augmentation
  temperature: 0,
  maxTokens: 200,
});

console.log(`\nAI Response:\n${response.content}`);
console.log(`\nSources used: ${response.sources?.length || 0}`);
response.sources?.forEach((s, i) => {
  console.log(`  [${i + 1}] ${s.source} (score: ${s.score.toFixed(3)})`);
});
console.log(`Cost: $${response.cost.total.toFixed(6)}`);

// ── 4. List sources ──
console.log("\nKnowledge base sources:");
kb.listSources().forEach(s => {
  console.log(`  - ${s.name} (${s.status}, ${s.chunkCount || "?"} chunks)`);
});

// ── 5. Cleanup ──
// kb.deleteSource(sourceId); // removes source + all chunks

await gateway.shutdown();
