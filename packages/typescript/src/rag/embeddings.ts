import OpenAI from "openai";

/**
 * Embedding generator — wraps OpenAI's embedding API.
 * Produces 1536-dimensional vectors (text-embedding-3-small) or 3072 (text-embedding-3-large).
 */

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export class OpenAIEmbeddings implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  dimensions: number;

  constructor(apiKey: string, model = "text-embedding-3-small") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = model.includes("large") ? 3072 : 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    // OpenAI supports batch embedding up to 2048 inputs
    const batchSize = 512;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
      });
      for (const item of response.data) {
        allEmbeddings.push(item.embedding);
      }
    }

    return allEmbeddings;
  }
}

/**
 * Cosine similarity between two vectors.
 * Returns value between -1 and 1 (higher = more similar).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
