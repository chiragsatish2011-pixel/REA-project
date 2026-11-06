import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { ConfigManager, isSystemDirectory } from '../src/config/index.js';
import { SwarmCoordinator } from '../src/swarm/coordinator.js';
import { NominREPL } from '../src/cli/repl.js';
import { TerminalUI } from '../src/cli/ui.js';
import { parseArgs } from '../bin/nomin.js';

describe('CLI & Dynamic Directory Switching', () => {
  it('parses positional path and task arguments correctly in bin/nomin', () => {
    // 1. Existing directory '.' sets workdir
    const argsDot = parseArgs(['.']);
    assert.strictEqual(argsDot.workdir, path.resolve('.'));
    assert.strictEqual(argsDot.task, undefined);

    // 2. Existing directory '..' sets workdir
    const argsParent = parseArgs(['..']);
    assert.strictEqual(argsParent.workdir, path.resolve('..'));
    assert.strictEqual(argsParent.task, undefined);

    // 3. Non-directory argument is treated as task
    const argsTask = parseArgs(['Build a feature']);
    assert.strictEqual(argsTask.task, 'Build a feature');
    assert.strictEqual(argsTask.workdir, undefined);

    // 4. Directory followed by task
    const argsDirAndTask = parseArgs(['.', 'Build a feature']);
    assert.strictEqual(argsDirAndTask.workdir, path.resolve('.'));
    assert.strictEqual(argsDirAndTask.task, 'Build a feature');

    // 5. Named --workdir flag takes precedence
    const argsNamed = parseArgs(['--workdir', './src', 'Fix bugs']);
    assert.strictEqual(argsNamed.workdir, './src');
    assert.strictEqual(argsNamed.task, 'Fix bugs');
  });
  it('detects package.json name and bin mappings correctly', () => {
    const pkgPath = path.resolve('package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    assert.strictEqual(pkg.name, '@nomincode/cli');
    assert.strictEqual(pkg.bin.nomincode, './bin/nomin.js');
    assert.strictEqual(pkg.bin.nomin, './bin/nomin.js');
  });

  it('detects system directories accurately', () => {
    if (process.platform === 'win32') {
      assert.strictEqual(isSystemDirectory('C:\\Windows\\system32'), true);
      assert.strictEqual(isSystemDirectory('C:\\Windows'), true);
      assert.strictEqual(isSystemDirectory('C:\\Program Files'), true);
    } else {
      assert.strictEqual(isSystemDirectory('/bin'), true);
      assert.strictEqual(isSystemDirectory('/usr/bin'), true);
    }

    // Normal workspace directory is not a system directory
    assert.strictEqual(isSystemDirectory(process.cwd()), false);
  });

  it('SwarmCoordinator supports switchWorkspace and getWorkspaceRoot', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-coord-1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-coord-2-'));

    try {
      const coordinator = new SwarmCoordinator({
        workspaceRoot: tempDir1,
        useGitWorktrees: false,
      });

      assert.strictEqual(coordinator.getWorkspaceRoot(), tempDir1);

      // Dynamically switch workspace
      coordinator.switchWorkspace(tempDir2);
      assert.strictEqual(coordinator.getWorkspaceRoot(), path.resolve(tempDir2));
    } finally {
      fs.rmSync(tempDir1, { recursive: true, force: true });
      fs.rmSync(tempDir2, { recursive: true, force: true });
    }
  });

  it('NominREPL handleDirectorySwitch switches workspace and updates config', async () => {
    const originalCwd = process.cwd();
    const initialDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-repl-init-'));
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-repl-target-'));

    try {
      const configManager = ConfigManager.getInstance(initialDir);
      configManager.updateConfig({ workdir: initialDir });

      const coordinator = new SwarmCoordinator({
        workspaceRoot: initialDir,
        useGitWorktrees: false,
      });

      const repl = new NominREPL({
        workdir: initialDir,
        coordinator,
      });

      // Switch to target directory
      await repl.handleDirectorySwitch(targetDir);

      const canonical = (p: string) =>
        process.platform === 'win32' && fs.realpathSync.native
          ? fs.realpathSync.native(p).toLowerCase()
          : path.resolve(p).toLowerCase();

      assert.strictEqual(canonical(configManager.getConfig().workdir), canonical(targetDir));
      assert.strictEqual(canonical(coordinator.getWorkspaceRoot()), canonical(targetDir));

      // Attempt to switch to non-existent directory (should fail gracefully and keep current)
      const fakeDir = path.join(os.tmpdir(), 'non-existent-nomin-dir-12345');
      await repl.handleDirectorySwitch(fakeDir);
      assert.strictEqual(canonical(configManager.getConfig().workdir), canonical(targetDir));
    } finally {
      try {
        process.chdir(originalCwd);
      } catch (_) {}
      try {
        fs.rmSync(initialDir, { recursive: true, force: true });
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  it('TerminalUI renders workspace switched card cleanly', () => {
    // Verify renderWorkspaceSwitchedCard does not throw
    TerminalUI.renderWorkspaceSwitchedCard('C:\\projects\\my-app', 'feature/auth');
    TerminalUI.renderSystemDirWarning();
  });
});
