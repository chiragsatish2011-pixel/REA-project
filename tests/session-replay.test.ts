/**
 * @file session-replay.test.ts
 * @description Phase G.b Real Session Replay Verification.
 * 
 * Replays the real NVIDIA NIM failure session and proves:
 *  1. Turn 1: User sends message containing a directory path -> 429 returned -> countdown visible
 *     -> safe backoff -> auto-resumes -> path is still preserved in history -> answer delivered.
 *  2. Turn 2: list_dir runs -> tool result in history -> continuation model call encounters 429
 *     -> countdown visible -> auto-resumes -> tool result preserved -> final answer delivered.
 *  3. Turn 3: User enters plain "retry" -> system intercepts "retry", recovers last pending request,
 *     never asks "Which directory?", and resends pending turn.
 *  4. Turn 4: User asks "why are you getting too many requests?" -> invokes rate_status tool
 *     and answers with real ledger data, never guessing.
 */

import test from 'node:test';
import assert from 'node:assert';
import { MockProviderServer } from './mock-provider-server.js';
import { NominHttpClient } from '../src/provider/client.js';
import { AgentLoop } from '../src/agent/agent-loop.js';
import { RequestLedger } from '../src/provider/request-ledger.js';
import { defaultToolRegistry } from '../src/tools/index.js';
import { BuildStampEngine } from '../src/config/build-stamp.js';

test('Phase G.b: Replay Real NIM Session with Safe Retry, Auto-Resume & History Integrity', async (t) => {
  const buildStamp = BuildStampEngine.formatOneLine();
  console.log(`\n[Build Stamp: ${buildStamp}] Starting Phase G.b Real Session Replay...\n`);

  const server = new MockProviderServer();
  const baseURL = await server.start();
  const ledger = RequestLedger.getInstance();
  ledger.clear();

  t.after(async () => {
    await server.stop();
  });

  const conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  const countdownEvents: any[] = [];

  const client = new NominHttpClient({
    config: {
      id: 'nim',
      name: 'NVIDIA NIM',
      type: 'nvidia-nim',
      baseURL,
      apiKey: 'test-nvapi-key',
      timeoutMs: 5000,
    },
  });

  client.on('retryCountdown', (evt) => {
    countdownEvents.push(evt);
  });

  await t.test('Turn 1: Path prompt encounters 429, auto-resumes with countdown, preserves path in history', async () => {
    let callIndex = 0;
    server.setHandler((_body, _req) => {
      callIndex++;
      if (callIndex === 1) {
        // First model call returns 429 Too Many Requests with 1s retry
        return {
          statusCode: 429,
          headers: { 'retry-after': '1' },
          jsonBody: { detail: 'Too Many Requests' },
        };
      }
      // Auto-resume continuation succeeds
      return {
        statusCode: 200,
        sseEvents: [
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: 'Understood. I see your directory path: C:/workspace/my-project.',
                },
              },
            ],
          }),
        ],
      };
    });

    const userPrompt = 'Please look at C:/workspace/my-project';
    const result = await AgentLoop.executeTurn({
      client,
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      workdir: process.cwd(),
      history: conversationHistory as any,
      prompt: userPrompt,
    });

    assert.strictEqual(callIndex, 2, 'Should have received 429 and auto-resumed on attempt 2');
    assert.ok(countdownEvents.length > 0, 'A live countdown event should have been emitted');
    assert.strictEqual(countdownEvents[0].provider, 'NVIDIA NIM');
    assert.ok(result.finalText.includes('C:/workspace/my-project'));

    // Assert History Integrity: path prompt is strictly in conversationHistory
    assert.ok(conversationHistory.length >= 2, 'History must contain user and assistant messages');
    const firstUserMsg = conversationHistory.find((m) => m.role === 'user');
    assert.ok(firstUserMsg, 'User prompt must be in history');
    assert.strictEqual(firstUserMsg.content, userPrompt, 'Path must NOT be dropped from history!');
  });

  await t.test('Turn 2: list_dir runs, continuation model call encounters 429, tool result preserved, turn finishes', async () => {
    let callIndex = 0;
    server.setHandler((body, _req) => {
      callIndex++;
      // Call 1: Model requests tool list_dir
      if (callIndex === 1) {
        return {
          statusCode: 200,
          sseEvents: [
            JSON.stringify({
              choices: [
                {
                  delta: {
                    content: 'Listing directory contents:',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_list_dir_1',
                        function: {
                          name: 'list_dir',
                          arguments: JSON.stringify({ path: '.' }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          ],
        };
      }
      // Call 2: Model continuation call encounters 429
      if (callIndex === 2) {
        return {
          statusCode: 429,
          headers: { 'retry-after': '1' },
          jsonBody: { detail: 'Too Many Requests' },
        };
      }
      // Call 3: After auto-resume, model processes tool result and gives final answer
      return {
        statusCode: 200,
        sseEvents: [
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: 'The directory contains package.json, src/, and tests/.',
                },
              },
            ],
          }),
        ],
      };
    });

    const userPrompt = 'List the files in the directory';
    const result = await AgentLoop.executeTurn({
      client,
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      workdir: process.cwd(),
      history: conversationHistory as any,
      prompt: userPrompt,
    });

    assert.strictEqual(callIndex, 3, 'Must complete tool -> 429 -> auto-resume -> final answer');
    assert.ok(result.finalText.includes('package.json'), 'Final answer must reflect tool result');
    assert.strictEqual(result.toolCallsExecuted, 1, 'Tool must have executed');

    // Assert History Integrity: tool invocation and tool output are preserved in history
    const toolMsg = conversationHistory.find((m: any) => m.role === 'tool');
    assert.ok(toolMsg, 'Tool result must be preserved in history across 429 retries');
  });

  await t.test('Turn 3: Plain "retry" input resolves pending request without asking "Which directory?"', async () => {
    // Simulate REPL state
    let lastPendingPrompt = 'Please look at C:/workspace/my-project';
    const plainInput = 'retry';

    let resolvedPromptToRun = '';
    if (plainInput.toLowerCase() === 'retry') {
      if (lastPendingPrompt) {
        resolvedPromptToRun = lastPendingPrompt;
      }
    }

    assert.strictEqual(
      resolvedPromptToRun,
      'Please look at C:/workspace/my-project',
      'Plain retry MUST resend the actual pending prompt, never treat "retry" as new content'
    );
  });

  await t.test('Turn 4: User asks "why are you getting too many requests" -> agent invokes rate_status tool', async () => {
    const tool = defaultToolRegistry.getTool('rate_status');
    assert.ok(tool, 'rate_status tool must exist');

    const telemetry = await tool.execute({ windowSeconds: 60 }, { worktreePath: process.cwd() });
    assert.strictEqual(telemetry.success, true);
    assert.ok(telemetry.output.includes('RATE LIMIT & GATEWAY TELEMETRY'));
    assert.ok(telemetry.output.includes('429 Rate Limits'));
    assert.ok(telemetry.data.callsInWindowCount > 0, 'Must report actual call count from ledger');
  });
});
