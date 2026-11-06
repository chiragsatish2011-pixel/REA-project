/**
 * Nomin Code: Workspace Safety & System Directory Protection Test Suite
 * Tests:
 * 1. Detection of system-protected directories and drive roots
 * 2. Refusal of tool execution when launched from system directories
 * 3. Exact user-friendly warning directing user to 'cd' into a project
 * 4. Normal tool execution permitted in legitimate user project workspaces
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isSystemDir, isDriveRootDir, detectWorkspaceProject } from '../src/config/index.js';
import { defaultToolRegistry } from '../src/tools/index.js';
import { BashTool } from '../src/tools/bash.js';

describe('System Directory & Workspace Safety Protection', () => {
  it('accurately identifies system-protected directories and drive roots', () => {
    if (process.platform === 'win32') {
      const winDir = process.env.WINDIR || 'C:\\Windows';
      assert.strictEqual(isSystemDir(winDir), true);
      assert.strictEqual(isSystemDir(path.join(winDir, 'System32')), true);
      assert.strictEqual(isDriveRootDir('C:\\'), true);
      assert.strictEqual(isDriveRootDir('c:\\'), true);
    } else {
      assert.strictEqual(isSystemDir('/etc'), true);
      assert.strictEqual(isSystemDir('/bin'), true);
      assert.strictEqual(isSystemDir('/System'), true);
      assert.strictEqual(isDriveRootDir('/'), true);
    }

    // Normal project directories must NOT be flagged as system dirs
    const normalProjectDir = path.join(os.tmpdir(), 'my-legit-app');
    assert.strictEqual(isSystemDir(normalProjectDir), false);
    assert.strictEqual(isDriveRootDir(normalProjectDir), false);
  });

  it('refuses tool execution via ToolRegistry when workdir is a system directory', async () => {
    const sysDir = process.platform === 'win32'
      ? (process.env.WINDIR || 'C:\\Windows\\System32')
      : '/etc';

    const result = await defaultToolRegistry.executeTool(
      'read_file',
      { file_path: 'test.txt' },
      {
        taskId: 'test-task',
        workdir: sysDir,
        worktreePath: sysDir,
      }
    );

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('Refusing to execute agent tool \'read_file\' in system-protected directory'));
    assert.ok(result.error?.includes('cd <project-path>'));
  });

  it('refuses bash tool execution when working directory is a drive root', async () => {
    const driveRoot = process.platform === 'win32' ? 'C:\\' : '/';
    const bash = new BashTool();

    const result = await bash.execute(
      { command: 'echo dangerous' },
      {
        taskId: 'test-bash-task',
        workdir: driveRoot,
        worktreePath: driveRoot,
      }
    );

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('Refusing to execute'));
    assert.ok(result.error?.includes('cd <project-path>'));
  });

  it('allows tool execution in legitimate project directories', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-safe-project-'));
    try {
      // Create a test file
      const testFile = path.join(tempDir, 'hello.txt');
      fs.writeFileSync(testFile, 'console.log("hello world");', 'utf8');

      const result = await defaultToolRegistry.executeTool(
        'read_file',
        { path: 'hello.txt' },
        {
          taskId: 'test-safe-task',
          workdir: tempDir,
          worktreePath: tempDir,
        }
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.output.includes('console.log("hello world");'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('audits workspace projects and provides safety recommendations', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-audit-project-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf8');

      const audit = detectWorkspaceProject(tempDir);
      assert.strictEqual(audit.isProject, true);
      assert.strictEqual(audit.isSystemDir, false);
      assert.strictEqual(audit.isDriveRoot, false);
      assert.ok(audit.projectMarkers.includes('package.json'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
