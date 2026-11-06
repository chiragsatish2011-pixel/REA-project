/**
 * Test Suite: Conversational Intent & Workspace Resilience
 * Verifies that greetings, questions, and chit-chat do not trigger destructive build swarms,
 * and that manifest-free workspaces do not fail with ENOENT on package.json.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { isConversationalPrompt, NominREPL } from '../src/cli/repl.js';
import { SwarmCoordinator } from '../src/swarm/coordinator.js';
import { ConfigManager } from '../src/config/index.js';

describe('Conversational Intent & Workspace Resilience', () => {
  it('correctly classifies conversational greetings and assistant queries', () => {
    // Greetings
    assert.strictEqual(isConversationalPrompt('hi'), true);
    assert.strictEqual(isConversationalPrompt('hi!'), true);
    assert.strictEqual(isConversationalPrompt('hello'), true);
    assert.strictEqual(isConversationalPrompt('Hey there'), true);
    assert.strictEqual(isConversationalPrompt('yo'), true);
    assert.strictEqual(isConversationalPrompt('good morning'), true);
    assert.strictEqual(isConversationalPrompt('thanks'), true);
    assert.strictEqual(isConversationalPrompt('bye'), true);

    // Questions and identity
    assert.strictEqual(isConversationalPrompt('who are you?'), true);
    assert.strictEqual(isConversationalPrompt('what can you do?'), true);
    assert.strictEqual(isConversationalPrompt('what is nomin?'), true);
    assert.strictEqual(isConversationalPrompt('how do you work?'), true);

    // Emotional reactions, confusion, and conversational status checks
    assert.strictEqual(isConversationalPrompt('wtf'), true);
    assert.strictEqual(isConversationalPrompt('wt are u doing?'), true);
    assert.strictEqual(isConversationalPrompt('what are you doing?'), true);
    assert.strictEqual(isConversationalPrompt('wt'), true);
    assert.strictEqual(isConversationalPrompt('what?'), true);
    assert.strictEqual(isConversationalPrompt('huh'), true);
    assert.strictEqual(isConversationalPrompt('why'), true);
  });

  it('correctly classifies coding action goals as non-conversational', () => {
    assert.strictEqual(isConversationalPrompt('implement authentication with JWT'), false);
    assert.strictEqual(isConversationalPrompt('fix the bug in discount calculation'), false);
    assert.strictEqual(isConversationalPrompt('create an HTTP server using express'), false);
    assert.strictEqual(isConversationalPrompt('build the frontend assets'), false);
    assert.strictEqual(isConversationalPrompt('refactor database connector'), false);
    assert.strictEqual(isConversationalPrompt('write unit tests for repl'), false);
    assert.strictEqual(isConversationalPrompt('add a new route for user signup'), false);
  });

  it('handles conversational greeting "hi" in NominREPL gracefully without swarm deadlock', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-hi-test-'));
    try {
      const configManager = ConfigManager.getInstance(tmpDir);
      configManager.updateConfig({ workdir: tmpDir, activeModel: 'meta/llama-3.3-70b-instruct' });

      const coordinator = new SwarmCoordinator({
        workspaceRoot: tmpDir,
        useGitWorktrees: false,
      });

      const repl = new NominREPL({
        workdir: tmpDir,
        coordinator,
      });

      // handleUserGoal("hi") should execute without throwing, deadlocking, or running npm run build
      await assert.doesNotReject(async () => {
        await repl.handleUserGoal('hi');
      });

      // Verify that no failed swarm tasks were registered on the blackboard for "hi"
      const tasks = coordinator.blackboard.getAllTasks();
      assert.strictEqual(tasks.length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs swarm in manifest-free directory without ENOENT on package.json', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-empty-ws-'));
    try {
      const coordinator = new SwarmCoordinator({
        workspaceRoot: emptyDir,
        useGitWorktrees: false,
      });

      // Running an actual task in an empty directory should not crash on missing package.json
      const result = await coordinator.orchestrate('Scaffold initial markdown notes');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.failedTasks, 0);
      assert.strictEqual(result.completedTasks, 2);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('executes sequential tasks in the same session without DAG cycle errors', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-sequential-test-'));
    try {
      const coordinator = new SwarmCoordinator({
        workspaceRoot: tempDir,
        useGitWorktrees: false,
      });

      // Turn 1
      const res1 = await coordinator.orchestrate('First task');
      assert.strictEqual(res1.success, true);

      // Turn 2: in previous versions, re-adding tasks caused: Cycle detected in Task Dependency DAG
      const res2 = await coordinator.orchestrate('Second task');
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.errors.length, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('auto-aligns models when switching between incompatible provider endpoints', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-provider-align-'));
    try {
      const cfgManager = ConfigManager.getInstance(tempDir);
      cfgManager.setActiveProvider('nim');
      cfgManager.setSoloModel('meta/llama-3.3-70b-instruct');
      assert.strictEqual(cfgManager.getConfig().activeModel, 'meta/llama-3.3-70b-instruct');

      // Switch to OpenAI: meta/llama-3.3-70b-instruct is incompatible with OpenAI, so activeModel is safely cleared (no auto-routing)
      cfgManager.setActiveProvider('openai');
      assert.strictEqual(cfgManager.getConfig().activeModel, undefined);

      // Explicitly set OpenAI model
      cfgManager.setSoloModel('gpt-4o');
      assert.strictEqual(cfgManager.getConfig().activeModel, 'gpt-4o');

      // Switch back to NIM: gpt-4o is incompatible with NIM, cleared (no auto-routing)
      cfgManager.setActiveProvider('nim');
      assert.strictEqual(cfgManager.getConfig().activeModel, undefined);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
