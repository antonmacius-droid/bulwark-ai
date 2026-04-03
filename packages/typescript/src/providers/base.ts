import type { ChatMessage } from "../types";

/** SECURITY: Validate provider baseUrl to prevent SSRF */
export function validateBaseUrl(url: string): void {
  try {
    const parsed = new URL(url);
    // Block non-HTTPS (except localhost for dev)
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !isLocalhost) {
      throw new Error(`Insecure protocol: ${parsed.protocol}. Use HTTPS.`);
    }
    // Block cloud metadata endpoints
    const blockedHosts = ["169.254.169.254", "metadata.google.internal", "100.100.100.200"];
    if (blockedHosts.includes(parsed.hostname)) {
      throw new Error(`Blocked host: ${parsed.hostname}`);
    }
    // Block private IP ranges (10.x, 172.16-31.x, 192.168.x) unless localhost
    if (!isLocalhost) {
      const parts = parsed.hostname.split(".").map(Number);
      if (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) {
        throw new Error(`Private IP blocked: ${parsed.hostname}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("blocked") || err instanceof Error && err.message.includes("Insecure")) throw err;
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
