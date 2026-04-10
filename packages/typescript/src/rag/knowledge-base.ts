import { v4 as uuid } from "uuid";
import type { Database } from "../database";
import type { RAGConfig, SearchResult, KnowledgeSource, Chunk } from "./types";
import { chunkText, type ChunkOptions } from "./chunker";
import { OpenAIEmbeddings, cosineSimilarity, type EmbeddingProvider } from "./embeddings";
import { checkLicense } from "./license-check";

/**
 * Knowledge Base — document ingestion, chunking, embedding, and retrieval.
 *
 * Uses SQLite for chunk storage with in-process cosine similarity search.
 * For production with large datasets, use Postgres + pgvector.
 *
 * @example
 * ```ts
 * const kb = gateway.knowledgeBase;
 * await kb.ingest("My document content...", { name: "contract.pdf", type: "pdf" });
 * const results = await kb.search("what are the payment terms?");
 * ```
 */
export class KnowledgeBase {
  private db: Database;
  private config: RAGConfig;
  private embedder: EmbeddingProvider;

  constructor(db: Database, config: RAGConfig, openaiApiKey: string) {
    checkLicense("RAG Knowledge Base");
    this.db = db;
    this.config = config;
    this.embedder = new OpenAIEmbeddings(openaiApiKey, config.embeddingModel || "text-embedding-3-small");
  }

  /**
   * Ingest text content into the knowledge base.
   * Chunks the text, generates embeddings, and stores them.
   */
  async ingest(
    content: string,
    source: { name: string; type: KnowledgeSource["type"]; tenantId?: string; userId?: string },
    chunkOptions?: ChunkOptions
  ): Promise<{ sourceId: string; chunks: number }> {
    const sourceId = uuid();

    // Create source record
    this.db.run(
      "INSERT INTO bulwark_knowledge_sources (id, tenant_id, name, type, status) VALUES (?, ?, ?, ?, ?)",
      [sourceId, source.tenantId || null, source.name, source.type, "indexing"]
    );

    try {
      // Chunk the content
      const chunks = chunkText(content, {
        chunkSize: chunkOptions?.chunkSize || this.config.chunkSize || 1000,
        chunkOverlap: chunkOptions?.chunkOverlap || this.config.chunkOverlap || 200,
        strategy: chunkOptions?.strategy || "paragraph",
      });

      if (chunks.length === 0) {
        this.db.run("UPDATE bulwark_knowledge_sources SET status = 'error' WHERE id = ?", [sourceId]);
        return { sourceId, chunks: 0 };
      }

      // Generate embeddings in batch
      const texts = chunks.map(c => c.content);
      const embeddings = await this.embedder.embed(texts);

      // Store chunks with embeddings
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = uuid();
        const embeddingBlob = Buffer.from(new Float32Array(embeddings[i]).buffer);
        this.db.run(
          "INSERT INTO bulwark_chunks (id, source_id, tenant_id, content, embedding, metadata) VALUES (?, ?, ?, ?, ?, ?)",
          [chunkId, sourceId, source.tenantId || null, chunks[i].content, embeddingBlob, JSON.stringify({ index: chunks[i].index, ...(source.userId ? { userId: source.userId } : {}) })]
        );
      }

      // Update source status
      this.db.run(
        "UPDATE bulwark_knowledge_sources SET status = 'active', chunk_count = ?, updated_at = datetime('now') WHERE id = ?",
        [chunks.length, sourceId]
      );

      return { sourceId, chunks: chunks.length };
    } catch (err) {
      this.db.run("UPDATE bulwark_knowledge_sources SET status = 'error' WHERE id = ?", [sourceId]);
      throw err;
    }
  }

  /**
   * Search the knowledge base using semantic similarity.
   */
  async search(query: string, options?: { tenantId?: string; sourceId?: string; topK?: number; minScore?: number }): Promise<SearchResult[]> {
    const topK = options?.topK || this.config.topK || 8;
    const minScore = options?.minScore || this.config.minScore || 0.3;

    // Generate query embedding
    const [queryEmbedding] = await this.embedder.embed([query]);

    // Load all chunks (for SQLite — in-process similarity)
    let sql = "SELECT c.*, ks.name as source_name FROM bulwark_chunks c JOIN bulwark_knowledge_sources ks ON ks.id = c.source_id WHERE ks.status = 'active'";
    const params: unknown[] = [];

    // SECURITY: Always scope by tenant. If no tenantId, only search non-tenant (global) chunks.
    if (options?.tenantId) {
      sql += " AND c.tenant_id = ?";
      params.push(options.tenantId);
    } else {
      sql += " AND (c.tenant_id IS NULL OR c.tenant_id = '')";
    }
    if (options?.sourceId) {
      sql += " AND c.source_id = ?";
      params.push(options.sourceId);
    }

    const rows = await this.db.queryAll<{
      id: string; source_id: string; source_name: string;
      content: string; embedding: Buffer; metadata: string; tenant_id: string;
    }>(sql, params);

    // Calculate similarity scores
    const scored: SearchResult[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const embedding = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
      const score = cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        scored.push({
          chunk: {
            id: row.id,
            sourceId: row.source_id,
            sourceName: row.source_name,
            content: row.content,
            tenantId: row.tenant_id,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          },
          score,
        });
      }
    }

    // Sort by score descending, take top K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** List all knowledge sources */
  async listSources(tenantId?: string): Promise<KnowledgeSource[]> {
    let sql = "SELECT * FROM bulwark_knowledge_sources";
    const params: unknown[] = [];
    if (tenantId) {
      sql += " WHERE tenant_id = ?";
      params.push(tenantId);
    } else {
      // No tenantId — only return global (non-tenant) sources, same pattern as search()
      sql += " WHERE (tenant_id IS NULL OR tenant_id = '')";
    }
    sql += " ORDER BY created_at DESC";
    return await this.db.queryAll<KnowledgeSource>(sql, params);
  }

  /** Delete a knowledge source and all its chunks. If tenantId provided, verifies ownership. */
  async deleteSource(sourceId: string, tenantId?: string): Promise<void> {
    if (tenantId) {
      // Verify tenant owns this source
      const source = await this.db.queryOne<{ tenant_id: string }>("SELECT tenant_id FROM bulwark_knowledge_sources WHERE id = ?", [sourceId]);
      if (source && source.tenant_id && source.tenant_id !== tenantId) {
        throw new Error("Cannot delete source belonging to another tenant");
      }
    }
    this.db.run("DELETE FROM bulwark_chunks WHERE source_id = ?", [sourceId]);
    this.db.run("DELETE FROM bulwark_knowledge_sources WHERE id = ?", [sourceId]);
  }
}
