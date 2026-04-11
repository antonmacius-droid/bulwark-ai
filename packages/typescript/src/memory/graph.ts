/**
 * Associative Knowledge Graph
 *
 * Implements three key innovations:
 *
 * 1. HEBBIAN LEARNING — "Neurons that fire together wire together"
 *    When engrams are co-accessed in the same query/conversation,
 *    their association strengthens automatically. No manual linking needed.
 *
 * 2. CONTEXTUAL GRAVITY — Important engrams attract related context
 *    High-activation engrams pull their associated neighborhood into
 *    recall results, even if individual neighbors wouldn't score high enough.
 *    Gravity = activation × association_strength × recency
 *
 * 3. SEMANTIC BRIDGING — Cross-product connections via embedding proximity
 *    Even if two engrams from different products were never co-accessed,
 *    the graph forms implicit associations through embedding similarity.
 *    This is how a building mentioned in procurement automatically
 *    connects to the same building in facility management.
 */

import type { Engram, Association, AssociationType, CrossProductMemoryConfig } from "./types";
import { MemoryStore } from "./store";
import { cosineSimilarity } from "../rag/embeddings";

/** Default graph configuration */
const DEFAULT_GRAPH = {
  maxAssociationsPerEngram: 50,
  semanticAssociationThreshold: 0.7,
  hebbianLearningRate: 0.1,
  associationDecayRate: 0.02,
};

export class AssociativeGraph {
  private readonly config: Required<NonNullable<CrossProductMemoryConfig["graph"]>>;

  constructor(
    private readonly store: MemoryStore,
    config?: CrossProductMemoryConfig["graph"]
  ) {
    this.config = { ...DEFAULT_GRAPH, ...config };
  }

  /**
   * Hebbian reinforcement — strengthen associations between co-accessed engrams.
   *
   * Called when multiple engrams are retrieved in the same recall query.
   * All pairs get their associations strengthened.
   *
   * Complexity: O(n²) where n = co-accessed engrams.
   * Capped by recall topK (typically 5-10), so this is fast.
   */
  async hebbianReinforce(engramIds: string[]): Promise<number> {
    if (engramIds.length < 2) return 0;

    let reinforced = 0;

    for (let i = 0; i < engramIds.length; i++) {
      for (let j = i + 1; j < engramIds.length; j++) {
        // Bidirectional reinforcement
        await this.store.reinforceAssociation(
          engramIds[i],
          engramIds[j],
          this.config.hebbianLearningRate
        );
        await this.store.reinforceAssociation(
          engramIds[j],
          engramIds[i],
          this.config.hebbianLearningRate
        );
        reinforced += 2;
      }
    }

    return reinforced;
  }

  /**
   * Form semantic associations between a new engram and existing ones.
   *
   * Compares the new engram's embedding against all existing engrams
   * in the same tenant. Forms associations where similarity exceeds threshold.
   *
   * This is the "semantic bridging" mechanism — how a "Building X" engram
   * from procurement connects to a "Building X" engram from facility management
   * without any explicit linking.
   */
  async formSemanticAssociations(
    newEngram: Engram,
    candidates: Engram[]
  ): Promise<Association[]> {
    if (!newEngram.embedding) return [];

    const formed: Association[] = [];
    const now = new Date().toISOString();

    for (const candidate of candidates) {
      if (!candidate.embedding) continue;
      if (candidate.id === newEngram.id) continue;

      const similarity = cosineSimilarity(newEngram.embedding, candidate.embedding);

      if (similarity >= this.config.semanticAssociationThreshold) {
        const assoc: Association = {
          sourceId: newEngram.id,
          targetId: candidate.id,
          strength: similarity, // Initial strength = similarity score
          type: "semantic",
          coAccessCount: 0,
          createdAt: now,
          updatedAt: now,
        };

        await this.store.createAssociation(assoc);
        formed.push(assoc);

        // Bidirectional
        await this.store.createAssociation({
          ...assoc,
          sourceId: candidate.id,
          targetId: newEngram.id,
        });
      }
    }

    return formed;
  }

  /**
   * Form causal association — when one engram is derived from another.
   */
  async formCausalAssociation(parentId: string, childId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.store.createAssociation({
      sourceId: parentId,
      targetId: childId,
      strength: 0.8, // Causal links start strong
      type: "causal",
      coAccessCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Form entity association — when two engrams reference the same entity.
   *
   * Entity matching uses exact key match in engram.data.
   * For example, if engram A has data.buildingId = "B-123" and
   * engram B also has data.buildingId = "B-123", they get linked.
   */
  async formEntityAssociations(
    newEngram: Engram,
    candidates: Engram[]
  ): Promise<Association[]> {
    const formed: Association[] = [];
    const now = new Date().toISOString();
    const newData = newEngram.data;

    // Extract entity-like keys (IDs, names, references)
    const entityKeys = Object.entries(newData).filter(([key]) =>
      key.endsWith("Id") || key.endsWith("_id") || key === "name" || key === "entity" || key === "reference"
    );

    if (entityKeys.length === 0) return formed;

    for (const candidate of candidates) {
      if (candidate.id === newEngram.id) continue;

      const candidateData = candidate.data;
      let matched = false;

      for (const [key, value] of entityKeys) {
        if (value && candidateData[key] === value) {
          matched = true;
          break;
        }
      }

      if (matched) {
        const assoc: Association = {
          sourceId: newEngram.id,
          targetId: candidate.id,
          strength: 0.7,
          type: "entity",
          coAccessCount: 0,
          createdAt: now,
          updatedAt: now,
        };

        await this.store.createAssociation(assoc);
        await this.store.createAssociation({
          ...assoc,
          sourceId: candidate.id,
          targetId: newEngram.id,
        });
        formed.push(assoc);
      }
    }

    return formed;
  }

  /**
   * Contextual Gravity — compute the gravity pull of an engram.
   *
   * Gravity determines how strongly an engram pulls its neighborhood
   * into recall results. High-gravity engrams act as "attractors" that
   * surface entire clusters of related context.
   *
   * gravity = activation × (1 + log2(accessCount)) × recencyFactor
   */
  computeGravity(engram: Engram): number {
    const accessFactor = 1 + Math.log2(Math.max(1, engram.accessCount));
    const hoursSinceAccess = (Date.now() - new Date(engram.lastAccessedAt).getTime()) / (1000 * 60 * 60);
    const recencyFactor = Math.exp(-0.05 * hoursSinceAccess); // Gentle recency decay

    return engram.activation * accessFactor * recencyFactor;
  }

  /**
   * Get the gravitational neighborhood of an engram.
   *
   * Returns associated engrams weighted by:
   * - The attractor's gravity
   * - Association strength to each neighbor
   * - Each neighbor's own activation
   *
   * This models how recalling "kitchen" naturally brings "cooking",
   * "refrigerator", "recipes" — but NOT "bathroom" even though
   * both are rooms in a house.
   */
  async getGravitationalNeighborhood(
    attractor: Engram,
    tenantId: string,
    depth: number = 1
  ): Promise<{ engram: Engram; pullStrength: number; path: string[] }[]> {
    const gravity = this.computeGravity(attractor);
    const { engrams, associations } = await this.store.getNeighborhood(attractor.id, depth, tenantId);

    // Build adjacency map for path tracking
    const adjacency = new Map<string, Map<string, number>>();
    for (const assoc of associations) {
      if (!adjacency.has(assoc.sourceId)) adjacency.set(assoc.sourceId, new Map());
      adjacency.get(assoc.sourceId)!.set(assoc.targetId, assoc.strength);
    }

    // Score each neighbor
    const results: { engram: Engram; pullStrength: number; path: string[] }[] = [];

    for (const neighbor of engrams) {
      // Find strongest path from attractor to neighbor
      const { strength: pathStrength, path } = this.findStrongestPath(
        attractor.id,
        neighbor.id,
        adjacency,
        depth
      );

      // Pull strength = attractor gravity × path strength × neighbor activation
      const pullStrength = gravity * pathStrength * neighbor.activation;

      results.push({
        engram: neighbor,
        pullStrength,
        path,
      });
    }

    return results
      .filter((r) => r.pullStrength > 0.01) // Filter negligible pulls
      .sort((a, b) => b.pullStrength - a.pullStrength);
  }

  /**
   * Find strongest path between two nodes in the association graph.
   * Uses BFS with path-product scoring (multiply edge weights along path).
   */
  private findStrongestPath(
    from: string,
    to: string,
    adjacency: Map<string, Map<string, number>>,
    maxDepth: number
  ): { strength: number; path: string[] } {
    // BFS tracking best path to each node
    const best = new Map<string, { strength: number; path: string[] }>();
    best.set(from, { strength: 1.0, path: [from] });

    const queue: string[] = [from];
    let depth = 0;

    while (queue.length > 0 && depth < maxDepth) {
      const nextQueue: string[] = [];

      for (const current of queue) {
        const currentBest = best.get(current)!;
        const neighbors = adjacency.get(current);
        if (!neighbors) continue;

        for (const [neighborId, edgeStrength] of neighbors) {
          const pathStrength = currentBest.strength * edgeStrength;
          const existing = best.get(neighborId);

          if (!existing || pathStrength > existing.strength) {
            best.set(neighborId, {
              strength: pathStrength,
              path: [...currentBest.path, neighborId],
            });
            nextQueue.push(neighborId);
          }
        }
      }

      queue.length = 0;
      queue.push(...nextQueue);
      depth++;
    }

    const result = best.get(to);
    return result || { strength: 0, path: [] };
  }

  /**
   * Run graph maintenance: decay associations, prune weak ones.
   */
  async maintenance(): Promise<{ decayed: number }> {
    const decayed = await this.store.decayAssociations(this.config.associationDecayRate);
    return { decayed };
  }

  /**
   * Detect contradictions — find engrams that have "contradicts" associations
   * or very different content on the same entity.
   */
  async detectContradictions(tenantId: string, engram: Engram): Promise<Engram[]> {
    // Get entity associations
    const associations = await this.store.getAssociationsFrom(engram.id);
    const contradictions: Engram[] = [];

    for (const assoc of associations) {
      if (assoc.type === "contradicts") {
        const target = await this.store.getEngram(assoc.targetId, tenantId);
        if (target) contradictions.push(target);
      }
    }

    return contradictions;
  }
}
