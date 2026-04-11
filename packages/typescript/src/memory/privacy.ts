/**
 * Privacy Mesh — Multi-Layer Boundary Enforcement
 *
 * Unlike traditional RBAC which is flat (has_permission: yes/no),
 * the Privacy Mesh enforces boundaries as nested layers:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ TENANT BOUNDARY (HARD — never crossed)       │
 *   │  ┌─────────────────────────────────────────┐ │
 *   │  │ USER BOUNDARY (configurable)             │ │
 *   │  │  ┌─────────────────────────────────────┐ │ │
 *   │  │  │ PRODUCT BOUNDARY (configurable)      │ │ │
 *   │  │  │  ┌─────────────────────────────────┐ │ │ │
 *   │  │  │  │ SENSITIVITY BOUNDARY            │ │ │ │
 *   │  │  │  │ (PII = restricted routing)      │ │ │ │
 *   │  │  │  └─────────────────────────────────┘ │ │ │
 *   │  │  └─────────────────────────────────────┘ │ │
 *   │  └─────────────────────────────────────────┘ │
 *   └─────────────────────────────────────────────┘
 *
 * Each boundary layer is a FILTER, not a gate.
 * The query passes through each layer, and each layer can narrow
 * (but never widen) the result set.
 */

import type { Engram, PrivacyLevel, ProductManifest } from "./types";

/**
 * Privacy query context — describes who is asking for memories.
 */
export interface PrivacyContext {
  tenantId: string;
  userId: string;
  productId: string;
  sessionId?: string;
  /** Product manifest for the querying product */
  manifest: ProductManifest;
}

/**
 * Result of a privacy check with reason for explainability.
 */
export interface PrivacyVerdict {
  allowed: boolean;
  reason: string;
  /** Which boundary blocked access (if blocked) */
  blockedBy?: "tenant" | "user" | "product" | "sensitivity" | "kind";
}

export class PrivacyMesh {
  private readonly manifests: Map<string, ProductManifest>;

  constructor(manifests: ProductManifest[]) {
    this.manifests = new Map(manifests.map((m) => [m.productId, m]));
  }

  /**
   * Check if a specific engram is visible to the given privacy context.
   * Returns verdict with reason for explainability/audit.
   */
  check(engram: Engram, ctx: PrivacyContext): PrivacyVerdict {
    // Layer 1: TENANT BOUNDARY — absolute, non-negotiable
    if (engram.tenantId !== ctx.tenantId) {
      return { allowed: false, reason: "Tenant boundary: engram belongs to different tenant", blockedBy: "tenant" };
    }

    // Layer 2: KIND BOUNDARY — product must subscribe to this engram kind
    if (!ctx.manifest.subscribes.includes(engram.kind)) {
      return {
        allowed: false,
        reason: `Kind boundary: product '${ctx.productId}' does not subscribe to '${engram.kind}' engrams`,
        blockedBy: "kind",
      };
    }

    // Layer 3: PRIVACY LEVEL BOUNDARY
    const privacyVerdict = this.checkPrivacyLevel(engram, ctx);
    if (!privacyVerdict.allowed) return privacyVerdict;

    // Layer 4: SENSITIVITY BOUNDARY
    if (engram.sensitive && !ctx.manifest.canReadSensitive && engram.productId !== ctx.productId) {
      return {
        allowed: false,
        reason: `Sensitivity boundary: engram is sensitive, product '${ctx.productId}' cannot read cross-product sensitive data`,
        blockedBy: "sensitivity",
      };
    }

    return { allowed: true, reason: "All privacy boundaries passed" };
  }

  /**
   * Filter a list of engrams through the privacy mesh.
   * Returns only the engrams visible to the given context.
   */
  filter(engrams: Engram[], ctx: PrivacyContext): Engram[] {
    return engrams.filter((engram) => this.check(engram, ctx).allowed);
  }

  /**
   * Check if a product can emit a given engram kind.
   */
  canEmit(productId: string, kind: string): boolean {
    const manifest = this.manifests.get(productId);
    if (!manifest) return false;
    return manifest.emits.includes(kind as Engram["kind"]);
  }

  /**
   * Get the maximum privacy level a product can assign to its engrams.
   */
  getMaxPrivacy(productId: string): PrivacyLevel {
    const manifest = this.manifests.get(productId);
    return manifest?.maxPrivacy || "user_private";
  }

  /**
   * Check if a product is registered in the mesh.
   */
  hasProduct(productId: string): boolean {
    return this.manifests.has(productId);
  }

  /**
   * Get product manifest.
   */
  getManifest(productId: string): ProductManifest | undefined {
    return this.manifests.get(productId);
  }

  /**
   * Register or update a product manifest.
   */
  registerProduct(manifest: ProductManifest): void {
    this.manifests.set(manifest.productId, manifest);
  }

  /**
   * Get all product IDs that subscribe to a given engram kind.
   * Used by event bus to route context events.
   */
  getSubscribers(kind: string): string[] {
    const subscribers: string[] = [];
    for (const [productId, manifest] of this.manifests) {
      if (manifest.subscribes.includes(kind as Engram["kind"])) {
        subscribers.push(productId);
      }
    }
    return subscribers;
  }

  /**
   * Check whether two products share overlapping domains.
   * Products with domain overlap get higher routing priority.
   */
  domainOverlap(productA: string, productB: string): number {
    const a = this.manifests.get(productA);
    const b = this.manifests.get(productB);
    if (!a || !b) return 0;

    const setA = new Set(a.domains);
    const intersection = b.domains.filter((d) => setA.has(d));

    if (a.domains.length === 0 || b.domains.length === 0) return 0;

    // Jaccard similarity
    const union = new Set([...a.domains, ...b.domains]);
    return intersection.length / union.size;
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private checkPrivacyLevel(engram: Engram, ctx: PrivacyContext): PrivacyVerdict {
    switch (engram.privacy) {
      case "session":
        // Only visible in the originating session.
        // If no sessionId on the engram or context, fall back to user+product match.
        if (engram.sessionId && ctx.sessionId && engram.sessionId !== ctx.sessionId) {
          return {
            allowed: false,
            reason: "Privacy: session-scoped engram not visible outside originating session",
            blockedBy: "user",
          };
        }
        // Session engrams are always restricted to same user + same product
        if (engram.userId !== ctx.userId || engram.productId !== ctx.productId) {
          return {
            allowed: false,
            reason: "Privacy: session-scoped engram restricted to same user and product",
            blockedBy: "user",
          };
        }
        return { allowed: true, reason: "Same session context" };

      case "user_private":
        // Visible to the creating user across any product
        if (engram.userId !== ctx.userId) {
          return {
            allowed: false,
            reason: "Privacy: user-private engram not visible to other users",
            blockedBy: "user",
          };
        }
        return { allowed: true, reason: "Same user" };

      case "product":
        // Visible to all users of the originating product within tenant
        if (engram.productId !== ctx.productId) {
          return {
            allowed: false,
            reason: `Privacy: product-scoped engram from '${engram.productId}' not visible to '${ctx.productId}'`,
            blockedBy: "product",
          };
        }
        return { allowed: true, reason: "Same product" };

      case "cross_product":
        // Visible across all products within tenant
        return { allowed: true, reason: "Cross-product visibility" };

      default:
        return { allowed: false, reason: `Unknown privacy level: ${engram.privacy}`, blockedBy: "product" };
    }
  }
}
