/**
 * Nomin Code: NVIDIA NIM Provider Plugin
 * Endpoint: https://integrate.api.nvidia.com/v1
 * Fully OpenAI-compatible chat completions and model listing with native thinking token support.
 */

import { ProviderPlugin, RateLimitInfo } from '../plugin-interface.js';
import { DiscoveredModel, ChatCompletionOptions, StreamChunk, ModelSettings } from '../types.js';
import { NominHttpClient } from '../client.js';
import { LiveCatalogManager } from '../live-catalog.js';
import { ErrorClassifier, ClassifiedError } from '../error-classifier.js';
import { ModelSettingsManager } from '../model-settings.js';

export class NvidiaNimProvider implements ProviderPlugin {
  public readonly id = 'nim';
  public readonly name = 'NVIDIA NIM';
  public readonly defaultBaseUrl = 'https://integrate.api.nvidia.com/v1';

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
    if (lower['x-ratelimit-remaining-requests']) {
      info.remainingRequests = parseInt(lower['x-ratelimit-remaining-requests'], 10);
    }
    if (lower['x-ratelimit-remaining-tokens']) {
      info.remainingTokens = parseInt(lower['x-ratelimit-remaining-tokens'], 10);
    }
    return info;
  }
}
