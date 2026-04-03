import OpenAI from "openai";
import type { ProviderConfig } from "../types";
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk } from "./base";
import { validateBaseUrl } from "./base";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    if (config.baseUrl) validateBaseUrl(config.baseUrl);
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages.map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stop,
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content || "",
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      finishReason: choice?.finish_reason || undefined,
    };
  }

  async *chatStream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages.map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stop,
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      const done = chunk.choices[0]?.finish_reason !== null && chunk.choices[0]?.finish_reason !== undefined;

      yield {
        content: delta,
        done,
        usage: chunk.usage ? {
          inputTokens: chunk.usage.prompt_tokens || 0,
          outputTokens: chunk.usage.completion_tokens || 0,
          totalTokens: chunk.usage.total_tokens || 0,
        } : undefined,
      };
    }
  }
}
