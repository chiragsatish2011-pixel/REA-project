/**
 * Nomin Code: Error Classifier & Resilience Test Suite
 * Tests:
 * 1. 401/403 Unauthorized / Forbidden key detection & action recommendation
 * 2. 404 Model or path not found classification
 * 3. 410 Gone / Model retired detection with exact upstream reason
 * 4. 429 Rate limited with Retry-After header parsing
 * 5. 5xx Server errors and network timeouts with retryable flag
 * 6. 400 Bad Request parameter diagnostics
 * 7. Upstream header extraction (x-request-id, nvcf-error-source, retry-after)
 * 8. Strict secret sanitization preventing key leaks in error messages
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ErrorClassifier } from '../src/provider/error-classifier.js';
import { NominHttpError } from '../src/provider/client.js';

describe('ErrorClassifier & Upstream Diagnostics', () => {
  it('classifies HTTP 401 Unauthorized as AUTH_FAILED and recommends nomin auth', () => {
    const error = new NominHttpError({
      message: 'Unauthorized',
      statusCode: 401,
      responseBody: JSON.stringify({ error: { message: 'Invalid API key provided' } }),
      provider: 'NVIDIA NIM',
      model: 'meta/llama-3.1-8b-instruct',
    });

    const classified = ErrorClassifier.classify(error);
    assert.strictEqual(classified.category, 'AUTH_FAILED');
    assert.strictEqual(classified.statusCode, 401);
    assert.ok(classified.providerDetail.includes('Invalid API key'));
    assert.ok(classified.suggestedAction.includes('nomin auth') || classified.suggestedAction.includes('/provider key'));
    assert.strictEqual(classified.retryable, false);
  });

  it('classifies HTTP 404 Not Found as NOT_FOUND with missing model explanation', () => {
    const error = new NominHttpError({
      message: 'Not Found',
      statusCode: 404,
      responseBody: JSON.stringify({ error: { message: 'The model xyz does not exist' } }),
      provider: 'NVIDIA NIM',
      model: 'xyz',
    });

    const classified = ErrorClassifier.classify(error, { modelId: 'xyz' });
    assert.strictEqual(classified.category, 'NOT_FOUND');
    assert.strictEqual(classified.statusCode, 404);
    assert.ok(classified.providerDetail.includes('does not exist'));
    assert.ok(classified.suggestedAction.includes('/models') || classified.suggestedAction.includes('model'));
  });

  it('classifies HTTP 410 Gone as MODEL_RETIRED with exact provider EOL detail', () => {
    const error = new NominHttpError({
      message: 'Gone',
      statusCode: 410,
      headers: {
        'nvcf-error-source': 'gateway_rejected',
        'x-request-id': 'test-request-id-410',
      },
      responseBody: JSON.stringify({
        type: 'about:blank',
        title: 'Gone',
        status: 410,
        detail: "The model 'meta/llama-3.3-70b-instruct' has reached its end of life on 2026-08-26T09:00:00Z and is no longer available.",
      }),
      provider: 'NVIDIA NIM',
      model: 'meta/llama-3.3-70b-instruct',
    });

    const classified = ErrorClassifier.classify(error, { modelId: 'meta/llama-3.3-70b-instruct' });
    assert.strictEqual(classified.category, 'MODEL_RETIRED');
    assert.strictEqual(classified.statusCode, 410);
    assert.strictEqual(classified.requestId, 'test-request-id-410');
    assert.strictEqual(classified.gatewaySource, 'gateway_rejected');
    assert.ok(classified.providerDetail.includes('end of life on 2026-08-26T09:00:00Z'));
    assert.strictEqual(classified.retryable, false);
    assert.ok(classified.suggestedAction.includes('picker') || classified.suggestedAction.includes('/models'));
  });

  it('classifies HTTP 429 as RATE_LIMITED and parses Retry-After header', () => {
    const error = new NominHttpError({
      message: 'Too Many Requests',
      statusCode: 429,
      headers: {
        'retry-after': '30',
        'x-request-id': 'req-rate-limit-123',
      },
      responseBody: JSON.stringify({ error: { message: 'Rate limit exceeded: quota 30 RPM exhausted' } }),
      provider: 'NVIDIA NIM',
      model: 'mistralai/mistral-large-2-instruct',
    });

    const classified = ErrorClassifier.classify(error);
    assert.strictEqual(classified.category, 'RATE_LIMITED');
    assert.strictEqual(classified.statusCode, 429);
    assert.strictEqual(classified.retryAfterSec, 30);
    assert.strictEqual(classified.retryable, true);
    assert.ok(classified.suggestedAction.includes('30') || classified.suggestedAction.includes('backoff'));
  });

  it('classifies HTTP 500/502/503/504 as SERVER_ERROR and marks retryable with backoff', () => {
    const error503 = new NominHttpError({
      message: 'Service Unavailable',
      statusCode: 503,
      responseBody: 'Backend upstream service overloaded',
      provider: 'NVIDIA NIM',
    });

    const classified = ErrorClassifier.classify(error503);
    assert.strictEqual(classified.category, 'SERVER_ERROR');
    assert.strictEqual(classified.statusCode, 503);
    assert.strictEqual(classified.retryable, true);
    assert.ok(classified.suggestedAction.includes('backoff') || classified.suggestedAction.includes('retry'));
  });

  it('classifies network timeouts and fetch aborts as NETWORK_ERROR', () => {
    const networkErr = new Error('fetch failed: connect ETIMEDOUT 10.0.0.1:443');
    const classified = ErrorClassifier.classify(networkErr);
    assert.strictEqual(classified.category, 'NETWORK_ERROR');
    assert.strictEqual(classified.retryable, true);
    assert.ok(classified.providerDetail.includes('ETIMEDOUT') || classified.providerDetail.includes('fetch failed'));
  });

  it('classifies HTTP 400 Bad Request and identifies invalid parameter', () => {
    const error400 = new NominHttpError({
      message: 'Bad Request',
      statusCode: 400,
      responseBody: JSON.stringify({
        error: {
          message: "Unsupported parameter: 'reasoning_effort' is not supported by model meta/llama-3.1-8b-instruct",
          param: 'reasoning_effort',
        },
      }),
      provider: 'NVIDIA NIM',
      model: 'meta/llama-3.1-8b-instruct',
    });

    const classified = ErrorClassifier.classify(error400);
    assert.strictEqual(classified.category, 'BAD_REQUEST');
    assert.strictEqual(classified.statusCode, 400);
    assert.ok(classified.providerDetail.includes('reasoning_effort'));
    assert.strictEqual(classified.retryable, false);
  });

  it('strictly sanitizes credentials so raw API keys never leak into formatted error cards', () => {
    const rawSecret = 'nvapi-TOP-SECRET-KEY-ABC123XYZ';
    const error = new NominHttpError({
      message: `Failed request with Authorization: Bearer ${rawSecret}`,
      statusCode: 401,
      responseBody: `{"error": "Key ${rawSecret} rejected"}`,
      provider: 'NVIDIA NIM',
    });

    const classified = ErrorClassifier.classify(error);
    const card = ErrorClassifier.formatDiagnosticCard(classified);

    // Assert that the raw secret does NOT appear anywhere in the classified detail or card
    assert.strictEqual(classified.providerDetail.includes(rawSecret), false);
    assert.strictEqual(card.includes(rawSecret), false);
    assert.ok(card.includes('REDACTED') || card.includes('••••'));
  });
});
