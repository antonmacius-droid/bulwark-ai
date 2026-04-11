/**
 * Event Bus — Cross-Product Context Propagation
 *
 * Products don't poll for context — they subscribe to events and get
 * notified when relevant context is created/updated/promoted.
 *
 * Design:
 * - In-process pub/sub (same Node.js process = zero network overhead)
 * - Async handlers with error isolation (one handler failing doesn't block others)
 * - Backpressure: event queue with configurable max depth
 * - Event deduplication: same event won't fire twice in the same tick
 *
 * For distributed deployments (multiple processes/pods), this can be
 * backed by Redis Pub/Sub or NATS — the interface stays the same.
 */

import type { ContextEvent, ContextEventType, ContextEventHandler } from "./types";

/** Max events in the pending queue before dropping oldest */
const DEFAULT_MAX_QUEUE_DEPTH = 1000;

/** Max time to wait for a handler to complete (ms) */
const HANDLER_TIMEOUT_MS = 5000;

interface Subscription {
  id: string;
  productId: string;
  eventTypes: ContextEventType[] | "*";
  handler: ContextEventHandler;
}

export class ContextEventBus {
  private subscriptions: Subscription[] = [];
  private pendingQueue: ContextEvent[] = [];
  private processing = false;
  private readonly maxQueueDepth: number;
  private seenEvents = new Set<string>();
  private nextSubId = 0;

  constructor(opts?: { maxQueueDepth?: number }) {
    this.maxQueueDepth = opts?.maxQueueDepth || DEFAULT_MAX_QUEUE_DEPTH;
  }

  /**
   * Subscribe to context events.
   *
   * @param productId - Product subscribing
   * @param eventTypes - Event types to listen for, or "*" for all
   * @param handler - Async handler function
   * @returns Subscription ID for unsubscribe
   */
  subscribe(
    productId: string,
    eventTypes: ContextEventType[] | "*",
    handler: ContextEventHandler
  ): string {
    const id = `sub-${this.nextSubId++}`;
    this.subscriptions.push({ id, productId, eventTypes, handler });
    return id;
  }

  /**
   * Unsubscribe from events.
   */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== subscriptionId);
  }

  /**
   * Emit a context event — routes to all matching subscribers.
   *
   * Events are processed asynchronously. If the queue is full,
   * the oldest event is dropped (backpressure).
   */
  async emit(event: ContextEvent): Promise<void> {
    // Deduplication: prevent same event from firing twice in rapid succession
    const eventKey = `${event.type}:${event.engrams.map((e) => e.id).join(",")}:${event.timestamp}`;
    if (this.seenEvents.has(eventKey)) return;
    this.seenEvents.add(eventKey);

    // Cleanup seen events periodically (keep last 500)
    if (this.seenEvents.size > 500) {
      const arr = Array.from(this.seenEvents);
      this.seenEvents = new Set(arr.slice(arr.length - 250));
    }

    // Backpressure: drop oldest if queue is full
    if (this.pendingQueue.length >= this.maxQueueDepth) {
      this.pendingQueue.shift();
    }

    this.pendingQueue.push(event);
    await this.processQueue();
  }

  /**
   * Get all subscription IDs for a product.
   */
  getProductSubscriptions(productId: string): string[] {
    return this.subscriptions
      .filter((s) => s.productId === productId)
      .map((s) => s.id);
  }

  /**
   * Get count of pending events.
   */
  get pendingCount(): number {
    return this.pendingQueue.length;
  }

  /**
   * Get count of subscriptions.
   */
  get subscriptionCount(): number {
    return this.subscriptions.length;
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.pendingQueue.length > 0) {
        const event = this.pendingQueue.shift()!;
        await this.dispatch(event);
      }
    } finally {
      this.processing = false;
    }
  }

  private async dispatch(event: ContextEvent): Promise<void> {
    const matching = this.subscriptions.filter((sub) => {
      // Don't send events back to the originating product
      if (sub.productId === event.productId) return false;

      // Check event type filter
      if (sub.eventTypes === "*") return true;
      return sub.eventTypes.includes(event.type);
    });

    // Fire all handlers concurrently with timeout + error isolation
    const promises = matching.map(async (sub) => {
      try {
        await Promise.race([
          sub.handler(event),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Handler timeout: ${sub.id}`)), HANDLER_TIMEOUT_MS)
          ),
        ]);
      } catch (err) {
        // Error isolation: log but don't propagate.
        // One product's handler failure must never affect another product.
        console.warn(
          `[bulwark-memory] Event handler error in ${sub.productId} (${sub.id}):`,
          err instanceof Error ? err.message : err
        );
      }
    });

    await Promise.all(promises);
  }
}
