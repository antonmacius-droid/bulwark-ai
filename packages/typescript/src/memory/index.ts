/**
 * Cross-Product AI Memory — Main Orchestrator
 *
 * This is the public API for the Engram Architecture. It ties together:
 *
 * - MemoryStore     → Persistence (DB)
 * - EngramLifecycle → Birth, promotion, decay, death
 * - AssociativeGraph → Knowledge graph with Hebbian learning
 * - ContextRouter    → Recall with multi-factor scoring
 * - PrivacyMesh      → Multi-layer boundary enforcement
 * - ContextEventBus  → Cross-product event propagation
 *
 * Usage:
 * ```ts
 * const memory = new CrossProductMemory(db, {
 *   enabled: true,
 *   products: [
 *     {
 *       productId: "pirkimai-ai",
 *       name: "Pirkimai.AI",
 *       emits: ["fact", "entity", "decision", "event"],
 *       subscribes: ["fact", "entity", "relationship", "event"],
 *       maxPrivacy: "cross_product",
 *       canReadSensitive: false,
 *       domains: ["procurement", "tenders"],
 *     },
 *     {
 *       productId: "bendrija-os",
 *       name: "BendrijaOS",
 *       emits: ["fact", "entity", "relationship", "event"],
 *       subscribes: ["fact", "entity", "decision", "event"],
 *       maxPrivacy: "cross_product",
 *       canReadSensitive: true,
 *       domains: ["building-management", "contractors"],
 *     },
 *   ],
 * });
 *
 * // Product A stores a memory
 * await memory.remember({
 *   content: "Building X at Gedimino pr. 1 has 5 floors and needs HVAC repair",
 *   kind: "fact",
 *   data: { buildingId: "B-001", address: "Gedimino pr. 1", floors: 5 },
 *   productId: "pirkimai-ai",
 *   userId: "user-123",
 *   tenantId: "tenant-abc",
 * });
 *
 * // Product B recalls relevant context (automatically surfaces Building X)
 * const context = await memory.recall({
 *   query: "What do we know about the building on Gedimino?",
 *   productId: "bendrija-os",
 *   userId: "user-123",
 *   tenantId: "tenant-abc",
 * });
 * // → Returns the Building X engram with explainability
 * ```
 */

import type { Database } from "../database";
import type { EmbeddingProvider } from "../rag/embeddings";
import { OpenAIEmbeddings } from "../rag/embeddings";
import type {
  Engram,
  EngramKind,
  EngramOrigin,
  RecallQuery,
  RecallResult,
  CrossProductMemoryConfig,
  ProductManifest,
  ContextEvent,
  ContextEventType,
  ContextEventHandler,
  GravityWell,
  MemoryStats,
} from "./types";
import { MemoryStore } from "./store";
import { EngramLifecycle } from "./engram";
import { AssociativeGraph } from "./graph";
import { ContextRouter } from "./router";
import { PrivacyMesh, type PrivacyContext } from "./privacy";
import { ContextEventBus } from "./events";

/**
 * Options for remembering new context.
 */
export interface RememberOptions {
  /** The content to remember */
  content: string;

  /** Structured data (entities, attributes, IDs) */
  data?: Record<string, unknown>;

  /** What kind of memory this is */
  kind: EngramKind;

  /** Which product is creating this memory */
  productId: string;

  /** User who created this memory */
  userId: string;

  /** Tenant context */
  tenantId: string;

  /** Session/conversation ID */
  sessionId?: string;

  /** How this memory was created */
  origin?: Partial<EngramOrigin>;

  /** Parent engram IDs (causal chain) */
  parentIds?: string[];

  /** Whether this contains sensitive information */
  sensitive?: boolean;

  /** Pre-computed embedding (skip embedding call if provided) */
  embedding?: number[];
}

export class CrossProductMemory {
  private readonly store: MemoryStore;
  private readonly lifecycle: EngramLifecycle;
  private readonly graph: AssociativeGraph;
  private readonly router: ContextRouter;
  private readonly privacy: PrivacyMesh;
  private readonly events: ContextEventBus;
  private readonly embedder: EmbeddingProvider | null;
  private readonly config: CrossProductMemoryConfig;

  private initialized = false;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database, config: CrossProductMemoryConfig) {
    this.config = config;
    this.store = new MemoryStore(db);
    this.lifecycle = new EngramLifecycle(config.lifecycle);
    this.graph = new AssociativeGraph(this.store, config.graph);
    this.privacy = new PrivacyMesh(config.products);
    this.events = new ContextEventBus();

    // Embedding provider
    if (config.embeddings?.apiKey) {
      this.embedder = new OpenAIEmbeddings(config.embeddings.apiKey, config.embeddings.model);
    } else {
      this.embedder = null;
    }

    this.router = new ContextRouter(this.store, this.graph, this.privacy, this.embedder, config.recall);
  }

  /**
   * Initialize the memory system — creates DB tables, starts maintenance loop.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await this.store.init();
    this.initialized = true;

    // Start background maintenance (decay, GC, promotions)
    this.maintenanceTimer = setInterval(
      () => this.runMaintenance().catch((e) => console.warn("[bulwark-memory] Maintenance error:", e)),
      this.lifecycle.maintenanceIntervalMs
    );

    // Prevent timer from keeping process alive
    if (this.maintenanceTimer.unref) this.maintenanceTimer.unref();
  }

  /**
   * Remember — store a new context memory.
   *
   * Creates an engram, generates embedding, forms associations
   * with existing related engrams, and emits events.
   */
  async remember(opts: RememberOptions): Promise<Engram> {
    await this.init();

    // Validate product can emit this kind
    if (!this.privacy.canEmit(opts.productId, opts.kind)) {
      throw new Error(
        `Product '${opts.productId}' is not configured to emit '${opts.kind}' engrams. ` +
        `Check your product manifest.`
      );
    }

    // Generate embedding
    let embedding = opts.embedding || null;
    if (!embedding && this.embedder) {
      const [emb] = await this.embedder.embed([opts.content]);
      embedding = emb;
    }

    // Create engram
    const engram = this.lifecycle.create({
      content: opts.content,
      data: opts.data,
      kind: opts.kind,
      tenantId: opts.tenantId,
      userId: opts.userId,
      productId: opts.productId,
      sessionId: opts.sessionId,
      origin: {
        type: opts.origin?.type || "conversation",
        productId: opts.productId,
        requestId: opts.origin?.requestId,
        model: opts.origin?.model,
        confidence: opts.origin?.confidence || 1.0,
      },
      parentIds: opts.parentIds,
      embedding,
      sensitive: opts.sensitive,
    });

    // Persist
    await this.store.createEngram(engram);

    // Form associations with existing engrams
    await this.formAssociations(engram);

    // Emit creation event
    await this.events.emit({
      type: "engram.created",
      productId: opts.productId,
      userId: opts.userId,
      tenantId: opts.tenantId,
      sessionId: opts.sessionId,
      engrams: [engram],
      timestamp: new Date().toISOString(),
    });

    return engram;
  }

  /**
   * Recall — retrieve relevant context for a query.
   *
   * This is the main cross-product intelligence entry point.
   * Returns scored, ranked, explainable context from across all products.
   */
  async recall(query: RecallQuery): Promise<RecallResult[]> {
    await this.init();

    const manifest = this.privacy.getManifest(query.productId);
    if (!manifest) {
      throw new Error(
        `Product '${query.productId}' is not registered. Call registerProduct() first.`
      );
    }

    const privacyCtx: PrivacyContext = {
      tenantId: query.tenantId,
      userId: query.userId,
      productId: query.productId,
      manifest,
    };

    const results = await this.router.recall(query, privacyCtx);

    // Emit context surfaced event for cross-product tracking
    if (results.length > 0) {
      const crossProductResults = results.filter((r) => r.engram.productId !== query.productId);
      if (crossProductResults.length > 0) {
        await this.events.emit({
          type: "context.surfaced",
          productId: query.productId,
          userId: query.userId,
          tenantId: query.tenantId,
          engrams: crossProductResults.map((r) => r.engram),
          timestamp: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Recall and format as context string — ready to inject into LLM system prompt.
   *
   * This is the "just works" API. Returns a formatted string that can be
   * appended to a system prompt to give the LLM cross-product context.
   */
  async recallAsContext(query: Omit<RecallQuery, "explainable">): Promise<string> {
    const results = await this.recall({ ...query, explainable: true });

    if (results.length === 0) return "";

    const lines = results.map((r) => {
      const source = r.engram.productId !== query.productId
        ? ` [from ${r.engram.productId}]`
        : "";
      const confidence = r.score >= 0.7 ? "high" : r.score >= 0.5 ? "moderate" : "low";
      return `- ${r.engram.content}${source} (${confidence} relevance, ${r.engram.kind})`;
    });

    return [
      "## Cross-Product Context",
      "The following context was automatically recalled from across the product suite:",
      "",
      ...lines,
    ].join("\n");
  }

  // ─── Event Subscription ─────────────────────────────────────────────

  /**
   * Subscribe a product to context events.
   */
  subscribe(
    productId: string,
    eventTypes: ContextEventType[] | "*",
    handler: ContextEventHandler
  ): string {
    return this.events.subscribe(productId, eventTypes, handler);
  }

  /**
   * Unsubscribe from events.
   */
  unsubscribe(subscriptionId: string): void {
    this.events.unsubscribe(subscriptionId);
  }

  // ─── Product Management ──────────────────────────────────────────────

  /**
   * Register a new product in the memory mesh.
   */
  registerProduct(manifest: ProductManifest): void {
    this.privacy.registerProduct(manifest);
  }

  // ─── Direct Engram Access ────────────────────────────────────────────

  /**
   * Get a specific engram by ID (tenant-scoped).
   */
  async getEngram(id: string, tenantId: string): Promise<Engram | undefined> {
    await this.init();
    return this.store.getEngram(id, tenantId);
  }

  /**
   * Delete a specific engram (and its associations).
   */
  async forgetEngram(id: string, tenantId: string): Promise<void> {
    await this.init();
    await this.store.deleteEngram(id, tenantId);
  }

  /**
   * Forget all engrams for a user within a tenant (GDPR compliance).
   * Bypasses privacy mesh — this is a data deletion operation, not a recall.
   */
  async forgetUser(userId: string, tenantId: string): Promise<number> {
    await this.init();
    return this.store.deleteUserEngrams(userId, tenantId);
  }

  // ─── Analytics ───────────────────────────────────────────────────────

  /**
   * Get memory system statistics.
   */
  async getStats(tenantId: string): Promise<MemoryStats> {
    await this.init();
    return this.store.getStats(tenantId);
  }

  /**
   * Discover gravity wells — emergent clusters of related context.
   */
  async getGravityWells(tenantId: string): Promise<GravityWell[]> {
    await this.init();
    return this.store.discoverGravityWells(tenantId);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Shut down the memory system gracefully.
   */
  async shutdown(): Promise<void> {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────

  /**
   * Form associations between a new engram and existing related engrams.
   */
  private async formAssociations(newEngram: Engram): Promise<void> {
    // Get existing engrams in the same tenant for association formation
    const candidates = await this.store.queryEngrams({
      tenantId: newEngram.tenantId,
      userId: newEngram.userId,
      productId: newEngram.productId,
      limit: 50,
    });

    // Form semantic associations (embedding similarity)
    await this.graph.formSemanticAssociations(newEngram, candidates);

    // Form entity associations (shared data keys)
    await this.graph.formEntityAssociations(newEngram, candidates);

    // Form causal associations (parent chain)
    for (const parentId of newEngram.parentIds) {
      await this.graph.formCausalAssociation(parentId, newEngram.id);
    }
  }

  /**
   * Background maintenance — runs periodically.
   *
   * 1. Apply decay to all engrams
   * 2. Check for promotions
   * 3. Garbage collect expired/decayed engrams
   * 4. Decay associations
   */
  private async runMaintenance(): Promise<void> {
    // Get all tenant IDs (from products config — each product has tenants)
    // For simplicity, we process all engrams. In production with many tenants,
    // this would be sharded or use a tenant registry.
    const tenantIds = new Set<string>();

    // Scan for distinct tenants in the engrams table
    const rows = await this.store["db"].queryAll<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM bulwark_engrams LIMIT 100`
    );
    for (const row of rows) tenantIds.add(row.tenant_id);

    for (const tenantId of tenantIds) {
      // 1. Apply activation decay
      await this.store.applyDecay(tenantId);

      // 2. Check promotions
      const { promotionCandidates } = await this.store.getMaintenanceCandidates(tenantId, this.lifecycle.gcThreshold);
      for (const engram of promotionCandidates) {
        const newStage = this.lifecycle.checkPromotion(engram);
        if (newStage) {
          const updates = this.lifecycle.applyPromotion(engram, newStage);
          await this.store.updateEngram(engram.id, tenantId, updates);

          await this.events.emit({
            type: "engram.promoted",
            productId: engram.productId,
            userId: engram.userId,
            tenantId,
            engrams: [{ ...engram, ...updates } as Engram],
            timestamp: new Date().toISOString(),
          });
        }
      }

      // 3. Garbage collect
      const gcCount = await this.store.garbageCollect(tenantId, this.lifecycle.gcThreshold);
      if (gcCount > 0) {
        console.log(`[bulwark-memory] GC: removed ${gcCount} engrams for tenant ${tenantId}`);
      }

      // 4. Decay associations
      await this.graph.maintenance();
    }
  }
}

// Re-export everything for clean public API
export type {
  Engram,
  EngramStage,
  EngramKind,
  EngramOrigin,
  Association,
  AssociationType,
  PrivacyLevel,
  ProductManifest,
  RecallQuery,
  RecallResult,
  ContextEvent,
  ContextEventType,
  ContextEventHandler,
  CrossProductMemoryConfig,
  GravityWell,
  MemoryStats,
} from "./types";
