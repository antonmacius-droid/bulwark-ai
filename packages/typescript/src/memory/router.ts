/**
 * Cross-Product Context Router
 *
 * The router is the brain of the memory system — it determines what
 * context is relevant to a given query and scores it for ranking.
 *
 * Scoring formula (weighted multi-factor):
 *
 *   score = w_s × semantic
 *         + w_a × activation
 *         + w_r × recency
 *         + w_g × association
 *         + w_m × maturity
 *
 * Where:
 *   semantic    = cosine similarity between query embedding and engram embedding
 *   activation  = engram's current activation level (0-1)
 *   recency     = exponential decay based on time since last access
 *   association = max association strength from any already-recalled engram
 *   maturity    = stage bonus (crystallized > consolidated > working > ephemeral)
 *
 * The router also performs:
 * - Graph expansion: after initial recall, expand through associations
 * - Gravity pull: high-gravity engrams pull their neighborhoods
 * - Deduplication: merge near-identical results
 * - Privacy filtering: enforce privacy mesh at result level
 */

import type {
  Engram,
  RecallQuery,
  RecallResult,
  CrossProductMemoryConfig,
} from "./types";
import type { EmbeddingProvider } from "../rag/embeddings";
import { cosineSimilarity } from "../rag/embeddings";
import { MemoryStore } from "./store";
import { AssociativeGraph } from "./graph";
import { PrivacyMesh, type PrivacyContext } from "./privacy";
import { STAGE_MATURITY } from "./engram";

/** Default recall configuration */
const DEFAULT_RECALL = {
  defaultTopK: 10,
  defaultMinScore: 0.3,
  defaultGraphDepth: 1,
  semanticWeight: 0.4,
  activationWeight: 0.2,
  recencyWeight: 0.15,
  associationWeight: 0.15,
  maturityWeight: 0.1,
};

export class ContextRouter {
  private readonly config: Required<NonNullable<CrossProductMemoryConfig["recall"]>>;

  constructor(
    private readonly store: MemoryStore,
    private readonly graph: AssociativeGraph,
    private readonly privacy: PrivacyMesh,
    private readonly embedder: EmbeddingProvider | null,
    config?: CrossProductMemoryConfig["recall"]
  ) {
    this.config = { ...DEFAULT_RECALL, ...config };
  }

  /**
   * Recall relevant context for a query.
   *
   * This is the main entry point for cross-product memory retrieval.
   * The pipeline:
   *
   * 1. Embed the query
   * 2. Candidate retrieval (DB query with privacy filtering)
   * 3. Semantic scoring (embedding similarity)
   * 4. Multi-factor scoring (activation, recency, maturity)
   * 5. Graph expansion (follow associations, apply gravity)
   * 6. Hebbian reinforcement (strengthen co-access associations)
   * 7. Deduplication and final ranking
   */
  async recall(query: RecallQuery, privacyCtx: PrivacyContext): Promise<RecallResult[]> {
    const topK = query.topK || this.config.defaultTopK;
    const minScore = query.minScore || this.config.defaultMinScore;
    const graphDepth = query.graphDepth ?? this.config.defaultGraphDepth;

    // Step 1: Get query embedding
    const queryEmbedding = query.queryEmbedding || (this.embedder ? (await this.embedder.embed([query.query]))[0] : null);

    // Step 2: Retrieve candidates from store (with privacy at SQL level)
    const manifest = this.privacy.getManifest(query.productId);
    const candidates = await this.store.queryEngrams({
      tenantId: query.tenantId,
      userId: query.userId,
      productId: query.productId,
      kinds: query.kinds,
      stages: query.stages,
      canReadSensitive: manifest?.canReadSensitive || false,
      limit: topK * 5, // Over-fetch for better ranking after scoring
    });

    // Step 3: Apply privacy mesh filter
    const privateCandidates = this.privacy.filter(candidates, privacyCtx);

    // Step 4: Score each candidate
    const scored: RecallResult[] = [];

    for (const engram of privateCandidates) {
      const scoring = this.scoreEngram(engram, queryEmbedding);
      const score = this.computeWeightedScore(scoring);

      if (score >= minScore) {
        scored.push({
          engram,
          score,
          scoring,
          reason: this.explainScore(engram, scoring, query.productId),
        });
      }
    }

    // Step 5: Sort by score, take initial topK
    scored.sort((a, b) => b.score - a.score);
    let results = scored.slice(0, topK);

    // Step 6: Graph expansion — follow associations from top results
    if (graphDepth > 0 && results.length > 0) {
      const expanded = await this.expandThroughGraph(results, queryEmbedding, privacyCtx, graphDepth, minScore);
      results = this.mergeAndDedup([...results, ...expanded], topK);
    }

    // Step 7: Hebbian reinforcement (if enabled)
    if (query.reinforce !== false && results.length >= 2) {
      const recalledIds = results.map((r) => r.engram.id);
      await this.graph.hebbianReinforce(recalledIds);

      // Update activation on accessed engrams
      for (const result of results) {
        await this.store.updateEngram(result.engram.id, result.engram.tenantId, {
          activation: Math.min(1.0, result.engram.activation + 0.1),
          accessCount: result.engram.accessCount + 1,
          lastAccessedAt: new Date().toISOString(),
        });
      }
    }

    // Step 8: Add association paths for explainability
    if (query.explainable) {
      for (const result of results) {
        if (result.associationPath) continue;
        result.associationPath = [result.engram.productId];
      }
    }

    return results;
  }

  // ─── Scoring ─────────────────────────────────────────────────────────

  private scoreEngram(
    engram: Engram,
    queryEmbedding: number[] | null
  ): RecallResult["scoring"] {
    // Semantic similarity
    let semantic = 0;
    if (queryEmbedding && engram.embedding) {
      semantic = Math.max(0, cosineSimilarity(queryEmbedding, engram.embedding));
    }

    // Activation level (already 0-1)
    const activation = engram.activation;

    // Recency — exponential decay, half-life of 24 hours
    const hoursSinceAccess = (Date.now() - new Date(engram.lastAccessedAt).getTime()) / (1000 * 60 * 60);
    const recency = Math.exp(-0.029 * hoursSinceAccess); // 0.029 ≈ ln(2)/24

    // Association strength — filled during graph expansion, 0 for initial scoring
    const association = 0;

    // Maturity bonus
    const maturity = STAGE_MATURITY[engram.stage];

    return { semantic, activation, recency, association, maturity };
  }

  private computeWeightedScore(scoring: RecallResult["scoring"]): number {
    return (
      this.config.semanticWeight * scoring.semantic +
      this.config.activationWeight * scoring.activation +
      this.config.recencyWeight * scoring.recency +
      this.config.associationWeight * scoring.association +
      this.config.maturityWeight * scoring.maturity
    );
  }

  // ─── Graph Expansion ─────────────────────────────────────────────────

  /**
   * Expand recall results through the association graph.
   *
   * For each top result, follow associations to find related engrams
   * that might not have scored high enough on their own, but are
   * connected to highly relevant engrams.
   *
   * This is the "contextual gravity" effect — important engrams pull
   * their neighborhood into the recall results.
   */
  private async expandThroughGraph(
    initialResults: RecallResult[],
    queryEmbedding: number[] | null,
    privacyCtx: PrivacyContext,
    depth: number,
    minScore: number
  ): Promise<RecallResult[]> {
    const existingIds = new Set(initialResults.map((r) => r.engram.id));
    const expanded: RecallResult[] = [];

    for (const result of initialResults) {
      const neighborhood = await this.graph.getGravitationalNeighborhood(
        result.engram,
        result.engram.tenantId,
        depth
      );

      for (const neighbor of neighborhood) {
        if (existingIds.has(neighbor.engram.id)) continue;
        existingIds.add(neighbor.engram.id);

        // Check privacy
        const verdict = this.privacy.check(neighbor.engram, privacyCtx);
        if (!verdict.allowed) continue;

        // Score with association boost
        const scoring = this.scoreEngram(neighbor.engram, queryEmbedding);
        scoring.association = neighbor.pullStrength;

        const score = this.computeWeightedScore(scoring);

        if (score >= minScore) {
          expanded.push({
            engram: neighbor.engram,
            score,
            scoring,
            reason: `Surfaced via association from '${result.engram.content.slice(0, 50)}...' (pull: ${neighbor.pullStrength.toFixed(3)})`,
            associationPath: neighbor.path,
          });
        }
      }
    }

    return expanded;
  }

  // ─── Deduplication ───────────────────────────────────────────────────

  /**
   * Merge and deduplicate results, keeping highest-scored unique engrams.
   */
  private mergeAndDedup(results: RecallResult[], topK: number): RecallResult[] {
    const seen = new Map<string, RecallResult>();

    for (const result of results) {
      const existing = seen.get(result.engram.id);
      if (!existing || result.score > existing.score) {
        seen.set(result.engram.id, result);
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ─── Explainability ──────────────────────────────────────────────────

  private explainScore(engram: Engram, scoring: RecallResult["scoring"], queryProductId: string): string {
    const parts: string[] = [];

    if (scoring.semantic > 0.5) parts.push(`high semantic match (${(scoring.semantic * 100).toFixed(0)}%)`);
    else if (scoring.semantic > 0.3) parts.push(`moderate semantic match (${(scoring.semantic * 100).toFixed(0)}%)`);

    if (scoring.activation > 0.7) parts.push("highly activated");
    if (scoring.recency > 0.8) parts.push("recently accessed");
    if (scoring.maturity > 0.5) parts.push(`${engram.stage} memory`);
    if (scoring.association > 0.3) parts.push(`strong graph association (${scoring.association.toFixed(2)})`);

    if (engram.productId !== queryProductId) {
      parts.push(`cross-product from '${engram.productId}'`);
    }

    return parts.join(", ") || "baseline match";
  }
}
