import type { ProviderConfig } from "../types";
import type { LLMProvider, LLMRequest, LLMResponse } from "./base";
import { validateBaseUrl } from "./base";

/**
 * Google Vertex AI / Gemini provider.
 * Uses the Gemini REST API format.
 *
 * @example
 * ```ts
 * providers: {
 *   google: { apiKey: process.env.GOOGLE_AI_KEY! }
 * }
 * ```
 */
export class GoogleProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    if (config.baseUrl) validateBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || "gemini-2.0-flash";

    // Convert OpenAI format to Gemini format
    const systemInstruction = request.messages.find(m => m.role === "system");
    const contents = request.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    // SECURITY: API key in header, not URL (avoids key appearing in logs/proxies)
    const response = await fetch(`${this.baseUrl}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents,
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction.content }] } : undefined,
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          topP: request.topP,
          stopSequences: request.stop,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google AI error (${response.status}): ${err}`);
    }

    const data = await response.json() as {
      candidates: { content: { parts: { text: string }[] }; finishReason: string }[];
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
    };

    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";

    return {
      content: text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      finishReason: data.candidates?.[0]?.finishReason,
    };
  }
}
