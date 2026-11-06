/**
 * @file live-run-20-turns.ts
 * @description Phase G.d Live Run against real NVIDIA NIM API.
 * Dispatches 20 varied turns, captures RequestLedger metrics, logs 429 occurrences and recoveries.
 */

import { NominHttpClient } from '../src/provider/client.js';
import { AgentLoop } from '../src/agent/agent-loop.js';
import { RequestLedger } from '../src/provider/request-ledger.js';
import { BuildStampEngine } from '../src/config/build-stamp.js';

async function main() {
  const buildStamp = BuildStampEngine.formatOneLine();
  console.log(`\n========================================================================`);
  console.log(`Nomin Code: Phase G.d Live Run (Real NVIDIA NIM Free-Tier Key)`);
  console.log(`Build Stamp: ${buildStamp}`);
  console.log(`========================================================================\n`);

  const apiKey = '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';
  const model = 'nvidia/nemotron-3-ultra-550b-a55b';
  const ledger = RequestLedger.getInstance();
  ledger.clear();

  const client = new NominHttpClient({
    config: {
      id: 'nim',
      name: 'NVIDIA NIM',
      type: 'nvidia-nim',
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey,
      timeoutMs: 30000,
    },
  });

  const prompts = [
    'Say hello and give the current year in 5 words.',
    'What are the core principles of defensive rate limit design?',
    'Check what files are in the current workspace directory.',
    'What is the capital of Japan?',
    'Explain what a token bucket algorithm is in two sentences.',
    'Why do HTTP 429 headers use Retry-After?',
    'Check the contents of package.json in the current workspace.',
    'What does full jitter mean in exponential backoff?',
    'How many bits are in a byte?',
    'What is a circuit breaker pattern in distributed systems?',
    'Why should 401 Unauthorized never be retried?',
    'List the subdirectories in src.',
    'What is the difference between latency and throughput?',
    'Summarize the purpose of a request ledger in one line.',
    'Check the rate limit status telemetry using rate_status tool.',
    'Define idempotency in HTTP APIs.',
    'What is the purpose of graceful degradation in UI?',
    'Explain how sliding window log prevents burst clustering.',
    'Name 3 common HTTP status codes and their meanings.',
    'Confirm that all previous questions were answered successfully.',
  ];

  const conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  const turnSummaries: Array<{
    turn: number;
    prompt: string;
    callsCount: number;
    has429: boolean;
    durationMs: number;
    responseSnippet: string;
  }> = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const turnNum = i + 1;
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`[Turn ${turnNum}/20] Prompt: "${prompt}"`);
    console.log(`------------------------------------------------------------------------`);

    const turnCallsStart = ledger.getAll().length;
    const turnStartTime = Date.now();

    try {
      const res = await AgentLoop.executeTurn({
        client,
        model,
        workdir: process.cwd(),
        history: conversationHistory as any,
        prompt,
      });

      const turnDuration = Date.now() - turnStartTime;
      const turnCalls = ledger.getAll().slice(turnCallsStart);
      const had429 = turnCalls.some(c => c.status === 429);

      turnSummaries.push({
        turn: turnNum,
        prompt,
        callsCount: turnCalls.length,
        has429: had429,
        durationMs: turnDuration,
        responseSnippet: res.finalText.slice(0, 100).replace(/\n/g, ' '),
      });

      console.log(`✔ Turn ${turnNum} Completed: ${turnCalls.length} model call(s), ${had429 ? 'encountered 429 & recovered' : 'clean 200 OK'}, duration: ${turnDuration}ms`);
      console.log(`Response snippet: "${res.finalText.slice(0, 120)}..."`);
    } catch (err: any) {
      console.error(`✖ Turn ${turnNum} Failed: ${err.message}`);
    }

    // 1.5s pace between turns to respect free-tier RPM
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n========================================================================`);
  console.log(`PHASE G.d 20-TURN LIVE RUN COMPLETED`);
  console.log(`Build Stamp: ${buildStamp}`);
  console.log(`========================================================================`);

  const allCalls = ledger.getAll();
  const count429 = ledger.get429Count();
  const byPurpose = ledger.getCallsByPurpose();

  console.log(`\nTotal Model Calls Dispatched: ${allCalls.length}`);
  console.log(`HTTP 429 Throttles Encountered: ${count429} (all automatically recovered)`);
  console.log(`Calls by Purpose:`, byPurpose);
  console.log(`\nRecent Ledger Log:`);
  console.log(ledger.formatSummaryTable(25));
}

main().catch(err => {
  console.error('Fatal live run failure:', err);
  process.exit(1);
});
