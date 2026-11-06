/**
 * Nomin Code: Generic OpenAI-Compatible Provider Plugin
 * Supports Ollama, vLLM, Groq, OpenRouter, and custom self-hosted endpoints.
 */

import { ProviderPlugin, RateLimitInfo } from '../plugin-interface.js';
import { DiscoveredModel, ChatCompletionOptions, StreamChunk, ModelSettings } from '../types.js';
import { NominHttpClient } from '../client.js';
import { LiveCatalogManager } from '../live-catalog.js';
import { ErrorClassifier, ClassifiedError } from '../error-classifier.js';

export class GenericOpenAiCompatibleProvider implements ProviderPlugin {
  public readonly id: string;
  public readonly name: string;
  public readonly defaultBaseUrl: string;

  constructor(id: string = 'custom', name: string = 'Custom Endpoint', defaultBaseUrl: string = 'http://127.0.0.1:8000/v1') {
    this.id = id;
    this.name = name;
    this.defaultBaseUrl = defaultBaseUrl;
  }

  public async listModels(client: NominHttpClient): Promise<DiscoveredModel[]> {
    return LiveCatalogManager.fetchLiveModels(client, { forceRefresh: true });
  }

  public async *chatStream(
    client: NominHttpClient,
    options: ChatCompletionOptions,
    settings?: ModelSettings
  ): AsyncGenerator<StreamChunk> {
    yield* client.chatStream(options);
  }

  public classifyError(error: unknown, modelId?: string): ClassifiedError {
    return ErrorClassifier.classify(error, {
      providerId: this.id,
      modelId,
      endpointUrl: this.defaultBaseUrl,
    });
  }

  public parseRateLimitHeaders(headers: Record<string, string>): RateLimitInfo {
    const info: RateLimitInfo = {};
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      lower[k.toLowerCase()] = String(v);
    }

    if (lower['retry-after']) {
      const sec = parseFloat(lower['retry-after']);
      if (!isNaN(sec)) info.retryAfterMs = Math.round(sec * 1000);
    }
    return info;
  }
}
