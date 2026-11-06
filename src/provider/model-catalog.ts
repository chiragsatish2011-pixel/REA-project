/**
 * Nomin Code: Model Catalog Bridge & Dynamic Model Discovery Engine
 * Integrates LiveCatalogManager with live provider discovery,
 * disk caching, instant search/filter, and multi-level reasoning effort presets.
 * ZERO hardcoded models.
 */

import { LiveCatalogManager } from './live-catalog.js';
import { DiscoveredModel } from './types.js';
import { NominHttpClient } from './client.js';
import { REASONING_EFFORT_LEVELS, ReasoningEffortDescriptor } from './model-settings.js';

export * from './live-catalog.js';
export * from './model-settings.js';

export type CatalogModel = DiscoveredModel;
export const REASONING_EFFORT_PRESETS = REASONING_EFFORT_LEVELS;

export class ModelCatalogManager extends LiveCatalogManager {
  /**
   * Returns models for a given provider, prioritizing disk/memory cache.
   * Returns empty array if no live catalog has been fetched yet.
   */
  public static getCatalog(providerId: string = 'nim'): DiscoveredModel[] {
    const cached = this.loadFromCache(providerId);
    if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
      return cached.models;
    }
    return [];
  }

  /**
   * Filters and sorts the model catalog by query, category, or publisher.
   */
  public static filter(
    query?: string,
    category?: string,
    providerId: string = 'nim'
  ): DiscoveredModel[] {
    const all = this.getCatalog(providerId);
    const requiresReasoning = category === 'reasoning';
    const requiresVision = category === 'vision';
    return this.filterAndSort(all, {
      query,
      requiresReasoning,
      requiresVision,
      showAllTypes: false,
    });
  }

  /**
   * Performs dynamic live sync from provider GET /models endpoint.
   */
  public static async fetchLiveCatalog(client: NominHttpClient): Promise<DiscoveredModel[]> {
    return this.fetchLiveModels(client, { forceRefresh: true });
  }

  /**
   * Returns live discovered chat models from cache for the provider (no static hardcoded presets).
   */
  public static getPopularAlivePresets(provider: string = 'nim'): string[] {
    const cached = this.loadFromCache(provider);
    if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
      return cached.models
        .filter((m) => m.isAlive && (m.modelType === 'chat' || m.modelType === 'completion'))
        .slice(0, 10)
        .map((m) => m.id);
    }
    return [];
  }
}
