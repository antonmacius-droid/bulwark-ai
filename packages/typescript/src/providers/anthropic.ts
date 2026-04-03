import Anthropic from "@anthropic-ai/sdk";
import type { ProviderConfig } from "../types";
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk } from "./base";
import { validateBaseUrl } from "./base";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(config: ProviderConfig) {
    if (config.baseUrl) validateBaseUrl(config.baseUrl);
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const systemMessage = request.messages.find(m => m.role === "system");
    const messages = request.messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response = await this.client.messages.create({
      model: request.model, system: systemMessage?.content, messages,
      max_tokens: request.maxTokens || 4096, temperature: request.temperature,
      top_p: request.topP, stop_sequences: request.stop,
    });

    const content = response.content
      .filter(block => block.type === "text")
      .map(block => (block as { type: "text"; text: string }).text)
      .join("");

    return {
      content,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.input_tokens + response.usage.output_tokens },
      finishReason: response.stop_reason || undefined,
    };
  }

  async *chatStream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const systemMessage = request.messages.find(m => m.role === "system");
    const messages = request.messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    const stream = this.client.messages.stream({
      model: request.model, system: systemMessage?.content, messages,
      max_tokens: request.maxTokens || 4096, temperature: request.temperature,
      top_p: request.topP, stop_sequences: request.stop,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { content: event.delta.text, done: false };
      }
      if (event.type === "message_stop") {
        const finalMessage = await stream.finalMessage();
        yield {
          content: "", done: true,
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
            totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
          },
        };
      }
    }
  }
}
