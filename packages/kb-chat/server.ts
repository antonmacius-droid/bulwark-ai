/**
 * KB Chat Server — standalone "Chat with your docs" backend
 * Uses the Bulwark AI gateway's RAG pipeline for document ingestion and retrieval.
 *
 * Endpoints:
 *   POST   /api/setup         — Configure API key and create gateway
 *   GET    /api/status        — Check configuration status
 *   POST   /api/upload        — Ingest a document into the knowledge base
 *   POST   /api/chat          — Chat with knowledge base (non-streaming)
 *   POST   /api/chat/stream   — Chat with knowledge base (SSE streaming)
 *   GET    /api/sources       — List all knowledge sources
 *   DELETE /api/sources/:id   — Delete a knowledge source
 *   POST   /api/search        — Semantic search across knowledge base
 *
 * Port: 3200
 */

import express, { type Request, type Response } from "express";
import cors from "cors";
import { AIGateway, BulwarkError } from "../typescript/dist/index.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Suppress license notice in dev
process.env.BULWARK_LICENSE_KEY = "dev";

const app = express();
const PORT = 3200;
const DB_PATH = path.join(__dirname, "kb-chat.db");

// Middleware
app.use(cors({ origin: "http://localhost:3201" }));
app.use(express.json({ limit: "50mb" }));

// --- State ---
let gateway: AIGateway | null = null;
let apiKey: string | null = null;

const RAG_CONFIG = {
  enabled: true,
  chunkSize: 500,
  chunkOverlap: 100,
  topK: 6,
  minScore: 0.25,
} as const;

// --- Helper: create gateway instance ---
function createGateway(key: string): AIGateway {
  return new AIGateway({
    providers: {
      openai: { apiKey: key },
    },
    database: DB_PATH,
    pii: { enabled: true, action: "redact" },
    audit: true,
    rag: RAG_CONFIG,
  });
}

// --- Helper: require configured gateway ---
function requireGateway(res: Response): AIGateway | null {
  if (!gateway) {
    res.status(400).json({ error: "Gateway not configured. Call POST /api/setup first." });
    return null;
  }
  return gateway;
}

// ============================================================
// POST /api/setup — Configure API key, create/recreate gateway
// ============================================================
app.post("/api/setup", async (req: Request, res: Response) => {
  try {
    const { apiKey: key } = req.body;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ error: "apiKey is required" });
    }

    // Shut down existing gateway if any
    if (gateway) {
      try {
        await gateway.shutdown();
      } catch {
        // ignore shutdown errors on recreation
      }
    }

    apiKey = key;
    gateway = createGateway(key);
    await gateway.init();

    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Setup failed";
    res.status(500).json({ error: message });
  }
});

// ============================================================
// GET /api/status — Check if gateway is configured
// ============================================================
app.get("/api/status", (_req: Request, res: Response) => {
  try {
    if (!gateway || !gateway.rag) {
      return res.json({ configured: false, sources: 0, chunks: 0 });
    }

    const sources = gateway.rag.listSources();
    const totalChunks = sources.reduce((sum, s) => {
      // chunkCount may come back as chunk_count from SQLite row mapping
      const count = (s as any).chunkCount ?? (s as any).chunk_count ?? 0;
      return sum + count;
    }, 0);

    res.json({
      configured: true,
      sources: sources.length,
      chunks: totalChunks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Status check failed";
    res.status(500).json({ error: message });
  }
});

// ============================================================
// POST /api/upload — Ingest a document into the knowledge base
// ============================================================
app.post("/api/upload", async (req: Request, res: Response) => {
  try {
    const gw = requireGateway(res);
    if (!gw) return;

    const { content, name, type } = req.body;
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content is required and must be a string" });
    }
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    if (!type || typeof type !== "string") {
      return res.status(400).json({ error: "type is required" });
    }

    const kb = gw.rag;
    if (!kb) {
      return res.status(500).json({ error: "Knowledge base not initialized" });
    }

    const result = await kb.ingest(content, { name, type: type as any });
    res.json({ sourceId: result.sourceId, chunks: result.chunks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    res.status(500).json({ error: message });
  }
});

// ============================================================
// POST /api/chat — Chat with knowledge base (non-streaming)
// ============================================================
app.post("/api/chat", async (req: Request, res: Response) => {
  try {
    const gw = requireGateway(res);
    if (!gw) return;

    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const response = await gw.chat({
      model: "gpt-4o",
      messages,
      knowledgeBase: true,
    });

    res.json({
      content: response.content,
      model: response.model,
      sources: response.sources,
      usage: response.usage,
      cost: response.cost,
      durationMs: response.durationMs,
    });
  } catch (err) {
    if (err instanceof BulwarkError) {
      return res.status(err.httpStatus).json(err.toJSON());
    }
    const message = err instanceof Error ? err.message : "Chat failed";
    res.status(500).json({ error: message });
  }
});

// ============================================================
// POST /api/chat/stream — Chat with knowledge base (SSE)
// ============================================================
app.post("/api/chat/stream", async (req: Request, res: Response) => {
  try {
    const gw = requireGateway(res);
    if (!gw) return;

    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Set up SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const stream = gw.chatStream({
      model: "gpt-4o",
      messages,
      knowledgeBase: true,
    });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    // If headers already sent, try to send error via SSE
    if (res.headersSent) {
      const message = err instanceof Error ? err.message : "Stream failed";
      res.write(`data: ${JSON.stringify({ type: "error", content: message })}\n\n`);
      res.end();
      return;
    }

    if (err instanceof BulwarkError) {
      return res.status(err.httpStatus).json(err.toJSON());
    }
    const message = err instanceof Error ? err.message : "Stream failed";
    res.status(500).json({ error: message });
  }
});

// ============================================================
// GET /api/sources — List all knowledge sources
// ============================================================
app.get("/api/sources", (_req: Request, res: Response) => {
  try {
    const gw = requireGateway(res);
    if (!gw) return;

    const kb = gw.rag;
    if (!kb) {
      return res.status(500).json({ error: "Knowledge base not initialized" });
    }

    const sources = kb.listSources();
    res.json({ sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list sources";
    res.status(500).json({ error: message });
  }
});

// ============================================================
// DELETE /api/sources/:id — Delete a source and its chunks
// ============================================================
app.delete("/api/sources/:id", (_req: Request, res: Response) => {
  try {
    const gw = requireGateway(res);
    if (!gw) return;

    const kb = gw.rag;
    if (!kb) {
      return res.status(500).json({ error: "Knowledge base not initialized" });
    }

    const { id } = _req.params;
    kb.deleteSource(id);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete source";
    res.status(500).json({ error: message });
  }
});

// ============================================================
// POST /api/search — Semantic search across knowledge base
// ============================================================
app.post("/api/search", async (req: Request, res: Response) => {
  try {
    const gw = requireGateway(res);
    if (!gw) return;

    const { query, topK } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const kb = gw.rag;
    if (!kb) {
      return res.status(500).json({ error: "Knowledge base not initialized" });
    }

    const results = await kb.search(query, {
      topK: typeof topK === "number" ? topK : RAG_CONFIG.topK,
    });

    res.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    res.status(500).json({ error: message });
  }
});

// ============================================================
// Start server
// ============================================================
app.listen(PORT, () => {
  console.log(`KB Chat server running on http://localhost:${PORT}`);
  console.log(`CORS: allowing http://localhost:3201`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`RAG config: chunkSize=${RAG_CONFIG.chunkSize}, chunkOverlap=${RAG_CONFIG.chunkOverlap}, topK=${RAG_CONFIG.topK}, minScore=${RAG_CONFIG.minScore}`);
});

export default app;
