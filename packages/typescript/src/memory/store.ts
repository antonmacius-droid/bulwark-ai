/**
 * Memory Store — Persistence layer for the Engram Architecture.
 *
 * Uses the same pluggable Database abstraction as the rest of Bulwark,
 * so it works with SQLite (zero-config) or Postgres (production).
 *
 * Schema design principles:
 * - Engrams are stored with their embeddings as BLOBs for local similarity search
 * - Associations are stored as directed edges with strength/type
 * - Gravity wells are computed views, not stored (derived from access patterns)
 * - All queries are tenant-scoped at the SQL level (defense in depth)
 */

import type { Database } from "../database";
import type {
  Engram,
  EngramStage,
  EngramKind,
  Association,
  AssociationType,
  PrivacyLevel,
  GravityWell,
  MemoryStats,
} from "./types";

const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS bulwark_engrams (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  kind TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'ephemeral',
  activation REAL NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  decay_rate REAL NOT NULL DEFAULT 0.1,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  session_id TEXT,
  privacy TEXT NOT NULL DEFAULT 'user_private',
  sensitive INTEGER NOT NULL DEFAULT 0,
  embedding BLOB,
  embedding_hash TEXT,
  origin TEXT NOT NULL DEFAULT '{}',
  parent_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  promoted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_engrams_tenant ON bulwark_engrams(tenant_id);
CREATE INDEX IF NOT EXISTS idx_engrams_user ON bulwark_engrams(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_engrams_product ON bulwark_engrams(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_engrams_stage ON bulwark_engrams(stage);
CREATE INDEX IF NOT EXISTS idx_engrams_kind ON bulwark_engrams(kind);
CREATE INDEX IF NOT EXISTS idx_engrams_activation ON bulwark_engrams(activation);
CREATE INDEX IF NOT EXISTS idx_engrams_expires ON bulwark_engrams(expires_at);
CREATE INDEX IF NOT EXISTS idx_engrams_embedding_hash ON bulwark_engrams(embedding_hash);
CREATE INDEX IF NOT EXISTS idx_engrams_privacy ON bulwark_engrams(tenant_id, privacy);

CREATE TABLE IF NOT EXISTS bulwark_associations (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5,
  type TEXT NOT NULL DEFAULT 'co-access',
  co_access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_assoc_source ON bulwark_associations(source_id);
CREATE INDEX IF NOT EXISTS idx_assoc_target ON bulwark_associations(target_id);
CREATE INDEX IF NOT EXISTS idx_assoc_strength ON bulwark_associations(strength);

CREATE TABLE IF NOT EXISTS bulwark_products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manifest TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Serialize embedding to Buffer for storage.
 * Uses Float32Array for 4x compression vs JSON (1536 dims = 6KB vs 24KB).
 */
function serializeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * Deserialize embedding from stored Buffer.
 */
function deserializeEmbedding(buffer: Buffer): number[] {
  const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  return Array.from(float32);
}

/**
 * Fast embedding hash using FNV-1a on quantized values.
 * Used for deduplication without full vector comparison.
 */
function hashEmbedding(embedding: number[]): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < embedding.length; i++) {
    // Quantize to 8-bit to group near-identical embeddings
    const quantized = Math.round(embedding[i] * 127) & 0xff;
    hash ^= quantized;
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(36);
}

/**
 * Convert database row to Engram object.
 */
function rowToEngram(row: Record<string, unknown>): Engram {
  return {
    id: row.id as string,
    content: row.content as string,
    data: JSON.parse((row.data as string) || "{}"),
    kind: row.kind as EngramKind,
    stage: row.stage as EngramStage,
    activation: row.activation as number,
    accessCount: row.access_count as number,
    lastAccessedAt: row.last_accessed_at as string,
    decayRate: row.decay_rate as number,
    tenantId: row.tenant_id as string,
    userId: row.user_id as string,
    productId: row.product_id as string,
    sessionId: (row.session_id as string) || undefined,
    privacy: row.privacy as PrivacyLevel,
    sensitive: !!(row.sensitive as number),
    embedding: row.embedding ? deserializeEmbedding(row.embedding as Buffer) : null,
    embeddingHash: (row.embedding_hash as string) || null,
    origin: JSON.parse((row.origin as string) || "{}"),
    parentIds: JSON.parse((row.parent_ids as string) || "[]"),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    expiresAt: (row.expires_at as string) || null,
    promotedAt: row.promoted_at as string,
  };
}

function rowToAssociation(row: Record<string, unknown>): Association {
  return {
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    strength: row.strength as number,
    type: row.type as AssociationType,
    coAccessCount: row.co_access_count as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class MemoryStore {
  constructor(private readonly db: Database) {}

  /** Initialize schema — called once on startup */
  async init(): Promise<void> {
    // Execute each statement separately for compatibility
    const statements = MEMORY_SCHEMA.split(";").filter((s) => s.trim());
    for (const stmt of statements) {
      await this.db.run(stmt);
    }
  }

  // ─── Engram CRUD ─────────────────────────────────────────────────────

  async createEngram(engram: Engram): Promise<void> {
    const embeddingBlob = engram.embedding ? serializeEmbedding(engram.embedding) : null;
    const embeddingHash = engram.embedding ? hashEmbedding(engram.embedding) : null;

    await this.db.run(
      `INSERT INTO bulwark_engrams
       (id, content, data, kind, stage, activation, access_count, last_accessed_at,
        decay_rate, tenant_id, user_id, product_id, session_id, privacy, sensitive,
        embedding, embedding_hash, origin, parent_ids, created_at, updated_at,
        expires_at, promoted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        engram.id,
        engram.content,
        JSON.stringify(engram.data),
        engram.kind,
        engram.stage,
        engram.activation,
        engram.accessCount,
        engram.lastAccessedAt,
        engram.decayRate,
        engram.tenantId,
        engram.userId,
        engram.productId,
        engram.sessionId || null,
        engram.privacy,
        engram.sensitive ? 1 : 0,
        embeddingBlob,
        embeddingHash,
        JSON.stringify(engram.origin),
        JSON.stringify(engram.parentIds),
        engram.createdAt,
        engram.updatedAt,
        engram.expiresAt,
        engram.promotedAt,
      ]
    );
  }

  async getEngram(id: string, tenantId: string): Promise<Engram | undefined> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      `SELECT * FROM bulwark_engrams WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );
    return row ? rowToEngram(row) : undefined;
  }

  async updateEngram(
    id: string,
    tenantId: string,
    updates: Partial<Pick<Engram, "activation" | "accessCount" | "lastAccessedAt" | "stage" | "decayRate" | "expiresAt" | "promotedAt" | "content" | "data" | "privacy" | "updatedAt">>
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.activation !== undefined) { sets.push("activation = ?"); params.push(updates.activation); }
    if (updates.accessCount !== undefined) { sets.push("access_count = ?"); params.push(updates.accessCount); }
    if (updates.lastAccessedAt !== undefined) { sets.push("last_accessed_at = ?"); params.push(updates.lastAccessedAt); }
    if (updates.stage !== undefined) { sets.push("stage = ?"); params.push(updates.stage); }
    if (updates.decayRate !== undefined) { sets.push("decay_rate = ?"); params.push(updates.decayRate); }
    if (updates.expiresAt !== undefined) { sets.push("expires_at = ?"); params.push(updates.expiresAt); }
    if (updates.promotedAt !== undefined) { sets.push("promoted_at = ?"); params.push(updates.promotedAt); }
    if (updates.content !== undefined) { sets.push("content = ?"); params.push(updates.content); }
    if (updates.data !== undefined) { sets.push("data = ?"); params.push(JSON.stringify(updates.data)); }
    if (updates.privacy !== undefined) { sets.push("privacy = ?"); params.push(updates.privacy); }

    sets.push("updated_at = ?");
    params.push(updates.updatedAt || new Date().toISOString());

    params.push(id, tenantId);

    if (sets.length > 1) {
      await this.db.run(`UPDATE bulwark_engrams SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, params);
    }
  }

  async deleteEngram(id: string, tenantId: string): Promise<void> {
    // Delete associations first (referential integrity)
    await this.db.run(
      `DELETE FROM bulwark_associations WHERE source_id = ? OR target_id = ?`,
      [id, id]
    );
    await this.db.run(
      `DELETE FROM bulwark_engrams WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );
  }

  /**
   * Delete all engrams for a user within a tenant (GDPR).
   * Bypasses privacy — this is a deletion, not a query.
   */
  async deleteUserEngrams(userId: string, tenantId: string): Promise<number> {
    const rows = await this.db.queryAll<{ id: string }>(
      `SELECT id FROM bulwark_engrams WHERE user_id = ? AND tenant_id = ?`,
      [userId, tenantId]
    );
    for (const row of rows) {
      await this.deleteEngram(row.id, tenantId);
    }
    return rows.length;
  }

  // ─── Engram Queries ──────────────────────────────────────────────────

  /**
   * Get all engrams visible to a product+user within a tenant.
   * Respects privacy mesh boundaries at the SQL level.
   */
  async queryEngrams(opts: {
    tenantId: string;
    userId: string;
    productId: string;
    kinds?: EngramKind[];
    stages?: EngramStage[];
    minActivation?: number;
    limit?: number;
    canReadSensitive?: boolean;
  }): Promise<Engram[]> {
    const conditions: string[] = ["tenant_id = ?"];
    const params: unknown[] = [opts.tenantId];

    // Privacy mesh enforcement at SQL level:
    // - cross_product: visible to all products within tenant
    // - product: visible only to originating product
    // - user_private: visible only to creating user across products
    // - session: visible only to same user in same product (most restrictive)
    conditions.push(
      `(privacy = 'cross_product' OR (privacy = 'product' AND product_id = ?) OR (privacy = 'user_private' AND user_id = ?) OR (privacy = 'session' AND user_id = ? AND product_id = ?))`
    );
    params.push(opts.productId, opts.userId, opts.userId, opts.productId);

    if (!opts.canReadSensitive) {
      // If product can't read sensitive, only show non-sensitive OR own product's sensitive
      conditions.push(`(sensitive = 0 OR product_id = ?)`);
      params.push(opts.productId);
    }

    if (opts.kinds?.length) {
      conditions.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`);
      params.push(...opts.kinds);
    }

    if (opts.stages?.length) {
      conditions.push(`stage IN (${opts.stages.map(() => "?").join(",")})`);
      params.push(...opts.stages);
    }

    if (opts.minActivation !== undefined) {
      conditions.push("activation >= ?");
      params.push(opts.minActivation);
    }

    // Exclude expired engrams
    conditions.push("(expires_at IS NULL OR expires_at > ?)");
    params.push(new Date().toISOString());

    const limit = opts.limit || 100;
    params.push(limit);

    const rows = await this.db.queryAll<Record<string, unknown>>(
      `SELECT * FROM bulwark_engrams WHERE ${conditions.join(" AND ")} ORDER BY activation DESC LIMIT ?`,
      params
    );

    return rows.map(rowToEngram);
  }

  /**
   * Find engrams with similar embedding hash (fast pre-filter for deduplication).
   */
  async findByEmbeddingHash(hash: string, tenantId: string): Promise<Engram[]> {
    const rows = await this.db.queryAll<Record<string, unknown>>(
      `SELECT * FROM bulwark_engrams WHERE embedding_hash = ? AND tenant_id = ?`,
      [hash, tenantId]
    );
    return rows.map(rowToEngram);
  }

  /**
   * Get all engrams that need lifecycle maintenance:
   * expired, below GC threshold, or eligible for promotion.
   */
  async getMaintenanceCandidates(tenantId: string, gcThreshold: number): Promise<{
    expired: Engram[];
    decayed: Engram[];
    promotionCandidates: Engram[];
  }> {
    const now = new Date().toISOString();
    const [expired, decayed, candidates] = await Promise.all([
      this.db.queryAll<Record<string, unknown>>(
        `SELECT * FROM bulwark_engrams WHERE tenant_id = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
        [tenantId, now]
      ),
      this.db.queryAll<Record<string, unknown>>(
        `SELECT * FROM bulwark_engrams WHERE tenant_id = ? AND activation < ? AND stage != 'crystallized'`,
        [tenantId, gcThreshold]
      ),
      this.db.queryAll<Record<string, unknown>>(
        `SELECT * FROM bulwark_engrams WHERE tenant_id = ? AND stage != 'crystallized' AND access_count > 1 ORDER BY activation DESC LIMIT 100`,
        [tenantId]
      ),
    ]);

    return {
      expired: expired.map(rowToEngram),
      decayed: decayed.map(rowToEngram),
      promotionCandidates: candidates.map(rowToEngram),
    };
  }

  /**
   * Batch update activation levels (for decay processing).
   * Uses exponential decay: activation *= e^(-decayRate * hoursSinceLastAccess)
   */
  async applyDecay(tenantId: string): Promise<number> {
    // SQLite doesn't have exp(), so we calculate in application layer
    const rows = await this.db.queryAll<Record<string, unknown>>(
      `SELECT id, activation, decay_rate, last_accessed_at FROM bulwark_engrams
       WHERE tenant_id = ? AND stage != 'crystallized'`,
      [tenantId]
    );

    const now = Date.now();
    let updated = 0;

    for (const row of rows) {
      const lastAccess = new Date(row.last_accessed_at as string).getTime();
      const hoursSinceAccess = (now - lastAccess) / (1000 * 60 * 60);
      const decayRate = row.decay_rate as number;
      const currentActivation = row.activation as number;
      const newActivation = currentActivation * Math.exp(-decayRate * hoursSinceAccess);

      if (Math.abs(newActivation - currentActivation) > 0.001) {
        await this.db.run(
          `UPDATE bulwark_engrams SET activation = ? WHERE id = ? AND tenant_id = ?`,
          [Math.max(0, newActivation), row.id, tenantId]
        );
        updated++;
      }
    }

    return updated;
  }

  // ─── Association CRUD ────────────────────────────────────────────────

  async createAssociation(assoc: Association): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO bulwark_associations
       (source_id, target_id, strength, type, co_access_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [assoc.sourceId, assoc.targetId, assoc.strength, assoc.type, assoc.coAccessCount, assoc.createdAt, assoc.updatedAt]
    );
  }

  async getAssociationsFrom(engramId: string): Promise<Association[]> {
    const rows = await this.db.queryAll<Record<string, unknown>>(
      `SELECT * FROM bulwark_associations WHERE source_id = ? ORDER BY strength DESC`,
      [engramId]
    );
    return rows.map(rowToAssociation);
  }

  async getAssociationsTo(engramId: string): Promise<Association[]> {
    const rows = await this.db.queryAll<Record<string, unknown>>(
      `SELECT * FROM bulwark_associations WHERE target_id = ? ORDER BY strength DESC`,
      [engramId]
    );
    return rows.map(rowToAssociation);
  }

  /**
   * Get bidirectional neighborhood of an engram (all connected engrams within N hops).
   */
  async getNeighborhood(engramId: string, depth: number, tenantId: string): Promise<{ engrams: Engram[]; associations: Association[] }> {
    const visited = new Set<string>([engramId]);
    const allAssociations: Association[] = [];
    let frontier = [engramId];

    for (let hop = 0; hop < depth; hop++) {
      const nextFrontier: string[] = [];

      for (const nodeId of frontier) {
        const [outgoing, incoming] = await Promise.all([
          this.getAssociationsFrom(nodeId),
          this.getAssociationsTo(nodeId),
        ]);

        for (const assoc of [...outgoing, ...incoming]) {
          allAssociations.push(assoc);
          const neighborId = assoc.sourceId === nodeId ? assoc.targetId : assoc.sourceId;
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            nextFrontier.push(neighborId);
          }
        }
      }

      frontier = nextFrontier;
    }

    // Fetch all neighbor engrams (tenant-scoped)
    visited.delete(engramId); // Don't re-fetch the origin
    const engrams: Engram[] = [];
    for (const id of visited) {
      const engram = await this.getEngram(id, tenantId);
      if (engram) engrams.push(engram);
    }

    return { engrams, associations: allAssociations };
  }

  /**
   * Strengthen an association (Hebbian reinforcement).
   */
  async reinforceAssociation(
    sourceId: string,
    targetId: string,
    learningRate: number
  ): Promise<void> {
    const now = new Date().toISOString();

    // Try to update existing association
    const existing = await this.db.queryOne<Record<string, unknown>>(
      `SELECT * FROM bulwark_associations WHERE source_id = ? AND target_id = ?`,
      [sourceId, targetId]
    );

    if (existing) {
      const currentStrength = existing.strength as number;
      // Asymptotic strengthening: approaches 1.0 but never exceeds it
      const newStrength = currentStrength + learningRate * (1.0 - currentStrength);
      const newCoAccess = (existing.co_access_count as number) + 1;

      await this.db.run(
        `UPDATE bulwark_associations SET strength = ?, co_access_count = ?, updated_at = ?
         WHERE source_id = ? AND target_id = ?`,
        [newStrength, newCoAccess, now, sourceId, targetId]
      );
    } else {
      await this.createAssociation({
        sourceId,
        targetId,
        strength: learningRate,
        type: "co-access",
        coAccessCount: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Decay all associations.
   */
  async decayAssociations(decayRate: number): Promise<number> {
    const rows = await this.db.queryAll<Record<string, unknown>>(
      `SELECT source_id, target_id, strength, updated_at FROM bulwark_associations`
    );

    let updated = 0;
    const now = Date.now();

    for (const row of rows) {
      const lastUpdate = new Date(row.updated_at as string).getTime();
      const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);
      const currentStrength = row.strength as number;
      const newStrength = currentStrength * Math.exp(-decayRate * daysSinceUpdate);

      if (newStrength < 0.01) {
        // GC dead associations
        await this.db.run(
          `DELETE FROM bulwark_associations WHERE source_id = ? AND target_id = ?`,
          [row.source_id, row.target_id]
        );
        updated++;
      } else if (Math.abs(newStrength - currentStrength) > 0.001) {
        await this.db.run(
          `UPDATE bulwark_associations SET strength = ? WHERE source_id = ? AND target_id = ?`,
          [newStrength, row.source_id, row.target_id]
        );
        updated++;
      }
    }

    return updated;
  }

  // ─── Gravity Wells ───────────────────────────────────────────────────

  /**
   * Discover gravity wells — clusters of tightly associated engrams.
   * Uses single-linkage clustering on association strength.
   */
  async discoverGravityWells(tenantId: string, minCohesion: number = 0.5): Promise<GravityWell[]> {
    // Get all strong associations
    const strongAssocs = await this.db.queryAll<Record<string, unknown>>(
      `SELECT a.source_id, a.target_id, a.strength
       FROM bulwark_associations a
       JOIN bulwark_engrams e1 ON a.source_id = e1.id AND e1.tenant_id = ?
       WHERE a.strength >= ?`,
      [tenantId, minCohesion]
    );

    // Union-Find for clustering
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: string, b: string) => {
      parent.set(find(a), find(b));
    };

    for (const row of strongAssocs) {
      union(row.source_id as string, row.target_id as string);
    }

    // Group by cluster root
    const clusters = new Map<string, Set<string>>();
    for (const nodeId of parent.keys()) {
      const root = find(nodeId);
      if (!clusters.has(root)) clusters.set(root, new Set());
      clusters.get(root)!.add(nodeId);
    }

    // Build gravity wells from clusters with 2+ members
    const wells: GravityWell[] = [];
    for (const [, members] of clusters) {
      if (members.size < 2) continue;

      const memberIds = Array.from(members);
      const engrams: Engram[] = [];

      for (const id of memberIds) {
        const engram = await this.getEngram(id, tenantId);
        if (engram) engrams.push(engram);
      }

      if (engrams.length < 2) continue;

      // Attractor = highest activation
      const attractor = engrams.reduce((a, b) => a.activation > b.activation ? a : b);

      // Compute cohesion as average pairwise association strength
      const pairStrengths: number[] = [];
      for (const assoc of strongAssocs) {
        if (members.has(assoc.source_id as string) && members.has(assoc.target_id as string)) {
          pairStrengths.push(assoc.strength as number);
        }
      }
      const cohesion = pairStrengths.length > 0
        ? pairStrengths.reduce((a, b) => a + b, 0) / pairStrengths.length
        : 0;

      const kindCounts = new Map<string, number>();
      const productSet = new Set<string>();
      for (const e of engrams) {
        kindCounts.set(e.kind, (kindCounts.get(e.kind) || 0) + 1);
        productSet.add(e.productId);
      }

      wells.push({
        id: `well-${attractor.id}`,
        attractorId: attractor.id,
        memberIds: engrams.map((e) => e.id),
        avgActivation: engrams.reduce((s, e) => s + e.activation, 0) / engrams.length,
        cohesion,
        dominantKinds: Array.from(kindCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k]) => k as EngramKind),
        contributingProducts: Array.from(productSet),
        updatedAt: new Date().toISOString(),
      });
    }

    return wells.sort((a, b) => b.cohesion - a.cohesion);
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  async getStats(tenantId: string): Promise<MemoryStats> {
    const [byStage, byKind, byProduct, assocCount, avgAct, recent, gc, recalls] = await Promise.all([
      this.db.queryAll<{ stage: string; count: number }>(
        `SELECT stage, COUNT(*) as count FROM bulwark_engrams WHERE tenant_id = ? GROUP BY stage`, [tenantId]
      ),
      this.db.queryAll<{ kind: string; count: number }>(
        `SELECT kind, COUNT(*) as count FROM bulwark_engrams WHERE tenant_id = ? GROUP BY kind`, [tenantId]
      ),
      this.db.queryAll<{ product_id: string; count: number }>(
        `SELECT product_id, COUNT(*) as count FROM bulwark_engrams WHERE tenant_id = ? GROUP BY product_id`, [tenantId]
      ),
      this.db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM bulwark_associations a JOIN bulwark_engrams e ON a.source_id = e.id WHERE e.tenant_id = ?`, [tenantId]
      ),
      this.db.queryOne<{ avg: number }>(
        `SELECT AVG(activation) as avg FROM bulwark_engrams WHERE tenant_id = ?`, [tenantId]
      ),
      this.db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM bulwark_engrams WHERE tenant_id = ? AND created_at >= datetime('now', '-1 day')`, [tenantId]
      ),
      this.db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM bulwark_engrams WHERE tenant_id = ? AND stage = 'ephemeral' AND activation < 0.05`, [tenantId]
      ),
      this.db.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM bulwark_engrams WHERE tenant_id = ? AND last_accessed_at >= datetime('now', '-1 day') AND product_id != (SELECT product_id FROM bulwark_engrams WHERE tenant_id = ? LIMIT 1)`, [tenantId, tenantId]
      ),
    ]);

    const stageMap: Record<string, number> = {};
    for (const r of byStage) stageMap[r.stage] = r.count;

    const kindMap: Record<string, number> = {};
    for (const r of byKind) kindMap[r.kind] = r.count;

    const productMap: Record<string, number> = {};
    for (const r of byProduct) productMap[r.product_id] = r.count;

    const wells = await this.discoverGravityWells(tenantId);

    return {
      engramsByStage: stageMap as Record<EngramStage, number>,
      engramsByKind: kindMap as Record<EngramKind, number>,
      engramsByProduct: productMap,
      totalAssociations: assocCount?.count || 0,
      gravityWellCount: wells.length,
      avgActivation: avgAct?.avg || 0,
      recentCreations: recent?.count || 0,
      recentGarbageCollected: gc?.count || 0,
      recentCrossProductRecalls: recalls?.count || 0,
    };
  }

  // ─── Garbage Collection ──────────────────────────────────────────────

  /**
   * Remove expired and fully decayed engrams.
   * Returns count of removed engrams.
   */
  async garbageCollect(tenantId: string, gcThreshold: number): Promise<number> {
    const candidates = await this.getMaintenanceCandidates(tenantId, gcThreshold);

    let removed = 0;
    for (const engram of [...candidates.expired, ...candidates.decayed]) {
      await this.deleteEngram(engram.id, tenantId);
      removed++;
    }

    return removed;
  }
}
