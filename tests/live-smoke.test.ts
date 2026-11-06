/**
 * Nomin Code: Live NVIDIA NIM Smoke Test (Real Network & Gateway)
 * Connects directly to NVIDIA NIM using the user's active nvapi key:
 * 1. Fetches real live catalog and counts models (85 models from GET /models)
 * 2. Probes active model via ModelValidator against live NVIDIA NIM gateway
 * 3. Accurately reports real upstream response (403 Authorization failed or 200 OK)
 * 4. Verifies reasoning effort setting and dynamic payload adaptation per model
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { NominHttpClient } from '../src/provider/client.js';
import { LiveCatalogManager } from '../src/provider/live-catalog.js';
import { ModelValidator } from '../src/provider/model-validator.js';
import { ModelSettingsManager } from '../src/provider/model-settings.js';
import { ConfigManager } from '../src/config/index.js';

describe('Live NVIDIA NIM Smoke Test (Real Network & Gateway)', () => {
  const cfgMgr = ConfigManager.getInstance();
  const cfg = cfgMgr.getConfig();
  const nimProv = cfg.providers.nim;
  const apiKey = nimProv?.apiKey || process.env.NVIDIA_API_KEY || '';

  if (!apiKey || !apiKey.startsWith('nvapi-')) {
    it.skip('No live NVIDIA NIM API key available; skipping live smoke test', () => {});
    return;
  }

  const client = new NominHttpClient({
    config: {
      id: 'nim',
      name: 'NVIDIA NIM',
      type: 'nvidia-nim',
      baseURL: nimProv?.baseUrl || 'https://integrate.api.nvidia.com/v1',
      apiKey,
    },
  });

  let liveModels: Array<{ id: string }> = [];
  let chosenModel = '';

  it('1. Fetches live model catalog from NVIDIA NIM and counts models', async () => {
    liveModels = await LiveCatalogManager.fetchLiveModels(client, { forceRefresh: true });
    console.log(`\n  ✔ Live NIM Catalog fetched: Found ${liveModels.length} models.`);
    assert.ok(liveModels.length >= 50, `Expected at least 50 live models from NIM, found ${liveModels.length}`);

    // Verify retired model is NOT in active list
    const hasRetired = liveModels.some(m => m.id === 'meta/llama-3.3-70b-instruct');
    assert.strictEqual(hasRetired, false, 'Retired model meta/llama-3.3-70b-instruct must not be returned in live catalog');
  });

  it('2. Probes model with live ModelValidator and accurately reports upstream gateway status', async () => {
    const preferred = liveModels.find(m =>
      m.id.includes('nemotron-70b') || m.id.includes('mistral-large') || m.id.includes('gemma')
    ) || liveModels[0];

    chosenModel = preferred.id;
    console.log(`  ✔ Selected model for live probe: ${chosenModel}`);

    const validation = await ModelValidator.validateModel(client, chosenModel, { timeoutMs: 15000 });
    console.log(`  ✔ Model validation diagnostic report:`);
    console.log(`      Model ID:    ${validation.modelId}`);
    console.log(`      Status:      ${validation.ok ? 'ALIVE & OK' : 'REJECTED BY UPSTREAM'}`);
    if (validation.error) {
      console.log(`      Category:    ${validation.error.category}`);
      console.log(`      HTTP Code:   ${validation.error.statusCode}`);
      console.log(`      Request ID:  ${validation.error.requestId || 'n/a'}`);
      console.log(`      Detail:      ${validation.error.providerDetail}`);
      console.log(`      Action:      ${validation.error.suggestedAction}`);

      // The live gateway accurately categorizes upstream status
      assert.ok(['AUTH_FAILED', 'NOT_FOUND', 'MODEL_NOT_FOUND', 'SERVER_ERROR'].includes(validation.error.category));
      assert.ok(validation.error.statusCode && validation.error.statusCode >= 400);
      assert.ok(Boolean(validation.error.suggestedAction));
    } else {
      console.log(`      TTFT:        ${validation.ttftMs}ms`);
      console.log(`      Tools:       ${validation.supportsTools}`);
      console.log(`      Reasoning:   ${validation.supportsReasoning}`);
      assert.strictEqual(validation.ok, true);
    }
  });

  it('3. Adapts request payload dynamically per reasoning effort level', () => {
    const payload: Record<string, unknown> = {
      model: chosenModel || 'nvidia/llama-3.1-nemotron-70b-instruct',
      messages: [{ role: 'user', content: 'Explain recursion in one sentence.' }],
    };

    // Set effort to high
    ModelSettingsManager.adaptPayload(payload, {
      modelId: payload.model as string,
      reasoningEffort: 'high',
    });

    const isReasoning = ModelSettingsManager.supportsReasoningEffort(payload.model as string);
    if (isReasoning) {
      console.log(`  ✔ Model '${payload.model}' supports reasoning. Adapted reasoning_effort: ${payload.reasoning_effort}`);
      assert.strictEqual(payload.reasoning_effort, 'high');
    } else {
      console.log(`  ✔ Model '${payload.model}' does not support reasoning channel. reasoning_effort safely omitted.`);
      assert.strictEqual(payload.reasoning_effort, undefined);
    }

    // Set effort to off
    ModelSettingsManager.adaptPayload(payload, {
      modelId: payload.model as string,
      reasoningEffort: 'off',
    });
    assert.strictEqual(payload.reasoning_effort, undefined);
    console.log(`  ✔ Effort set to 'off': reasoning_effort is undefined.`);
  });
});
