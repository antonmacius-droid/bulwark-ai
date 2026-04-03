/**
 * SSE Streaming support for chat responses.
 * Wraps provider streaming with governance checks (PII, policies, audit).
 *
 * @example
 * ```ts
 * // Express endpoint
 * app.post("/api/ai/stream", async (req, res) => {
 *   res.setHeader("Content-Type", "text/event-stream");
 *   res.setHeader("Cache-Control", "no-cache");
 *   res.setHeader("Connection", "keep-alive");
 *
 *   const stream = gateway.chatStream({ model: "gpt-4o", messages: req.body.messages, userId: "user-1" });
 *   for await (const event of stream) {
 *     res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
 *   }
 *   res.write("event: done\ndata: {}\n\n");
 *   res.end();
 * });
 * ```
 */

export interface StreamEvent {
  type: "delta" | "sources" | "pii_warning" | "error" | "usage" | "done";
  data: {
    content?: string;
    sources?: { content: string; source: string; score: number }[];
    piiTypes?: string[];
    error?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    cost?: { input: number; output: number; total: number };
    auditId?: string;
    durationMs?: number;
  };
}

/**
 * Creates an async iterable of stream events.
 * Pre-flight checks (PII, policies, budget, rate limit) run before streaming starts.
 * Token counting and audit logging happen after stream completes.
 */
export async function* createStreamAdapter(
  providerStream: AsyncIterable<string>,
  metadata: {
    piiWarnings?: string[];
    sources?: { content: string; source: string; score: number }[];
  }
): AsyncGenerator<StreamEvent> {
  // Emit sources first if RAG was used
  if (metadata.sources && metadata.sources.length > 0) {
    yield { type: "sources", data: { sources: metadata.sources } };
  }

  // Emit PII warnings
  if (metadata.piiWarnings && metadata.piiWarnings.length > 0) {
    yield { type: "pii_warning", data: { piiTypes: metadata.piiWarnings } };
  }

  // Stream content deltas
  for await (const chunk of providerStream) {
    yield { type: "delta", data: { content: chunk } };
  }
}
