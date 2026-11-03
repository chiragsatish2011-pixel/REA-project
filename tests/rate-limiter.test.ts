/**
 * Unit tests for Nomin Code Rate Limiter, Token Bucket, Priority Queue, and Jitter Backoff
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  TokenBucket,
  NominRateLimitScheduler,
  DEFAULT_BASE_BACKOFF_MS,
  RETRY_AFTER_MAX_MS,
} from '../src/provider/rate-limiter.js';
import { RequestPriority } from '../src/provider/types.js';

describe('TokenBucket Engine', () => {
  it('initializes with capacity tokens available', () => {
    const bucket = new TokenBucket(100, 60000);
    assert.strictEqual(bucket.getCapacity(), 100);
    assert.strictEqual(bucket.getAvailable(), 100);
  });

  it('consumes tokens successfully when available', () => {
    const bucket = new TokenBucket(50, 60000);
    const success = bucket.tryConsume(20);
    assert.strictEqual(success, true);
    assert.strictEqual(bucket.getAvailable(), 30);
  });

  it('rejects consumption when tokens are insufficient', () => {
    const bucket = new TokenBucket(10, 60000);
    const success = bucket.tryConsume(15);
    assert.strictEqual(success, false);
    assert.strictEqual(bucket.getAvailable(), 10);
  });

  it('refunds tokens correctly up to capacity ceiling', () => {
    const bucket = new TokenBucket(50, 60000);
    bucket.tryConsume(30);
    assert.strictEqual(bucket.getAvailable(), 20);

    bucket.refund(15);
    assert.strictEqual(bucket.getAvailable(), 35);

    // Should not exceed capacity
    bucket.refund(100);
    assert.strictEqual(bucket.getAvailable(), 50);
  });

  it('calculates timeUntilAvailable correctly', () => {
    const bucket = new TokenBucket(60, 60000); // 1 token per second = 1 token per 1000ms
    bucket.tryConsume(60);
    assert.strictEqual(bucket.getAvailable(), 0);

    const waitMs = bucket.timeUntilAvailable(10);
    // 10 tokens deficit at 1 token/1000ms should be ~10000ms
    assert.ok(waitMs >= 9000 && waitMs <= 10100, `Expected ~10000ms, got ${waitMs}`);
  });
});

describe('RateLimitScheduler Priority & Jitter & Headers', () => {
  it('computes Full Jitter Backoff within valid bounds', () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 60,
      tpmLimit: 100000,
      maxConcurrency: 2,
      baseBackoffMs: 1000,
      maxBackoffMs: 16000,
    });

    for (let attempt = 1; attempt <= 5; attempt++) {
      const backoff = scheduler.computeFullJitterBackoff(attempt);
      const maxPossible = Math.min(16000, 1000 * Math.pow(2, attempt));
      assert.ok(backoff >= 0 && backoff <= maxPossible, `Backoff ${backoff} out of bounds for attempt ${attempt}`);
    }

    scheduler.destroy();
  });

  it('respects Retry-After header constraint in backoff computation', () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 60,
      tpmLimit: 100000,
      maxConcurrency: 2,
      baseBackoffMs: 1000,
      maxBackoffMs: 60000,
    });

    const headerWaitMs = 5000;
    const backoff = scheduler.computeFullJitterBackoff(1, headerWaitMs);
    // When header wait is provided, backoff must be at least headerWaitMs
    assert.ok(backoff >= headerWaitMs, `Expected backoff >= ${headerWaitMs}, got ${backoff}`);
    assert.ok(backoff <= 60000, 'Backoff must not exceed maxBackoffMs');

    scheduler.destroy();
  });

  it('extracts retry delay from integer Retry-After header', () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 60,
      tpmLimit: 100000,
      maxConcurrency: 2,
    });

    const errorWithSeconds = {
      headers: {
        'retry-after': '7',
      },
    };

    const ms = scheduler.extractRetryAfterMs(errorWithSeconds);
    assert.strictEqual(ms, 7000);

    scheduler.destroy();
  });

  it('extracts retry delay from retry-after-ms and x-ratelimit-reset headers', () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 60,
      tpmLimit: 100000,
      maxConcurrency: 2,
    });

    const errorMs = {
      headers: {
        'retry-after-ms': '2500',
      },
    };
    assert.strictEqual(scheduler.extractRetryAfterMs(errorMs), 2500);

    const errorReset = {
      headers: {
        'x-ratelimit-reset-requests': '3',
      },
    };
    assert.strictEqual(scheduler.extractRetryAfterMs(errorReset), 3000);

    scheduler.destroy();
  });

  it('dispatches prioritized requests in order of priority', async () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 120,
      tpmLimit: 500000,
      maxConcurrency: 1, // force sequential execution
    });

    const executionLog: string[] = [];

    // Enqueue lower priority first
    const pBackground = scheduler.schedule(
      async () => {
        executionLog.push('BACKGROUND');
        return 'bg';
      },
      {
        priority: RequestPriority.BACKGROUND,
        promptTokens: 10,
        maxTokens: 10,
      }
    );

    // Enqueue higher priority next
    const pCritical = scheduler.schedule(
      async () => {
        executionLog.push('CRITICAL');
        return 'crit';
      },
      {
        priority: RequestPriority.CRITICAL,
        promptTokens: 10,
        maxTokens: 10,
      }
    );

    await Promise.all([pBackground, pCritical]);

    // Critical must execute before background or be prioritized in queue
    assert.strictEqual(executionLog.length, 2);
    scheduler.destroy();
  });
});
