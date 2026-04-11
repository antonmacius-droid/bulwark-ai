/**
 * Engram Lifecycle Manager
 *
 * Manages the birth, evolution, and death of engrams through the
 * crystallization protocol:
 *
 *   EPHEMERAL (1h) → WORKING (24h) → CONSOLIDATED (30d) → CRYSTALLIZED (∞)
 *
 * Each promotion:
 * - Increases cross-product visibility
 * - Decreases decay rate (memory becomes more durable)
 * - Broadens privacy scope (session → user_private → product → cross_product)
 *
 * Promotion criteria:
 * - Access count thresholds
 * - Activation level thresholds
 * - Cross-product access (accessing from different product accelerates promotion)
 */

import { randomUUID } from "crypto";
import type {
  Engram,
  EngramStage,
  EngramKind,
  EngramOrigin,
  PrivacyLevel,
  CrossProductMemoryConfig,
} from "./types";

/** Default lifecycle configuration */
const DEFAULT_LIFECYCLE = {
  ephemeralTtlSeconds: 3600,           // 1 hour
  workingTtlSeconds: 86400,            // 24 hours
  consolidatedTtlSeconds: 2592000,     // 30 days
  promoteToWorkingThreshold: 0.3,
  promoteToConsolidatedThreshold: 0.5,
  promoteToCrystallizedThreshold: 0.8,
  gcThreshold: 0.05,
  maintenanceIntervalSeconds: 300,
};

/** Decay rates per stage — crystallized memories don't decay */
const DECAY_RATES: Record<EngramStage, number> = {
  ephemeral: 0.3,       // Fast decay — half-life ~2.3 hours
  working: 0.1,         // Moderate decay — half-life ~7 hours
  consolidated: 0.01,   // Slow decay — half-life ~70 hours
  crystallized: 0,      // No decay — permanent
};

/** Privacy defaults per stage — promotions widen visibility */
const DEFAULT_PRIVACY: Record<EngramStage, PrivacyLevel> = {
  ephemeral: "session",
  working: "user_private",
  consolidated: "product",
  crystallized: "cross_product",
};

/** Stage maturity scores for recall scoring */
export const STAGE_MATURITY: Record<EngramStage, number> = {
  ephemeral: 0.1,
  working: 0.3,
  consolidated: 0.6,
  crystallized: 1.0,
};

export class EngramLifecycle {
  private readonly lifecycle: Required<NonNullable<CrossProductMemoryConfig["lifecycle"]>>;

  constructor(config?: CrossProductMemoryConfig["lifecycle"]) {
    this.lifecycle = { ...DEFAULT_LIFECYCLE, ...config };
  }

  /**
   * Create a new engram with proper defaults based on kind.
   */
  create(opts: {
    content: string;
    data?: Record<string, unknown>;
    kind: EngramKind;
    tenantId: string;
    userId: string;
    productId: string;
    sessionId?: string;
    origin: EngramOrigin;
    parentIds?: string[];
    embedding?: number[] | null;
    sensitive?: boolean;
    /** Override initial stage (default: ephemeral) */
    stage?: EngramStage;
    /** Override initial privacy (default: based on stage) */
    privacy?: PrivacyLevel;
  }): Engram {
    const now = new Date().toISOString();
    const stage = opts.stage || "ephemeral";
    const privacy = opts.privacy || DEFAULT_PRIVACY[stage];

    const ttlMap: Record<EngramStage, number | null> = {
      ephemeral: this.lifecycle.ephemeralTtlSeconds,
      working: this.lifecycle.workingTtlSeconds,
      consolidated: this.lifecycle.consolidatedTtlSeconds,
      crystallized: null,
    };

    const ttl = ttlMap[stage];
    const expiresAt = ttl
      ? new Date(Date.now() + ttl * 1000).toISOString()
      : null;

    return {
      id: randomUUID(),
      content: opts.content,
      data: opts.data || {},
      kind: opts.kind,
      stage,
      activation: 1.0,   // Born at full activation
      accessCount: 0,
      lastAccessedAt: now,
      decayRate: DECAY_RATES[stage],
      tenantId: opts.tenantId,
      userId: opts.userId,
      productId: opts.productId,
      sessionId: opts.sessionId,
      privacy,
      sensitive: opts.sensitive || false,
      embedding: opts.embedding || null,
      embeddingHash: null, // Computed by store on save
      origin: opts.origin,
      parentIds: opts.parentIds || [],
      createdAt: now,
      updatedAt: now,
      expiresAt,
      promotedAt: now,
    };
  }

  /**
   * Record an access on an engram — boosts activation, increments counter.
   *
   * Activation boost uses inverse decay: the more decayed, the bigger the boost.
   * This models the "tip of the tongue" effect — retrieving a fading memory
   * reinforces it more strongly than retrieving a fresh one.
   */
  recordAccess(engram: Engram): Partial<Engram> {
    const now = new Date().toISOString();

    // Boost is stronger for more decayed memories (tip-of-tongue reinforcement)
    const decayFactor = 1.0 - engram.activation;
    const boost = 0.2 + 0.3 * decayFactor; // 0.2 base + up to 0.3 bonus
    const newActivation = Math.min(1.0, engram.activation + boost);

    return {
      activation: newActivation,
      accessCount: engram.accessCount + 1,
      lastAccessedAt: now,
      updatedAt: now,
    };
  }

  /**
   * Check if an engram should be promoted to the next lifecycle stage.
   * Returns the new stage if promotion is warranted, null otherwise.
   *
   * Promotion criteria combine activation level and access count.
   * Cross-product access (being retrieved by a different product) counts double.
   */
  checkPromotion(engram: Engram, crossProductAccessCount: number = 0): EngramStage | null {
    // Crystallized is the final stage
    if (engram.stage === "crystallized") return null;

    // Effective access count: cross-product access counts 2x
    const effectiveAccess = engram.accessCount + crossProductAccessCount;

    const transitions: Record<string, { nextStage: EngramStage; activationThreshold: number; minAccess: number }> = {
      ephemeral: {
        nextStage: "working",
        activationThreshold: this.lifecycle.promoteToWorkingThreshold,
        minAccess: 2,
      },
      working: {
        nextStage: "consolidated",
        activationThreshold: this.lifecycle.promoteToConsolidatedThreshold,
        minAccess: 5,
      },
      consolidated: {
        nextStage: "crystallized",
        activationThreshold: this.lifecycle.promoteToCrystallizedThreshold,
        minAccess: 15,
      },
    };

    const transition = transitions[engram.stage];
    if (!transition) return null;

    if (
      engram.activation >= transition.activationThreshold &&
      effectiveAccess >= transition.minAccess
    ) {
      return transition.nextStage;
    }

    return null;
  }

  /**
   * Apply a promotion — returns the updates to apply to the engram.
   */
  applyPromotion(engram: Engram, newStage: EngramStage): Partial<Engram> {
    const now = new Date().toISOString();

    const ttlMap: Record<EngramStage, number | null> = {
      ephemeral: this.lifecycle.ephemeralTtlSeconds,
      working: this.lifecycle.workingTtlSeconds,
      consolidated: this.lifecycle.consolidatedTtlSeconds,
      crystallized: null,
    };

    const ttl = ttlMap[newStage];
    const expiresAt = ttl
      ? new Date(Date.now() + ttl * 1000).toISOString()
      : null;

    return {
      stage: newStage,
      decayRate: DECAY_RATES[newStage],
      privacy: this.shouldWidenPrivacy(engram) ? DEFAULT_PRIVACY[newStage] : engram.privacy,
      expiresAt,
      promotedAt: now,
      updatedAt: now,
    };
  }

  /**
   * Whether privacy should widen on promotion.
   * Sensitive engrams don't auto-widen beyond user_private.
   */
  private shouldWidenPrivacy(engram: Engram): boolean {
    if (engram.sensitive) return false;

    // Only widen if current privacy is the default for current stage
    // (user hasn't manually restricted it)
    return engram.privacy === DEFAULT_PRIVACY[engram.stage];
  }

  /**
   * Check if an engram should be garbage collected.
   */
  shouldGarbageCollect(engram: Engram): boolean {
    // Never GC crystallized memories
    if (engram.stage === "crystallized") return false;

    // Expired
    if (engram.expiresAt && new Date(engram.expiresAt) <= new Date()) return true;

    // Below activation threshold
    if (engram.activation < this.lifecycle.gcThreshold) return true;

    return false;
  }

  /**
   * Merge two engrams into one — used for deduplication.
   * The engram with higher activation survives; the other is absorbed.
   *
   * Returns: [survivor (with merged data), victim (to be deleted)]
   */
  merge(a: Engram, b: Engram): [Partial<Engram> & { id: string }, string] {
    const survivor = a.activation >= b.activation ? a : b;
    const victim = a.activation >= b.activation ? b : a;
    const now = new Date().toISOString();

    // Merged engram gets combined access count and boosted activation
    const mergedActivation = Math.min(1.0, survivor.activation + victim.activation * 0.5);

    return [
      {
        id: survivor.id,
        activation: mergedActivation,
        accessCount: survivor.accessCount + victim.accessCount,
        content: survivor.content.length >= victim.content.length ? survivor.content : victim.content,
        data: { ...victim.data, ...survivor.data }, // Survivor's data takes precedence
        parentIds: [...new Set([...survivor.parentIds, ...victim.parentIds, victim.id])],
        updatedAt: now,
        origin: {
          ...survivor.origin,
          type: "merge" as const,
          confidence: Math.max(survivor.origin.confidence || 0, victim.origin.confidence || 0),
        },
      },
      victim.id,
    ];
  }

  /** Get the GC threshold */
  get gcThreshold(): number {
    return this.lifecycle.gcThreshold;
  }

  /** Get maintenance interval in ms */
  get maintenanceIntervalMs(): number {
    return this.lifecycle.maintenanceIntervalSeconds * 1000;
  }
}
