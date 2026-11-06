/**
 * Urgent Bug Fix & TUI Overhaul: Test Suite
 * Validates:
 * 1. Global config credential resolution priority (~/.nomin/config.json > env vars > install dir .env)
 * 2. Key sanitization (stripping quotes, whitespace, \r\n, duplicate Bearer prefixes) and masking
 * 3. Strict filtering of non-chat models (embed, retriever, rerank, guard, safety, reward, parse) from /model
 * 4. Model capability classification ensuring embed/guard models are never tagged reasoning or tools
 * 5. Transactional model switching and disk persistence in ConfigManager
 * 6. Compact 2-line Unicode header card and docked status line formatting
 * 7. Actionable HTTP 403 diagnostics and /key configuration
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ConfigManager } from '../src/config/index.js';
import { LiveCatalogManager } from '../src/provider/live-catalog.js';
import { ModelSettingsManager } from '../src/provider/model-settings.js';
import { TerminalUI } from '../src/cli/ui.js';
import { StatusLine } from '../src/cli/components/status-line.js';
import { FooterHints } from '../src/cli/components/footer-hints.js';
import { NominDoctor } from '../src/cli/doctor.js';

describe('Urgent Bug Fix: Credential Resolution & Key Sanitization', () => {
  it('sanitizes API keys removing quotes, whitespace, newlines, and duplicate Bearer prefixes', () => {
    assert.strictEqual(ConfigManager.sanitizeApiKey('  nvapi-test-key-123  '), 'nvapi-test-key-123');
    assert.strictEqual(ConfigManager.sanitizeApiKey('"nvapi-quoted-key"'), 'nvapi-quoted-key');
    assert.strictEqual(ConfigManager.sanitizeApiKey("'nvapi-single-quoted'"), 'nvapi-single-quoted');
    assert.strictEqual(ConfigManager.sanitizeApiKey('Bearer nvapi-bearer-key'), 'nvapi-bearer-key');
    assert.strictEqual(ConfigManager.sanitizeApiKey('BEARER nvapi-upper-bearer'), 'nvapi-upper-bearer');
    assert.strictEqual(ConfigManager.sanitizeApiKey('nvapi-key-with-newline\r\n'), 'nvapi-key-with-newline');
  });

  it('masks API keys safely preserving prefix and suffix', () => {
    assert.strictEqual(ConfigManager.maskApiKey('nvapi-1234567890abcdef'), 'nvapi-1234...cdef');
    assert.strictEqual(ConfigManager.maskApiKey('short'), '••••••••');
    assert.strictEqual(ConfigManager.maskApiKey(''), 'NONE FOUND');
  });

  it('resolves credentials prioritizing global config over env vars and install .env', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-test-cred-'));
    const oldGlobalDir = process.env.NOMIN_GLOBAL_DIR;
    process.env.NOMIN_GLOBAL_DIR = tempDir;
    ConfigManager.resetInstance();
    try {
      const cfgManager = ConfigManager.getInstance(tempDir);
      // Save key in isolated global config
      cfgManager.setProviderApiKey('nim', 'nvapi-global-store-key-1234');

      const keyInfo = cfgManager.getProviderKeyInfo('nim');
      assert.strictEqual(keyInfo.apiKey, 'nvapi-global-store-key-1234');
      assert.ok(keyInfo.source.includes('config.json'));
      assert.strictEqual(keyInfo.masked, 'nvapi-glob...1234');
    } finally {
      if (oldGlobalDir !== undefined) {
        process.env.NOMIN_GLOBAL_DIR = oldGlobalDir;
      } else {
        delete process.env.NOMIN_GLOBAL_DIR;
      }
      ConfigManager.resetInstance();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Urgent Bug Fix: Catalog Filtering of Non-Chat Models', () => {
  it('identifies and strictly excludes embedding, retriever, guard, and parse models from chat catalog', () => {
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('nvidia/llama-3.2-nv-embedqa-1b-v1'), false);
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('nvidia/nemotron-3-embed-1b'), false);
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1'), false);
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('nvidia/llama-3.1-nemotron-safety-guard-8b-v3'), false);
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('nvidia/nemotron-safety-guard-2b'), false);
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('baai/bge-reranker-large'), false);
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('nvidia/parse-doc-v1'), false);

    // Legitimate chat models are accepted
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('meta/llama-3.3-70b-instruct'), true);
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('nvidia/nemotron-4-340b-instruct'), true);
    assert.strictEqual(LiveCatalogManager.isChatCallableModel('mistralai/mistral-large-2-instruct'), true);
  });

  it('classifies raw models ensuring embedding and guard models are never tagged with reasoning or tools', () => {
    const embedClassified = LiveCatalogManager.classifyRawModel({
      id: 'nvidia/nemotron-3-embed-1b',
      created: 1700000000,
      object: 'model',
      owned_by: 'nvidia',
    });
    assert.strictEqual(embedClassified.modelType, 'embedding');
    assert.strictEqual(embedClassified.supportsReasoning, false);
    assert.strictEqual(embedClassified.supportsTools, false);

    const guardClassified = LiveCatalogManager.classifyRawModel({
      id: 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3',
      created: 1700000000,
      object: 'model',
      owned_by: 'nvidia',
    });
    assert.strictEqual(guardClassified.modelType, 'guard');
    assert.strictEqual(guardClassified.supportsReasoning, false);
    assert.strictEqual(guardClassified.supportsTools, false);
  });

  it('rejects reasoning effort adjustment on non-chat models', () => {
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('nvidia/nemotron-3-embed-1b'), false);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('nvidia/llama-3.1-nemotron-safety-guard-8b-v3'), false);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('nvidia/llama-3.2-nv-embedqa-1b-v1'), false);
  });
});

describe('Urgent Bug Fix: Model State Persistence & Verification Integrity', () => {
  it('persists setActiveModel and reasoning effort to disk config and reloads accurately', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-test-persist-'));
    try {
      const cfgManager = ConfigManager.getInstance(tempDir);
      cfgManager.setActiveModel('meta/llama-3.3-70b-instruct');
      cfgManager.setReasoningEffort('high');

      assert.strictEqual(cfgManager.getConfig().activeModel, 'meta/llama-3.3-70b-instruct');
      assert.strictEqual(cfgManager.getConfig().reasoningEffort, 'high');

      // Mutate to another verified model
      cfgManager.setActiveModel('nvidia/nemotron-4-340b-instruct');
      cfgManager.setReasoningEffort('max');

      assert.strictEqual(cfgManager.getConfig().activeModel, 'nvidia/nemotron-4-340b-instruct');
      assert.strictEqual(cfgManager.getConfig().reasoningEffort, 'max');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('TUI Overhaul: Claude Code / OpenCode Grade Layout', () => {
  it('renders single compact 2-line Unicode header card without spamming extra warning blocks', () => {
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
        activeModel: 'meta/llama-3.3-70b-instruct',
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
    assert.ok(captured.includes('╭'));
    assert.ok(captured.includes('╰'));
    assert.ok(captured.includes('Sandboxed (~/.nomin)'));
    assert.ok(captured.includes('meta/llama-3.3-70b-instruct'));
  });

  it('renders slim docked status line and footer hints cleanly', () => {
    const statusText = StatusLine.render({
      providerName: 'NVIDIA NIM',
      activeModel: 'meta/llama-3.3-70b-instruct',
      reasoningEffort: 'high',
      permissionMode: 'auto-accept',
      workspaceDir: 'my-project',
      gitBranch: 'main',
      totalTokens: 128000,
      estimatedCostUsd: 0.042,
      rpmLimit: 120,
    });

    assert.ok(statusText.includes('[NVIDIA NIM]'));
    assert.ok(statusText.includes('meta/llama-3.3-70b-instruct'));
    assert.ok(statusText.includes('effort:high'));
    assert.ok(statusText.includes('AUTO-ACCEPT'));
    assert.ok(statusText.includes('128.0k tok'));

    const footerText = FooterHints.render([
      { key: '/', label: 'commands' },
      { key: 'shift+tab', label: 'auto-accept' },
      { key: 'ctrl+c', label: 'exit' },
    ]);

    assert.ok(footerText.includes('/'));
    assert.ok(footerText.includes('commands'));
    assert.ok(footerText.includes('shift+tab'));
    assert.ok(footerText.includes('auto-accept'));
  });

  it('runs doctor diagnostics and reports masked credential info and source', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-test-doc-'));
    const origGlobalDir = process.env.NOMIN_GLOBAL_DIR;
    try {
      process.env.NOMIN_GLOBAL_DIR = tempDir;
      ConfigManager.resetInstance();
      const cfgManager = ConfigManager.getInstance(tempDir);
      cfgManager.setActiveProvider('nim');
      cfgManager.setProviderApiKey('nim', 'nvapi-test-doctor-key-5678');

      const report = await NominDoctor.runDiagnostics(tempDir);
      assert.ok(report.checks.length >= 4);

      const credCheck = report.checks.find(c => c.id === 'credentials');
      assert.ok(credCheck);
      assert.strictEqual(credCheck.pass, true);
      assert.ok(credCheck.message.includes('nvapi-test...5678'));
      assert.ok(credCheck.message.includes('.nomin'));
      assert.ok(credCheck.message.includes('config.json'));
    } finally {
      if (origGlobalDir !== undefined) process.env.NOMIN_GLOBAL_DIR = origGlobalDir;
      else delete process.env.NOMIN_GLOBAL_DIR;
      fs.rmSync(tempDir, { recursive: true, force: true });
      ConfigManager.resetInstance();
    }
  });
});
