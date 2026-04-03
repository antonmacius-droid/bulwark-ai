import type { ProviderConfig } from "../types";
import type { LLMProvider, LLMRequest, LLMResponse } from "./base";

/**
 * Azure OpenAI provider — for enterprises using Azure's managed OpenAI service.
 * Requires: resourceName, deploymentName, apiVersion in config.
 *
 * @example
 * ```ts
 * providers: {
 *   custom: {
 *     apiKey: process.env.AZURE_OPENAI_KEY!,
 *     baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT",
 *   }
 * }
 * ```
 */
export class AzureOpenAIProvider implements LLMProvider {
  private apiKey: string;
  private endpoint: string;
  private apiVersion: string;

  constructor(config: ProviderConfig & { apiVersion?: string }) {
    this.apiKey = config.apiKey;
    this.endpoint = config.baseUrl || "";
    this.apiVersion = config.apiVersion || "2024-10-21";

    if (!this.endpoint) throw new Error("Azure OpenAI requires baseUrl (endpoint URL)");
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const url = `${this.endpoint}/chat/completions?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": this.apiKey,
      },
      body: JSON.stringify({
        messages: request.messages.map(m => ({ role: m.role, content: m.content })),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stop: request.stop,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Azure OpenAI error (${response.status}): ${err}`);
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
