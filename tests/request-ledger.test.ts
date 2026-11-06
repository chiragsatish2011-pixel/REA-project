/**
 * @file request-ledger.test.ts
 * @description Unit tests for RequestLedger, header sanitization,
 * purpose accounting, 429 rate limit tracking, and NominHttpClient integration.
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import * as http from 'node:http';
import {
  RequestLedger,
  requestLedger,
  type RequestPurpose,
  type LedgerEntry,
} from '../src/provider/request-ledger.js';
import { NominHttpClient, inferRequestPurpose } from '../src/provider/client.js';
import { BuildStampEngine } from '../src/config/build-stamp.js';

describe('Nomin Code: Request Ledger & Phase A Measurement Engine', () => {
  beforeEach(() => {
    requestLedger.clear();
  });

  it('1. BuildStampEngine.formatOneLine() produces expected version and commit stamp', () => {
    const stamp = BuildStampEngine.formatOneLine();
    assert.ok(stamp.includes('v1.0.0'), 'Stamp should contain version 1.0.0');
    assert.ok(stamp.includes('[') && stamp.includes(']'), 'Stamp should contain commit hash bracket');
  });

  it('2. RequestLedger.sanitizeHeaders strictly strips sensitive auth, keys, and tokens', () => {
    const dirtyHeaders = {
      'Authorization': 'Bearer nvapi-secret1234567890abcdef',
      'x-api-key': 'sk-secret-key-abcdef123456',
      'Cookie': 'session=abc123secret',
      'Content-Type': 'application/json',
      'X-Request-Id': 'req-xyz-789',
      'Retry-After': '12',
      'X-RateLimit-Limit-Requests': '30',
      'X-RateLimit-Remaining-Requests': '5',
      'X-RateLimit-Reset-Requests': '2026-11-05T13:00:00Z',
    };

    const sanitized = RequestLedger.sanitizeHeaders(dirtyHeaders);
    const keys = Object.keys(sanitized);

    // Verify sensitive keys are completely absent
    assert.strictEqual(keys.includes('authorization'), false, 'Authorization key must be stripped');
    assert.strictEqual(keys.includes('x-api-key'), false, 'x-api-key must be stripped');
    assert.strictEqual(keys.includes('cookie'), false, 'Cookie must be stripped');

    // Verify safe rate limit headers are preserved
    assert.strictEqual(sanitized['retry-after'], '12');
    assert.strictEqual(sanitized['x-ratelimit-limit-requests'], '30');
    assert.strictEqual(sanitized['x-ratelimit-remaining-requests'], '5');
    assert.strictEqual(sanitized['x-request-id'], 'req-xyz-789');

    // Verify rate details extraction
    const extracted = RequestLedger.extractRateLimitHeaders(dirtyHeaders);
    assert.strictEqual(extracted.retryAfter, 12);
    assert.strictEqual(extracted.limitRequests, '30');
    assert.strictEqual(extracted.remainingRequests, '5');
    assert.strictEqual(extracted.resetRequests, '2026-11-05T13:00:00Z');
  });

  it('3. RequestLedger correctly records entries, queries calls by purpose, and calculates 429 counts', () => {
    const now = Date.now();

    requestLedger.recordCall({
      purpose: 'chat',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      provider: 'nvidia-nim',
      status: 200,
      latencyMs: 350,
      tokens: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
      rateLimitHeaders: {},
      attempt: 1,
    });

    requestLedger.recordCall({
      purpose: 'tool-continuation',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      provider: 'nvidia-nim',
      status: 200,
      latencyMs: 420,
      tokens: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
      rateLimitHeaders: {},
      attempt: 1,
    });

    requestLedger.recordCall({
      purpose: 'tool-continuation',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      provider: 'nvidia-nim',
      status: 429,
      latencyMs: 120,
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      rateLimitHeaders: { retryAfter: 5 },
      error: 'Too Many Requests',
      attempt: 1,
    });

    requestLedger.recordCall({
      purpose: 'probe',
      model: 'models-catalog',
      provider: 'nvidia-nim',
      status: 200,
      latencyMs: 180,
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      rateLimitHeaders: {},
      attempt: 1,
    });

    assert.strictEqual(requestLedger.getAll().length, 4);
    assert.strictEqual(requestLedger.get429Count(), 1);

    const calls60s = requestLedger.getCallsLast60Seconds();
    assert.strictEqual(calls60s.length, 4);

    const byPurpose = requestLedger.getCallsByPurpose();
    assert.strictEqual(byPurpose.chat, 1);
    assert.strictEqual(byPurpose['tool-continuation'], 2);
    assert.strictEqual(byPurpose.probe, 1);
    assert.strictEqual(byPurpose.router, 0);

    const summaryTable = requestLedger.formatSummaryTable();
    assert.ok(summaryTable.includes('REQUEST LEDGER SUMMARY') || summaryTable.includes('Timestamp'));
    assert.ok(summaryTable.includes('nvidia/nemotron-3-ultra-550b-a55b') || summaryTable.includes('nemotron'));
  });

  it('4. inferRequestPurpose accurately infers chat vs tool-continuation', () => {
    // 1. Explicit purpose
    assert.strictEqual(inferRequestPurpose({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      purpose: 'router',
    }), 'router');

    // 2. Chat default
    assert.strictEqual(inferRequestPurpose({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    }), 'chat');

    // 3. Tool continuation when last message is tool
    assert.strictEqual(inferRequestPurpose({
      model: 'test',
      messages: [
        { role: 'user', content: 'run tool' },
        { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
        { role: 'tool', toolCallId: '1', content: 'result' },
      ],
    }), 'tool-continuation');
  });

  it('5. NominHttpClient integration records outgoing requests in RequestLedger on mock server', async () => {
    // Create a local mock server to simulate 200 and 429 responses
    let serverCallCount = 0;
    const server = http.createServer((req, res) => {
      serverCallCount++;
      if (req.url === '/models') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-ratelimit-remaining-requests': '29',
        });
        res.end(JSON.stringify({ data: [{ id: 'mock-model-1' }] }));
        return;
      }

      if (req.url === '/chat/completions') {
        if (serverCallCount === 2) {
          // Return 429 Too Many Requests with retry-after header
          res.writeHead(429, {
            'Content-Type': 'application/problem+json',
            'retry-after': '3',
            'nvcf-error-source': 'upstream_status',
          });
          res.end(JSON.stringify({ status: 429, title: 'Too Many Requests' }));
          return;
        }

        // Return SSE stream
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'x-ratelimit-remaining-requests': '28',
        });
        res.write('data: {"choices":[{"delta":{"content":"Hello world!"},"index":0}]}\n\n');
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;
    const baseURL = `http://127.0.0.1:${port}`;

    const client = new NominHttpClient({
      config: {
        id: 'test-nim',
        type: 'nvidia-nim',
        baseURL,
        apiKey: 'test-key',
        rateLimit: { maxRetries: 0 },
      },
    });

    try {
      requestLedger.clear();

      // 1. Call listModels
      const models = await client.listModels();
      assert.strictEqual(models.length, 1);
      assert.strictEqual(models[0].id, 'mock-model-1');

      // Check ledger recorded probe
      const entries1 = requestLedger.getAll();
      assert.strictEqual(entries1.length, 1);
      assert.strictEqual(entries1[0].purpose, 'probe');
      assert.strictEqual(entries1[0].status, 200);

      // 2. Call chat completion that triggers 429
      let saw429 = false;
      try {
        for await (const _ of client.chatStream({
          model: 'mock-model-1',
          messages: [{ role: 'user', content: 'test 429' }],
          purpose: 'chat',
        })) {
          // should fail
        }
      } catch (err: any) {
        saw429 = true;
      }
      assert.strictEqual(saw429, true, 'Expected 429 error to be thrown');

      // Check ledger recorded 429
      const entries2 = requestLedger.getAll();
      assert.strictEqual(entries2.length, 2);
      assert.strictEqual(entries2[1].status, 429);
      assert.strictEqual(entries2[1].rateLimitHeaders.retryAfter, 3);
      assert.strictEqual(requestLedger.get429Count(), 1);

      // 3. Call chat completion that succeeds with 200
      const chunks: string[] = [];
      for await (const chunk of client.chatStream({
        model: 'mock-model-1',
        messages: [{ role: 'user', content: 'hello' }],
        purpose: 'chat',
      })) {
        if (chunk.type === 'text-delta') {
          chunks.push(chunk.text);
        }
      }
      assert.strictEqual(chunks.join(''), 'Hello world!');

      // Check ledger recorded 200 with tokens
      const entries3 = requestLedger.getAll();
      assert.strictEqual(entries3.length, 3);
      assert.strictEqual(entries3[2].status, 200);
      assert.strictEqual(entries3[2].tokens.totalTokens, 15);
      assert.strictEqual(entries3[2].tokens.promptTokens, 10);
      assert.strictEqual(entries3[2].tokens.completionTokens, 5);
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
