import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type Database } from "../database";
import { CrossProductMemory, type RememberOptions } from "../memory/index";
import { EngramLifecycle, STAGE_MATURITY } from "../memory/engram";
import { PrivacyMesh } from "../memory/privacy";
import { ContextEventBus } from "../memory/events";
import { MemoryStore } from "../memory/store";
import { AssociativeGraph } from "../memory/graph";
import type {
  CrossProductMemoryConfig,
  ProductManifest,
  Engram,
  EngramStage,
  ContextEvent,
} from "../memory/types";
import * as fs from "fs";

// ─── Test Fixtures ─────────────────────────────────────────────────────

const TEST_DB = "test-memory.db";

const PRODUCT_A: ProductManifest = {
  productId: "pirkimai-ai",
  name: "Pirkimai.AI",
  emits: ["fact", "entity", "decision", "event"],
  subscribes: ["fact", "entity", "relationship", "event", "decision"],
  maxPrivacy: "cross_product",
  canReadSensitive: false,
  domains: ["procurement", "tenders"],
};

const PRODUCT_B: ProductManifest = {
  productId: "bendrija-os",
  name: "BendrijaOS",
  emits: ["fact", "entity", "relationship", "event"],
  subscribes: ["fact", "entity", "decision", "event", "relationship"],
  maxPrivacy: "cross_product",
  canReadSensitive: true,
  domains: ["building-management", "contractors"],
};

const PRODUCT_C: ProductManifest = {
  productId: "internal-tool",
  name: "Internal Tool",
  emits: ["fact"],
  subscribes: ["fact"],
  maxPrivacy: "product",
  canReadSensitive: false,
  domains: ["internal"],
};

const BASE_CONFIG: CrossProductMemoryConfig = {
  enabled: true,
  products: [PRODUCT_A, PRODUCT_B, PRODUCT_C],
  lifecycle: {
    ephemeralTtlSeconds: 3600,
    workingTtlSeconds: 86400,
    consolidatedTtlSeconds: 2592000,
    promoteToWorkingThreshold: 0.3,
    promoteToConsolidatedThreshold: 0.5,
    promoteToCrystallizedThreshold: 0.8,
    gcThreshold: 0.05,
    maintenanceIntervalSeconds: 999999, // Don't auto-run in tests
  },
  graph: {
    maxAssociationsPerEngram: 50,
    semanticAssociationThreshold: 0.7,
    hebbianLearningRate: 0.1,
    associationDecayRate: 0.02,
  },
};

function cleanup() {
  try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
}

// ─── Engram Lifecycle Tests ────────────────────────────────────────────

describe("EngramLifecycle", () => {
  const lifecycle = new EngramLifecycle(BASE_CONFIG.lifecycle);

  it("should create engrams with correct defaults", () => {
    const engram = lifecycle.create({
      content: "Building X has 5 floors",
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "pirkimai-ai",
      origin: { type: "conversation", productId: "pirkimai-ai" },
    });

    expect(engram.id).toBeTruthy();
    expect(engram.stage).toBe("ephemeral");
    expect(engram.activation).toBe(1.0);
    expect(engram.accessCount).toBe(0);
    expect(engram.decayRate).toBe(0.3);
    expect(engram.privacy).toBe("session"); // ephemeral default
    expect(engram.expiresAt).toBeTruthy();
    expect(engram.kind).toBe("fact");
    expect(engram.content).toBe("Building X has 5 floors");
  });

  it("should create with custom stage and privacy", () => {
    const engram = lifecycle.create({
      content: "Test",
      kind: "entity",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "manual", productId: "p1" },
      stage: "consolidated",
      privacy: "cross_product",
    });

    expect(engram.stage).toBe("consolidated");
    expect(engram.privacy).toBe("cross_product");
    expect(engram.decayRate).toBe(0.01); // consolidated rate
  });

  it("should boost activation on access (tip-of-tongue effect)", () => {
    const engram = lifecycle.create({
      content: "Test",
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });

    // Simulate some decay
    const decayedEngram = { ...engram, activation: 0.3 };
    const updates = lifecycle.recordAccess(decayedEngram);

    // More decayed = bigger boost (tip-of-tongue)
    expect(updates.activation!).toBeGreaterThan(0.3);
    expect(updates.accessCount).toBe(1);

    // High activation = smaller boost
    const freshUpdates = lifecycle.recordAccess(engram);
    const decayBoost = updates.activation! - 0.3;
    const freshBoost = freshUpdates.activation! - 1.0;
    expect(decayBoost).toBeGreaterThan(freshBoost);
  });

  it("should check promotion criteria correctly", () => {
    const engram = lifecycle.create({
      content: "Test",
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });

    // Not enough access count
    expect(lifecycle.checkPromotion(engram)).toBeNull();

    // Enough access + activation
    const promoted = { ...engram, accessCount: 3, activation: 0.5 };
    expect(lifecycle.checkPromotion(promoted)).toBe("working");

    // Working → consolidated
    const working = { ...engram, stage: "working" as EngramStage, accessCount: 6, activation: 0.6 };
    expect(lifecycle.checkPromotion(working)).toBe("consolidated");

    // Consolidated → crystallized
    const consolidated = { ...engram, stage: "consolidated" as EngramStage, accessCount: 16, activation: 0.9 };
    expect(lifecycle.checkPromotion(consolidated)).toBe("crystallized");

    // Crystallized → nothing
    const crystallized = { ...engram, stage: "crystallized" as EngramStage };
    expect(lifecycle.checkPromotion(crystallized)).toBeNull();
  });

  it("should apply promotion correctly", () => {
    const engram = lifecycle.create({
      content: "Test",
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });

    const updates = lifecycle.applyPromotion(engram, "working");
    expect(updates.stage).toBe("working");
    expect(updates.decayRate).toBe(0.1); // working rate
    expect(updates.privacy).toBe("user_private"); // working default

    // Crystallized gets no expiry
    const crystalUpdates = lifecycle.applyPromotion(engram, "crystallized");
    expect(crystalUpdates.expiresAt).toBeNull();
  });

  it("should not widen privacy for sensitive engrams", () => {
    const engram = lifecycle.create({
      content: "SSN: 123-45-6789",
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "conversation", productId: "p1" },
      sensitive: true,
    });

    const updates = lifecycle.applyPromotion(engram, "working");
    // Sensitive engrams keep their original privacy
    expect(updates.privacy).toBe("session");
  });

  it("should merge engrams correctly", () => {
    const a = lifecycle.create({
      content: "Building X has 5 floors",
      data: { buildingId: "B-001", floors: 5 },
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "conversation", productId: "p1", confidence: 0.9 },
    });

    const b = lifecycle.create({
      content: "Building X",
      data: { buildingId: "B-001", address: "Gedimino pr. 1" },
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p2",
      origin: { type: "extraction", productId: "p2", confidence: 0.7 },
    });

    // Simulate both having lower activation so merge boost is visible
    const aDecayed = { ...a, activation: 0.5, accessCount: 2 };
    const bDecayed = { ...b, activation: 0.3, accessCount: 3 };

    const [survivor, victimId] = lifecycle.merge(aDecayed, bDecayed);

    expect(survivor.id).toBe(a.id); // a survives (higher activation)
    expect(victimId).toBe(b.id);
    expect(survivor.activation).toBeGreaterThan(aDecayed.activation);
    // Survivor gets combined data (survivor's takes precedence)
    expect((survivor.data as Record<string, unknown>).buildingId).toBe("B-001");
    expect((survivor.data as Record<string, unknown>).address).toBe("Gedimino pr. 1");
  });

  it("should compute stage maturity scores", () => {
    expect(STAGE_MATURITY.ephemeral).toBeLessThan(STAGE_MATURITY.working);
    expect(STAGE_MATURITY.working).toBeLessThan(STAGE_MATURITY.consolidated);
    expect(STAGE_MATURITY.consolidated).toBeLessThan(STAGE_MATURITY.crystallized);
    expect(STAGE_MATURITY.crystallized).toBe(1.0);
  });
});

// ─── Privacy Mesh Tests ────────────────────────────────────────────────

describe("PrivacyMesh", () => {
  const mesh = new PrivacyMesh([PRODUCT_A, PRODUCT_B, PRODUCT_C]);
  const lifecycle = new EngramLifecycle();

  function makeEngram(overrides: Partial<Engram> = {}): Engram {
    return {
      ...lifecycle.create({
        content: "Test",
        kind: "fact",
        tenantId: "t1",
        userId: "u1",
        productId: "pirkimai-ai",
        origin: { type: "conversation", productId: "pirkimai-ai" },
      }),
      ...overrides,
    };
  }

  it("should block cross-tenant access (HARD boundary)", () => {
    const engram = makeEngram({ privacy: "cross_product" });
    const verdict = mesh.check(engram, {
      tenantId: "different-tenant",
      userId: "u1",
      productId: "pirkimai-ai",
      manifest: PRODUCT_A,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toBe("tenant");
  });

  it("should allow cross-product access for cross_product privacy", () => {
    const engram = makeEngram({ privacy: "cross_product" });
    const verdict = mesh.check(engram, {
      tenantId: "t1",
      userId: "u1",
      productId: "bendrija-os",
      manifest: PRODUCT_B,
    });

    expect(verdict.allowed).toBe(true);
  });

  it("should block cross-product access for product privacy", () => {
    const engram = makeEngram({ privacy: "product" });
    const verdict = mesh.check(engram, {
      tenantId: "t1",
      userId: "u1",
      productId: "bendrija-os",
      manifest: PRODUCT_B,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toBe("product");
  });

  it("should allow same-user cross-product for user_private", () => {
    const engram = makeEngram({ privacy: "user_private" });
    const verdict = mesh.check(engram, {
      tenantId: "t1",
      userId: "u1",
      productId: "bendrija-os",
      manifest: PRODUCT_B,
    });

    expect(verdict.allowed).toBe(true);
  });

  it("should block different-user for user_private", () => {
    const engram = makeEngram({ privacy: "user_private" });
    const verdict = mesh.check(engram, {
      tenantId: "t1",
      userId: "other-user",
      productId: "bendrija-os",
      manifest: PRODUCT_B,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toBe("user");
  });

  it("should block sensitive cross-product access for non-privileged products", () => {
    const engram = makeEngram({ privacy: "cross_product", sensitive: true });
    const verdict = mesh.check(engram, {
      tenantId: "t1",
      userId: "u1",
      productId: "internal-tool", // canReadSensitive: false
      manifest: PRODUCT_C,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toBe("sensitivity");
  });

  it("should allow sensitive cross-product access for privileged products", () => {
    const engram = makeEngram({ privacy: "cross_product", sensitive: true });
    const verdict = mesh.check(engram, {
      tenantId: "t1",
      userId: "u1",
      productId: "bendrija-os", // canReadSensitive: true
      manifest: PRODUCT_B,
    });

    expect(verdict.allowed).toBe(true);
  });

  it("should block engram kinds product doesn't subscribe to", () => {
    const engram = makeEngram({ kind: "preference" }); // Neither subscribes to preference
    const verdict = mesh.check(engram, {
      tenantId: "t1",
      userId: "u1",
      productId: "bendrija-os",
      manifest: PRODUCT_B,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toBe("kind");
  });

  it("should filter engrams correctly", () => {
    const engrams = [
      makeEngram({ id: "e1", privacy: "cross_product" }),
      makeEngram({ id: "e2", privacy: "product" }),           // blocked
      makeEngram({ id: "e3", privacy: "cross_product", tenantId: "other" }), // blocked
      makeEngram({ id: "e4", privacy: "user_private" }),
    ];

    const filtered = mesh.filter(engrams, {
      tenantId: "t1",
      userId: "u1",
      productId: "bendrija-os",
      manifest: PRODUCT_B,
    });

    expect(filtered.map((e) => e.id)).toEqual(["e1", "e4"]);
  });

  it("should compute domain overlap", () => {
    expect(mesh.domainOverlap("pirkimai-ai", "bendrija-os")).toBe(0); // No overlap
    expect(mesh.domainOverlap("pirkimai-ai", "pirkimai-ai")).toBeGreaterThan(0); // Self-overlap
  });

  it("should check emit permissions", () => {
    expect(mesh.canEmit("pirkimai-ai", "fact")).toBe(true);
    expect(mesh.canEmit("pirkimai-ai", "relationship")).toBe(false);
    expect(mesh.canEmit("bendrija-os", "relationship")).toBe(true);
  });

  it("should get subscribers for engram kinds", () => {
    const factSubs = mesh.getSubscribers("fact");
    expect(factSubs).toContain("pirkimai-ai");
    expect(factSubs).toContain("bendrija-os");
    expect(factSubs).toContain("internal-tool");

    const relSubs = mesh.getSubscribers("relationship");
    expect(relSubs).toContain("bendrija-os");
    expect(relSubs).not.toContain("internal-tool");
  });
});

// ─── Event Bus Tests ───────────────────────────────────────────────────

describe("ContextEventBus", () => {
  it("should deliver events to matching subscribers", async () => {
    const bus = new ContextEventBus();
    const received: ContextEvent[] = [];

    bus.subscribe("bendrija-os", ["engram.created"], (event) => {
      received.push(event);
    });

    await bus.emit({
      type: "engram.created",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      engrams: [],
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("engram.created");
  });

  it("should NOT deliver events back to the originator", async () => {
    const bus = new ContextEventBus();
    const received: ContextEvent[] = [];

    bus.subscribe("pirkimai-ai", "*", (event) => {
      received.push(event);
    });

    await bus.emit({
      type: "engram.created",
      productId: "pirkimai-ai", // Same as subscriber
      userId: "u1",
      tenantId: "t1",
      engrams: [],
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(0);
  });

  it("should handle wildcard subscriptions", async () => {
    const bus = new ContextEventBus();
    const received: ContextEvent[] = [];

    bus.subscribe("bendrija-os", "*", (event) => {
      received.push(event);
    });

    await bus.emit({
      type: "engram.promoted",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      engrams: [],
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(1);
  });

  it("should filter by event type", async () => {
    const bus = new ContextEventBus();
    const received: ContextEvent[] = [];

    bus.subscribe("bendrija-os", ["engram.promoted"], (event) => {
      received.push(event);
    });

    await bus.emit({
      type: "engram.created", // Not in subscription
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      engrams: [],
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(0);
  });

  it("should isolate handler errors", async () => {
    const bus = new ContextEventBus();
    const received: ContextEvent[] = [];

    // First subscriber throws
    bus.subscribe("bendrija-os", "*", () => {
      throw new Error("Handler crash!");
    });

    // Second subscriber should still receive
    bus.subscribe("internal-tool", "*", (event) => {
      received.push(event);
    });

    await bus.emit({
      type: "engram.created",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      engrams: [],
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(1);
  });

  it("should unsubscribe correctly", async () => {
    const bus = new ContextEventBus();
    const received: ContextEvent[] = [];

    const subId = bus.subscribe("bendrija-os", "*", (event) => {
      received.push(event);
    });

    bus.unsubscribe(subId);

    await bus.emit({
      type: "engram.created",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      engrams: [],
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(0);
  });

  it("should deduplicate identical events", async () => {
    const bus = new ContextEventBus();
    const received: ContextEvent[] = [];

    bus.subscribe("bendrija-os", "*", (event) => {
      received.push(event);
    });

    const event: ContextEvent = {
      type: "engram.created",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      engrams: [],
      timestamp: "2024-01-01T00:00:00Z", // Fixed timestamp
    };

    await bus.emit(event);
    await bus.emit(event); // Duplicate

    expect(received.length).toBe(1);
  });
});

// ─── Memory Store Tests ────────────────────────────────────────────────

describe("MemoryStore", () => {
  let db: Database;
  let store: MemoryStore;
  const lifecycle = new EngramLifecycle();

  beforeEach(async () => {
    cleanup();
    db = createDatabase(TEST_DB);
    db.init();
    store = new MemoryStore(db);
    await store.init();
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("should create and retrieve engrams", async () => {
    const engram = lifecycle.create({
      content: "Building X has 5 floors",
      data: { buildingId: "B-001" },
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "pirkimai-ai",
      origin: { type: "conversation", productId: "pirkimai-ai" },
    });

    await store.createEngram(engram);
    const retrieved = await store.getEngram(engram.id, "t1");

    expect(retrieved).toBeTruthy();
    expect(retrieved!.content).toBe("Building X has 5 floors");
    expect(retrieved!.kind).toBe("fact");
    expect(retrieved!.tenantId).toBe("t1");
    expect((retrieved!.data as Record<string, unknown>).buildingId).toBe("B-001");
  });

  it("should enforce tenant scoping on get", async () => {
    const engram = lifecycle.create({
      content: "Secret data",
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });

    await store.createEngram(engram);
    const wrongTenant = await store.getEngram(engram.id, "wrong-tenant");
    expect(wrongTenant).toBeUndefined();
  });

  it("should update engram fields", async () => {
    const engram = lifecycle.create({
      content: "Test",
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });

    await store.createEngram(engram);
    await store.updateEngram(engram.id, "t1", {
      activation: 0.5,
      stage: "working",
      accessCount: 3,
    });

    const updated = await store.getEngram(engram.id, "t1");
    expect(updated!.activation).toBe(0.5);
    expect(updated!.stage).toBe("working");
    expect(updated!.accessCount).toBe(3);
  });

  it("should delete engrams and their associations", async () => {
    const e1 = lifecycle.create({
      content: "E1", kind: "fact", tenantId: "t1", userId: "u1", productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });
    const e2 = lifecycle.create({
      content: "E2", kind: "fact", tenantId: "t1", userId: "u1", productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });

    await store.createEngram(e1);
    await store.createEngram(e2);
    await store.createAssociation({
      sourceId: e1.id, targetId: e2.id, strength: 0.5, type: "semantic",
      coAccessCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    await store.deleteEngram(e1.id, "t1");
    expect(await store.getEngram(e1.id, "t1")).toBeUndefined();

    // Association should be cleaned up too
    const assocs = await store.getAssociationsFrom(e1.id);
    expect(assocs.length).toBe(0);
  });

  it("should query engrams with privacy filtering", async () => {
    // Cross-product visible
    const e1 = lifecycle.create({
      content: "Visible", kind: "fact", tenantId: "t1", userId: "u1", productId: "p1",
      origin: { type: "conversation", productId: "p1" }, privacy: "cross_product",
    });
    // Product-only
    const e2 = lifecycle.create({
      content: "Product only", kind: "fact", tenantId: "t1", userId: "u1", productId: "p1",
      origin: { type: "conversation", productId: "p1" }, privacy: "product",
    });
    // User-private
    const e3 = lifecycle.create({
      content: "User private", kind: "fact", tenantId: "t1", userId: "u1", productId: "p1",
      origin: { type: "conversation", productId: "p1" }, privacy: "user_private",
    });

    await store.createEngram(e1);
    await store.createEngram(e2);
    await store.createEngram(e3);

    // Query from different product
    const results = await store.queryEngrams({
      tenantId: "t1", userId: "u1", productId: "p2",
    });

    // Should see cross_product and user_private (same user), NOT product-only
    const ids = results.map((r) => r.id);
    expect(ids).toContain(e1.id);
    expect(ids).not.toContain(e2.id);
    expect(ids).toContain(e3.id);
  });

  it("should create and query associations", async () => {
    const now = new Date().toISOString();
    await store.createAssociation({
      sourceId: "e1", targetId: "e2", strength: 0.7, type: "semantic",
      coAccessCount: 0, createdAt: now, updatedAt: now,
    });

    const from = await store.getAssociationsFrom("e1");
    expect(from.length).toBe(1);
    expect(from[0].targetId).toBe("e2");
    expect(from[0].strength).toBe(0.7);

    const to = await store.getAssociationsTo("e2");
    expect(to.length).toBe(1);
    expect(to[0].sourceId).toBe("e1");
  });

  it("should reinforce associations (Hebbian)", async () => {
    const now = new Date().toISOString();
    await store.createAssociation({
      sourceId: "e1", targetId: "e2", strength: 0.5, type: "co-access",
      coAccessCount: 1, createdAt: now, updatedAt: now,
    });

    await store.reinforceAssociation("e1", "e2", 0.1);

    const assocs = await store.getAssociationsFrom("e1");
    expect(assocs[0].strength).toBeGreaterThan(0.5);
    expect(assocs[0].coAccessCount).toBe(2);
  });

  it("should collect garbage", async () => {
    const expired = lifecycle.create({
      content: "Expired", kind: "fact", tenantId: "t1", userId: "u1", productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });
    // Set to already expired
    expired.expiresAt = new Date(Date.now() - 1000).toISOString();
    await store.createEngram(expired);

    const count = await store.garbageCollect("t1", 0.05);
    expect(count).toBe(1);
    expect(await store.getEngram(expired.id, "t1")).toBeUndefined();
  });
});

// ─── Associative Graph Tests ───────────────────────────────────────────

describe("AssociativeGraph", () => {
  let db: Database;
  let store: MemoryStore;
  let graph: AssociativeGraph;

  beforeEach(async () => {
    cleanup();
    db = createDatabase(TEST_DB);
    db.init();
    store = new MemoryStore(db);
    await store.init();
    graph = new AssociativeGraph(store, BASE_CONFIG.graph);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("should reinforce associations between co-accessed engrams", async () => {
    // Create initial associations
    const now = new Date().toISOString();
    await store.createAssociation({
      sourceId: "e1", targetId: "e2", strength: 0.3, type: "co-access",
      coAccessCount: 0, createdAt: now, updatedAt: now,
    });
    await store.createAssociation({
      sourceId: "e2", targetId: "e1", strength: 0.3, type: "co-access",
      coAccessCount: 0, createdAt: now, updatedAt: now,
    });

    const reinforced = await graph.hebbianReinforce(["e1", "e2", "e3"]);

    // e1↔e2, e1↔e3, e2↔e3 = 6 bidirectional reinforcements
    expect(reinforced).toBe(6);
  });

  it("should compute gravity correctly", () => {
    const lifecycle = new EngramLifecycle();
    const engram = lifecycle.create({
      content: "High gravity engram",
      kind: "fact",
      tenantId: "t1",
      userId: "u1",
      productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });

    // Fresh, high activation = high gravity
    const gravity1 = graph.computeGravity(engram);
    expect(gravity1).toBeGreaterThan(0.5);

    // Old, low activation = low gravity
    const oldEngram = {
      ...engram,
      activation: 0.1,
      accessCount: 1,
      lastAccessedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    };
    const gravity2 = graph.computeGravity(oldEngram);
    expect(gravity2).toBeLessThan(gravity1);

    // High access count boosts gravity
    const popularEngram = { ...engram, accessCount: 100 };
    const gravity3 = graph.computeGravity(popularEngram);
    expect(gravity3).toBeGreaterThan(gravity1);
  });

  it("should form entity associations", async () => {
    const lifecycle = new EngramLifecycle();

    const e1 = lifecycle.create({
      content: "Building X procurement",
      data: { buildingId: "B-001" },
      kind: "fact", tenantId: "t1", userId: "u1", productId: "p1",
      origin: { type: "conversation", productId: "p1" },
    });
    await store.createEngram(e1);

    const e2 = lifecycle.create({
      content: "Building X maintenance",
      data: { buildingId: "B-001" }, // Same entity!
      kind: "fact", tenantId: "t1", userId: "u1", productId: "p2",
      origin: { type: "conversation", productId: "p2" },
    });

    const formed = await graph.formEntityAssociations(e2, [e1]);
    expect(formed.length).toBe(1);
    expect(formed[0].type).toBe("entity");
    expect(formed[0].strength).toBe(0.7);
  });
});

// ─── Cross-Product Memory Integration Tests ───────────────────────────

describe("CrossProductMemory", () => {
  let db: Database;
  let memory: CrossProductMemory;

  beforeEach(async () => {
    cleanup();
    db = createDatabase(TEST_DB);
    db.init();
    // No embedding provider in tests (no OpenAI key)
    memory = new CrossProductMemory(db, BASE_CONFIG);
    await memory.init();
  });

  afterEach(async () => {
    await memory.shutdown();
    db.close();
    cleanup();
  });

  it("should remember and recall engrams", async () => {
    await memory.remember({
      content: "Building X at Gedimino pr. 1 has 5 floors",
      data: { buildingId: "B-001" },
      kind: "fact",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
    });

    // Recall from same product
    const results = await memory.recall({
      query: "building",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      minScore: 0, // No embedding = low semantic score, so lower threshold
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].engram.content).toContain("Building X");
  });

  it("should enforce product manifest emit permissions", async () => {
    await expect(
      memory.remember({
        content: "Test",
        kind: "relationship", // pirkimai-ai can't emit relationships
        productId: "pirkimai-ai",
        userId: "u1",
        tenantId: "t1",
      })
    ).rejects.toThrow("not configured to emit");
  });

  it("should reject recall from unregistered products", async () => {
    await expect(
      memory.recall({
        query: "test",
        productId: "unknown-product",
        userId: "u1",
        tenantId: "t1",
      })
    ).rejects.toThrow("not registered");
  });

  it("should emit events on remember", async () => {
    const events: ContextEvent[] = [];
    memory.subscribe("bendrija-os", ["engram.created"], (event) => {
      events.push(event);
    });

    await memory.remember({
      content: "Test event",
      kind: "fact",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
    });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("engram.created");
    expect(events[0].engrams[0].content).toBe("Test event");
  });

  it("should support GDPR forget user", async () => {
    // Store multiple memories for a user
    await memory.remember({
      content: "Memory 1", kind: "fact", productId: "pirkimai-ai",
      userId: "u1", tenantId: "t1",
    });
    await memory.remember({
      content: "Memory 2", kind: "entity", productId: "pirkimai-ai",
      userId: "u1", tenantId: "t1",
    });

    const deleted = await memory.forgetUser("u1", "t1");
    expect(deleted).toBe(2);

    // Verify they're gone
    const results = await memory.recall({
      query: "anything",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      minScore: 0,
    });
    expect(results.length).toBe(0);
  });

  it("should format recallAsContext correctly", async () => {
    await memory.remember({
      content: "Building X needs HVAC repair",
      kind: "fact",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
    });

    const context = await memory.recallAsContext({
      query: "building",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      minScore: 0,
    });

    expect(context).toContain("Cross-Product Context");
    expect(context).toContain("HVAC repair");
  });

  it("should get memory statistics", async () => {
    await memory.remember({
      content: "Stat test", kind: "fact", productId: "pirkimai-ai",
      userId: "u1", tenantId: "t1",
    });

    const stats = await memory.getStats("t1");
    expect(stats.engramsByStage.ephemeral).toBe(1);
    expect(stats.engramsByKind.fact).toBe(1);
    expect(stats.engramsByProduct["pirkimai-ai"]).toBe(1);
    expect(stats.recentCreations).toBe(1);
  });

  it("should register new products dynamically", async () => {
    const newProduct: ProductManifest = {
      productId: "new-app",
      name: "New App",
      emits: ["fact"],
      subscribes: ["fact"],
      maxPrivacy: "cross_product",
      canReadSensitive: false,
      domains: ["new-domain"],
    };

    memory.registerProduct(newProduct);

    // Should now be able to remember from new product
    await memory.remember({
      content: "From new app",
      kind: "fact",
      productId: "new-app",
      userId: "u1",
      tenantId: "t1",
    });

    const results = await memory.recall({
      query: "new",
      productId: "new-app",
      userId: "u1",
      tenantId: "t1",
      minScore: 0,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  it("should form entity associations across products", async () => {
    // Product A stores a memory about Building B-001
    await memory.remember({
      content: "Building B-001 tender submitted",
      data: { buildingId: "B-001" },
      kind: "fact",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
    });

    // Product B stores a memory about the SAME building
    await memory.remember({
      content: "Building B-001 inspection due",
      data: { buildingId: "B-001" },
      kind: "fact",
      productId: "bendrija-os",
      userId: "u1",
      tenantId: "t1",
    });

    // Both should be recalled when querying either product
    const results = await memory.recall({
      query: "building B-001",
      productId: "pirkimai-ai",
      userId: "u1",
      tenantId: "t1",
      minScore: 0,
    });

    // We should get results (entity association formed)
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
