/**
 * Nomin Code: Anthropic Claude Provider Plugin
 * Endpoint: https://api.anthropic.com/v1
 */

import { ProviderPlugin, RateLimitInfo } from '../plugin-interface.js';
import { DiscoveredModel, ChatCompletionOptions, StreamChunk, ModelSettings } from '../types.js';
import { NominHttpClient } from '../client.js';
import { LiveCatalogManager } from '../live-catalog.js';
import { ErrorClassifier, ClassifiedError } from '../error-classifier.js';

export class AnthropicProvider implements ProviderPlugin {
  public readonly id = 'anthropic';
  public readonly name = 'Anthropic Claude';
  public readonly defaultBaseUrl = 'https://api.anthropic.com/v1';

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
    if (lower['anthropic-ratelimit-requests-remaining']) {
      info.remainingRequests = parseInt(lower['anthropic-ratelimit-requests-remaining'], 10);
    }
    if (lower['anthropic-ratelimit-tokens-remaining']) {
      info.remainingTokens = parseInt(lower['anthropic-ratelimit-tokens-remaining'], 10);
    }
    return info;
  }
}
