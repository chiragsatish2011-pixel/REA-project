/**
 * Nomin Code: DeepSeek Official API Provider Plugin
 * Endpoint: https://api.deepseek.com/v1
 */

import { ProviderPlugin, RateLimitInfo } from '../plugin-interface.js';
import { DiscoveredModel, ChatCompletionOptions, StreamChunk, ModelSettings } from '../types.js';
import { NominHttpClient } from '../client.js';
import { LiveCatalogManager } from '../live-catalog.js';
import { ErrorClassifier, ClassifiedError } from '../error-classifier.js';

export class DeepSeekProvider implements ProviderPlugin {
  public readonly id = 'deepseek';
  public readonly name = 'DeepSeek Official API';
  public readonly defaultBaseUrl = 'https://api.deepseek.com/v1';

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
