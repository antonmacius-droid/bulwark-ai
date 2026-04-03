import type { ProviderConfig } from "../types";
import type { LLMProvider, LLMRequest, LLMResponse } from "./base";
import { validateBaseUrl } from "./base";

/**
 * Mistral AI provider — EU-based LLM (France).
 * Uses OpenAI-compatible API format.
 */
export class MistralProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    if (config.baseUrl) validateBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.mistral.ai/v1";
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(m => ({ role: m.role, content: m.content })),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stop: request.stop,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Mistral API error (${response.status}): ${err}`);
    }

    const data = await response.json() as {
      choices: { message: { content: string }; finish_reason: string }[];
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content || "",
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      finishReason: data.choices[0]?.finish_reason,
    };
  }
}
