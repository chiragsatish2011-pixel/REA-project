import { CompactionEngine, estimateTokens } from '../src/swarm/compaction.js';
import type { ChatMessage } from '../src/types.js';

const engine = new CompactionEngine({
  contextWindow: 25_000,
  bufferShare: 0.20,
  keepTokens: 2_000,
});

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

history.push({
  role: 'system',
  content: 'You are Nomin Code, an autonomous coding agent.',
});

history.push({
  role: 'user',
  content: [
    'Task: Optimize LLM throughput and ensure prompt cache stability.',
    'Definition of Done (DoD) Criteria:',
    ...CRITICAL_DOD_CRITERIA.map(c => `- [ ] ${c}`),
  ].join('\n'),
});

history.push({
  role: 'assistant',
  content: 'I will analyze provider client connection pooling and rate limit scheduler.',
});

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
  const verboseCode = Array.from({ length: 400 }, (_, line) => `const var_${line} = performComputation(${line}); // line comment`).join('\n');
  history.push({
    role: 'tool',
    toolCallId: `call_read_${i}`,
    content: `[TOOL RESULT: read_file src/module_${i}.ts]\n${verboseCode}`,
  });
}

history.push({
  role: 'assistant',
  content: 'Applying HTTP keep-alive connection pooling patch to client.ts:\n' + CRITICAL_DIFF_1,
});
history.push({
  role: 'tool',
  content: `[TOOL RESULT: edit_file applied successfully]\n${CRITICAL_DIFF_1}`,
});

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

history.push({
  role: 'assistant',
  content: 'Updating socket pool configuration in rate-limiter.ts:\n' + CRITICAL_DIFF_2,
});
history.push({
  role: 'tool',
  content: `[TOOL RESULT: patch applied]\n${CRITICAL_DIFF_2}`,
});

history.push({
  role: 'assistant',
  content: 'Running test suite via bash tool: npm test',
});
history.push({
  role: 'tool',
  content: `[TOOL RESULT: bash npm test]\n${TEST_FAILURE_LOG}`,
});

for (let turn = 21; turn <= 48; turn++) {
  history.push({
    role: turn % 2 === 1 ? 'assistant' : 'tool',
    content: `Turn ${turn} intermediate trace log: ${'X'.repeat(800)}`,
  });
}

history.push({
  role: 'user',
  content: 'Verify all criteria pass cleanly with zero drops.',
});
history.push({
  role: 'assistant',
  content: 'All unit test criteria verified and release gate passed.',
});

async function main() {
  const result = await engine.compact(history, 'auto');
  console.log('Compacted:', result.compacted);
  console.log('Summary Text:\n', result.summaryText);
  console.log('AssertionError present?', result.summaryText?.includes('AssertionError'));
  console.log('FAIL present?', result.summaryText?.includes('FAIL tests/provider.test.ts'));
}

main().catch(console.error);
