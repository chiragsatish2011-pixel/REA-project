/**
 * Unit tests for State & Filesystem Resilience Architecture in Nomin Code.
 * Validates bulletproof fallback when running in C:\Windows\system32 or read-only/system directories.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  isWritableDir,
  isSystemDir,
  hashOrSlug,
  safeMkdirSync,
  resolveNominPaths,
  ConfigManager,
} from '../src/config/index.js';
import { Blackboard } from '../src/swarm/blackboard.js';

describe('Filesystem Resilience & Path Resolver', () => {
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-resilience-test-'));
    ConfigManager.resetInstance();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpWorkspace)) {
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
    ConfigManager.resetInstance();
  });

  it('isWritableDir accurately verifies directory write capabilities', () => {
    assert.strictEqual(isWritableDir(tmpWorkspace), true);
    assert.strictEqual(isWritableDir(os.tmpdir()), true);

    // On Windows, system32 is not writable for non-elevated user writes
    if (process.platform === 'win32') {
      const sysDir = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32')
        : 'C:\\Windows\\system32';
      assert.strictEqual(isWritableDir(sysDir), false);
    }
  });

  it('isSystemDir detects system-protected directories on Windows and POSIX', () => {
    if (process.platform === 'win32') {
      assert.strictEqual(isSystemDir('C:\\Windows'), true);
      assert.strictEqual(isSystemDir('C:\\Windows\\system32'), true);
      assert.strictEqual(isSystemDir('c:\\windows\\system32'), true);
      assert.strictEqual(isSystemDir('C:\\Program Files'), true);
      assert.strictEqual(isSystemDir('C:\\Program Files (x86)'), true);
      assert.strictEqual(isSystemDir('C:\\'), true);
      assert.strictEqual(isSystemDir('C:'), true);
    } else {
      assert.strictEqual(isSystemDir('/'), true);
      assert.strictEqual(isSystemDir('/usr'), true);
      assert.strictEqual(isSystemDir('/usr/bin'), true);
      assert.strictEqual(isSystemDir('/etc'), true);
      assert.strictEqual(isSystemDir('/bin'), true);
    }

    // User workspaces are not system directories
    assert.strictEqual(isSystemDir(tmpWorkspace), false);
    assert.strictEqual(isSystemDir(path.join(os.homedir(), 'projects', 'my-app')), false);
  });

  it('hashOrSlug creates a clean, collision-resistant identifier', () => {
    const slug1 = hashOrSlug('C:\\Windows\\system32');
    const slug2 = hashOrSlug('C:\\Windows\\system32');
    const slug3 = hashOrSlug('C:\\Windows\\SysWOW64');

    assert.strictEqual(slug1, slug2, 'Identical paths must produce identical slugs');
    assert.notStrictEqual(slug1, slug3, 'Different paths must produce different slugs');
    assert.match(slug1, /^system32_[a-f0-9]{10}$/i);
  });

  it('safeMkdirSync safely falls back without throwing exceptions', () => {
    const validDir = path.join(tmpWorkspace, 'sub', 'nested');
    const created = safeMkdirSync(validDir);
    assert.strictEqual(created, validDir);
    assert.strictEqual(fs.existsSync(validDir), true);

    // Invalid/un-writable target should fallback without throwing
    const protectedTarget = process.platform === 'win32'
      ? 'C:\\Windows\\system32\\.nomin\\forbidden_test'
      : '/usr/bin/.nomin/forbidden_test';
    const fallbackTarget = path.join(tmpWorkspace, 'fallback');

    const result = safeMkdirSync(protectedTarget, fallbackTarget);
    assert.strictEqual(result, fallbackTarget);
    assert.strictEqual(fs.existsSync(fallbackTarget), true);
  });

  it('resolveNominPaths keeps metadata local for regular writable project folders', () => {
    const paths = resolveNominPaths(tmpWorkspace);
    assert.strictEqual(paths.isSystemDir, false);
    assert.strictEqual(paths.isFallbackState, false);
    assert.strictEqual(paths.stateDir, path.join(tmpWorkspace, '.nomin', 'state'));
    assert.strictEqual(paths.worktreeDir, path.join(tmpWorkspace, '.nomin', 'worktrees'));
    assert.strictEqual(fs.existsSync(paths.stateDir), true);
    assert.strictEqual(fs.existsSync(paths.worktreeDir), true);
  });

  it('resolveNominPaths redirects to ~/.nomin/workspaces for system/read-only directories', () => {
    const simulatedSysDir = process.platform === 'win32'
      ? 'C:\\Windows\\system32'
      : '/usr/bin';

    const paths = resolveNominPaths(simulatedSysDir);
    assert.strictEqual(paths.isSystemDir, true);
    assert.strictEqual(paths.isFallbackState, true);

    const expectedSlug = hashOrSlug(simulatedSysDir);
    const expectedBase = path.join(os.homedir(), '.nomin', 'workspaces', expectedSlug);

    assert.strictEqual(paths.stateDir, path.join(expectedBase, 'state'));
    assert.strictEqual(paths.worktreeDir, path.join(expectedBase, 'worktrees'));
    assert.strictEqual(fs.existsSync(paths.stateDir), true);
  });

  it('ConfigManager.loadConfig boots seamlessly in C:\\Windows\\system32 without EPERM', () => {
    const simulatedSysDir = process.platform === 'win32'
      ? 'C:\\Windows\\system32'
      : '/usr/bin';

    const configManager = ConfigManager.getInstance(simulatedSysDir);
    const config = configManager.getConfig();

    assert.strictEqual(config.isSystemDir, true);
    assert.strictEqual(config.isFallbackState, true);
    assert.ok(!config.stateDir.includes(simulatedSysDir));
    assert.ok(config.stateDir.includes('.nomin'));
    assert.strictEqual(fs.existsSync(config.stateDir), true);
  });

  it('ConfigManager persists and retrieves global settings across workspaces', () => {
    const manager1 = ConfigManager.getInstance(tmpWorkspace);
    manager1.saveGlobalConfig({
      logLevel: 'debug',
      maxTurnPerSubtask: 25,
    });

    ConfigManager.resetInstance();

    const anotherTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-another-'));
    try {
      const manager2 = ConfigManager.getInstance(anotherTmp);
      const config2 = manager2.getConfig();
      assert.strictEqual(config2.logLevel, 'debug');
      assert.strictEqual(config2.maxTurnPerSubtask, 25);
    } finally {
      fs.rmSync(anotherTmp, { recursive: true, force: true });
    }
  });
});

describe('Blackboard Resilience & StateDir Fallbacks', () => {
  it('Blackboard respects explicit stateDir option', () => {
    const customStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-bb-custom-'));
    try {
      const bb = new Blackboard({
        stateDir: customStateDir,
        autoSave: true,
      });

      assert.strictEqual(bb.getStateDir(), customStateDir);
      assert.strictEqual(fs.existsSync(path.join(customStateDir, 'blackboard.json')), true);
    } finally {
      fs.rmSync(customStateDir, { recursive: true, force: true });
    }
  });

  it('Blackboard catches EPERM/EACCES when given protected directory and falls back safely', () => {
    const protectedDir = process.platform === 'win32'
      ? 'C:\\Windows\\system32\\.nomin\\state'
      : '/etc/.nomin/state';

    // Must NOT crash or throw fatal error
    const bb = new Blackboard({
      stateDir: protectedDir,
      autoSave: true,
    });

    // Should have redirected away from protectedDir to fallback-state
    assert.notStrictEqual(bb.getStateDir(), protectedDir);
    assert.ok(
      bb.getStateDir().includes('fallback-state') || bb.isInMemoryMode(),
      'Should fallback to fallback-state directory or in-memory mode'
    );

    // Able to add tasks and persist without failure
    const task = bb.addTask({
      id: 'task-fallback-1',
      title: 'Fallback resilience check',
      description: 'Ensure durable task DAG works under fallback',
      assignedRole: 'Coder',
      dependencies: [],
      status: 'PENDING',
      acceptanceCriteria: [],
    });

    assert.strictEqual(bb.getTask('task-fallback-1')?.id, 'task-fallback-1');
  });

  it('Blackboard falls back automatically when workspaceRoot is a system directory', () => {
    const sysRoot = process.platform === 'win32'
      ? 'C:\\Windows\\system32'
      : '/usr/bin';

    const bb = new Blackboard({
      workspaceRoot: sysRoot,
      autoSave: true,
    });

    assert.notStrictEqual(bb.getStateDir(), path.join(sysRoot, '.nomin', 'state'));
    assert.ok(bb.getStateDir().includes('fallback-state'));
  });
});
