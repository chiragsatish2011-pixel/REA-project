/**
 * Nomin Code: High-Capacity Throughput, Prompt Caching & Context Compaction Test Suite
 * 
 * Benchmarks:
 * 1. Rate-Limit Saturation & High-Throughput: 100 parallel requests through NominRateLimitScheduler
 *    with proactive token accounting, verifying max throughput and zero drops.
 * 2. Stable Prefix Alignment: Invariant SHA-256 fingerprinting of system prompt, tool schemas,
 *    and repo map across multiple turns to guarantee >90% prefix cache hits (KV cache).
 * 3. Proactive Context Compaction Engine: 80% model window trigger, compacting a 50-turn
 *    conversation down to <= 20% tokens while preserving 100% of critical file diffs and DoD criteria.
 * 4. Connection Pooling & HTTP Keep-Alive telemetry and TTFT instrumentation.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as crypto from 'node:crypto';
import {
  NominRateLimitScheduler,
  RequestPriority,
  TokenBucket,
  LeakyBucketShaper,
  AimdConcurrencyGate,
  NominHttpClient,
  canonicalizeTools,
  canonicalizeToolParameters,
  computeStablePrefixHash,
  ChatMessage,
  ToolDefinition,
} from '../src/provider/index.js';
import { CompactionEngine, estimateTokens } from '../src/swarm/compaction.js';

describe('Nomin Code Throughput Saturation & Capacity Benchmarks', () => {
  it('saturates 100 parallel requests through NominRateLimitScheduler with token accounting and zero drops', async () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 6000,
      tpmLimit: 1_000_000,
      maxConcurrency: 25,
      minConcurrency: 10,
      leakyBucketIntervalMs: 0, // Zero interval to benchmark maximum allowable throughput
    });

    const TOTAL_REQUESTS = 100;
    let completedCount = 0;
    let totalTokensFromCallbacks = 0;

    const startTime = Date.now();

    // Spawn 100 parallel tasks with varying priorities and token payloads
    const taskPromises = Array.from({ length: TOTAL_REQUESTS }, (_, i) => {
      const priority = i % 5 === 0 
        ? RequestPriority.CRITICAL 
        : (i % 2 === 0 ? RequestPriority.INTERACTIVE : RequestPriority.BACKGROUND);
      
      const promptTokens = 100;
      const completionTokens = 50;
      const expectedTotalTokens = promptTokens + completionTokens;

      return scheduler.schedule(
        async () => {
          // Simulate fast async network I/O
          await new Promise(res => setTimeout(res, 5));
          completedCount++;
          return {
            id: `req_${i}`,
            result: `response_${i}`,
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: expectedTotalTokens,
            },
          };
        },
        {
          promptTokens,
          maxTokens: 100, // reserve up to 100 completion tokens
          priority,
          onTokensUsed: (usage) => {
            totalTokensFromCallbacks += usage.totalTokens;
          },
        }
      );
    });

    const results = await Promise.all(taskPromises);
    const durationMs = Date.now() - startTime;

    // 1. Verify zero dropped requests
    assert.strictEqual(results.length, TOTAL_REQUESTS, 'All 100 requests must resolve successfully');
    assert.strictEqual(completedCount, TOTAL_REQUESTS, 'All 100 requests must complete');

    // 2. Verify scheduler metrics
    const metrics = scheduler.getStatus();
    assert.strictEqual(metrics.totalDispatched, TOTAL_REQUESTS, '100 requests must be dispatched');
    assert.strictEqual(metrics.totalThrottled, 0, 'Zero requests should be throttled under allowable capacity');
    assert.strictEqual(metrics.queueDepth.total, 0, 'All queues must be completely drained');

    // 3. Verify token accounting
    const expectedTokensTotal = TOTAL_REQUESTS * 150;
    assert.strictEqual(totalTokensFromCallbacks, expectedTokensTotal, 'Token callback must account for all tokens');
    assert.strictEqual(metrics.totalTokensProcessed, expectedTokensTotal, 'Scheduler telemetry must record exact tokens');

    // 4. Verify high throughput execution
    assert.strictEqual(durationMs < 2000, true, `100 parallel requests completed in ${durationMs}ms (expected < 2000ms)`);

    scheduler.destroy();
  });

  it('preserves strict priority dispatching under high concurrency load', async () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 6000,
      tpmLimit: 1_000_000,
      maxConcurrency: 2, // low concurrency to force queueing
      leakyBucketIntervalMs: 0,
    });

    const executionLog: string[] = [];

    // Hold the slots with two initial tasks
    const hold1 = scheduler.schedule(
      () => new Promise(res => setTimeout(() => { executionLog.push('hold1'); res('h1'); }, 40)),
      { priority: RequestPriority.BACKGROUND }
    );
    const hold2 = scheduler.schedule(
      () => new Promise(res => setTimeout(() => { executionLog.push('hold2'); res('h2'); }, 40)),
      { priority: RequestPriority.BACKGROUND }
    );

    // Enqueue 5 background tasks first
    const bgTasks = Array.from({ length: 5 }, (_, i) =>
      scheduler.schedule(
        async () => { executionLog.push(`bg_${i}`); return `bg_${i}`; },
        { priority: RequestPriority.BACKGROUND }
      )
    );

    // Enqueue 2 critical tasks second
    const critTasks = Array.from({ length: 2 }, (_, i) =>
      scheduler.schedule(
        async () => { executionLog.push(`crit_${i}`); return `crit_${i}`; },
        { priority: RequestPriority.CRITICAL }
      )
    );

    await Promise.all([hold1, hold2, ...bgTasks, ...critTasks]);

    // All critical tasks must be dispatched before queued background tasks
    const firstCrit = executionLog.indexOf('crit_0');
    const firstBgAfterHolds = executionLog.findIndex(e => e.startsWith('bg_'));
    assert.strictEqual(firstCrit < firstBgAfterHolds, true, 'CRITICAL tasks must execute before BACKGROUND tasks');

    scheduler.destroy();
  });

  it('AIMD Concurrency Gate safely adapts without dropping scheduled tasks', async () => {
    const gate = new AimdConcurrencyGate(16, 2, 3);
    assert.strictEqual(gate.getCurrentLimit(), 2);

    // 3 successes increases concurrency
    gate.recordSuccess();
    gate.recordSuccess();
    gate.recordSuccess();
    assert.strictEqual(gate.getCurrentLimit(), 3);

    // 429 throttle cuts concurrency in half
    gate.recordThrottle();
    assert.strictEqual(gate.getCurrentLimit(), 2); // floor(3 * 0.5) = 1, bounded by minLimit 2
  });
});

describe('Stable Prefix Alignment & Prompt Caching Benchmarks', () => {
  const SAMPLE_SYSTEM_PROMPT = `You are Nomin Code, an autonomous multi-agent software engineering agent.
Follow the Definition of Done strictly:
1. All changes must pass acceptance criteria.
2. AST integrity inspector must pass with zero placeholder stubs.
3. Every file change must produce a minimal, verifiable diff.`;

  const SAMPLE_REPOMAP = `
src/
  provider/
    client.ts (NominHttpClient, computeStablePrefixHash)
    rate-limiter.ts (NominRateLimitScheduler, TokenBucket, AimdConcurrencyGate)
    types.ts (ChatMessage, ChatCompletionOptions)
  swarm/
    compaction.ts (CompactionEngine, estimateTokens)
    coordinator.ts (SwarmCoordinator)
`;

  const TOOL_READ_FILE: ToolDefinition = {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads lines of a source file within start_line and end_line bounds.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file' },
          start_line: { type: 'number', description: 'Start line (1-indexed)' },
          end_line: { type: 'number', description: 'End line (inclusive)' },
        },
        required: ['path'],
      },
    },
  };

  const TOOL_EDIT_FILE: ToolDefinition = {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Applies atomic search/replace edits or diffs to a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                search: { type: 'string' },
                replace: { type: 'string' },
              },
              required: ['search', 'replace'],
            },
          },
        },
        required: ['path', 'edits'],
      },
    },
  };

  const TOOL_BASH: ToolDefinition = {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Executes a sandboxed shell command and returns output with exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command string' },
          timeout_ms: { type: 'number', description: 'Execution timeout in ms' },
        },
        required: ['command'],
      },
    },
  };

  const TOOL_SEARCH_GREP: ToolDefinition = {
    type: 'function',
    function: {
      name: 'search_grep',
      description: 'Searches for regex patterns across workspace files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex query string' },
          path_pattern: { type: 'string', description: 'Optional glob pattern' },
        },
        required: ['pattern'],
      },
    },
  };

  it('produces identical SHA-256 stable prefix hash across multiple turns regardless of tool order', () => {
    // Turn 1: Tools in standard order [read_file, edit_file, bash, search_grep]
    const toolsTurn1 = [TOOL_READ_FILE, TOOL_EDIT_FILE, TOOL_BASH, TOOL_SEARCH_GREP];
    const hashTurn1 = computeStablePrefixHash(SAMPLE_SYSTEM_PROMPT, toolsTurn1, SAMPLE_REPOMAP);

    // Turn 2: Tools passed in completely reversed order [search_grep, bash, edit_file, read_file]
    const toolsTurn2 = [TOOL_SEARCH_GREP, TOOL_BASH, TOOL_EDIT_FILE, TOOL_READ_FILE];
    const hashTurn2 = computeStablePrefixHash(SAMPLE_SYSTEM_PROMPT, toolsTurn2, SAMPLE_REPOMAP);

    // Turn 3: Tools passed in random shuffle order
    const toolsTurn3 = [TOOL_EDIT_FILE, TOOL_SEARCH_GREP, TOOL_READ_FILE, TOOL_BASH];
    const hashTurn3 = computeStablePrefixHash(SAMPLE_SYSTEM_PROMPT, toolsTurn3, SAMPLE_REPOMAP);

    // Assert 100% prefix hash stability
    assert.strictEqual(typeof hashTurn1, 'string');
    assert.strictEqual(hashTurn1.length, 64, 'SHA-256 hash must be 64 hex characters');
    assert.strictEqual(hashTurn2, hashTurn1, 'Reversing tools array must produce identical SHA-256 hash');
    assert.strictEqual(hashTurn3, hashTurn1, 'Shuffling tools array must produce identical SHA-256 hash');
  });

  it('guarantees parameter properties key order invariance in tool schemas', () => {
    // Tool with properties key order: { path, start_line, end_line }
    const toolA: ToolDefinition = {
      type: 'function',
      function: {
        name: 'test_tool',
        description: 'Test description',
        parameters: {
          type: 'object',
          properties: {
            z_last: { type: 'string' },
            a_first: { type: 'string' },
            m_middle: { type: 'string' },
          },
        },
      },
    };

    // Tool with properties key order reversed: { a_first, m_middle, z_last }
    const toolB: ToolDefinition = {
      type: 'function',
      function: {
        name: 'test_tool',
        description: 'Test description',
        parameters: {
          type: 'object',
          properties: {
            a_first: { type: 'string' },
            z_last: { type: 'string' },
            m_middle: { type: 'string' },
          },
        },
      },
    };

    const canonicalA = canonicalizeTools([toolA])!;
    const canonicalB = canonicalizeTools([toolB])!;

    assert.strictEqual(
      JSON.stringify(canonicalA),
      JSON.stringify(canonicalB),
      'Canonicalized tool parameter schemas must be byte-for-byte identical'
    );
  });

  it('NominHttpClient exposes computeStablePrefixHash and instance method', () => {
    const client = new NominHttpClient({
      config: {
        id: 'nim-test',
        name: 'NVIDIA NIM',
        type: 'nvidia-nim',
        baseURL: 'https://integrate.api.nvidia.com/v1',
      },
    });

    const messagesTurn1: ChatMessage[] = [
      { role: 'system', content: SAMPLE_SYSTEM_PROMPT },
      { role: 'user', content: 'Turn 1 user prompt' },
    ];

    const messagesTurn2: ChatMessage[] = [
      { role: 'system', content: SAMPLE_SYSTEM_PROMPT },
      { role: 'user', content: 'Turn 1 user prompt' },
      { role: 'assistant', content: 'Turn 1 assistant answer' },
      { role: 'user', content: 'Turn 2 user prompt' },
    ];

    const hash1 = client.computeStablePrefixHash({
      model: 'deepseek-ai/deepseek-r1',
      messages: messagesTurn1,
      tools: [TOOL_BASH, TOOL_READ_FILE],
    }, SAMPLE_REPOMAP);

    const hash2 = client.computeStablePrefixHash({
      model: 'deepseek-ai/deepseek-r1',
      messages: messagesTurn2,
      tools: [TOOL_READ_FILE, TOOL_BASH], // reversed order
    }, SAMPLE_REPOMAP);

    assert.strictEqual(hash1, hash2, 'Client computeStablePrefixHash must match across turns');
    client.destroy();
  });

  it('verifies HTTP keep-alive connection pooling agent configuration', () => {
    const client = new NominHttpClient({
      config: {
        id: 'nim',
        name: 'NVIDIA NIM',
        type: 'nvidia-nim',
        baseURL: 'https://integrate.api.nvidia.com/v1',
        maxSockets: 64,
        keepAliveMsecs: 60000,
      },
    });

    const httpAgent = client.getHttpAgent();
    const httpsAgent = client.getHttpsAgent();

    assert.strictEqual((httpAgent as any).keepAlive, true, 'HTTP keepAlive must be true');
    assert.strictEqual((httpAgent as any).keepAliveMsecs, 60000, 'HTTP keepAliveMsecs must be 60000');
    assert.strictEqual((httpAgent as any).maxSockets, 64, 'HTTP maxSockets must match config');
    assert.strictEqual((httpAgent as any).maxFreeSockets >= 16, true, 'HTTP maxFreeSockets must be >= 16');

    assert.strictEqual((httpsAgent as any).keepAlive, true, 'HTTPS keepAlive must be true');
    assert.strictEqual((httpsAgent as any).keepAliveMsecs, 60000, 'HTTPS keepAliveMsecs must be 60000');
    assert.strictEqual((httpsAgent as any).maxSockets, 64, 'HTTPS maxSockets must match config');
    assert.strictEqual((httpsAgent as any).maxFreeSockets >= 16, true, 'HTTPS maxFreeSockets must be >= 16');

    client.destroy();
  });
});

describe('Context Compaction Engine Benchmarks', () => {
  it('proactively triggers compaction when context approaches 80% of model window', () => {
    const engine = new CompactionEngine({
      contextWindow: 100_000,
      bufferShare: 0.20, // 20% reserved buffer -> compaction triggers at 80% (80,000 tokens)
    });

    const thresholds = engine.getThresholds();
    assert.strictEqual(thresholds.windowSize, 100_000);
    assert.strictEqual(thresholds.effectiveBuffer, 20_000);
    assert.strictEqual(thresholds.compactionThreshold, 80_000);

    // Context below threshold (50,000 tokens) -> should not compact
    const messagesBelow: ChatMessage[] = [
      { role: 'user', content: 'A'.repeat(50_000 * 4) },
    ];
    assert.strictEqual(engine.shouldCompact(messagesBelow), false);

    // Context above threshold (85,000 tokens) -> triggers proactive compaction
    const messagesAbove: ChatMessage[] = [
      { role: 'user', content: 'A'.repeat(85_000 * 4) },
    ];
    assert.strictEqual(engine.shouldCompact(messagesAbove), true);
  });

  it('compacts a 50-turn conversational history down to <= 20% tokens while preserving 100% of critical file diffs and DoD criteria', async () => {
    const engine = new CompactionEngine({
      contextWindow: 25_000,
      bufferShare: 0.20,
      keepTokens: 2_000,
    });

    // 1. Construct realistic 50-turn conversational history
    const CRITICAL_DOD_CRITERIA = [
      'Criterion 1: npm test passes with exit code 0 and zero regressions',
      'Criterion 2: AstIntegrityInspector validates no placeholder stubs or skipped assertions',
      'Criterion 3: Zero 429 rate limit drops under 100 parallel requests saturation',
    ];

    const CRITICAL_DIFF_1 = [
      'diff --git a/src/provider/client.ts b/src/provider/client.ts',
      '--- a/src/provider/client.ts',
      '+++ b/src/provider/client.ts',
      '@@ -70,3 +70,4 @@',
      '+keepAlive: true,',
      '+keepAliveMsecs: 60000,',
      '+maxSockets: 64,',
    ].join('\n');

    const CRITICAL_DIFF_2 = [
      '<<<<<<< SEARCH',
      'const maxSockets = 16;',
      '=======',
      'const maxSockets = 64;',
      '>>>>>>> REPLACE',
    ].join('\n');

    const TEST_FAILURE_LOG = [
      'FAIL tests/provider.test.ts',
      '  ● NominRateLimitScheduler > handles throughput saturation',
      '    AssertionError: expected status 200 but received 429',
      '    at verifyThroughput (tests/provider.test.ts:142)',
      '    exitCode: 1',
    ].join('\n');

    const history: ChatMessage[] = [];

    // Turn 0: System Prompt Anchor
    history.push({
      role: 'system',
      content: 'You are Nomin Code, an autonomous coding agent.',
    });

    // Turn 1: Initial user task with acceptance criteria (DoD)
    history.push({
      role: 'user',
      content: [
        'Task: Optimize LLM throughput and ensure prompt cache stability.',
        'Definition of Done (DoD) Criteria:',
        ...CRITICAL_DOD_CRITERIA.map(c => `- [ ] ${c}`),
      ].join('\n'),
    });

    // Turn 2: Assistant plan
    history.push({
      role: 'assistant',
      content: 'I will analyze provider client connection pooling and rate limit scheduler.',
    });

    // Turns 3-8: Verbose read_file tool calls
    for (let i = 3; i <= 8; i++) {
      history.push({
        role: 'assistant',
        content: null,
        toolCalls: [{
          id: `call_read_${i}`,
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify({ path: `src/module_${i}.ts` }) },
        }],
      });
      // 500 lines of verbose code read (~2,000 tokens per message)
      const verboseCode = Array.from({ length: 400 }, (_, line) => `const var_${line} = performComputation(${line}); // line comment`).join('\n');
      history.push({
        role: 'tool',
        toolCallId: `call_read_${i}`,
        content: `[TOOL RESULT: read_file src/module_${i}.ts]\n${verboseCode}`,
      });
    }

    // Turn 9-10: File edit with Critical Diff 1
    history.push({
      role: 'assistant',
      content: 'Applying HTTP keep-alive connection pooling patch to client.ts:\n' + CRITICAL_DIFF_1,
    });
    history.push({
      role: 'tool',
      content: `[TOOL RESULT: edit_file applied successfully]\n${CRITICAL_DIFF_1}`,
    });

    // Turns 11-16: Verbose search_grep tool calls
    for (let i = 11; i <= 16; i++) {
      history.push({
        role: 'assistant',
        content: `Searching for token rate limits pattern ${i}`,
      });
      const verboseGrep = Array.from({ length: 300 }, (_, match) => `src/file_${match}.ts:42: const rpmLimit = 6000;`).join('\n');
      history.push({
        role: 'tool',
        content: `[TOOL RESULT: search_grep results]\n${verboseGrep}`,
      });
    }

    // Turn 17-18: Edit file with Critical Diff 2 (Aider format)
    history.push({
      role: 'assistant',
      content: 'Updating socket pool configuration in rate-limiter.ts:\n' + CRITICAL_DIFF_2,
    });
    history.push({
      role: 'tool',
      content: `[TOOL RESULT: patch applied]\n${CRITICAL_DIFF_2}`,
    });

    // Turn 19-20: Test run with failure evidence
    history.push({
      role: 'assistant',
      content: 'Running test suite via bash tool: npm test',
    });
    history.push({
      role: 'tool',
      content: `[TOOL RESULT: bash npm test]\n${TEST_FAILURE_LOG}`,
    });

    // Turns 21-48: Iterative coder-tester exchanges, directory listings, verbose logs
    for (let turn = 21; turn <= 48; turn++) {
      history.push({
        role: turn % 2 === 1 ? 'assistant' : 'tool',
        content: `Turn ${turn} intermediate trace log: ${'X'.repeat(800)}`,
      });
    }

    // Turns 49-50: Recent user follow-up and assistant answer
    history.push({
      role: 'user',
      content: 'Verify all criteria pass cleanly with zero drops.',
    });
    history.push({
      role: 'assistant',
      content: 'All unit test criteria verified and release gate passed.',
    });

    assert.strictEqual(history.length >= 50, true, 'History must contain at least 50 conversational turns');

    const originalTokens = estimateTokens(history);
    assert.strictEqual(originalTokens > 20_000, true, `Original conversation should be verbose (got ${originalTokens} tokens)`);

    // 2. Execute compaction
    const result = await engine.compact(history, 'auto');

    // 3. Verify compaction executed
    assert.strictEqual(result.compacted, true, 'Engine must compact the conversation history');
    assert.strictEqual(result.reason, 'auto');

    // 4. Verify token reduction down to <= 20% of original tokens
    const reductionRatio = result.newTokens / result.previousTokens;
    assert.strictEqual(
      reductionRatio <= 0.20,
      true,
      `Compacted tokens (${result.newTokens}) must be <= 20% of original (${result.previousTokens}). Ratio: ${(reductionRatio * 100).toFixed(1)}%`
    );

    // 5. Verify 100% preservation of Definition of Done criteria
    const summaryText = result.summaryText ?? '';
    for (const criterion of CRITICAL_DOD_CRITERIA) {
      assert.strictEqual(
        summaryText.includes(criterion),
        true,
        `DoD Criterion "${criterion}" must be 100% preserved in compacted summary`
      );
    }

    // 6. Verify 100% preservation of Critical File Diffs
    assert.strictEqual(
      summaryText.includes('keepAlive: true'),
      true,
      'Critical Diff 1 (keepAlive: true) must be preserved in compacted summary'
    );
    assert.strictEqual(
      summaryText.includes('keepAliveMsecs: 60000'),
      true,
      'Critical Diff 1 (keepAliveMsecs: 60000) must be preserved in compacted summary'
    );
    assert.strictEqual(
      summaryText.includes('<<<<<<< SEARCH') && summaryText.includes('const maxSockets = 64;'),
      true,
      'Critical Diff 2 (Aider SEARCH/REPLACE block) must be preserved in compacted summary'
    );

    // 7. Verify preservation of Test Failure Logs
    assert.strictEqual(
      summaryText.includes('AssertionError') || summaryText.includes('FAIL tests/provider.test.ts'),
      true,
      'Test failure evidence must be preserved in compacted summary'
    );

    // 8. Verify user goal objective preservation
    assert.strictEqual(
      summaryText.toLowerCase().includes('optimize llm throughput'),
      true,
      'User goal must be preserved in compacted summary'
    );
  });
});
