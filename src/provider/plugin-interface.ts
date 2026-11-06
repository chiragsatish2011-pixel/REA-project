/**
 * Nomin Code: Universal Provider Plugin Interface
 * Clean architectural boundary for LLM providers (NVIDIA NIM, OpenAI, Anthropic, DeepSeek, Ollama/vLLM).
 * Guarantees consistent model discovery, streaming, error classification, and rate limit parsing.
 */

import { DiscoveredModel, ChatCompletionOptions, StreamChunk, ModelSettings } from './types.js';
import { NominHttpClient } from './client.js';
import { ClassifiedError } from './error-classifier.js';

export interface RateLimitInfo {
  remainingRequests?: number;
  remainingTokens?: number;
  resetRequestsMs?: number;
  resetTokensMs?: number;
  retryAfterMs?: number;
}

export interface ProviderPlugin {
  readonly id: string;
  readonly name: string;
  readonly defaultBaseUrl: string;

  /**
   * Discovers all available models from the provider's live endpoint.
   */
  listModels(client: NominHttpClient): Promise<DiscoveredModel[]>;

  /**
   * Executes a streaming chat completion.
   */
  chatStream(
    client: NominHttpClient,
    options: ChatCompletionOptions,
    settings?: ModelSettings
  ): AsyncGenerator<StreamChunk>;

  /**
   * Classifies an error thrown by this provider into a structured ClassifiedError.
   */
  classifyError(error: unknown, modelId?: string): ClassifiedError;

  /**
   * Extracts rate limit and reset timestamps from HTTP response headers.
   */
  parseRateLimitHeaders(headers: Record<string, string>): RateLimitInfo;
}
