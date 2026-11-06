/**
 * @file reproduce-phase-a.ts
 * @description Phase A Measurement and Reproduction against live NVIDIA NIM endpoint.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { NominHttpClient, requestLedger, RequestLedger } from '../src/provider/client.js';
import { BuildStampEngine } from '../src/config/build-stamp.js';

async function main() {
  const stamp = BuildStampEngine.formatOneLine();
  console.log(`=== PHASE A MEASUREMENT & REPRODUCTION ===`);
  console.log(`Build Stamp: ${stamp}\n`);

  // 1. Load user config
  const configPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.nomin', 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found at ${configPath}`);
    process.exit(1);
  }

  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const nimConfig = rawConfig.providers.nim;
  const targetModel = 'nvidia/nemotron-3-ultra-550b-a55b';

  console.log(`Provider: NVIDIA NIM`);
  console.log(`Target Model: ${targetModel}`);
  console.log(`Base URL: ${nimConfig.baseUrl}`);
  console.log(`API Key: ${nimConfig.apiKey ? nimConfig.apiKey.slice(0, 8) + '...' + nimConfig.apiKey.slice(-4) : 'none'}\n`);

  requestLedger.clear();

  const client = new NominHttpClient({
    config: {
      id: 'nim',
      type: 'nvidia-nim',
      baseURL: nimConfig.baseUrl,
      apiKey: nimConfig.apiKey,
      rateLimit: { maxRetries: 0 },
    },
  });

  // Step 1: Normal Single Turn Call (200 OK)
  console.log(`--- Step 1: Baseline Single Turn Call ---`);
  const t1Start = Date.now();
  let t1Text = '';
  try {
    for await (const chunk of client.chatStream({
      model: targetModel,
      messages: [{ role: 'user', content: 'Say hello in 3 words.' }],
      purpose: 'chat',
      maxTokens: 25,
    })) {
      if (chunk.type === 'text-delta') {
        t1Text += chunk.text;
      }
    }
    console.log(`Turn 1 Response: "${t1Text.trim()}" in ${Date.now() - t1Start}ms`);
  } catch (err: any) {
    console.error(`Turn 1 failed:`, err.message);
  }

  const entriesAfterT1 = requestLedger.getAll();
  const t1Entry = entriesAfterT1[entriesAfterT1.length - 1];
  console.log(`\n[200 OK Headers Captured - Sanitized]:`);
  console.log(JSON.stringify(t1Entry.rateLimitHeaders.rawHeaders, null, 2));

  // Step 2: Hidden Calls Investigation (Catalog discovery & Capability probe)
  console.log(`\n--- Step 2: Hidden Calls Investigation ---`);
  console.log(`Investigating if background operations add load...`);
  try {
    console.log(`Executing background model catalog listModels()...`);
    await client.listModels();
  } catch (err: any) {
    console.log(`listModels result: ${err.message}`);
  }

  console.log(`Ledger after Step 2:`);
  console.log(requestLedger.formatSummaryTable(10));

  // Step 3: Burst calls to identify exact upstream throttling threshold
  console.log(`\n--- Step 3: Rapid Burst Dispatch to Measure 429 Threshold ---`);
  console.log(`Sending rapid burst of 8 concurrent requests to ${targetModel}...`);

  const burstPromises = [];
  for (let i = 0; i < 8; i++) {
    const burstCall = async (index: number) => {
      const callPurpose = index === 0 ? 'chat' : 'tool-continuation';
      try {
        let text = '';
        for await (const chunk of client.chatStream({
          model: targetModel,
          messages: [{ role: 'user', content: `Quick test item #${index}` }],
          purpose: callPurpose,
          maxTokens: 10,
        })) {
          if (chunk.type === 'text-delta') text += chunk.text;
        }
        return { index, status: 200, text };
      } catch (err: any) {
        return { index, status: err.status || 500, error: err.message };
      }
    };
    burstPromises.push(burstCall(i));
  }

  const burstResults = await Promise.all(burstPromises);
  console.log(`Burst results completed.`);

  for (const res of burstResults) {
    console.log(`Call #${res.index} -> Status: ${res.status} ${res.error ? `(${res.error})` : ''}`);
  }

  // Step 4: Examine 429 ledger entries
  const allEntries = requestLedger.getAll();
  const error429Entries = allEntries.filter(e => e.status === 429);

  console.log(`\n--- Step 4: 429 Rate Limit Incident Analysis ---`);
  console.log(`Total 429 incidents: ${error429Entries.length}`);

  if (error429Entries.length > 0) {
    const first429 = error429Entries[0];
    const calls60sAtIncident = requestLedger.getCallsLast60Seconds(first429.timestamp).length;
    console.log(`First 429 occurred at: ${first429.isoTime}`);
    console.log(`Calls in the last 60 seconds at time of 429: ${calls60sAtIncident}`);
    console.log(`429 Latency: ${first429.latencyMs}ms`);
    console.log(`429 Response Headers (sanitized):`);
    console.log(JSON.stringify(first429.rateLimitHeaders.rawHeaders, null, 2));
    console.log(`Extracted RateLimit details:`, {
      retryAfter: first429.rateLimitHeaders.retryAfter,
      remainingRequests: first429.rateLimitHeaders.remainingRequests,
      limitRequests: first429.rateLimitHeaders.limitRequests,
    });
  }

  // Final summary table
  console.log(`\n--- Full Request Ledger Summary ---`);
  console.log(requestLedger.formatSummaryTable(20));

  client.destroy();
}

main().catch(console.error);
