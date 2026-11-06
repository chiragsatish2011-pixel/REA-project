/**
 * @file agent-loop-and-path.test.ts
 * @description End-to-end regression tests for AgentLoop, path normalization,
 * EnvironmentContextEngine, and the Anti-Hallucination Stalling Guard against a live in-memory HTTP server.
 * Zero external runtime dependencies.
 */

import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { MockProviderServer } from './mock-provider-server.js';
import { AgentLoop } from '../src/agent/agent-loop.js';
import { EnvironmentContextEngine } from '../src/config/environment-context.js';
import { NominHttpClient } from '../src/provider/client.js';
import { NominREPL } from '../src/cli/repl.js';
import { ConfigManager } from '../src/config/index.js';
import { defaultToolRegistry } from '../src/tools/index.js';
import type { ChatMessage } from '../src/provider/types.js';

describe('Nomin Code: Context Engine, Agent Tool Loop & Path Normalization', () => {
  let mockServer: MockProviderServer;
  let baseURL: string;
  let tempWorkdir: string;

  before(async () => {
    mockServer = new MockProviderServer();
    baseURL = await mockServer.start();

    // Create a real temp workspace with files for testing
    tempWorkdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-test-workspace-'));
    fs.mkdirSync(path.join(tempWorkdir, 'src'));
    fs.writeFileSync(path.join(tempWorkdir, 'src', 'index.ts'), 'export const main = () => true;\n');
    fs.writeFileSync(path.join(tempWorkdir, 'package.json'), '{"name": "test-pkg"}\n');
    fs.writeFileSync(path.join(tempWorkdir, 'README.md'), '# Test Project\n');
  });

  after(async () => {
    await mockServer.stop();
    try {
      fs.rmSync(tempWorkdir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('1. EnvironmentContextEngine generates accurate workspace, OS, shell, date, and directory listing', async () => {
    const ctx = await EnvironmentContextEngine.generate(tempWorkdir);

    assert.strictEqual(ctx.workspacePath, path.resolve(tempWorkdir));
    assert.ok(ctx.osInfo.length > 0, 'OS info should be populated');
    assert.ok(ctx.shellInfo.length > 0, 'Shell info should be populated');
    assert.ok(ctx.currentDateTime.length > 0, 'Timestamp should be populated');
    assert.ok(ctx.topLevelEntries.length >= 3, 'Should list top-level files and directories');

    const entryNames = ctx.topLevelEntries.map(e => e.name);
    assert.ok(entryNames.includes('package.json'), 'package.json should be present');
    assert.ok(entryNames.includes('README.md'), 'README.md should be present');
    assert.ok(entryNames.includes('src'), 'src directory should be present');

    const promptBlock = EnvironmentContextEngine.formatPromptBlock(ctx);
    assert.ok(promptBlock.includes('Environment & Workspace Context'));
    assert.ok(promptBlock.includes(path.resolve(tempWorkdir)));
    assert.ok(promptBlock.includes('package.json'));
    assert.ok(promptBlock.includes('Operational Directives'));
  });

  test('2. AgentLoop intercepts embedded text JSON tool calls, executes them, feeds back results, and avoids raw JSON', async () => {
    let callCount = 0;
    mockServer.setHandler((reqBody) => {
      callCount++;
      if (callCount === 1) {
        // First turn: model outputs embedded text JSON tool call
        const sse1 = JSON.stringify({
          choices: [
            {
              delta: {
                content: `{"tool": "list_dir", "path": "."}`,
              },
            },
          ],
        });
        return { sseEvents: [sse1] };
      } else {
        // Second turn: model receives tool output and provides natural language response
        const sse2 = JSON.stringify({
          choices: [
            {
              delta: {
                content: 'In this directory, I see the following items: src/, package.json, and README.md.',
              },
            },
          ],
        });
        return { sseEvents: [sse2] };
      }
    });

    const client = new NominHttpClient({
      config: {
        id: 'mock-provider',
        name: 'Mock Provider',
        type: 'openai',
        baseURL,
        apiKey: 'test-key',
      },
    });

    const history: ChatMessage[] = [];
    const result = await AgentLoop.executeTurn({
      client,
      model: 'mock-model',
      workdir: tempWorkdir,
      history,
      prompt: 'just tell me what do you see in that directory',
      maxTurns: 5,
    });

    assert.strictEqual(result.toolCallsExecuted, 1, 'Should have executed 1 tool call');
    assert.ok(result.finalText.includes('src/'), 'Final text should include directory contents');
    assert.ok(result.finalText.includes('package.json'));
    assert.ok(!result.finalText.includes('{"tool":'), 'Final text MUST NOT contain raw tool JSON');

    // Check conversation history integrity
    assert.strictEqual(history.length, 4);
    assert.strictEqual(history[0].role, 'user');
    assert.strictEqual(history[1].role, 'assistant');
    assert.strictEqual(history[2].role, 'tool');
    assert.strictEqual(history[3].role, 'assistant');
    assert.ok(history[3].content?.includes('src/'));
  });

  test('3. Stalling Guard intercepts "checking directory now" and forces real tool execution', async () => {
    let callCount = 0;
    let receivedReprompt = false;

    mockServer.setHandler((reqBody) => {
      callCount++;
      if (callCount === 1) {
        // Model stalls without calling a tool
        const sse1 = JSON.stringify({
          choices: [
            {
              delta: {
                content: "I'm checking the directory for you right now - one moment.",
              },
            },
          ],
        });
        return { sseEvents: [sse1] };
      } else if (callCount === 2) {
        // Verify system reprompt arrived
        const messages = reqBody.messages || [];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.content && lastMsg.content.includes('[System Action Required]')) {
          receivedReprompt = true;
        }

        // Model now calls list_dir
        const sse2 = JSON.stringify({
          choices: [
            {
              delta: {
                content: '```json\n{"tool": "list_dir", "path": "."}\n```',
              },
            },
          ],
        });
        return { sseEvents: [sse2] };
      } else {
        // Model provides final answer
        const sse3 = JSON.stringify({
          choices: [
            {
              delta: {
                content: 'Here are the files: README.md, package.json, and src/.',
              },
            },
          ],
        });
        return { sseEvents: [sse3] };
      }
    });

    const client = new NominHttpClient({
      config: {
        id: 'mock-provider',
        name: 'Mock Provider',
        type: 'openai',
        baseURL,
        apiKey: 'test-key',
      },
    });

    const history: ChatMessage[] = [];
    const result = await AgentLoop.executeTurn({
      client,
      model: 'mock-model',
      workdir: tempWorkdir,
      history,
      prompt: 'ummm hello, what files are in here?',
      maxTurns: 5,
    });

    assert.ok(receivedReprompt, 'AgentLoop should have triggered anti-stalling reprompt');
    assert.strictEqual(result.toolCallsExecuted, 1, 'Should have executed list_dir after reprompt');
    assert.ok(result.finalText.includes('README.md'));
    assert.ok(!result.finalText.includes("I'm checking the directory for you right now"), 'Stalling text must not be shown to user');
  });

  test('4. Path Normalization and /cd correctly resolves quoted paths with spaces', async () => {
    // Create directory with spaces
    const spacedDir = path.join(tempWorkdir, 'Spaced Directory With Spaces 2.6');
    fs.mkdirSync(spacedDir, { recursive: true });

    ConfigManager.resetInstance();
    const configManager = ConfigManager.getInstance(tempWorkdir);
    const repl = new NominREPL({
      workdir: tempWorkdir,
      configManager,
    });

    const canonical = (p: string) =>
      process.platform === 'win32' && fs.realpathSync.native
        ? fs.realpathSync.native(p).toLowerCase()
        : path.resolve(p).toLowerCase();

    // Test /cd with enclosing double quotes
    await repl.handleDirectorySwitch(`"${spacedDir}"`);
    assert.strictEqual(
      canonical(configManager.getConfig().workdir),
      canonical(spacedDir),
      'Workspace should switch to quoted path without joining onto home or cwd'
    );

    // Test /cd with single quotes
    await repl.handleDirectorySwitch(`'${tempWorkdir}'`);
    assert.strictEqual(
      canonical(configManager.getConfig().workdir),
      canonical(tempWorkdir),
      'Workspace should switch to single-quoted path cleanly'
    );

    // Test /cd with no arguments prints workspace without error
    await repl.handleDirectorySwitch('');
    assert.strictEqual(
      canonical(configManager.getConfig().workdir),
      canonical(tempWorkdir)
    );
  });

  test('5. Tool Registry supports list_dir, write_file, and alias resolution', async () => {
    assert.ok(defaultToolRegistry.hasTool('list_dir'));
    assert.ok(defaultToolRegistry.hasTool('list_directory'));
    assert.ok(defaultToolRegistry.hasTool('ls'));
    assert.ok(defaultToolRegistry.hasTool('write_file'));
    assert.ok(defaultToolRegistry.hasTool('write'));

    // Execute list_dir
    const listRes = await defaultToolRegistry.executeTool('list_dir', { path: '.' }, {
      workdir: tempWorkdir,
      worktreePath: tempWorkdir,
    });
    assert.strictEqual(listRes.success, true);
    assert.ok(listRes.output.includes('package.json'));

    // Execute write_file
    const writeRes = await defaultToolRegistry.executeTool('write_file', {
      path: 'created_test.txt',
      content: 'hello from test',
    }, {
      workdir: tempWorkdir,
      worktreePath: tempWorkdir,
    });
    assert.strictEqual(writeRes.success, true);
    assert.ok(fs.existsSync(path.join(tempWorkdir, 'created_test.txt')));
    assert.strictEqual(fs.readFileSync(path.join(tempWorkdir, 'created_test.txt'), 'utf-8'), 'hello from test');
  });
});
