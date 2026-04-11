/**
 * Cross-Product AI Memory — The Engram Architecture
 *
 * Neuromorphic memory system where context units (engrams) form associative
 * networks across products through Hebbian learning, decay naturally over time,
 * and crystallize into permanent knowledge through repeated access.
 *
 * Engineering principles:
 * - Cognitive Locality: related memories cluster for O(1) associative recall
 * - Contextual Gravity: important context attracts related context into neighborhoods
 * - Memory Crystallization: repeated access promotes ephemeral → permanent
 * - Temporal Coherence: causal ordering maintained across product boundaries
 * - Privacy Mesh: multi-layer boundary enforcement (tenant > user > product > sensitivity)
 */

// ─── Memory Lifecycle ────────────────────────────────────────────────────────

/**
 * Engram maturity stages — memories promote through lifecycle based on access patterns.
 *
 * EPHEMERAL  → short-lived, single-product visibility, auto-expires
 * WORKING    → actively used, visible to originating product + direct associations
 * CONSOLIDATED → accessed across products, forms part of knowledge graph
 * CRYSTALLIZED → permanent, high activation, full cross-product visibility
 */
export type EngramStage = "ephemeral" | "working" | "consolidated" | "crystallized";

/**
 * What type of context this engram represents.
 * Determines default TTL, privacy level, and routing weight.
 */
export type EngramKind =
  | "fact"           // Extracted fact from conversation (e.g., "Building X has 5 floors")
  | "preference"     // User preference (e.g., "prefers email over Slack")
  | "decision"       // Decision made (e.g., "chose contractor Y for project Z")
  | "entity"         // Named entity (building, person, company, project)
  | "relationship"   // Relationship between entities (e.g., "contractor Y manages building X")
  | "event"          // Something that happened (e.g., "inspection completed on 2024-01-15")
  | "insight"        // AI-derived insight (e.g., "this user typically asks about HVAC issues")
  | "procedure"      // How-to knowledge (e.g., "to submit a tender, first...")
  | "context";       // Raw conversation context snapshot

// ─── Core Engram ─────────────────────────────────────────────────────────────

/**
 * An Engram is the fundamental unit of cross-product memory.
 *
 * Named after the hypothetical physical trace of memory in the brain,
 * each engram is a rich, self-describing context unit that:
 * - Has an activation level that strengthens on access and decays over time
 * - Forms associations with other engrams through co-access (Hebbian learning)
 * - Promotes through lifecycle stages based on access patterns
 * - Maintains causal lineage for explainability
 * - Respects multi-layer privacy boundaries
 */
export interface Engram {
  /** Unique identifier */
  id: string;

  /** Human-readable content of this memory */
  content: string;

  /** Structured key-value data (entities, attributes, metadata) */
  data: Record<string, unknown>;

  /** What kind of context this represents */
  kind: EngramKind;

  /** Current lifecycle stage */
  stage: EngramStage;

  // ── Activation & Decay ──

  /**
   * Activation level (0.0 - 1.0).
   * Increases on access, decays exponentially over time.
   * Engrams below decay threshold are garbage-collected.
   */
  activation: number;

  /** How many times this engram has been accessed/retrieved */
  accessCount: number;

  /** Timestamp of last access (ISO 8601) */
  lastAccessedAt: string;

  /** Decay rate — higher = faster decay. Decreases as stage promotes. */
  decayRate: number;

  // ── Scoping (Privacy Mesh) ──

  /** Tenant that owns this memory — HARD boundary, never crossed */
  tenantId: string;

  /** User who created this memory */
  userId: string;

  /** Product that originated this memory */
  productId: string;

  /** Session/conversation that created this memory */
  sessionId?: string;

  /** Privacy level — controls cross-product visibility */
  privacy: PrivacyLevel;

  /** Whether this engram contains PII-adjacent information */
  sensitive: boolean;

  // ── Embedding ──

  /** Semantic embedding vector for similarity search */
  embedding: number[] | null;

  /** Hash of embedding for deduplication without comparing full vectors */
  embeddingHash: string | null;

  // ── Causal Chain ──

  /** What created this engram */
  origin: EngramOrigin;

  /** IDs of engrams this was derived from (causal parents) */
  parentIds: string[];

  // ── Temporal ──

  /** When this engram was created (ISO 8601) */
  createdAt: string;

  /** When this engram was last modified (ISO 8601) */
  updatedAt: string;

  /** When this engram expires (null = permanent for crystallized) */
  expiresAt: string | null;

  /** When this engram was promoted to current stage */
  promotedAt: string;
}

/**
 * What created an engram — enables causal chain tracking and explainability.
 */
export interface EngramOrigin {
  /** How this engram was created */
  type: "conversation" | "extraction" | "inference" | "merge" | "manual";

  /** Product that created it */
  productId: string;

  /** Conversation/request ID that triggered creation */
  requestId?: string;

  /** Model that extracted/inferred this (if AI-derived) */
  model?: string;

  /** Confidence score of extraction (0-1) */
  confidence?: number;
}

// ─── Associations (Knowledge Graph Edges) ─────────────────────────────────

/**
 * An association between two engrams — the edge in the knowledge graph.
 *
 * Implements Hebbian learning: "neurons that fire together wire together."
 * When two engrams are co-accessed (retrieved in the same query or conversation),
 * their association strength increases. Unused associations decay.
 */
export interface Association {
  /** Source engram ID */
  sourceId: string;

  /** Target engram ID */
  targetId: string;

  /** Association strength (0.0 - 1.0). Strengthens on co-access, decays over time. */
  strength: number;

  /** How this association was formed */
  type: AssociationType;

  /** Number of times these engrams were co-accessed */
  coAccessCount: number;

  /** When this association was created */
  createdAt: string;

  /** When strength was last updated */
  updatedAt: string;
}

export type AssociationType =
  | "causal"        // A caused/created B
  | "semantic"      // A and B are semantically similar (embedding proximity)
  | "temporal"      // A and B occurred close in time
  | "co-access"     // A and B were retrieved together (Hebbian)
  | "entity"        // A and B share an entity reference
  | "hierarchical"  // A contains/parents B
  | "contradicts";  // A and B conflict (for conflict detection)

// ─── Privacy Mesh ────────────────────────────────────────────────────────────

/**
 * Multi-layer privacy control.
 *
 * Each level has progressively wider visibility:
 * - session: only visible in originating session
 * - user_private: only visible to the creating user, any product
 * - product: visible to all users of the originating product (within tenant)
 * - cross_product: visible across all products (within tenant)
 *
 * Tenant boundary is ALWAYS enforced — it's not a level, it's a law.
 */
export type PrivacyLevel = "session" | "user_private" | "product" | "cross_product";

/**
 * Defines what a product is allowed to see and emit.
 */
export interface ProductManifest {
  /** Unique product identifier (e.g., "pirkimai-ai", "bendrija-os") */
  productId: string;

  /** Human-readable name */
  name: string;

  /** What kinds of engrams this product can emit */
  emits: EngramKind[];

  /** What kinds of engrams this product subscribes to */
  subscribes: EngramKind[];

  /** Privacy ceiling — max privacy level this product can set on its engrams */
  maxPrivacy: PrivacyLevel;

  /** Whether this product can read sensitive engrams from other products */
  canReadSensitive: boolean;

  /** Domain tags for relevance routing (e.g., ["procurement", "tenders"]) */
  domains: string[];
}

// ─── Context Routing ─────────────────────────────────────────────────────────

/**
 * A scored recall result — engram + why it was surfaced.
 */
export interface RecallResult {
  /** The retrieved engram */
  engram: Engram;

  /** Overall relevance score (0-1) */
  score: number;

  /** Breakdown of how the score was computed */
  scoring: {
    /** Embedding cosine similarity to query */
    semantic: number;
    /** Activation level contribution */
    activation: number;
    /** Recency contribution */
    recency: number;
    /** Association strength contribution (from graph neighborhood) */
    association: number;
    /** Stage bonus (crystallized > consolidated > working > ephemeral) */
    maturity: number;
  };

  /** Why this engram was surfaced — for explainability */
  reason: string;

  /** Chain of associations that led to this engram */
  associationPath?: string[];
}

/**
 * Query for recalling context from memory.
 */
export interface RecallQuery {
  /** Natural language query or conversation context */
  query: string;

  /** Pre-computed query embedding (skip embedding if provided) */
  queryEmbedding?: number[];

  /** Product making the query */
  productId: string;

  /** User context */
  userId: string;

  /** Tenant context */
  tenantId: string;

  /** Max number of engrams to return */
  topK?: number;

  /** Minimum relevance score threshold */
  minScore?: number;

  /** Filter by engram kinds */
  kinds?: EngramKind[];

  /** Filter by stages */
  stages?: EngramStage[];

  /** Include association graph neighborhood (hop depth) */
  graphDepth?: number;

  /** Whether to include the association path in results */
  explainable?: boolean;

  /** Whether to update activation levels on accessed engrams (default: true) */
  reinforce?: boolean;
}

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * Context event emitted by a product — triggers cross-product memory operations.
 */
export interface ContextEvent {
  /** Event type */
  type: ContextEventType;

  /** Product emitting the event */
  productId: string;

  /** User context */
  userId: string;

  /** Tenant context */
  tenantId: string;

  /** Session/conversation ID */
  sessionId?: string;

  /** The engram(s) involved */
  engrams: Engram[];

  /** Request ID for tracing */
  requestId?: string;

  /** Timestamp */
  timestamp: string;
}

export type ContextEventType =
  | "engram.created"       // New engram formed
  | "engram.accessed"      // Engram recalled (triggers Hebbian reinforcement)
  | "engram.promoted"      // Engram promoted to next lifecycle stage
  | "engram.decayed"       // Engram fell below activation threshold
  | "engram.merged"        // Two engrams merged (deduplication)
  | "association.formed"   // New association between engrams
  | "association.strengthened" // Existing association reinforced
  | "context.requested"    // Product requested cross-product context
  | "context.surfaced";    // Context surfaced to a product

/**
 * Handler for context events.
 */
export type ContextEventHandler = (event: ContextEvent) => void | Promise<void>;

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Cross-Product Memory configuration.
 */
export interface CrossProductMemoryConfig {
  /** Enable cross-product memory */
  enabled: boolean;

  /** Product manifests — register all products in the suite */
  products: ProductManifest[];

  /** Embedding provider config (reuses gateway's OpenAI key if available) */
  embeddings?: {
    /** OpenAI API key (falls back to gateway config) */
    apiKey?: string;
    /** Model to use (default: text-embedding-3-small) */
    model?: string;
  };

  /** Memory lifecycle configuration */
  lifecycle?: {
    /** TTL for ephemeral engrams in seconds (default: 3600 = 1h) */
    ephemeralTtlSeconds?: number;
    /** TTL for working engrams in seconds (default: 86400 = 24h) */
    workingTtlSeconds?: number;
    /** TTL for consolidated engrams in seconds (default: 2592000 = 30d) */
    consolidatedTtlSeconds?: number;
    /** Minimum activation to promote from ephemeral → working (default: 0.3) */
    promoteToWorkingThreshold?: number;
    /** Minimum activation to promote from working → consolidated (default: 0.5) */
    promoteToConsolidatedThreshold?: number;
    /** Minimum activation to promote from consolidated → crystallized (default: 0.8) */
    promoteToCrystallizedThreshold?: number;
    /** Activation below this level triggers garbage collection (default: 0.05) */
    gcThreshold?: number;
    /** How often to run lifecycle maintenance in seconds (default: 300 = 5min) */
    maintenanceIntervalSeconds?: number;
  };

  /** Association graph configuration */
  graph?: {
    /** Max associations per engram (default: 50) */
    maxAssociationsPerEngram?: number;
    /** Minimum similarity to form semantic association (default: 0.7) */
    semanticAssociationThreshold?: number;
    /** How much co-access strengthens an association (default: 0.1) */
    hebbianLearningRate?: number;
    /** Association decay rate per day (default: 0.02) */
    associationDecayRate?: number;
  };

  /** Recall (retrieval) configuration */
  recall?: {
    /** Default topK for recall queries (default: 10) */
    defaultTopK?: number;
    /** Default minimum score threshold (default: 0.3) */
    defaultMinScore?: number;
    /** Default graph neighborhood depth (default: 1) */
    defaultGraphDepth?: number;
    /** Weight for semantic similarity in scoring (default: 0.4) */
    semanticWeight?: number;
    /** Weight for activation level in scoring (default: 0.2) */
    activationWeight?: number;
    /** Weight for recency in scoring (default: 0.15) */
    recencyWeight?: number;
    /** Weight for association strength in scoring (default: 0.15) */
    associationWeight?: number;
    /** Weight for maturity stage in scoring (default: 0.1) */
    maturityWeight?: number;
  };
}

// ─── Gravity Well ────────────────────────────────────────────────────────────

/**
 * A gravity well is an emergent cluster of engrams that are frequently co-accessed.
 * Discovered automatically through access patterns, not manually curated.
 *
 * When you recall one engram in a gravity well, the entire neighborhood
 * surfaces — like how thinking about "kitchen" naturally brings to mind
 * "cooking", "refrigerator", "recipes".
 */
export interface GravityWell {
  /** Unique identifier for this cluster */
  id: string;

  /** The most activated engram in the cluster (the "attractor") */
  attractorId: string;

  /** All engram IDs in this cluster */
  memberIds: string[];

  /** Average activation of members */
  avgActivation: number;

  /** Cohesion score — how tightly coupled the members are */
  cohesion: number;

  /** Dominant engram kinds in this cluster */
  dominantKinds: EngramKind[];

  /** Products that contribute to this cluster */
  contributingProducts: string[];

  /** When this cluster was last updated */
  updatedAt: string;
}

// ─── Statistics ──────────────────────────────────────────────────────────────

/**
 * Memory system statistics for monitoring and admin dashboard.
 */
export interface MemoryStats {
  /** Total engrams by stage */
  engramsByStage: Record<EngramStage, number>;

  /** Total engrams by kind */
  engramsByKind: Record<EngramKind, number>;

  /** Total engrams by product */
  engramsByProduct: Record<string, number>;

  /** Total associations */
  totalAssociations: number;

  /** Number of gravity wells */
  gravityWellCount: number;

  /** Average activation across all engrams */
  avgActivation: number;

  /** Engrams created in last 24h */
  recentCreations: number;

  /** Engrams garbage-collected in last 24h */
  recentGarbageCollected: number;

  /** Cross-product recalls in last 24h */
  recentCrossProductRecalls: number;
}
