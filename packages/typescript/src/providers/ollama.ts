import type { ProviderConfig } from "../types";
import type { LLMProvider, LLMRequest, LLMResponse } from "./base";
import { validateBaseUrl } from "./base";

/**
 * Ollama provider — run LLMs locally (Llama, Mistral, Phi, etc).
 * Zero data leaves your machine. Perfect for maximum privacy.
 *
 * @example
 * ```ts
 * providers: {
 *   ollama: { apiKey: "", baseUrl: "http://localhost:11434" }
 * }
 * // Then: gateway.chat({ model: "llama3.2", ... })
 * ```
 */
export class OllamaProvider implements LLMProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    if (config.baseUrl) validateBaseUrl(config.baseUrl);
    this.baseUrl = config.baseUrl || "http://localhost:11434";
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    // Convert to Ollama's chat API format
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: request.temperature,
          top_p: request.topP,
          num_predict: request.maxTokens,
          stop: request.stop,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama error (${response.status}): ${err}`);
    }

    const data = await response.json() as {
      message: { role: string; content: string };
      done: boolean;
      total_duration: number;
      eval_count: number;
      prompt_eval_count: number;
    };

    return {
      content: data.message?.content || "",
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      finishReason: data.done ? "stop" : undefined,
    };
  }
}
