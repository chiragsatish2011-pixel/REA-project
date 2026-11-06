/**
 * Nomin Code: Regression Test Suite for HTTP 410 Gone
 * Replays the exact failure session from the user prompt:
 * User selects 'meta/llama-3.3-70b-instruct', which was retired by NVIDIA NIM on 2026-08-26.
 *
 * Requirements:
 * 1. Clear message with exact upstream detail (EOL date, request ID, gateway source)
 * 2. Model marked RETIRED in the local pool / config
 * 3. NO silent switch to a different model (e.g. nemotron)
 * 4. ModelValidator refuses to activate the retired model
 * 5. Pre-validation stops repeated identical errors
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ErrorClassifier } from '../src/provider/error-classifier.js';
import { NominHttpError, NominHttpClient } from '../src/provider/client.js';
import { ModelValidator } from '../src/provider/model-validator.js';
import { ConfigManager } from '../src/config/index.js';

describe('Regression 410 Session Replay: meta/llama-3.3-70b-instruct', () => {
  const RETIRED_MODEL_ID = 'meta/llama-3.3-70b-instruct';
  const RETIRED_DETAIL =
    "The model 'meta/llama-3.3-70b-instruct' has reached its end of life on 2026-08-26T09:00:00Z and is no longer available.";
  const REQUEST_ID = '50fe3cc8-78b1-4bd3-a8d4-71984dde23d2';
  const GATEWAY_SOURCE = 'gateway_rejected';

  it('accurately captures upstream HTTP 410 Gone error with full diagnostics', () => {
    // 1. Simulate exact error returned by NVIDIA NIM gateway
    const upstreamError = new NominHttpError({
      statusCode: 410,
      message: 'Gone',
      headers: {
        'nvcf-error-source': GATEWAY_SOURCE,
        'x-request-id': REQUEST_ID,
        'content-type': 'application/problem+json',
      },
      responseBody: JSON.stringify({
        type: 'about:blank',
        title: 'Gone',
        status: 410,
        detail: RETIRED_DETAIL,
      }),
      provider: 'NVIDIA NIM',
      model: RETIRED_MODEL_ID,
    });

    const classified = ErrorClassifier.classify(upstreamError, {
      modelId: RETIRED_MODEL_ID,
      providerId: 'nim',
    });

    // Verify classification
    assert.strictEqual(classified.category, 'MODEL_RETIRED');
    assert.strictEqual(classified.statusCode, 410);
    assert.strictEqual(classified.requestId, REQUEST_ID);
    assert.strictEqual(classified.gatewaySource, GATEWAY_SOURCE);
    assert.strictEqual(classified.providerDetail, RETIRED_DETAIL);
    assert.strictEqual(classified.isRetired, true);
    assert.strictEqual(classified.retryable, false);

    // Verify formatted diagnostic card
    const card = ErrorClassifier.formatDiagnosticCard(classified);
    assert.ok(card.includes('[HTTP 410]'));
    assert.ok(card.includes(REQUEST_ID));
    assert.ok(card.includes('2026-08-26'));
  });

  it('marks model as RETIRED in config without silently switching to another model', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-reg410-test-'));
    try {
      ConfigManager.resetInstance();
      const cfgMgr = ConfigManager.getInstance(tempDir);
      cfgMgr.updateConfig({ activeProvider: 'nim' });

      // User initially had the retired model in their pool
      cfgMgr.addModel(RETIRED_MODEL_ID);
      cfgMgr.setSoloModel(RETIRED_MODEL_ID);

      assert.strictEqual(cfgMgr.getConfig().activeModel, RETIRED_MODEL_ID);

      // On 410 Gone, mark model as RETIRED
      cfgMgr.markModelRetired(RETIRED_MODEL_ID, RETIRED_DETAIL);

      const cfg = cfgMgr.getConfig();

      // 1. Verify model is recorded in retiredModels
      assert.ok(cfg.retiredModels);
      assert.ok(cfg.retiredModels[RETIRED_MODEL_ID]);
      assert.ok(cfg.retiredModels[RETIRED_MODEL_ID].includes('2026-08-26'));

      // 2. CRITICAL INVARIANT: NEVER silently switch to a different model (e.g. nemotron)
      assert.notStrictEqual(cfg.activeModel, 'nvidia/llama-3.1-nemotron-70b-instruct');
      assert.notStrictEqual(cfg.activeModel, 'meta/llama-3.1-70b-instruct');

      // Model remains explicitly marked as retired so the user is informed to choose
      assert.strictEqual(cfg.activeModel, RETIRED_MODEL_ID);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      ConfigManager.resetInstance();
    }
  });

  it('ModelValidator rejects activation when endpoint returns 410 Gone', async () => {
    // Create a mock client that throws 410 Gone for meta/llama-3.3-70b-instruct
    const client = new NominHttpClient({
      config: {
        id: 'nim',
        name: 'NVIDIA NIM',
        type: 'nvidia-nim',
        baseURL: 'https://integrate.api.nvidia.com/v1',
        apiKey: 'nvapi-dummy-key-for-test',
      },
    });

    // Mock chatStream to reject with 410 Gone
    client.chatStream = async function* () {
      throw new NominHttpError({
        statusCode: 410,
        message: 'Gone',
        headers: {
          'nvcf-error-source': GATEWAY_SOURCE,
          'x-request-id': REQUEST_ID,
        },
        responseBody: JSON.stringify({
          type: 'about:blank',
          title: 'Gone',
          status: 410,
          detail: RETIRED_DETAIL,
        }),
      });
    };

    const result = await ModelValidator.validateModel(client, RETIRED_MODEL_ID);

    // Validation must FAIL
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.modelId, RETIRED_MODEL_ID);
    assert.ok(result.error);
    assert.strictEqual(result.error?.category, 'MODEL_RETIRED');
    assert.strictEqual(result.error?.statusCode, 410);
    assert.ok(result.error?.providerDetail.includes('2026-08-26'));

    client.destroy();
  });
});
