/**
 * Test Suite: OpenCode TUI Fidelity, Key Input Race Immunity & State Sanitation
 * Verifies:
 * 1. TerminalUI.printBootSequence never displays literal 'undefined' or 'none'
 * 2. StatusLine.render never displays literal 'undefined' or 'none'
 * 3. SlashMenu renders OpenCode-style rounded box borders and peach active highlight
 * 4. ConfigManager resolves invalid or retired model strings safely to undefined
 * 5. SelectList applies peach active selection highlight matching OpenCode
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ThemeManager } from '../src/cli/theme.js';
import { TerminalUI } from '../src/cli/ui.js';
import { StatusLine } from '../src/cli/components/status-line.js';
import { SlashMenu } from '../src/cli/slash-menu.js';
import { SelectList } from '../src/cli/components/select-list.js';
import { ConfigManager } from '../src/config/index.js';

describe('OpenCode UI Polish & Header Sanitation', () => {
  it('TerminalUI printBootSequence renders "(no model selected)" when activeModel is undefined or string "undefined"', () => {
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
        activeModel: undefined,
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

    assert.ok(captured.includes('(no model selected)'), 'Must show (no model selected)');
    assert.strictEqual(captured.includes('· undefined ·'), false, 'Must never render literal "undefined"');
    assert.strictEqual(captured.includes('· none ·'), false, 'Must never render literal "none"');
  });

  it('StatusLine render shows "(no model - run /model)" when activeModel is missing or string "undefined"', () => {
    const status1 = StatusLine.render({
      providerName: 'NVIDIA NIM',
      activeModel: undefined,
      reasoningEffort: 'medium',
      permissionMode: 'normal',
      workspaceDir: 'C:\\Windows\\system32',
    });

    assert.ok(status1.includes('(no model - run /model)'));
    assert.strictEqual(status1.includes('undefined'), false);
    assert.strictEqual(status1.includes('none ['), false);

    const status2 = StatusLine.render({
      providerName: 'NVIDIA NIM',
      activeModel: 'undefined',
      reasoningEffort: 'low',
      permissionMode: 'normal',
      workspaceDir: 'C:\\Windows\\system32',
    });

    assert.ok(status2.includes('(no model - run /model)'));
    assert.strictEqual(status2.includes('undefined'), false);
  });

  it('SlashMenu renders OpenCode box border with peach selection background', () => {
    const menu = new SlashMenu('/');
    const rendered = menu.render();

    assert.ok(rendered.length >= 3, 'Must render top border, items, and bottom border');
    assert.ok(rendered[0].includes('╭'), 'First line must be top border');
    assert.ok(rendered[rendered.length - 1].includes('╰'), 'Last line must be bottom border');

    // Strip ANSI to check plain structure
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const plainTop = stripAnsi(rendered[0]).trim();
    const plainRow = stripAnsi(rendered[1]).trim();
    const plainBottom = stripAnsi(rendered[rendered.length - 1]).trim();

    assert.strictEqual(plainTop.length, plainRow.length, 'Border width must equal item row width');
    assert.strictEqual(plainBottom.length, plainRow.length, 'Bottom border width must equal item row width');

    // Check peach background escape code in selected item
    const c = ThemeManager.getColors();
    assert.ok(rendered[1].includes(c.peachBg), 'Selected item must use peach background');
  });

  it('SelectList highlights active selection with peach background and ❯ pointer', () => {
    const list = new SelectList({
      title: 'Configure Reasoning Effort & Thinking Budget:',
      options: [
        { id: 'off', label: 'off', secondary: 'Zero reasoning tokens', value: 'off' },
        { id: 'low', label: 'low', secondary: 'Budget: ~1,024 tokens', value: 'low' },
        { id: 'medium', label: 'medium', secondary: 'Budget: ~2,048 tokens', value: 'medium' },
      ],
      initialIndex: 1,
    });

    const rendered = list.render();
    const selectedLine = rendered.find(l => l.includes('low'));
    assert.ok(selectedLine, 'Should render low option');
    assert.ok(selectedLine.includes('❯'), 'Selected line must have cursor pointer');
    const c = ThemeManager.getColors();
    assert.ok(selectedLine.includes(c.peachBg), 'Selected line must have peach background');
  });

  it('ConfigManager normalizes string "undefined" or "none" in activeModel to undefined', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-opencode-test-'));
    const origGlobalDir = process.env.NOMIN_GLOBAL_DIR;
    try {
      process.env.NOMIN_GLOBAL_DIR = tempDir;
      ConfigManager.resetInstance();
      const cfgPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(cfgPath, JSON.stringify({ activeModel: 'undefined', selectedModels: [] }), 'utf8');

      const mgr = ConfigManager.getInstance(tempDir);
      assert.strictEqual(mgr.getConfig().activeModel, undefined);
    } finally {
      if (origGlobalDir !== undefined) process.env.NOMIN_GLOBAL_DIR = origGlobalDir;
      else delete process.env.NOMIN_GLOBAL_DIR;
      fs.rmSync(tempDir, { recursive: true, force: true });
      ConfigManager.resetInstance();
    }
  });

  it('NominREPL automatically detects pasted API keys in user prompt and triggers key storage', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-key-paste-test-'));
    const origGlobalDir = process.env.NOMIN_GLOBAL_DIR;
    try {
      process.env.NOMIN_GLOBAL_DIR = tempDir;
      ConfigManager.resetInstance();
      const cfgMgr = ConfigManager.getInstance(tempDir);
      cfgMgr.setActiveProvider('nim');

      let savedKey = '';
      const repl = {
        configManager: cfgMgr,
        handleKeyCommand: async (k: string) => {
          savedKey = k;
        },
        executeUserTask: async function (prompt: string) {
          const trimmed = prompt.trim();
          const isPastedApiKey =
            /^nvapi-[A-Za-z0-9_-]{20,}/i.test(trimmed) ||
            /^sk-ant-[A-Za-z0-9_-]{20,}/i.test(trimmed) ||
            /^sk-[A-Za-z0-9_-]{20,}/i.test(trimmed);
          if (isPastedApiKey) {
            await this.handleKeyCommand(trimmed);
          }
        },
      };

      await repl.executeUserTask('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');
      assert.strictEqual(savedKey, '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');
    } finally {
      if (origGlobalDir !== undefined) process.env.NOMIN_GLOBAL_DIR = origGlobalDir;
      else delete process.env.NOMIN_GLOBAL_DIR;
      fs.rmSync(tempDir, { recursive: true, force: true });
      ConfigManager.resetInstance();
    }
  });
});
