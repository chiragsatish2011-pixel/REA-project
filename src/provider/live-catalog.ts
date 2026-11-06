/**
 * Nomin Code: Live Model Catalog Manager & Interactive Discovery Engine
 * 100% Dynamic — ZERO hardcoded models.
 * Fetches models live from provider GET /models endpoint with disk caching,
 * fuzzy search, publisher/capability filtering, neutral sorting, and paged terminal UI.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DiscoveredModel, ModelType, CatalogCache } from './types.js';
import { NominHttpClient } from './client.js';
import { NominLogger } from './logger.js';
import { ANSI } from '../cli/ansi.js';

export interface CatalogFilterOptions {
  query?: string;
  publisher?: string;
  showAllTypes?: boolean; // false = chat/completion only (default)
  requiresTools?: boolean;
  requiresReasoning?: boolean;
  requiresVision?: boolean;
  sortBy?: 'name' | 'publisher' | 'context' | 'recent';
  favoritesOnly?: boolean;
  favorites?: string[];
  recentlyUsed?: string[];
}

export interface PagedCatalogResult {
  items: DiscoveredModel[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  activeFilterSummary: string;
}

export function isChatCallableModel(id: string, modelType?: string): boolean {
  const lower = id.toLowerCase();
  if (/(embed|retriever|rerank|safety-guard|guard|reward|parse)/i.test(lower)) {
    return false;
  }
  if (modelType && modelType !== 'chat' && modelType !== 'completion') {
    return false;
  }
  return true;
}

export class LiveCatalogManager {
  public static isChatCallableModel(id: string, modelType?: string): boolean {
    return isChatCallableModel(id, modelType);
  }

  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private static memoryCache: Map<string, CatalogCache> = new Map();

  /**
   * Resolves the disk cache directory for catalogs (~/.nomin/catalogs).
   */
  public static getCatalogCacheDir(): string {
    const base = process.env.NOMIN_GLOBAL_DIR || path.join(os.homedir(), '.nomin');
    const catalogDir = path.join(base, 'catalogs');
    try {
      if (!fs.existsSync(catalogDir)) {
        fs.mkdirSync(catalogDir, { recursive: true });
      }
    } catch {
      const tmpDir = path.join(os.tmpdir(), '.nomin', 'catalogs');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      return tmpDir;
    }
    return catalogDir;
  }

  private static getCacheFilePath(providerId: string): string {
    const cleanId = providerId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return path.join(this.getCatalogCacheDir(), `catalog_${cleanId}.json`);
  }

  /**
   * Loads catalog from disk cache if present and non-empty.
   */
  public static loadFromCache(providerId: string): CatalogCache | null {
    if (this.memoryCache.has(providerId)) {
      return this.memoryCache.get(providerId)!;
    }

    try {
      const filePath = this.getCacheFilePath(providerId);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed: CatalogCache = JSON.parse(raw);
        if (Array.isArray(parsed.models) && parsed.models.length > 0) {
          this.memoryCache.set(providerId, parsed);
          return parsed;
        }
      }
    } catch (err) {
      NominLogger.warn(`Failed reading catalog cache for ${providerId}: ${(err as Error).message}`);
    }

    return null;
  }

  /**
   * Saves catalog to persistent disk cache.
   */
  public static saveToCache(cache: CatalogCache): void {
    try {
      this.memoryCache.set(cache.providerId, cache);
      const filePath = this.getCacheFilePath(cache.providerId);
      fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
      NominLogger.info(`Saved ${cache.models.length} models to catalog cache for ${cache.providerId}`);
    } catch (err) {
      NominLogger.warn(`Failed saving catalog cache for ${cache.providerId}: ${(err as Error).message}`);
    }
  }

  /**
   * Non-blocking background refresh for application startup.
   */
  public static triggerBackgroundRefresh(client: NominHttpClient): void {
    const providerId = client.getConfig().id || client.getProviderType();
    // Fire and forget; never throw unhandled rejection
    this.fetchLiveModels(client, { forceRefresh: false })
      .then((models) => {
        NominLogger.info(`Background refresh completed for ${providerId}: ${models.length} models discovered.`);
      })
      .catch((err) => {
        NominLogger.warn(`Background catalog refresh skipped for ${providerId}: ${err.message}`);
      });
  }

  /**
   * Fetches models live from provider. Uses disk cache unless forceRefresh is set or cache is stale.
   */
  public static async fetchLiveModels(
    client: NominHttpClient,
    options: { forceRefresh?: boolean } = {}
  ): Promise<DiscoveredModel[]> {
    const providerId = client.getConfig().id || client.getProviderType();
    const cached = this.loadFromCache(providerId);

    const isStale = !cached || (Date.now() - cached.fetchedAt > this.CACHE_TTL_MS);
    if (!options.forceRefresh && cached && !isStale) {
      return cached.models;
    }

    // Perform live network fetch
    NominLogger.info(`Fetching live model catalog from ${client.getBaseURL()} (/models)...`);
    const rawList = await client.listModels();

    const discovered: DiscoveredModel[] = rawList.map((raw) =>
      this.classifyRawModel(raw, providerId)
    );

    const newCache: CatalogCache = {
      providerId,
      baseUrl: client.getBaseURL(),
      fetchedAt: Date.now(),
      models: discovered,
    };

    this.saveToCache(newCache);
    return discovered;
  }

  /**
   * Classifies a model from raw API response into DiscoveredModel with publisher & capabilities.
   */
  public static classifyRawModel(
    raw: { id: string; object?: string; created?: number; owned_by?: string },
    providerId: string = 'nim'
  ): DiscoveredModel {
    const id = raw.id.trim();
    const lower = id.toLowerCase();

    // Publisher extraction
    let publisher = 'other';
    if (id.includes('/')) {
      publisher = id.split('/')[0];
    } else if (raw.owned_by) {
      publisher = raw.owned_by;
    } else if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3')) {
      publisher = 'openai';
    } else if (lower.startsWith('claude')) {
      publisher = 'anthropic';
    }

    // Model type classification
    let modelType: ModelType = 'chat';
    if (lower.includes('rerank')) {
      modelType = 'rerank';
    } else if (
      raw.object === 'embedding' ||
      lower.includes('embed') ||
      lower.includes('retriever') ||
      lower.includes('bge-') ||
      lower.includes('e5-')
    ) {
      modelType = 'embedding';
    } else if (lower.includes('sdxl') || lower.includes('flux') || lower.includes('stable-diffusion') || lower.includes('dall-e')) {
      modelType = 'image';
    } else if (lower.includes('whisper') || lower.includes('tts') || lower.includes('audio') || lower.includes('parler')) {
      modelType = 'audio';
    } else if (
      lower.includes('guard') ||
      lower.includes('shield') ||
      lower.includes('safety') ||
      lower.includes('moderation') ||
      lower.includes('reward')
    ) {
      modelType = 'guard';
    } else if (lower.includes('parse')) {
      modelType = 'other';
    } else if (lower.includes('base') && !lower.includes('instruct') && !lower.includes('chat')) {
      modelType = 'completion';
    }

    // Context window extraction
    let contextWindow = 128000;
    if (lower.includes('128k') || lower.includes('128000')) contextWindow = 128000;
    else if (lower.includes('200k')) contextWindow = 200000;
    else if (lower.includes('1m') || lower.includes('1000k')) contextWindow = 1000000;
    else if (lower.includes('64k') || lower.includes('65536')) contextWindow = 65536;
    else if (lower.includes('32k') || lower.includes('32768')) contextWindow = 32768;
    else if (lower.includes('16k') || lower.includes('16384')) contextWindow = 16384;
    else if (lower.includes('8k') || lower.includes('8192')) contextWindow = 8192;
    else if (lower.includes('4k') || lower.includes('4096')) contextWindow = 4096;

    // Strict non-chat check: embedding, rerank, guard, reward, parse models CANNOT chat/reason/tool-call
    const isCallableChat = isChatCallableModel(id, modelType);

    // Reasoning capability detection (only valid chat models can have reasoning)
    const supportsReasoning =
      isCallableChat &&
      (
        lower.includes('deepseek-r1') ||
        lower.includes('r1') ||
        (lower.includes('nemotron') && !lower.includes('embed')) ||
        lower.includes('o1') ||
        lower.includes('o3') ||
        lower.includes('claude-3-7') ||
        lower.includes('thinking') ||
        lower.includes('reason')
      );

    // Vision capability detection
    const supportsVision =
      isCallableChat &&
      (
        lower.includes('vision') ||
        lower.includes('vl') ||
        lower.includes('multimodal') ||
        lower.includes('omni') ||
        lower.includes('4o')
      );

    // Tool calling: general modern chat/instruct models support tools
    const supportsTools =
      isCallableChat &&
      modelType === 'chat' &&
      !lower.includes('guard') &&
      !lower.includes('embedding');

    return {
      id,
      providerId,
      publisher,
      modelType,
      object: raw.object,
      created: raw.created,
      owned_by: raw.owned_by,
      contextWindow,
      supportsTools,
      supportsReasoning,
      supportsVision,
      isAlive: true,
    };
  }

  /**
   * Filters and sorts a model list without opinionated ranking or hardcoded presets.
   * Default sorting is strictly neutral (alphabetical A-Z).
   */
  public static filterAndSort(
    models: DiscoveredModel[],
    options: CatalogFilterOptions = {}
  ): DiscoveredModel[] {
    let result = [...models];

    // Filter by type: chat/completion only by default (strictly exclude embed, guard, rerank, parse)
    if (!options.showAllTypes) {
      result = result.filter((m) => isChatCallableModel(m.id, m.modelType));
    }

    // Filter by publisher
    if (options.publisher && options.publisher !== 'all') {
      const pub = options.publisher.toLowerCase().trim();
      result = result.filter((m) => m.publisher.toLowerCase() === pub);
    }

    // Filter by tool-calling requirement
    if (options.requiresTools) {
      result = result.filter((m) => m.supportsTools);
    }

    // Filter by reasoning requirement
    if (options.requiresReasoning) {
      result = result.filter((m) => m.supportsReasoning);
    }

    // Filter by vision requirement
    if (options.requiresVision) {
      result = result.filter((m) => m.supportsVision);
    }

    // Filter favorites only
    if (options.favoritesOnly && options.favorites) {
      const favSet = new Set(options.favorites);
      result = result.filter((m) => favSet.has(m.id));
    }

    // Fuzzy text search on model ID or publisher
    if (options.query && options.query.trim()) {
      const q = options.query.toLowerCase().trim();
      result = result.filter(
        (m) => m.id.toLowerCase().includes(q) || m.publisher.toLowerCase().includes(q)
      );
    }

    // Sorting (NEUTRAL default: alphabetical)
    const sortBy = options.sortBy || 'name';
    if (sortBy === 'name') {
      result.sort((a, b) => a.id.localeCompare(b.id));
    } else if (sortBy === 'publisher') {
      result.sort((a, b) => {
        const pubComp = a.publisher.localeCompare(b.publisher);
        if (pubComp !== 0) return pubComp;
        return a.id.localeCompare(b.id);
      });
    } else if (sortBy === 'context') {
      result.sort((a, b) => (b.contextWindow || 0) - (a.contextWindow || 0));
    } else if (sortBy === 'recent' && options.recentlyUsed) {
      const recents = options.recentlyUsed;
      result.sort((a, b) => {
        const idxA = recents.indexOf(a.id);
        const idxB = recents.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.id.localeCompare(b.id);
      });
    }

    return result;
  }

  /**
   * Paginates the catalog list so 100+ entries stay snappy and smooth.
   */
  public static paginate(
    models: DiscoveredModel[],
    page: number = 1,
    pageSize: number = 15,
    options: CatalogFilterOptions = {}
  ): PagedCatalogResult {
    const filtered = this.filterAndSort(models, options);
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * pageSize;
    const items = filtered.slice(startIndex, startIndex + pageSize);

    const filters: string[] = [];
    if (options.query) filters.push(`search: "${options.query}"`);
    if (options.publisher && options.publisher !== 'all') filters.push(`publisher: ${options.publisher}`);
    if (options.showAllTypes) filters.push('all types');
    else filters.push('chat/completion only');
    if (options.requiresTools) filters.push('tools');
    if (options.requiresReasoning) filters.push('reasoning');
    if (options.requiresVision) filters.push('vision');
    if (options.favoritesOnly) filters.push('favorites');
    filters.push(`sort: ${options.sortBy || 'name'}`);

    return {
      items,
      totalItems,
      totalPages,
      currentPage,
      pageSize,
      activeFilterSummary: filters.join(' · '),
    };
  }

  /**
   * Renders a rich detail card for a highlighted model.
   */
  public static renderDetailPane(model: DiscoveredModel, isFavorite: boolean = false): string {
    const lines: string[] = [];
    const favStar = isFavorite ? ` ${ANSI.gold}★ (Favorite)${ANSI.reset}` : '';
    const aliveBadge = model.isAlive
      ? `${ANSI.mint}[LIVE]${ANSI.reset}`
      : `${ANSI.coral}[RETIRED]${ANSI.reset}`;

    lines.push(`  ╭─ Model Details: ${ANSI.bold}${ANSI.brightCyan}${model.id}${ANSI.reset}${favStar} ───`);
    lines.push(`  │  Publisher:       ${ANSI.cyan}${model.publisher}${ANSI.reset}`);
    lines.push(`  │  Type:            ${model.modelType} ${aliveBadge}`);
    lines.push(`  │  Context Window:  ${model.contextWindow ? (model.contextWindow / 1000).toFixed(0) + 'K tokens' : 'Unknown'}`);
    lines.push(`  │  Tool Calling:    ${model.supportsTools ? `${ANSI.mint}✔ Supported${ANSI.reset}` : `${ANSI.dim}Not advertised${ANSI.reset}`}`);
    lines.push(`  │  Reasoning:       ${model.supportsReasoning ? `${ANSI.mint}✔ Supported (Thinking Token Channel)${ANSI.reset}` : `${ANSI.dim}Standard completion${ANSI.reset}`}`);
    lines.push(`  │  Vision / VL:     ${model.supportsVision ? `${ANSI.mint}✔ Multimodal${ANSI.reset}` : `${ANSI.dim}Text only${ANSI.reset}`}`);
    if (model.lastProbedAt) {
      const ago = Math.round((Date.now() - model.lastProbedAt) / 60000);
      lines.push(`  │  Last Verified:   ${ago} min ago`);
    }
    if (model.retiredReason) {
      lines.push(`  │  ${ANSI.coral}Notice:${ANSI.reset}         ${model.retiredReason}`);
    }
    lines.push(`  ╰──────────────────────────────────────────────────────────────────────────`);

    return lines.join('\n');
  }

  /**
   * Extracts distinct publishers present in the catalog for filtering.
   */
  public static getDistinctPublishers(models: DiscoveredModel[]): string[] {
    const set = new Set<string>();
    for (const m of models) {
      if (m.publisher) set.add(m.publisher);
    }
    return Array.from(set).sort();
  }

  // Convenience aliases and helpers for testing & client ergonomics
  public static filterModels(models: DiscoveredModel[], options: CatalogFilterOptions = {}): DiscoveredModel[] {
    return this.filterAndSort(models, options);
  }

  public static sortModels(models: DiscoveredModel[], sortBy: 'name' | 'publisher' | 'context' | 'recent' = 'name'): DiscoveredModel[] {
    return this.filterAndSort(models, { showAllTypes: true, sortBy });
  }

  public static classifyModelType(id: string): ModelType {
    return this.classifyRawModel({ id }, 'test').modelType;
  }

  public static normalizeCatalogResponse(response: any, providerId: string = 'nim'): DiscoveredModel[] {
    if (!response || typeof response !== 'object') return [];
    const list = Array.isArray(response.data) ? response.data : Array.isArray(response) ? response : [];
    return list
      .filter((item: any) => item && typeof item.id === 'string' && item.id.trim().length > 0)
      .map((item: any) => this.classifyRawModel(item, providerId));
  }

  public static formatDetailPane(model: DiscoveredModel, isFavorite: boolean = false): string {
    return this.renderDetailPane(model, isFavorite);
  }

  public static saveCache(filePath: string, cache: CatalogCache): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
  }

  public static loadCache(filePath: string): CatalogCache | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }
}
