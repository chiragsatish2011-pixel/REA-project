import test from 'node:test';
import assert from 'node:assert';
import { defaultToolRegistry } from '../src/tools/index.js';
import { RequestLedger } from '../src/provider/request-ledger.js';
import { RequestGateway } from '../src/provider/request-gateway.js';

test('RateStatusTool returns accurate ledger and gateway metrics', async () => {
  const ledger = RequestLedger.getInstance();
  const gateway = RequestGateway.getInstance();

  ledger.clear();
  gateway.setRpmLimit('nvidia-nim', 'nvidia/nemotron-3-ultra-550b-a55b', 40);

  // Record mock calls
  ledger.recordCall({
    purpose: 'chat',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    provider: 'nvidia-nim',
    status: 200,
    latencyMs: 120,
    tokens: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    rateLimitHeaders: {},
  });

  ledger.recordCall({
    purpose: 'tool-continuation',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    provider: 'nvidia-nim',
    status: 429,
    latencyMs: 80,
    tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    rateLimitHeaders: { retryAfter: 5 },
    error: 'Too Many Requests',
  });

  const tool = defaultToolRegistry.getTool('rate_status');
  assert.ok(tool, 'rate_status tool should be registered');

  const res = await tool.execute({ windowSeconds: 60 }, { worktreePath: process.cwd() });
  assert.strictEqual(res.success, true);
  assert.ok(res.output.includes('40 requests/minute'));
  assert.ok(res.output.includes('chat:              1'));
  assert.ok(res.output.includes('tool-continuation: 1'));
  assert.ok(res.output.includes('429 Rate Limits: 1 in last 60s'));
  assert.ok(res.output.includes('Status Code:  429'));
  assert.strictEqual(res.data.count429InWindow, 1);
  assert.strictEqual(res.data.rpmLimit, 40);
});
