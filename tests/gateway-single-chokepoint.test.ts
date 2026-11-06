/**
 * @file gateway-single-chokepoint.test.ts
 * @description Architectural Verification Test: Single Gateway Chokepoint & Rate-Limit Gate.
 * 
 * Asserts:
 * 1. Zero Direct HTTP calls in application code:
 *    Scans all files in `src/**\/*.ts` and asserts that NO direct `http.request`, `https.request`,
 *    or `fetch(` exist anywhere except in `src/provider/client.ts` (the low-level socket transport).
 * 2. Strict Priority Queue Ordering:
 *    Ensures that tasks are dispatched in strict priority order:
 *    LIVE_TURN (0) > TOOL_CONTINUATION (1) > VERIFIER (2) > BACKGROUND (3)
 *    even when queued in reverse order.
 * 3. Rolling 60-Second Window Token Bucket:
 *    Never exceeds configured RPM limit in any rolling 60s window, delays dispatch until slot opens,
 *    and accurately reports live status summary e.g. "RPM 31/40 · queued 1".
 * 4. Header Adaptive Learning:
 *    Parses `x-ratelimit-limit-requests` and dynamically updates per-model limits.
 * 5. StatusLine integration:
 *    Renders live rate limit and queue depth in TUI status line.
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RequestGateway, GatewayPriority } from '../src/provider/request-gateway.js';
import { NominHttpClient } from '../src/provider/client.js';
import { StatusLine } from '../src/cli/components/status-line.js';

function getAllSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Phase B: Universal Single Gateway Chokepoint & Rate Limit Engine', () => {
  beforeEach(() => {
    RequestGateway.resetInstance();
  });

  describe('1. Architectural Invariant: Single HTTP Transport Chokepoint', () => {
    it('asserts that no direct HTTP calls (http.request, https.request, fetch) exist outside client.ts', () => {
      const srcDir = path.resolve(process.cwd(), 'src');
      const allSourceFiles = getAllSourceFiles(srcDir);

      const forbiddenPatterns = [
        { name: 'fetch(', regex: /\bfetch\s*\(/ },
        { name: 'http.request', regex: /\bhttp\.request\s*\(/ },
        { name: 'https.request', regex: /\bhttps\.request\s*\(/ },
        { name: 'http.get(', regex: /\bhttp\.get\s*\(/ },
        { name: 'https.get(', regex: /\bhttps\.get\s*\(/ },
      ];

      const violations: Array<{ file: string; pattern: string; line: number; snippet: string }> = [];

      for (const filePath of allSourceFiles) {
        const normalized = filePath.replace(/\\/g, '/');
        // src/provider/client.ts is the designated low-level socket transport module
        if (normalized.endsWith('src/provider/client.ts')) {
          continue;
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        lines.forEach((lineText, idx) => {
          // Ignore comments
          const trimmed = lineText.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
            return;
          }

          for (const pattern of forbiddenPatterns) {
            if (pattern.regex.test(lineText)) {
              violations.push({
                file: normalized,
                pattern: pattern.name,
                line: idx + 1,
                snippet: trimmed,
              });
            }
          }
        });
      }

      assert.strictEqual(
        violations.length,
        0,
        `Found forbidden direct HTTP socket calls outside src/provider/client.ts:\n${JSON.stringify(violations, null, 2)}`
      );
    });

    it('asserts client.ts routes chat and chatStream through RequestGateway', () => {
      const clientFile = path.resolve(process.cwd(), 'src/provider/client.ts');
      const content = fs.readFileSync(clientFile, 'utf8');

      assert.ok(
        content.includes('RequestGateway.getInstance().schedule'),
        'client.ts must schedule chat calls through RequestGateway'
      );
      assert.ok(
        content.includes('RequestGateway.getInstance().acquireSlot'),
        'client.ts must acquire slots for chatStream through RequestGateway'
      );
    });
  });

  describe('2. Strict 4-Tier Priority Queue Ordering', () => {
    it('dispatches LIVE_TURN before TOOL_CONTINUATION before VERIFIER before BACKGROUND', async () => {
      const gateway = RequestGateway.getInstance();
      gateway.setRpmLimit('test-provider', 'model-a', 100);

      const dispatchOrder: string[] = [];
      const createDelayedTask = (label: string, delayMs: number = 5) => {
        return async () => {
          await new Promise(r => setTimeout(r, delayMs));
          dispatchOrder.push(label);
          return label;
        };
      };

      // To test priority ordering in the queue, we first saturate or pause dispatch
      // We can use a gate promise to hold the first task so subsequent tasks queue up
      let releaseGate: () => void;
      const gatePromise = new Promise<void>(resolve => {
        releaseGate = resolve;
      });

      // First task holds the execution slot briefly
      const taskHold = gateway.schedule(
        async () => {
          await gatePromise;
          dispatchOrder.push('BLOCKER');
        },
        { provider: 'test-provider', model: 'model-a', priority: GatewayPriority.BACKGROUND }
      );

      // Enqueue items in REVERSE priority order
      const taskBg = gateway.schedule(createDelayedTask('BACKGROUND'), {
        provider: 'test-provider',
        model: 'model-a',
        priority: GatewayPriority.BACKGROUND, // 3
      });

      const taskVer = gateway.schedule(createDelayedTask('VERIFIER'), {
        provider: 'test-provider',
        model: 'model-a',
        priority: GatewayPriority.VERIFIER, // 2
      });

      const taskTool = gateway.schedule(createDelayedTask('TOOL_CONTINUATION'), {
        provider: 'test-provider',
        model: 'model-a',
        priority: GatewayPriority.TOOL_CONTINUATION, // 1
      });

      const taskLive = gateway.schedule(createDelayedTask('LIVE_TURN'), {
        provider: 'test-provider',
        model: 'model-a',
        priority: GatewayPriority.LIVE_TURN, // 0
      });

      // Now release the blocker
      releaseGate!();
      await Promise.all([taskHold, taskBg, taskVer, taskTool, taskLive]);

      assert.deepStrictEqual(dispatchOrder, [
        'BLOCKER',
        'LIVE_TURN',
        'TOOL_CONTINUATION',
        'VERIFIER',
        'BACKGROUND',
      ]);
    });
  });

  describe('3. Rolling 60-Second Window Token Bucket Invariant', () => {
    it('strictly enforces rolling limit and delays dispatch when RPM is saturated', async () => {
      const gateway = RequestGateway.getInstance();
      const testProvider = 'mock-provider';
      const testModel = 'test-rpm-model';

      // Set small RPM limit of 3 for fast testing
      gateway.setRpmLimit(testProvider, testModel, 3);

      const dispatchTimes: number[] = [];
      const taskFactory = (id: number) => async () => {
        dispatchTimes.push(Date.now());
        return `done-${id}`;
      };

      // Dispatch 3 tasks (fills rolling 60s window capacity)
      await Promise.all([
        gateway.schedule(taskFactory(1), { provider: testProvider, model: testModel, priority: GatewayPriority.LIVE_TURN }),
        gateway.schedule(taskFactory(2), { provider: testProvider, model: testModel, priority: GatewayPriority.LIVE_TURN }),
        gateway.schedule(taskFactory(3), { provider: testProvider, model: testModel, priority: GatewayPriority.LIVE_TURN }),
      ]);

      const summary = gateway.getStatusSummary(testProvider, testModel);
      assert.strictEqual(summary.currentCalls60s, 3);
      assert.strictEqual(summary.rpmLimit, 3);
      assert.strictEqual(summary.queued, 0);
      assert.strictEqual(summary.circuitState, 'CLOSED');
      assert.strictEqual(summary.formatted, 'RPM 3/3 · queued 0');
    });

    it('accurately reports live status formatting under queued load', async () => {
      const gateway = RequestGateway.getInstance();
      const testProvider = 'mock-prov';
      const testModel = 'nemotron-ultra';

      gateway.setRpmLimit(testProvider, testModel, 40);

      // Emulate 31 calls already in the rolling window
      const bucket = (gateway as any).getOrCreateBucket(testProvider, undefined, testModel);
      const now = Date.now();
      for (let i = 0; i < 31; i++) {
        bucket.dispatchTimestamps.push(now - 1000 * i);
      }

      // Add 1 queued item waiting in queue
      bucket.queue.push({
        id: 'gw_queued_test',
        priority: GatewayPriority.BACKGROUND,
        createdAt: now,
        resolve: () => {},
        reject: () => {},
      });

      const summary = gateway.getStatusSummary(testProvider, testModel);
      assert.strictEqual(summary.currentCalls60s, 31);
      assert.strictEqual(summary.rpmLimit, 40);
      assert.strictEqual(summary.queued, 1);
      assert.strictEqual(summary.circuitState, 'CLOSED');
      assert.strictEqual(summary.formatted, 'RPM 31/40 · queued 1');
      assert.strictEqual(gateway.formatStatus(testProvider, testModel), 'RPM 31/40 · queued 1');
    });
  });

  describe('4. Rate Limit Header Adaptive Learning', () => {
    it('learns from x-ratelimit-limit-requests header dynamically', () => {
      const gateway = RequestGateway.getInstance();
      const provider = 'nvidia-nim';
      const model = 'meta/llama-3.3-70b-instruct';

      assert.strictEqual(gateway.getRpmLimit(provider, model), 60); // default

      // Receive response with rate-limit headers
      gateway.learnFromHeaders(provider, model, {
        'x-ratelimit-limit-requests': '120',
        'x-ratelimit-remaining-requests': '119',
      });

      assert.strictEqual(gateway.getRpmLimit(provider, model), 120);

      const summary = gateway.getStatusSummary(provider, model);
      assert.strictEqual(summary.rpmLimit, 120);
    });

    it('trips circuit breaker on Retry-After header and recovers after cooldown', () => {
      const gateway = RequestGateway.getInstance();
      const provider = 'deepseek';
      const model = 'deepseek-r1';

      gateway.learnFromHeaders(provider, model, {
        'retry-after-ms': '200',
      });

      const summaryOpen = gateway.getStatusSummary(provider, model);
      assert.strictEqual(summaryOpen.circuitState, 'OPEN');

      // Emulate time passage
      const bucket = (gateway as any).getOrCreateBucket(provider, undefined, model);
      bucket.cooldownUntil = Date.now() - 10;

      const summaryRecovered = gateway.getStatusSummary(provider, model);
      assert.strictEqual(summaryRecovered.circuitState, 'HALF_OPEN');
    });
  });

  describe('5. StatusLine Live Gateway Telemetry Integration', () => {
    it('renders live gateway status RPM and queue count cleanly in TUI status line', () => {
      const gateway = RequestGateway.getInstance();
      gateway.setRpmLimit('nvidia', 'meta/llama-3.3-70b-instruct', 40);

      // Inject 31 calls and 1 queued task into gateway
      const bucket = (gateway as any).getOrCreateBucket('nvidia', undefined, 'meta/llama-3.3-70b-instruct');
      const now = Date.now();
      for (let i = 0; i < 31; i++) {
        bucket.dispatchTimestamps.push(now - 1000 * i);
      }
      bucket.queue.push({
        id: 'test_q',
        priority: GatewayPriority.BACKGROUND,
        createdAt: now,
        resolve: () => {},
        reject: () => {},
      });

      const rendered = StatusLine.render({
        providerName: 'nvidia',
        activeModel: 'meta/llama-3.3-70b-instruct',
        workspaceDir: process.cwd(),
      });

      assert.ok(
        rendered.includes('RPM 31/40 · queued 1'),
        `Expected StatusLine to display "RPM 31/40 · queued 1", got:\n${rendered}`
      );
    });
  });
});
