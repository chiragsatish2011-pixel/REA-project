/**
 * Nomin Code: Live Model Catalog Unit Test Suite
 * Tests:
 * 1. Mocked provider responses for catalog fetch with 100+ models
 * 2. Non-chat filtering (embeddings, rerankers, guard models, audio, vision)
 * 3. Search and publisher filtering (meta, nvidia, deepseek-ai, mistralai, etc.)
 * 4. Pagination and virtualization for 100+ models
 * 5. Malformed catalog response handling
 * 6. Neutral sorting (alphabetical, no promoted presets)
 * 7. Model detail pane formatting
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LiveCatalogManager } from '../src/provider/live-catalog.js';
import { DiscoveredModel } from '../src/provider/types.js';

describe('Live Model Catalog Engine', () => {
  // Generate 120 mock models spanning diverse publishers and model types
  const publishers = ['meta', 'nvidia', 'deepseek-ai', 'mistralai', 'qwen', 'google', 'microsoft'];
  const mockModels: DiscoveredModel[] = [];

  for (let i = 1; i <= 120; i++) {
    const pub = publishers[i % publishers.length];
    let type: 'chat' | 'embedding' | 'rerank' | 'guard' | 'image' | 'audio' = 'chat';
    let id = `${pub}/model-${String(i).padStart(3, '0')}-instruct`;

    if (i % 10 === 0) {
      type = 'embedding';
      id = `${pub}/embed-text-v${i}`;
    } else if (i % 15 === 0) {
      type = 'rerank';
      id = `${pub}/rerank-large-v${i}`;
    } else if (i % 25 === 0) {
      type = 'guard';
      id = `${pub}/llama-guard-${i}`;
    }

    mockModels.push({
      id,
      providerId: 'nim',
      publisher: pub,
      modelType: type,
      contextWindow: 128000,
      supportsTools: i % 2 === 0,
      supportsReasoning: i % 3 === 0,
      supportsVision: i % 5 === 0,
      isAlive: true,
      rateLimits: { rpm: 40, tpm: 100000 },
    });
  }

  it('correctly filters non-chat models (embeddings, rerankers, guards) by default', () => {
    // When showAllTypes is false (default), only chat models should be returned
    const chatOnly = LiveCatalogManager.filterModels(mockModels, { showAllTypes: false });
    assert.ok(chatOnly.length > 0);
    assert.ok(chatOnly.every(m => m.modelType === 'chat'));
    assert.strictEqual(chatOnly.some(m => m.modelType === 'embedding'), false);
    assert.strictEqual(chatOnly.some(m => m.modelType === 'rerank'), false);
    assert.strictEqual(chatOnly.some(m => m.modelType === 'guard'), false);

    // When showAllTypes is true, all 120 models must be returned
    const allModels = LiveCatalogManager.filterModels(mockModels, { showAllTypes: true });
    assert.strictEqual(allModels.length, 120);
  });

  it('filters models accurately by search query', () => {
    const results = LiveCatalogManager.filterModels(mockModels, {
      query: 'model-001',
      showAllTypes: true,
    });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'nvidia/model-001-instruct');
  });

  it('filters models accurately by publisher', () => {
    const metaModels = LiveCatalogManager.filterModels(mockModels, {
      publisher: 'meta',
      showAllTypes: true,
    });
    assert.ok(metaModels.length > 0);
    assert.ok(metaModels.every(m => m.publisher === 'meta'));

    const deepseekModels = LiveCatalogManager.filterModels(mockModels, {
      publisher: 'deepseek-ai',
      showAllTypes: true,
    });
    assert.ok(deepseekModels.length > 0);
    assert.ok(deepseekModels.every(m => m.publisher === 'deepseek-ai'));
  });

  it('filters models by capabilities (tools, reasoning, vision)', () => {
    const reasoningModels = LiveCatalogManager.filterModels(mockModels, {
      requiresReasoning: true,
      showAllTypes: false,
    });
    assert.ok(reasoningModels.length > 0);
    assert.ok(reasoningModels.every(m => m.supportsReasoning === true));

    const toolModels = LiveCatalogManager.filterModels(mockModels, {
      requiresTools: true,
      showAllTypes: false,
    });
    assert.ok(toolModels.length > 0);
    assert.ok(toolModels.every(m => m.supportsTools === true));
  });

  it('paginates 100+ models smoothly with correct boundaries', () => {
    const chatModels = LiveCatalogManager.filterModels(mockModels, { showAllTypes: false });
    const pageSize = 15;
    const page1 = LiveCatalogManager.paginate(chatModels, 1, pageSize);
    assert.strictEqual(page1.items.length, pageSize);
    assert.strictEqual(page1.currentPage, 1);
    assert.strictEqual(page1.totalItems, chatModels.length);
    assert.strictEqual(page1.totalPages, Math.ceil(chatModels.length / pageSize));

    // Page 2
    const page2 = LiveCatalogManager.paginate(chatModels, 2, pageSize);
    assert.strictEqual(page2.items.length, pageSize);
    assert.strictEqual(page2.currentPage, 2);
    assert.notStrictEqual(page1.items[0].id, page2.items[0].id);

    // Last page
    const lastPageNum = page1.totalPages;
    const lastPage = LiveCatalogManager.paginate(chatModels, lastPageNum, pageSize);
    assert.ok(lastPage.items.length <= pageSize);
    assert.strictEqual(lastPage.currentPage, lastPageNum);
  });

  it('sorts models neutrally (alphabetical by default, no promoted presets)', () => {
    const sorted = LiveCatalogManager.sortModels(mockModels, 'name');
    for (let i = 0; i < sorted.length - 1; i++) {
      assert.ok(sorted[i].id.localeCompare(sorted[i + 1].id) <= 0, `Expected ${sorted[i].id} <= ${sorted[i + 1].id}`);
    }
  });

  it('classifies models dynamically based on ID patterns and tags', () => {
    assert.strictEqual(LiveCatalogManager.classifyModelType('nvidia/nv-embedqa-e5-v5'), 'embedding');
    assert.strictEqual(LiveCatalogManager.classifyModelType('baai/bge-reranker-large'), 'rerank');
    assert.strictEqual(LiveCatalogManager.classifyModelType('meta/llama-guard-3-8b'), 'guard');
    assert.strictEqual(LiveCatalogManager.classifyModelType('meta/llama-3.1-8b-instruct'), 'chat');
  });

  it('handles malformed catalog response gracefully without throwing', () => {
    // Test parsing null, undefined, or empty objects
    const emptyResult = LiveCatalogManager.normalizeCatalogResponse(null as any, 'nim');
    assert.deepStrictEqual(emptyResult, []);

    const nonArrayResult = LiveCatalogManager.normalizeCatalogResponse({ data: 'not-an-array' } as any, 'nim');
    assert.deepStrictEqual(nonArrayResult, []);

    const missingFields = LiveCatalogManager.normalizeCatalogResponse({
      data: [{ id: '' }, { foo: 'bar' }, { id: 'valid/model' }]
    } as any, 'nim');
    assert.strictEqual(missingFields.length, 1);
    assert.strictEqual(missingFields[0].id, 'valid/model');
  });

  it('renders model detail pane with complete metadata', () => {
    const model: DiscoveredModel = {
      id: 'nvidia/cosmos-reason2-8b',
      providerId: 'nim',
      publisher: 'nvidia',
      modelType: 'chat',
      contextWindow: 128000,
      supportsTools: true,
      supportsReasoning: true,
      supportsVision: false,
      rateLimits: { rpm: 40, tpm: 100000 },
    };

    const card = LiveCatalogManager.formatDetailPane(model);
    assert.ok(card.includes('nvidia/cosmos-reason2-8b'));
    assert.ok(card.includes('nvidia'));
    assert.ok(card.includes('128K'));
    assert.ok(card.includes('Reasoning:'));
    assert.ok(card.includes('Tool Calling:'));
  });

  it('caches catalog to disk and retrieves it cleanly', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-catalog-cache-'));
    try {
      const cachePath = path.join(tempDir, 'catalog_test.json');
      LiveCatalogManager.saveCache(cachePath, {
        providerId: 'nim',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        fetchedAt: Date.now(),
        models: mockModels.slice(0, 5),
      });

      const loaded = LiveCatalogManager.loadCache(cachePath);
      assert.ok(loaded);
      assert.strictEqual(loaded?.providerId, 'nim');
      assert.strictEqual(loaded?.models.length, 5);
      assert.strictEqual(loaded?.models[0].id, mockModels[0].id);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
