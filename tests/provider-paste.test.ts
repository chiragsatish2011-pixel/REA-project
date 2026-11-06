import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigManager } from '../src/config/index.js';
import { NominREPL } from '../src/cli/repl.js';
import { SwarmCoordinator } from '../src/swarm/coordinator.js';

describe('Provider Key Paste & Input Verification', () => {
  it('cleanly strips Bearer prefix and wrapping quotes in ConfigManager.setProviderApiKey', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-paste-test-'));
    const oldGlobalDir = process.env.NOMIN_GLOBAL_DIR;
    process.env.NOMIN_GLOBAL_DIR = tmpDir;
    ConfigManager.resetInstance();
    try {
      const configManager = ConfigManager.getInstance(tmpDir);

      // 1. Key with quotes
      configManager.setProviderApiKey('openai', '"sk-proj-1234567890abcdef"');
      assert.strictEqual(configManager.getConfig().providers.openai.apiKey, 'sk-proj-1234567890abcdef');

      // 2. Key with single quotes
      configManager.setProviderApiKey('anthropic', "'sk-ant-api03-abcdef123456'");
      assert.strictEqual(configManager.getConfig().providers.anthropic.apiKey, 'sk-ant-api03-abcdef123456');

      // 3. Key with Bearer prefix
      configManager.setProviderApiKey('nim', 'Bearer nvapi-SECRETKEY-TEST-999');
      assert.strictEqual(configManager.getConfig().providers.nim.apiKey, 'nvapi-SECRETKEY-TEST-999');

      // 4. Key with Bearer and quotes
      configManager.setProviderApiKey('deepseek', 'Bearer "sk-deepseek-888"');
      assert.strictEqual(configManager.getConfig().providers.deepseek.apiKey, 'sk-deepseek-888');

      // 5. Creating a brand new custom provider via key
      configManager.setProviderApiKey('custom_gpu', 'gpu-key-xyz');
      assert.strictEqual(configManager.getConfig().providers.custom_gpu.apiKey, 'gpu-key-xyz');
    } finally {
      if (oldGlobalDir !== undefined) {
        process.env.NOMIN_GLOBAL_DIR = oldGlobalDir;
      } else {
        delete process.env.NOMIN_GLOBAL_DIR;
      }
      ConfigManager.resetInstance();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handleProviderCommand accepts direct paste argument /provider key <pasted-key>', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-cmd-paste-'));
    const oldGlobalDir = process.env.NOMIN_GLOBAL_DIR;
    process.env.NOMIN_GLOBAL_DIR = tmpDir;
    ConfigManager.resetInstance();
    try {
      const configManager = ConfigManager.getInstance(tmpDir);
      const coordinator = new SwarmCoordinator({ workspaceRoot: tmpDir, useGitWorktrees: false });
      const repl = new NominREPL({ workdir: tmpDir, coordinator });

      // Run /provider key with pasted key
      await repl.handleProviderCommand('key nvapi-PASTED-KEY-FULL-STRING-123456789');

      const activeProv = configManager.getConfig().activeProvider;
      assert.strictEqual(
        configManager.getConfig().providers[activeProv].apiKey,
        'nvapi-PASTED-KEY-FULL-STRING-123456789'
      );
    } finally {
      if (oldGlobalDir !== undefined) {
        process.env.NOMIN_GLOBAL_DIR = oldGlobalDir;
      } else {
        delete process.env.NOMIN_GLOBAL_DIR;
      }
      ConfigManager.resetInstance();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handleProviderCommand switch updates active provider and preserves custom endpoints', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-switch-test-'));
    const oldGlobalDir = process.env.NOMIN_GLOBAL_DIR;
    process.env.NOMIN_GLOBAL_DIR = tmpDir;
    ConfigManager.resetInstance();
    try {
      const configManager = ConfigManager.getInstance(tmpDir);
      const coordinator = new SwarmCoordinator({ workspaceRoot: tmpDir, useGitWorktrees: false });
      const repl = new NominREPL({ workdir: tmpDir, coordinator });

      await repl.handleProviderCommand('switch anthropic');
      assert.strictEqual(configManager.getConfig().activeProvider, 'anthropic');

      await repl.handleProviderCommand('switch openai');
      assert.strictEqual(configManager.getConfig().activeProvider, 'openai');
    } finally {
      if (oldGlobalDir !== undefined) {
        process.env.NOMIN_GLOBAL_DIR = oldGlobalDir;
      } else {
        delete process.env.NOMIN_GLOBAL_DIR;
      }
      ConfigManager.resetInstance();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
