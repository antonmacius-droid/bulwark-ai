export interface RAGConfig {
  enabled: boolean;
  /** Embedding model */
  embeddingModel?: string;
  /** Chunk size in characters */
  chunkSize?: number;
  /** Chunk overlap */
  chunkOverlap?: number;
  /** Max chunks to retrieve per query */
  topK?: number;
  /** Minimum similarity score (0-1) */
  minScore?: number;
}

export interface Chunk {
  id: string;
  sourceId: string;
  sourceName: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  tenantId?: string;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export interface KnowledgeSource {
  id: string;
  name: string;
  type: "pdf" | "docx" | "text" | "url" | "confluence" | "sharepoint";
  status: "pending" | "indexing" | "active" | "error";
  chunkCount: number;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
}
