/**
 * Nomin Code: Intent Router, Self-Repairing Planner & REPL Upgrade Regression Suite
 * Tests reproduction and fixes for:
 * 1. Transcript replay: "hi", "hello", "wt are u doing?", "wtf", "wt"
 * 2. Self-healing DAG planner (Cycle elimination, back-edge pruning, linear fallback)
 * 3. Provider/Model integrity & zero-default validation
 * 4. Workspace safety guardian (Home dir, system root, RepoMap protection)
 * 5. Honest state reporting & DoD Gate selective isolation
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { IntentRouter } from '../src/swarm/intent-router.js';
import { PlanValidator, type PlanRepairReport, type DecomposedPlan, type RawPlanTask } from '../src/swarm/plan-validator.js';
import {
  ConfigManager,
  detectWorkspaceProject,
  isHomeDir,
  isDriveRootDir,
  isSystemDir,
  validateModelProviderMatch,
} from '../src/config/index.js';
import { Blackboard } from '../src/swarm/blackboard.js';
import { RepoMapEngine } from '../src/tools/repomap.js';

describe('Nomin Code Harness Upgrade & Transcript Regression Suite', () => {

  describe('1. Transcript Replay & Intent Router Verification', () => {
    it('classifies "hi" and "hello" as CHAT/QUESTION and never as a coding objective', () => {
      const resHi = IntentRouter.classifyHeuristic('hi');
      assert.strictEqual(resHi.intent, 'CHAT/QUESTION');

      const resHello = IntentRouter.classifyHeuristic('hello');
      assert.strictEqual(resHello.intent, 'CHAT/QUESTION');

      const resHey = IntentRouter.classifyHeuristic('hey there!');
      assert.strictEqual(resHey.intent, 'CHAT/QUESTION');
    });

    it('classifies "wt are u doing?" as CHAT/QUESTION for state intercept', () => {
      const res1 = IntentRouter.classifyHeuristic('wt are u doing?');
      assert.strictEqual(res1.intent, 'CHAT/QUESTION');

      const res2 = IntentRouter.classifyHeuristic('what are you doing?');
      assert.strictEqual(res2.intent, 'CHAT/QUESTION');

      const res3 = IntentRouter.classifyHeuristic('what are you working on');
      assert.strictEqual(res3.intent, 'CHAT/QUESTION');
    });

    it('classifies "wtf", "wt", "?", and noise as UNCLEAR/NOISE (preventing Architect DAG cycle crash)', () => {
      const resWtf = IntentRouter.classifyHeuristic('wtf');
      assert.strictEqual(resWtf.intent, 'UNCLEAR/NOISE');

      const resWt = IntentRouter.classifyHeuristic('wt');
      assert.strictEqual(resWt.intent, 'UNCLEAR/NOISE');

      const resQ = IntentRouter.classifyHeuristic('?');
      assert.strictEqual(resQ.intent, 'UNCLEAR/NOISE');

      const resGibberish = IntentRouter.classifyHeuristic('asdfghjk');
      assert.strictEqual(resGibberish.intent, 'UNCLEAR/NOISE');
    });

    it('classifies code explanation queries as CODE-EXPLAIN', () => {
      const res = IntentRouter.classifyHeuristic('explain how auth works in this project');
      assert.strictEqual(res.intent, 'CODE-EXPLAIN');

      const res2 = IntentRouter.classifyHeuristic('what does src/cli/ui.ts do?');
      assert.strictEqual(res2.intent, 'CODE-EXPLAIN');
    });

    it('classifies imperative tasks as SMALL-TASK or LARGE-TASK', () => {
      const resSmall = IntentRouter.classifyHeuristic('fix typo in readme');
      assert.strictEqual(resSmall.intent, 'SMALL-TASK');

      const resLarge = IntentRouter.classifyHeuristic('refactor the entire authentication system with jwt and refresh tokens');
      assert.strictEqual(resLarge.intent, 'LARGE-TASK');
    });

    it('respects slash command overrides /plan and /chat', () => {
      const resPlan = IntentRouter.classifyHeuristic('/plan fix the bug');
      assert.strictEqual(resPlan.intent, 'LARGE-TASK');

      const resChat = IntentRouter.classifyHeuristic('/chat create a microservice architecture');
      assert.strictEqual(resChat.intent, 'CHAT/QUESTION');
    });
  });

  describe('2. Self-Healing Planner & DAG Auto-Repair Engine', () => {
    it('repairs cyclic dependencies without crashing or throwing stack traces to user', () => {
      // Simulates the exact observed failure: "Swarm Execution Error: Cycle detected in Task Dependency DAG. Cyclic tasks: T-102"
      const cyclicPlan = {
        tasks: [
          { id: 'T-101', title: 'Task 1', dependencies: ['T-102'] },
          { id: 'T-102', title: 'Task 2', dependencies: ['T-101'] },
        ],
      };

      const repaired = PlanValidator.validateAndRepair(cyclicPlan, 'Refactor code');
      assert.ok(repaired.tasks.length >= 2);

      // Verify that the repaired tasks form a strictly valid topological sort in Blackboard
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-dag-repair-'));
      try {
        const bb = new Blackboard({ workspaceRoot: tempDir, autoSave: false });
        for (const t of repaired.tasks) {
          bb.addTask({
            id: t.id,
            title: t.title,
            description: t.description || t.title,
            assignedRole: 'Coder',
            dependencies: t.dependencies,
            status: 'PENDING',
            acceptanceCriteria: [],
          });
        }

        const state = bb.getState();
        assert.ok(state.taskDAG.topologicalOrder.length >= 2);
        assert.doesNotThrow(() => bb.recomputeTopologicalSort());
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('removes self-dependencies where task depends on itself', () => {
      const selfDepPlan = {
        tasks: [
          { id: 'T-001', title: 'Init', dependencies: ['T-001'] },
        ],
      };

      const repaired = PlanValidator.validateAndRepair(selfDepPlan, 'Single task');
      assert.strictEqual(repaired.tasks.length, 1);
      assert.deepStrictEqual(repaired.tasks[0].dependencies, []);
    });

    it('disambiguates duplicate task IDs', () => {
      const dupPlan = {
        tasks: [
          { id: 'T-1', title: 'First part', dependencies: [] },
          { id: 'T-1', title: 'Second part', dependencies: [] },
        ],
      };

      const repaired = PlanValidator.validateAndRepair(dupPlan, 'Split goal');
      assert.strictEqual(repaired.tasks.length, 2);
      const ids = repaired.tasks.map(t => t.id);
      assert.strictEqual(new Set(ids).size, 2);
    });

    it('caps excessive task explosion at 8 maximum subtasks', () => {
      const largeTasks: Array<{ id: string; title: string; dependencies: string[] }> = [];
      for (let i = 1; i <= 20; i++) {
        largeTasks.push({ id: `T-${i}`, title: `Subtask ${i}`, dependencies: [] });
      }

      const repaired = PlanValidator.validateAndRepair({ tasks: largeTasks }, 'Massive task');
      assert.ok(repaired.tasks.length <= 8);
    });

    it('generates a deterministic fallback plan for empty or corrupt plans', () => {
      const repaired = PlanValidator.validateAndRepair({ tasks: [] }, 'Fix the test');
      assert.strictEqual(repaired.tasks.length, 2);
      assert.strictEqual(repaired.tasks[0].id, 'T-101');
      assert.deepStrictEqual(repaired.tasks[0].dependencies, []);
      assert.strictEqual(repaired.tasks[1].id, 'T-102');
      assert.deepStrictEqual(repaired.tasks[1].dependencies, ['T-101']);
    });
  });

  describe('3. Provider & Model Integrity (No Defaults, Strict Matching)', () => {
    it('detects mismatched models across incompatible providers', () => {
      // NIM model meta/llama on OpenAI endpoint -> INVALID
      const r1 = validateModelProviderMatch('openai', 'meta/llama-3.3-70b-instruct');
      assert.strictEqual(r1.valid, false);
      assert.ok(r1.error?.includes('not an OpenAI model'));

      // OpenAI model gpt-4o on NVIDIA NIM endpoint -> INVALID
      const r2 = validateModelProviderMatch('nim', 'gpt-4o');
      assert.strictEqual(r2.valid, false);
      assert.ok(r2.error?.includes('not available on NVIDIA NIM'));

      // Anthropic model with gpt-4o -> INVALID
      const r3 = validateModelProviderMatch('anthropic', 'gpt-4o');
      assert.strictEqual(r3.valid, false);

      // DeepSeek model with gpt-4o -> INVALID
      const r4 = validateModelProviderMatch('deepseek', 'gpt-4o');
      assert.strictEqual(r4.valid, false);

      // Correct pairs -> VALID
      assert.strictEqual(validateModelProviderMatch('nim', 'meta/llama-3.3-70b-instruct').valid, true);
      assert.strictEqual(validateModelProviderMatch('openai', 'gpt-4o').valid, true);
      assert.strictEqual(validateModelProviderMatch('anthropic', 'claude-3-7-sonnet-20250219').valid, true);
      assert.strictEqual(validateModelProviderMatch('deepseek', 'deepseek-chat').valid, true);
    });

    it('clears activeModel when switching providers rather than defaulting or auto-routing', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-integrity-'));
      try {
        const mgr = ConfigManager.getInstance(tempDir);
        mgr.setActiveProvider('nim');
        mgr.setSoloModel('meta/llama-3.3-70b-instruct');
        assert.strictEqual(mgr.getConfig().activeModel, 'meta/llama-3.3-70b-instruct');

        // Switch to OpenAI: NIM model is incompatible, cleared to undefined
        mgr.setActiveProvider('openai');
        assert.strictEqual(mgr.getConfig().activeModel, undefined);

        // User explicitly sets OpenAI model
        mgr.setSoloModel('gpt-4o');
        assert.strictEqual(mgr.getConfig().activeModel, 'gpt-4o');

        // Switch to Anthropic: OpenAI model is incompatible, cleared to undefined
        mgr.setActiveProvider('anthropic');
        assert.strictEqual(mgr.getConfig().activeModel, undefined);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects setting incompatible model via setSoloModel', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-reject-'));
      try {
        const mgr = ConfigManager.getInstance(tempDir);
        mgr.setActiveProvider('openai');
        assert.throws(() => {
          mgr.setSoloModel('meta/llama-3.3-70b-instruct');
        }, /not an OpenAI model/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('4. Workspace Safety Guardian', () => {
    it('detects home directory and warns before indexing or destructive operations', () => {
      const home = os.homedir();
      assert.strictEqual(isHomeDir(home), true);

      const audit = detectWorkspaceProject(home);
      assert.strictEqual(audit.isHome, true);
      assert.strictEqual(audit.isProject, false);
      assert.ok(audit.warning?.includes('user home directory'));
    });

    it('disables RepoMap indexing when invoked in user home directory', () => {
      const home = os.homedir();
      const res = RepoMapEngine.generate({ repoPath: home, maxTokens: 512 });
      assert.ok(res.mapText.includes('RepoMap disabled'));
      assert.strictEqual(res.filesIndexed ?? res.totalFilesIndexed, 0);
    });

    it('correctly recognizes legitimate project workspaces with package.json or .git', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-valid-proj-'));
      try {
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'my-test-pkg' }));
        const audit = detectWorkspaceProject(tempDir);
        assert.strictEqual(audit.isProject, true);
        assert.strictEqual(audit.isHome, false);
        assert.strictEqual(audit.warning, undefined);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('detects drive root and system directories', () => {
      if (process.platform === 'win32') {
        assert.strictEqual(isDriveRootDir('C:\\'), true);
        assert.strictEqual(isSystemDir('C:\\Windows'), true);
        assert.strictEqual(isSystemDir('C:\\Windows\\System32'), true);
      } else {
        assert.strictEqual(isDriveRootDir('/'), true);
        assert.strictEqual(isSystemDir('/etc'), true);
        assert.strictEqual(isSystemDir('/usr/bin'), true);
      }
    });
  });
});
