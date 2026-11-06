/**
 * @file workspace-safety-new.test.ts
 * @description Verifies Workspace Safety Pause, /new command, and automatic task resume in Nomin Code.
 * Pure Node.js standard library test runner.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { NominREPL } from '../src/cli/repl.js';
import { ConfigManager } from '../src/config/index.js';
import { TerminalUI } from '../src/cli/ui.js';

describe('Workspace Safety & /new Project Flow', () => {
  let tempHome: string;
  let testWorkspace: string;

  before(() => {
    const rawTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-home-test-'));
    tempHome = (process.platform === 'win32' && fs.realpathSync.native)
      ? fs.realpathSync.native(rawTemp)
      : rawTemp;
    testWorkspace = path.join(tempHome, 'test-project');
    fs.mkdirSync(testWorkspace, { recursive: true });
    // Write package.json so it's a legitimate project
    fs.writeFileSync(path.join(testWorkspace, 'package.json'), '{}', 'utf-8');
  });

  after(() => {
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch (_) {}
  });

  it('1. /new creates project directory and switches workspace cleanly', async () => {
    const repl = new NominREPL({ workdir: testWorkspace });
    const newProjName = 'super-game-v1';
    const targetFolder = path.join(testWorkspace, newProjName);

    // Call handleNewProjectCommand
    await repl.handleNewProjectCommand(newProjName);

    // Directory must exist
    assert.ok(fs.existsSync(targetFolder), `Expected directory ${targetFolder} to exist`);
    assert.ok(fs.statSync(targetFolder).isDirectory());

    // Config manager workdir must be updated
    const cfg = ConfigManager.getInstance(targetFolder).getConfig();
    assert.equal(path.resolve(cfg.workdir).toLowerCase(), path.resolve(targetFolder).toLowerCase());
  });

  it('2. /new rejects empty project name with clear usage message', async () => {
    const repl = new NominREPL({ workdir: testWorkspace });
    let captured = '';
    const origLog = console.log;
    console.log = (...args: any[]) => {
      captured += args.join(' ') + '\n';
    };

    try {
      await repl.handleNewProjectCommand('');
    } finally {
      console.log = origLog;
    }

    const clean = TerminalUI.stripAnsi(captured);
    assert.ok(clean.includes('Missing project name'));
    assert.ok(clean.includes('Usage: /new <project-name>'));
  });

  it('3. /version slash command prints BuildStamp output', async () => {
    const repl = new NominREPL({ workdir: testWorkspace });
    let captured = '';
    const origLog = console.log;
    console.log = (...args: any[]) => {
      captured += args.join(' ') + '\n';
    };

    try {
      await repl.handleSlashCommand('/version');
    } finally {
      console.log = origLog;
    }

    assert.ok(captured.includes('@nomincode/cli'));
    assert.ok(captured.includes('commit:'));
    assert.ok(captured.includes('Entry:'));
  });
});
