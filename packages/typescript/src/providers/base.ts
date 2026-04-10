import type { ChatMessage } from "../types";

/** SECURITY: Validate provider baseUrl to prevent SSRF */
export function validateBaseUrl(url: string): void {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // Block non-HTTPS (except localhost for dev)
    const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (parsed.protocol !== "https:" && !isLocalhost) {
      throw new Error(`Insecure protocol: ${parsed.protocol}. Use HTTPS.`);
    }
    // Block cloud metadata endpoints
    const blockedHosts = ["169.254.169.254", "metadata.google.internal", "100.100.100.200"];
    if (blockedHosts.includes(host)) {
      throw new Error(`Blocked host: ${host}`);
    }
    if (!isLocalhost) {
      // Block 0.0.0.0
      if (host === "0.0.0.0") {
        throw new Error(`Blocked host: ${host}`);
      }
      // Block IPv4 private ranges (10.x, 172.16-31.x, 192.168.x)
      const parts = host.split(".").map(Number);
      if (parts.length === 4 && !isNaN(parts[0])) {
        if (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) {
          throw new Error(`Private IP blocked: ${host}`);
        }
        // Block link-local (169.254.x.x)
        if (parts[0] === 169 && parts[1] === 254) {
          throw new Error(`Blocked host: ${host}`);
        }
      }
      // Block IPv6 private/link-local ranges
      const stripped = host.replace(/^\[/, "").replace(/\]$/, "");
      const lower = stripped.toLowerCase();
      if (lower.startsWith("fc") || lower.startsWith("fd") ||  // unique local (fc00::/7)
          lower.startsWith("fe80") ||                           // link-local
          lower === "::1" ||                                     // loopback
          lower.startsWith("::ffff:")) {                         // IPv4-mapped IPv6
        throw new Error(`Blocked IPv6 address: ${host}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes("blocked") || err.message.includes("Blocked") || err.message.includes("Insecure"))) throw err;
    throw new Error(`Invalid baseUrl: ${url}`);
  }
}

export interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
  usage?: LLMResponse["usage"];
}

export interface LLMProvider {
  chat(request: LLMRequest): Promise<LLMResponse>;
  chatStream?(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}
