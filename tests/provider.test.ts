/**
 * Nomin Code: Provider Layer Test Suite
 * Tests JsonRepair, RateLimiter, CapabilityProbe, and HttpClient serialization.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  JsonRepair,
  safeJsonParse,
  repairJson,
  TokenBucket,
  LeakyBucketShaper,
  AimdConcurrencyGate,
  NominRateLimitScheduler,
  RequestPriority,
  RETRY_AFTER_MAX_MS,
  DEFAULT_BASE_BACKOFF_MS,
  CapabilityProbe,
  NominHttpClient,
} from '../src/provider/index.js';

describe('JsonRepair Engine', () => {
  it('parses already valid JSON cleanly', () => {
    const valid = '{"foo": "bar", "count": 42, "items": [1, 2, 3]}';
    const result = safeJsonParse(valid);
    assert.deepStrictEqual(result, { foo: 'bar', count: 42, items: [1, 2, 3] });
  });

  it('strips markdown code blocks', () => {
    const wrapped = '```json\n{"action": "read_file", "path": "src/index.ts"}\n```';
    const result = safeJsonParse(wrapped);
    assert.strictEqual(result.action, 'read_file');
    assert.strictEqual(result.path, 'src/index.ts');
  });

  it('strips trailing commas before brackets and braces', () => {
    const trailing = '{"items": [1, 2, 3, ], "config": {"timeout": 100, }, }';
    const repaired = repairJson(trailing);
    const parsed = JSON.parse(repaired);
    assert.deepStrictEqual(parsed, { items: [1, 2, 3], config: { timeout: 100 } });
  });

  it('fixes unescaped newlines inside string literals', () => {
    const rawWithNewlines = '{"code": "function hello() {\n  return 42;\n}"}';
    const parsed = safeJsonParse(rawWithNewlines);
    assert.strictEqual(parsed.code, 'function hello() {\n  return 42;\n}');
  });

  it('converts single quotes to double quotes for keys and strings', () => {
    const singleQuoted = "{'key': 'value with \"quotes\" inside'}";
    const parsed = safeJsonParse(singleQuoted);
    assert.strictEqual(parsed.key, 'value with "quotes" inside');
  });

  it('normalises Python literals outside of string literals', () => {
    const pythonJson = '{"is_ready": True, "failed": False, "details": None}';
    const parsed = safeJsonParse(pythonJson);
    assert.strictEqual(parsed.is_ready, true);
    assert.strictEqual(parsed.failed, false);
    assert.strictEqual(parsed.details, null);
  });

  it('auto-closes truncated JSON strings, objects, and arrays', () => {
    const truncated = '{"path": "foo.ts", "lines": [10, 20, {"nested": "incomp';
    const repaired = repairJson(truncated);
    const parsed = JSON.parse(repaired);
    assert.strictEqual(parsed.path, 'foo.ts');
    assert.strictEqual(parsed.lines[0], 10);
    assert.strictEqual(parsed.lines[1], 20);
    assert.strictEqual(parsed.lines[2].nested, 'incomp');
  });

  it('extracts candidate JSON when wrapped in conversational text', () => {
    const conversational = 'Certainly! Here is the tool call:\n```json\n{"tool": "grep", "pattern": "TODO"}\n```\nLet me know if you need more help!';
    const parsed = safeJsonParse(conversational);
    assert.strictEqual(parsed.tool, 'grep');
    assert.strictEqual(parsed.pattern, 'TODO');
  });
});

describe('Rate Limiter & Concurrency Scheduler', () => {
  it('TokenBucket consumes and refills accurately', () => {
    const bucket = new TokenBucket(100, 1000); // 100 tokens per second = 0.1 per ms
    assert.strictEqual(bucket.tryConsume(60), true);
    assert.strictEqual(bucket.getAvailable() <= 40, true);
    assert.strictEqual(bucket.tryConsume(50), false); // only ~40 remaining

    bucket.refund(20);
    assert.strictEqual(bucket.getAvailable() >= 55, true);
  });

  it('LeakyBucketShaper paces dispatch intervals', () => {
    const shaper = new LeakyBucketShaper(60); // 60 RPM -> ~850ms interval
    shaper.markDispatched();
    const wait = shaper.timeUntilNextSlot();
    assert.strictEqual(wait > 700 && wait <= 850, true);
  });

  it('AimdConcurrencyGate modulates active slots dynamically', () => {
    const gate = new AimdConcurrencyGate(10, 1, 3); // successWindow = 3
    assert.strictEqual(gate.getCurrentLimit(), 2);

    // 3 successes increases concurrency by 1
    gate.recordSuccess();
    gate.recordSuccess();
    gate.recordSuccess();
    assert.strictEqual(gate.getCurrentLimit(), 3);

    // Throttle cuts concurrency by half: floor(3 * 0.5) = 1
    gate.recordThrottle();
    assert.strictEqual(gate.getCurrentLimit(), 1);
  });

  it('computes full jitter exponential backoff bounded by RETRY_AFTER_MAX_MS', () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 60,
      tpmLimit: 100000,
      maxConcurrency: 4,
    });

    const backoff1 = scheduler.computeFullJitterBackoff(1);
    assert.strictEqual(backoff1 >= 0 && backoff1 <= DEFAULT_BASE_BACKOFF_MS * 2, true);

    // Header delay greater than jitter should take precedence up to cap
    const withHeader = scheduler.computeFullJitterBackoff(1, 5000);
    assert.strictEqual(withHeader >= 5000, true);

    // Delay capped at 15 minutes
    const hugeHeader = scheduler.computeFullJitterBackoff(1, 999999999);
    assert.strictEqual(hugeHeader <= RETRY_AFTER_MAX_MS, true);

    scheduler.destroy();
  });

  it('extracts Retry-After in integer seconds and HTTP dates', () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 60,
      tpmLimit: 100000,
      maxConcurrency: 4,
    });

    // Integer seconds
    const errorSec = { headers: { 'retry-after': '30' } };
    assert.strictEqual(scheduler.extractRetryAfterMs(errorSec), 30000);

    // HTTP-date format
    const futureDate = new Date(Date.now() + 15000).toUTCString();
    const errorDate = { headers: { 'retry-after': futureDate } };
    const dateMs = scheduler.extractRetryAfterMs(errorDate);
    assert.strictEqual(dateMs !== undefined && dateMs > 13000 && dateMs <= 16000, true);

    // retry-after-ms header
    const errorMs = { headers: { 'retry-after-ms': '1250' } };
    assert.strictEqual(scheduler.extractRetryAfterMs(errorMs), 1250);

    scheduler.destroy();
  });

  it('executes tasks respecting priority (CRITICAL before BACKGROUND)', async () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 600,
      tpmLimit: 100000,
      maxConcurrency: 2,
    });

    const executionOrder: string[] = [];

    // Enqueue a slow task to hold slot
    const slowTask = scheduler.schedule(
      () => new Promise(res => setTimeout(() => { executionOrder.push('slow'); res('slow'); }, 50)),
      { priority: RequestPriority.BACKGROUND }
    );

    // Enqueue background task
    const bgTask = scheduler.schedule(
      async () => { executionOrder.push('bg'); return 'bg'; },
      { priority: RequestPriority.BACKGROUND }
    );

    // Enqueue critical task after bg
    const critTask = scheduler.schedule(
      async () => { executionOrder.push('critical'); return 'critical'; },
      { priority: RequestPriority.CRITICAL }
    );

    await Promise.all([slowTask, bgTask, critTask]);

    // Critical must execute before background
    const critIdx = executionOrder.indexOf('critical');
    const bgIdx = executionOrder.indexOf('bg');
    assert.strictEqual(critIdx < bgIdx, true, 'CRITICAL task should execute before BACKGROUND task');

    scheduler.destroy();
  });
});

describe('Capability Probe', () => {
  it('returns canonical profile for DeepSeek-R1 with reasoning replay', () => {
    const profile = CapabilityProbe.getCanonicalProfile('deepseek-ai/deepseek-r1', 'nvidia-nim');
    assert.ok(profile);
    assert.strictEqual(profile.family, 'deepseek');
    assert.strictEqual(profile.reasoningChannel, 'reasoning_content');
    assert.strictEqual(profile.reasoningReplayRequired, true);
    assert.strictEqual(profile.contextWindow, 128000);
  });

  it('returns canonical profile for Qwen 2.5 Coder with FIM tokens', () => {
    const profile = CapabilityProbe.getCanonicalProfile('qwen/qwen2.5-coder-32b-instruct', 'nvidia-nim');
    assert.ok(profile);
    assert.strictEqual(profile.family, 'qwen');
    assert.strictEqual(profile.fimSupport, true);
    assert.strictEqual(profile.fimTokens?.prefix, '<|fim_prefix|>');
    assert.strictEqual(profile.fimTokens?.middle, '<|fim_middle|>');
    assert.strictEqual(profile.fimTokens?.suffix, '<|fim_suffix|>');
  });

  it('returns canonical profile for Claude 3.5 Sonnet', () => {
    const profile = CapabilityProbe.getCanonicalProfile('claude-3-5-sonnet', 'anthropic');
    assert.ok(profile);
    assert.strictEqual(profile.family, 'claude');
    assert.strictEqual(profile.toolCallMode, 'native_anthropic');
    assert.strictEqual(profile.contextWindow, 200000);
  });
});

describe('NominHttpClient Configuration & Connection Pooling', () => {
  it('initializes with NVIDIA NIM default configuration', () => {
    const client = new NominHttpClient({
      config: {
        id: 'nim',
        name: 'NVIDIA NIM',
        type: 'nvidia-nim',
        baseURL: 'https://integrate.api.nvidia.com/v1',
        apiKey: 'nvapi-test',
      },
    });

    assert.strictEqual(client.getProviderType(), 'nvidia-nim');
    assert.strictEqual(client.getBaseURL(), 'https://integrate.api.nvidia.com/v1');
    client.destroy();
  });
});
