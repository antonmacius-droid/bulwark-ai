import type { ChatMessage } from "../types";

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
