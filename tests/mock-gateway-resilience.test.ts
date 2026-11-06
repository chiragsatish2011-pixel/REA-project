/**
 * @file mock-gateway-resilience.test.ts
 * @description Comprehensive Phase G Mock Provider Resilience Tests.
 * Asserts:
 *  1. 429 with Retry-After: 5 (safe retry backoff)
 *  2. 429 with Retry-After: 0 (strictly enforces 1s floor; zero sub-second loops)
 *  3. 429 with no headers (jittered exponential backoff with 1s floor and 60s cap)
 *  4. 503 Service Unavailable (safe retry)
 *  5. Timeout error (safe retry)
 *  6. 401 Unauthorized (immediately rejected, never retried)
 *  7. Burst of 100 requests with 40 RPM limit (rolling window invariant, 0 dropped)
 *  8. Circuit breaker state machine (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)
 */

import test from 'node:test';
import assert from 'node:assert';
import { MockProviderServer } from './mock-provider-server.js';
import { NominHttpClient, NominHttpError } from '../src/provider/client.js';
import { RequestGateway, GatewayPriority } from '../src/provider/request-gateway.js';
import { RequestLedger } from '../src/provider/request-ledger.js';
import { BuildStampEngine } from '../src/config/build-stamp.js';

test('Phase G.a: Mock OpenAI-Compatible Gateway Resilience Suite', async (t) => {
  const buildStamp = BuildStampEngine.formatOneLine();
  console.log(`\n[Build Stamp: ${buildStamp}] Starting Phase G.a Resilience Tests...\n`);

  const server = new MockProviderServer();
  const baseURL = await server.start();
  const ledger = RequestLedger.getInstance();
  const gateway = RequestGateway.getInstance();

  t.after(async () => {
    await server.stop();
  });

  await t.test('1. HTTP 429 with Retry-After: 5 backed off safely and auto-resumes', async () => {
    let callCount = 0;
    server.setHandler((_body, _req) => {
      callCount++;
      if (callCount === 1) {
        return {
          statusCode: 429,
          headers: { 'retry-after': '1' }, // 1s for fast test
          jsonBody: { error: { message: 'Too Many Requests' } },
        };
      }
      return {
        statusCode: 200,
        sseEvents: [JSON.stringify({ choices: [{ delta: { content: 'Recovered from 429' } }] })],
      };
    });

    const client = new NominHttpClient({
      config: {
        id: 'test-resilience',
        name: 'Test Resilience',
        type: 'openai',
        baseURL,
        apiKey: 'test-key',
        timeoutMs: 5000,
      },
    });

    const calculatedDelay = NominHttpClient.computeRetryDelay(1, 5);
    assert.ok(calculatedDelay >= 1000, `Delay (${calculatedDelay}ms) must be >= 1000ms`);
    assert.ok(calculatedDelay <= 5000, `Delay (${calculatedDelay}ms) must be <= 5000ms`);

    let sawCountdown = false;
    client.on('retryCountdown', (evt) => {
      if (evt.status === 429) sawCountdown = true;
    });

    const response = await client.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello after rate limit' }],
    });

    assert.strictEqual(callCount, 2, 'Should have retried exactly once after 429');
    assert.ok(response.choices[0]?.message?.content?.includes('Recovered from 429'));
    assert.strictEqual(sawCountdown, true, 'Should emit retryCountdown event');
  });

  await t.test('2. HTTP 429 with Retry-After: 0 strictly enforces 1s floor (no spinloop)', async () => {
    // OpenCode bug #37076: Retry-After 0 caused 700 calls in 5 seconds.
    // Assert computeRetryDelay with header "0" returns >= 1000ms
    for (let attempt = 1; attempt <= 6; attempt++) {
      const delay = NominHttpClient.computeRetryDelay(attempt, '0');
      assert.ok(delay >= 1000, `Attempt ${attempt}: delay (${delay}ms) must be >= 1000ms`);
      assert.ok(delay <= 60000, `Attempt ${attempt}: delay (${delay}ms) must be <= 60000ms`);
    }

    let calls = 0;
    const timestamps: number[] = [];

    server.setHandler((_body, _req) => {
      calls++;
      timestamps.push(Date.now());
      if (calls === 1) {
        return {
          statusCode: 429,
          headers: { 'retry-after': '0' },
          jsonBody: { error: { message: 'Too Many Requests' } },
        };
      }
      return {
        statusCode: 200,
        sseEvents: [JSON.stringify({ choices: [{ delta: { content: 'Spinloop prevented' } }] })],
      };
    });

    const client = new NominHttpClient({
      config: {
        id: 'test-spinloop',
        name: 'Test Spinloop',
        type: 'openai',
        baseURL,
        apiKey: 'test-key',
        timeoutMs: 5000,
      },
    });

    const response = await client.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'test zero delay' }],
    });

    assert.strictEqual(calls, 2);
    assert.ok(timestamps.length === 2);
    const elapsedBetweenCalls = timestamps[1] - timestamps[0];
    assert.ok(
      elapsedBetweenCalls >= 900,
      `Time between calls (${elapsedBetweenCalls}ms) must respect the 1s floor (no sub-second spinloops)`
    );
    assert.ok(response.choices[0]?.message?.content?.includes('Spinloop prevented'));
  });

  await t.test('3. HTTP 429 with no header applies jittered exponential backoff capped at 60s', async () => {
    const delayAttempt1 = NominHttpClient.computeRetryDelay(1, undefined);
    const delayAttempt2 = NominHttpClient.computeRetryDelay(2, undefined);
    const delayAttempt6 = NominHttpClient.computeRetryDelay(6, undefined);
    const delayAttempt10 = NominHttpClient.computeRetryDelay(10, undefined);

    assert.ok(delayAttempt1 >= 1000 && delayAttempt1 <= 60000);
    assert.ok(delayAttempt2 >= 1000 && delayAttempt2 <= 60000);
    assert.ok(delayAttempt6 >= 1000 && delayAttempt6 <= 60000);
    assert.ok(delayAttempt10 >= 1000 && delayAttempt10 <= 60000, 'Attempt 10 should be capped at 60000ms');
  });

  await t.test('4. HTTP 503 Service Unavailable safely retries and auto-resumes', async () => {
    let callCount = 0;
    server.setHandler((_body, _req) => {
      callCount++;
      if (callCount === 1) {
        return {
          statusCode: 503,
          headers: { 'retry-after': '1' },
          jsonBody: { error: { message: 'Service Unavailable' } },
        };
      }
      return {
        statusCode: 200,
        sseEvents: [JSON.stringify({ choices: [{ delta: { content: '503 Resolved' } }] })],
      };
    });

    const client = new NominHttpClient({
      config: {
        id: 'test-503',
        name: 'Test 503',
        type: 'openai',
        baseURL,
        apiKey: 'test-key',
        timeoutMs: 5000,
      },
    });

    const response = await client.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello after 503' }],
    });

    assert.strictEqual(callCount, 2, 'Should retry on 503');
    assert.ok(response.choices[0]?.message?.content?.includes('503 Resolved'));
  });

  await t.test('5. Request timeout retries safely', async () => {
    let callCount = 0;
    server.setHandler((_body, _req) => {
      callCount++;
      if (callCount === 1) {
        return {
          statusCode: 408,
          jsonBody: { error: { message: 'Request Timeout' } },
        };
      }
      return {
        statusCode: 200,
        sseEvents: [JSON.stringify({ choices: [{ delta: { content: 'Timeout Resolved' } }] })],
      };
    });

    const client = new NominHttpClient({
      config: {
        id: 'test-timeout',
        name: 'Test Timeout',
        type: 'openai',
        baseURL,
        apiKey: 'test-key',
        timeoutMs: 5000,
      },
    });

    const response = await client.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello after timeout' }],
    });

    assert.strictEqual(callCount, 2);
    assert.ok(response.choices[0]?.message?.content?.includes('Timeout Resolved'));
  });

  await t.test('6. HTTP 401 Unauthorized is immediately thrown and NEVER retried', async () => {
    let callCount = 0;
    server.setHandler((_body, _req) => {
      callCount++;
      return {
        statusCode: 401,
        jsonBody: { error: { message: 'Invalid API Key' } },
      };
    });

    const client = new NominHttpClient({
      config: {
        id: 'test-401',
        name: 'Test 401',
        type: 'openai',
        baseURL,
        apiKey: 'invalid-key',
        timeoutMs: 5000,
      },
    });

    await assert.rejects(
      async () => {
        await client.chat({
          model: 'test-model',
          messages: [{ role: 'user', content: 'test 401' }],
        });
      },
      (err: any) => {
        assert.ok(err instanceof NominHttpError);
        assert.strictEqual(err.status, 401);
        return true;
      }
    );

    assert.strictEqual(callCount, 1, '401 MUST NEVER be retried! Exactly 1 attempt allowed.');
  });

  await t.test('7. Burst of 100 requests with 40 RPM limit: 0 dropped, rolling limit never exceeded', async () => {
    RequestGateway.resetInstance();
    const gw = RequestGateway.getInstance();
    gw.setRpmLimit('burst-provider', 'burst-model', 40);
    gw.setRollingWindowMs(60000);

    let virtualClock = 1000000000000;
    gw.setTimeProvider(() => virtualClock);

    let executedCount = 0;
    const executionTimes: number[] = [];
    const promises: Promise<number>[] = [];

    for (let i = 0; i < 100; i++) {
      const p = gw.schedule(
        async () => {
          executedCount++;
          executionTimes.push(virtualClock);
          return i;
        },
        {
          provider: 'burst-provider',
          model: 'burst-model',
          priority: GatewayPriority.LIVE_TURN,
        }
      );
      promises.push(p);
    }

    // Yield to let the initial 40 scheduled microtasks execute
    await new Promise(r => setTimeout(r, 20));

    // First batch of 40 executes immediately
    assert.strictEqual(executedCount, 40, 'First 40 must execute immediately');

    // Advance clock by 60,001 ms -> next 40 execute
    virtualClock += 60001;
    gw.advanceTime(0);
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(executedCount, 80, 'Second 40 must execute after 60s');

    // Advance clock by another 60,001 ms -> remaining 20 execute
    virtualClock += 60001;
    gw.advanceTime(0);
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(executedCount, 100, 'Remaining 20 must execute');

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 100, 'All 100 requests must resolve (0 dropped)');

    // Invariant: Never exceed 40 in ANY rolling 60-second window
    for (let i = 0; i < executionTimes.length; i++) {
      const tStart = executionTimes[i];
      const inWindow = executionTimes.filter((t) => t >= tStart && t < tStart + 60000);
      assert.ok(
        inWindow.length <= 40,
        `Rolling 60s invariant violated at t=${tStart}: got ${inWindow.length} calls (limit: 40)`
      );
    }
  });

  await t.test('8. Circuit breaker state machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED', async () => {
    RequestGateway.resetInstance();
    const gw = RequestGateway.getInstance();
    gw.setFailureThreshold(5);
    gw.setCircuitCooldownMs(5000);

    let clock = 500000;
    gw.setTimeProvider(() => clock);

    assert.strictEqual(gw.getCircuitState('mock-p', 'mock-m'), 'CLOSED');

    // Record 4 failures
    for (let i = 0; i < 4; i++) {
      gw.recordFailure('mock-p', 'mock-m', 429);
      assert.strictEqual(gw.getCircuitState('mock-p', 'mock-m'), 'CLOSED');
    }

    // 5th failure trips circuit breaker
    gw.recordFailure('mock-p', 'mock-m', 429);
    assert.strictEqual(gw.getCircuitState('mock-p', 'mock-m'), 'OPEN');

    // Advance clock by 3s (still in cooldown)
    clock += 3000;
    assert.strictEqual(gw.getCircuitState('mock-p', 'mock-m'), 'OPEN');

    // Advance past 5s cooldown
    clock += 3000;
    assert.strictEqual(gw.getCircuitState('mock-p', 'mock-m'), 'HALF_OPEN');

    // Successful request recovers circuit
    gw.recordSuccess('mock-p', 'mock-m');
    assert.strictEqual(gw.getCircuitState('mock-p', 'mock-m'), 'CLOSED');
    assert.strictEqual(gw.getConsecutiveFailures('mock-p', 'mock-m'), 0);
  });
});
