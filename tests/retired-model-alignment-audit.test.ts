/**
 * Comprehensive Audit Test Suite:
 * 1. Model retirement lifecycle & HTTP 410 protection
 * 2. ModelPicker visual alignment & column padding invariance
 * 3. TerminalUI boot logo horizontal alignment centering relative to header card
 * 4. ModelPicker exclusion of retired models
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ConfigManager } from '../src/config/index.js';
import { ModelPicker } from '../src/cli/model-picker.js';
import { TerminalUI } from '../src/cli/ui.js';
import type { DiscoveredModel } from '../src/provider/types.js';

describe('Model Retirement Lifecycle & 410 Gone Audit', () => {
  it('ConfigManager ignores retired models when selecting initial activeModel', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-retire-test-'));
    const origGlobalDir = process.env.NOMIN_GLOBAL_DIR;
    process.env.NOMIN_GLOBAL_DIR = tempDir;
    try {
      const globalCfgPath = path.join(tempDir, 'config.json');
      // Simulate user's exact state where retired model is in selectedModels and retiredModels
      fs.writeFileSync(
        globalCfgPath,
        JSON.stringify({
          activeProvider: 'nim',
          selectedModels: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-v4.1-flash'],
          retiredModels: {
            'meta/llama-3.3-70b-instruct': 'EOL on 2026-08-26',
          },
        }),
        'utf8'
      );

      ConfigManager.resetInstance();
      const cfgMgr = ConfigManager.getInstance(tempDir);
      const cfg = cfgMgr.getConfig();

      // Must NOT select the retired model!
      assert.notStrictEqual(cfg.activeModel, 'meta/llama-3.3-70b-instruct');
      // Must fall back to the live non-retired model
      assert.strictEqual(cfg.activeModel, 'deepseek-ai/deepseek-v4.1-flash');
      assert.strictEqual(cfgMgr.isModelRetired('meta/llama-3.3-70b-instruct'), true);
    } finally {
      if (origGlobalDir !== undefined) process.env.NOMIN_GLOBAL_DIR = origGlobalDir;
      else delete process.env.NOMIN_GLOBAL_DIR;
      fs.rmSync(tempDir, { recursive: true, force: true });
      ConfigManager.resetInstance();
    }
  });

  it('ModelPicker strictly excludes retired models from active selection list', () => {
    const models: DiscoveredModel[] = [
      {
        id: 'meta/llama-3.3-70b-instruct',
        providerId: 'nim',
        publisher: 'meta',
        modelType: 'chat',
        contextWindow: 128000,
        supportsTools: true,
        supportsReasoning: true,
      },
      {
        id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        providerId: 'nim',
        publisher: 'nvidia',
        modelType: 'chat',
        contextWindow: 128000,
        supportsTools: true,
        supportsReasoning: true,
      },
    ];

    const picker = new ModelPicker({
      models,
      activeModel: 'meta/llama-3.3-70b-instruct',
      retiredModels: {
        'meta/llama-3.3-70b-instruct': 'Model retired on 2026-08-26',
      },
      providerName: 'NVIDIA NIM',
    });

    const rendered = picker.render();
    const joined = rendered.join('\n');

    // Retired model must be filtered out
    assert.ok(!joined.includes('meta/llama-3.3-70b-instruct'));
    // Active non-retired model must be visible
    assert.ok(joined.includes('nvidia/llama-3.1-nemotron-ultra-253b-v1'));
  });
});

describe('TUI Visual Alignment & Column Layout Invariants', () => {
  it('ModelPicker aligns selected and unselected row text to the exact same visual column', () => {
    const models: DiscoveredModel[] = [
      {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct',
        providerId: 'nim',
        publisher: 'nvidia',
        modelType: 'chat',
        contextWindow: 128000,
        supportsTools: true,
        supportsReasoning: true,
      },
      {
        id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        providerId: 'nim',
        publisher: 'nvidia',
        modelType: 'chat',
        contextWindow: 128000,
        supportsTools: true,
        supportsReasoning: true,
      },
    ];

    const picker = new ModelPicker({
      models,
      providerName: 'NVIDIA NIM',
    });

    const rendered = picker.render();
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const modelLines = rendered.filter(l => /^\s{2,4}(?:>|\s)\s*nvidia\/llama-3\.1-nemotron/.test(stripAnsi(l)));
    assert.strictEqual(modelLines.length, 2);
    const line0Plain = stripAnsi(modelLines[0]); // selected row (index 0)
    const line1Plain = stripAnsi(modelLines[1]); // unselected row (index 1)

    // Leading space indent before model name MUST be identical!
    const line0Indent = line0Plain.indexOf('nvidia/llama-3.1-nemotron');
    const line1Indent = line1Plain.indexOf('nvidia/llama-3.1-nemotron');

    assert.strictEqual(
      line0Indent,
      line1Indent,
      `Row text column misalignment: selected row has indent ${line0Indent}, unselected has ${line1Indent}`
    );
    assert.strictEqual(line0Indent, 4, 'Columns should be aligned with exact 4-space indent');
  });

  it('TerminalUI printBootSequence centers block logo relative to the header card width', () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: any) => {
      captured += (msg || '') + '\n';
    };

    try {
      TerminalUI.printBootSequence({
        version: '1.0.0',
        providerName: 'NVIDIA NIM',
        providerUrl: 'https://integrate.api.nvidia.com/v1',
        workdir: 'C:\\Windows\\system32',
        mode: 'solo',
        activeModel: 'deepseek-ai/deepseek-v4.1-flash',
        roles: {},
        selectedModels: [],
        reasoningEffort: 'medium',
        rpmLimit: 120,
        tpmLimit: 300000,
        concurrency: 4,
      });
    } finally {
      console.log = origLog;
    }

    assert.ok(captured.includes('NOMIN CODE'));
    assert.ok(captured.includes('█▄ █'));

    // Verify logo is not shifted 40+ spaces to the right
    const logoLine = captured.split('\n').find(l => l.includes('█▄ █')) || '';
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const plainLogo = stripAnsi(logoLine);
    const leadingSpaces = plainLogo.length - plainLogo.trimStart().length;

    assert.ok(leadingSpaces >= 15 && leadingSpaces <= 26, `Logo leading spaces (${leadingSpaces}) should be centered relative to ~78 col card`);
  });
});
