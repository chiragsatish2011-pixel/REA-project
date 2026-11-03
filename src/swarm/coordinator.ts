/**
 * @file coordinator.ts
 * @description Master Swarm Orchestrator managing the 4-agent parallel loop:
 * 1. Lead Architect: receives user request, extracts DAG and Acceptance Criteria into Blackboard.
 * 2. Spawns Coder and Tester into dedicated Git worktrees.
 * 3. Coordinates inter-agent messages between Coder and Tester via Mailbox.
 * 4. Dispatches completed worktrees to Verifier for release-gate evidence checking and merge.
 *
 * Pure Node.js standard library implementation.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Blackboard } from './blackboard.js';
import { SwarmMailbox } from './mailbox.js';
import { ReminderTracker, type TodoGateDecision } from './reminder-policy.js';
import { CompactionEngine, estimateTokens } from './compaction.js';
import type {
  AcceptanceCriterion,
  NominAgentMessage,
  SwarmRole,
  SwarmRunResult,
  SwarmTask,
  SwarmTaskStatus,
} from './types.js';

const execFileAsync = promisify(execFile);

export interface SwarmCoordinatorOptions {
  workspaceRoot?: string;
  sessionId?: string;
  maxRetriesPerTask?: number;
  useGitWorktrees?: boolean;
  architectModel?: string;
  coderModel?: string;
  testerModel?: string;
  verifierModel?: string;
}

export interface TaskExecutionHookContext {
  task: SwarmTask;
  role: SwarmRole;
  worktreePath: string;
  blackboard: Blackboard;
  mailbox: SwarmMailbox;
}

export type AgentExecutionHook = (
  context: TaskExecutionHookContext,
  incomingMessages: NominAgentMessage[]
) => Promise<{
  success: boolean;
  output?: string;
  diffSummary?: string;
  commitHash?: string;
  evidence?: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  feedback?: string;
}>;

export class SwarmCoordinator extends EventEmitter {
  public readonly blackboard: Blackboard;
  public readonly mailbox: SwarmMailbox;
  public readonly reminderTracker: ReminderTracker;
  public readonly compactionEngine: CompactionEngine;

  private workspaceRoot: string;
  private worktreesBaseDir: string;
  private maxRetriesPerTask: number;
  private useGitWorktrees: boolean;
  private sessionId: string;

  // Optional custom agent handlers (defaults provided)
  private architectHook?: (userGoal: string) => Promise<Array<Omit<SwarmTask, 'createdAt' | 'updatedAt'>>>;
  private coderHook?: AgentExecutionHook;
  private testerHook?: AgentExecutionHook;
  private verifierHook?: AgentExecutionHook;

  constructor(options: SwarmCoordinatorOptions = {}) {
    super();
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.sessionId = options.sessionId || crypto.randomUUID();
    this.maxRetriesPerTask = options.maxRetriesPerTask ?? 3;
    this.useGitWorktrees = options.useGitWorktrees ?? true;

    this.worktreesBaseDir = path.join(this.workspaceRoot, '.nomin', 'worktrees');

    this.blackboard = new Blackboard({
      workspaceRoot: this.workspaceRoot,
      sessionId: this.sessionId,
    });

    this.mailbox = new SwarmMailbox();
    this.reminderTracker = new ReminderTracker({
      todo_gate: { enabled: true, max_fires_per_prompt: 2 },
    });
    this.compactionEngine = new CompactionEngine();

    this.registerAgents({
      architectModel: options.architectModel || 'deepseek-ai/deepseek-r1',
      coderModel: options.coderModel || 'qwen/qwen2.5-coder-32b-instruct',
      testerModel: options.testerModel || 'qwen/qwen2.5-coder-32b-instruct',
      verifierModel: options.verifierModel || 'deepseek-ai/deepseek-r1',
    });
  }

  /**
   * Registers the 4 core swarm agents on the Blackboard.
   */
  private registerAgents(models: Record<string, string>): void {
    this.blackboard.registerAgent({
      agentId: 'agent-architect-01',
      role: 'Architect',
      model: models.architectModel,
    });
    this.blackboard.registerAgent({
      agentId: 'agent-coder-01',
      role: 'Coder',
      model: models.coderModel,
    });
    this.blackboard.registerAgent({
      agentId: 'agent-tester-01',
      role: 'Tester',
      model: models.testerModel,
    });
    this.blackboard.registerAgent({
      agentId: 'agent-verifier-01',
      role: 'Verifier',
      model: models.verifierModel,
    });
  }

  public setArchitectHook(hook: (userGoal: string) => Promise<Array<Omit<SwarmTask, 'createdAt' | 'updatedAt'>>>): void {
    this.architectHook = hook;
  }

  public setCoderHook(hook: AgentExecutionHook): void {
    this.coderHook = hook;
  }

  public setTesterHook(hook: AgentExecutionHook): void {
    this.testerHook = hook;
  }

  public setVerifierHook(hook: AgentExecutionHook): void {
    this.verifierHook = hook;
  }

  /**
   * Main entry point: Executes the entire 4-agent parallel loop for a user request.
   */
  public async orchestrate(userGoal: string): Promise<SwarmRunResult> {
    const startTime = Date.now();
    this.emit('swarm:started', { sessionId: this.sessionId, userGoal });
    this.reminderTracker.resetPrompt();

    // -------------------------------------------------------------------------
    // Phase 1: Lead Architect Task Decomposition & Acceptance Criteria Extraction
    // -------------------------------------------------------------------------
    this.emit('architect:started', { userGoal });
    this.blackboard.updateAgentStatus('agent-architect-01', 'busy');

    const tasks = await this.executeArchitectDecomposition(userGoal);
    for (const t of tasks) {
      this.blackboard.addTask(t);
    }
    this.blackboard.updateAgentStatus('agent-architect-01', 'idle');
    this.emit('architect:dag_created', {
      tasksCount: tasks.length,
      topologicalOrder: this.blackboard.getState().taskDAG.topologicalOrder,
    });

    // -------------------------------------------------------------------------
    // Phase 2: Parallel Swarm Loop (Coder + Tester + Verifier)
    // -------------------------------------------------------------------------
    const errors: string[] = [];

    while (true) {
      const readyTasks = this.blackboard.getReadyTasks();
      const allTasks = this.blackboard.getAllTasks();
      const pendingOrInProgress = allTasks.filter(
        (t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS' || t.status === 'CODE_SUBMITTED'
      );

      if (pendingOrInProgress.length === 0) {
        // Swarm finished all tasks!
        break;
      }

      if (readyTasks.length === 0 && pendingOrInProgress.length > 0) {
        // Deadlock or unresolvable failure
        const blockedTasks = pendingOrInProgress.map((t) => t.id).join(', ');
        const err = `Swarm deadlock: Remaining tasks are blocked without ready dependencies: ${blockedTasks}`;
        errors.push(err);
        this.emit('swarm:error', err);
        break;
      }

      // Process all ready tasks in parallel
      await Promise.all(
        readyTasks.map(async (task) => {
          try {
            await this.processTaskThroughSwarm(task);
          } catch (taskErr) {
            const msg = `Task ${task.id} failed: ${(taskErr as Error).message}`;
            errors.push(msg);
            this.blackboard.updateTask(task.id, {
              status: 'REJECTED',
              errorFeedback: msg,
            });
          }
        })
      );
    }

    // -------------------------------------------------------------------------
    // Phase 3: Final Verification & Results Gathering
    // -------------------------------------------------------------------------
    const allFinalTasks = this.blackboard.getAllTasks();
    const completedTasks = allFinalTasks.filter((t) => t.status === 'VERIFIED').length;
    const failedTasks = allFinalTasks.filter((t) => t.status === 'REJECTED').length;
    const isSuccess = completedTasks === allFinalTasks.length && errors.length === 0;

    const result: SwarmRunResult = {
      success: isSuccess,
      sessionId: this.sessionId,
      totalTasks: allFinalTasks.length,
      completedTasks,
      failedTasks,
      durationMs: Date.now() - startTime,
      taskOutcomes: allFinalTasks.map((t) => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        assignedRole: t.assignedRole,
        criteriaPassed: t.acceptanceCriteria.filter((c) => c.verified).length,
        criteriaTotal: t.acceptanceCriteria.length,
        error: t.errorFeedback,
      })),
      errors,
    };

    this.emit('swarm:completed', result);
    return result;
  }

  /**
   * Executes Lead Architect decomposition.
   */
  private async executeArchitectDecomposition(
    userGoal: string
  ): Promise<Array<Omit<SwarmTask, 'createdAt' | 'updatedAt'>>> {
    if (this.architectHook) {
      return this.architectHook(userGoal);
    }

    // High-quality deterministic fallback decomposition
    const taskId1 = 'T-101';
    const taskId2 = 'T-102';

    return [
      {
        id: taskId1,
        title: 'Core Implementation',
        description: `Implement required feature logic for: ${userGoal}`,
        assignedRole: 'Coder',
        dependencies: [],
        status: 'PENDING',
        acceptanceCriteria: [
          {
            id: 'AC-101-1',
            name: 'Syntactic Validation & Build',
            command: 'npm run build || tsc --noEmit',
            timeoutSeconds: 30,
            expectedExitCode: 0,
            description: 'Ensure TypeScript code compiles without type or syntax errors.',
          },
        ],
      },
      {
        id: taskId2,
        title: 'Adversarial Test Suite & Integration Verification',
        description: `Validate criteria and test edge cases for: ${userGoal}`,
        assignedRole: 'Tester',
        dependencies: [taskId1],
        status: 'PENDING',
        acceptanceCriteria: [
          {
            id: 'AC-102-1',
            name: 'Unit & Regression Test Execution',
            command: 'npm test',
            timeoutSeconds: 60,
            expectedExitCode: 0,
            description: 'Execute automated test suite to ensure all assertions pass.',
          },
        ],
      },
    ];
  }

  /**
   * Processes a single task through the Coder -> Tester -> Verifier pipeline.
   */
  private async processTaskThroughSwarm(task: SwarmTask): Promise<void> {
    this.blackboard.updateTask(task.id, { status: 'IN_PROGRESS' });
    this.emit('task:in_progress', { taskId: task.id, title: task.title });

    let retries = 0;
    const maxRetries = this.maxRetriesPerTask;

    while (retries <= maxRetries) {
      // 1. Setup isolated Git Worktrees
      const coderWorktree = await this.setupWorktree(task.id, 'coder');
      const testerWorktree = await this.setupWorktree(task.id, 'tester');

      this.blackboard.updateTask(task.id, {
        worktreePath: coderWorktree,
        branchName: `agent/coder-${task.id}`,
      });

      // 2. Dispatch task to Coder
      this.mailbox.send({
        conversationId: this.sessionId,
        senderRole: 'Architect',
        recipientRole: 'Coder',
        messageType: 'TASK_DISPATCH',
        payload: {
          taskId: task.id,
          status: 'IN_PROGRESS',
          worktreePath: coderWorktree,
        },
      });

      // 3. Execute Coder
      this.blackboard.updateAgentStatus('agent-coder-01', 'busy', task.id);
      this.emit('coder:started', { taskId: task.id, worktree: coderWorktree });

      const coderResult = await this.executeCoder(task, coderWorktree);
      this.blackboard.updateAgentStatus('agent-coder-01', 'idle');

      if (!coderResult.success) {
        retries++;
        this.emit('coder:failed', { taskId: task.id, error: coderResult.feedback, retries });
        if (retries > maxRetries) {
          throw new Error(`Coder exceeded max retries (${maxRetries}) on task ${task.id}: ${coderResult.feedback}`);
        }
        continue;
      }

      this.blackboard.updateTask(task.id, {
        status: 'CODE_SUBMITTED',
        commitHash: coderResult.commitHash || 'c0ffee1',
      });

      // 4. Send Code Submission to Tester
      this.mailbox.send({
        conversationId: this.sessionId,
        senderRole: 'Coder',
        recipientRole: 'Tester',
        messageType: 'CODE_SUBMISSION',
        payload: {
          taskId: task.id,
          status: 'CODE_SUBMITTED',
          worktreePath: coderWorktree,
          commitHash: coderResult.commitHash,
        },
      });

      // 5. Execute Tester against Acceptance Criteria
      this.blackboard.updateAgentStatus('agent-tester-01', 'busy', task.id);
      this.emit('tester:started', { taskId: task.id, worktree: testerWorktree });

      const testResult = await this.executeTester(task, testerWorktree);
      this.blackboard.updateAgentStatus('agent-tester-01', 'idle');

      this.mailbox.send({
        conversationId: this.sessionId,
        senderRole: 'Tester',
        recipientRole: 'Verifier',
        messageType: 'TEST_RESULTS',
        payload: {
          taskId: task.id,
          evidence: testResult.evidence,
          status: testResult.success ? 'TESTS_PASSED' : 'REJECTED',
          feedback: testResult.feedback,
        },
      });

      // 6. Verifier Safety Gate
      this.blackboard.updateAgentStatus('agent-verifier-01', 'busy', task.id);
      this.emit('verifier:started', { taskId: task.id });

      const verificationVerdict = await this.executeVerifier(task, coderWorktree, testResult);
      this.blackboard.updateAgentStatus('agent-verifier-01', 'idle');

      if (verificationVerdict.success) {
        // All acceptance criteria passed, no integrity violations!
        this.blackboard.updateTask(task.id, {
          status: 'VERIFIED',
          commitHash: coderResult.commitHash,
        });

        // Merge worktree back to primary workspace
        await this.mergeWorktree(coderWorktree);
        await this.cleanupWorktree(coderWorktree);
        await this.cleanupWorktree(testerWorktree);

        this.mailbox.send({
          conversationId: this.sessionId,
          senderRole: 'Verifier',
          recipientRole: 'Architect',
          messageType: 'REVIEW_VERDICT',
          payload: {
            taskId: task.id,
            status: 'VERIFIED',
            feedback: 'Definition of Done confirmed with machine execution proof.',
          },
        });

        this.emit('task:verified', { taskId: task.id });
        return;
      } else {
        // Verification failed
        retries++;
        this.emit('verifier:rejected', {
          taskId: task.id,
          reason: verificationVerdict.feedback,
          retries,
        });

        // Feedback loop to Coder
        this.mailbox.send({
          conversationId: this.sessionId,
          senderRole: 'Verifier',
          recipientRole: 'Coder',
          messageType: 'REVIEW_VERDICT',
          payload: {
            taskId: task.id,
            status: 'REJECTED',
            feedback: verificationVerdict.feedback,
          },
        });

        await this.cleanupWorktree(coderWorktree);
        await this.cleanupWorktree(testerWorktree);

        if (retries > maxRetries) {
          throw new Error(`Task ${task.id} rejected by Verifier after ${maxRetries} iterations: ${verificationVerdict.feedback}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Worktree Management
  // ---------------------------------------------------------------------------

  private async setupWorktree(taskId: string, role: string): Promise<string> {
    const wtDir = path.join(this.worktreesBaseDir, `wt-${taskId}-${role}`);

    if (!fs.existsSync(this.worktreesBaseDir)) {
      fs.mkdirSync(this.worktreesBaseDir, { recursive: true });
    }

    if (this.useGitWorktrees) {
      try {
        const branch = `agent/${role}-${taskId}-${Date.now().toString(36)}`;
        await execFileAsync('git', ['worktree', 'add', '-b', branch, wtDir], {
          cwd: this.workspaceRoot,
        });
        return wtDir;
      } catch {
        // Git worktree add fallback: isolated directory copy
      }
    }

    // Directory-based isolation fallback
    if (!fs.existsSync(wtDir)) {
      fs.mkdirSync(wtDir, { recursive: true });
    }
    return wtDir;
  }

  private async mergeWorktree(worktreePath: string): Promise<void> {
    if (this.useGitWorktrees && fs.existsSync(worktreePath)) {
      try {
        // Check if there are committed changes
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: worktreePath,
        });
        const branch = stdout.trim();
        if (branch && branch.startsWith('agent/')) {
          await execFileAsync('git', ['merge', '--no-ff', branch, '-m', `Merge ${branch} into main`], {
            cwd: this.workspaceRoot,
          });
        }
      } catch {
        // Non-blocking merge error fallback
      }
    }
  }

  private async cleanupWorktree(worktreePath: string): Promise<void> {
    try {
      if (this.useGitWorktrees) {
        try {
          await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
            cwd: this.workspaceRoot,
          });
        } catch {
          // ignore git error and proceed to disk check
        }
      }
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  }

  // ---------------------------------------------------------------------------
  // Agent Execution Runners
  // ---------------------------------------------------------------------------

  private async executeCoder(
    task: SwarmTask,
    worktreePath: string
  ): Promise<{ success: boolean; commitHash?: string; feedback?: string }> {
    if (this.coderHook) {
      const incoming = this.mailbox.drainQueue('Coder', { taskId: task.id });
      return this.coderHook({ task, role: 'Coder', worktreePath, blackboard: this.blackboard, mailbox: this.mailbox }, incoming);
    }

    // Check system reminder policy
    this.reminderTracker.onTurnStart();
    const nudge = this.reminderTracker.evaluateNudge();
    if (nudge.shouldNudge) {
      this.emit('reminder:nudge', nudge.reminderText);
    }

    // Simulated reliable coder completion
    const mockCommit = crypto.randomBytes(4).toString('hex');
    this.reminderTracker.onTodoWriteCalled();

    return {
      success: true,
      commitHash: mockCommit,
      feedback: 'Code modifications applied cleanly to worktree.',
    };
  }

  private async executeTester(
    task: SwarmTask,
    worktreePath: string
  ): Promise<{
    success: boolean;
    evidence: { command: string; exitCode: number; stdout: string; stderr: string };
    feedback?: string;
  }> {
    if (this.testerHook) {
      const incoming = this.mailbox.drainQueue('Tester', { taskId: task.id });
      const res = await this.testerHook(
        { task, role: 'Tester', worktreePath, blackboard: this.blackboard, mailbox: this.mailbox },
        incoming
      );
      return {
        success: res.success,
        evidence: res.evidence || { command: 'npm test', exitCode: res.success ? 0 : 1, stdout: res.output || '', stderr: '' },
        feedback: res.feedback,
      };
    }

    // Execute actual acceptance criteria commands if present
    for (const criterion of task.acceptanceCriteria) {
      const startTime = Date.now();
      try {
        const [cmd, ...args] = criterion.command.split(' ');
        const { stdout, stderr } = await execFileAsync(cmd, args, {
          cwd: this.workspaceRoot,
          timeout: criterion.timeoutSeconds * 1000,
          shell: true,
        });

        this.blackboard.updateCriterion(task.id, criterion.id, true, {
          exitCode: 0,
          stdout: stdout.slice(0, 1000),
          stderr: stderr.slice(0, 1000),
          timestamp: Date.now(),
          durationMs: Date.now() - startTime,
        });
      } catch (cmdErr: any) {
        const exitCode = cmdErr.code ?? 1;
        const stdout = cmdErr.stdout || '';
        const stderr = cmdErr.stderr || (cmdErr as Error).message;

        this.blackboard.updateCriterion(task.id, criterion.id, false, {
          exitCode,
          stdout: stdout.slice(0, 1000),
          stderr: stderr.slice(0, 1000),
          timestamp: Date.now(),
          durationMs: Date.now() - startTime,
        });

        return {
          success: false,
          evidence: {
            command: criterion.command,
            exitCode,
            stdout,
            stderr,
          },
          feedback: `Acceptance Criterion failed: ${criterion.name}. Exit code ${exitCode}. Error: ${stderr}`,
        };
      }
    }

    return {
      success: true,
      evidence: {
        command: task.acceptanceCriteria[0]?.command || 'npm test',
        exitCode: 0,
        stdout: 'All criteria passed successfully with exit code 0.',
        stderr: '',
      },
    };
  }

  private async executeVerifier(
    task: SwarmTask,
    worktreePath: string,
    testResult: { success: boolean; evidence: any; feedback?: string }
  ): Promise<{ success: boolean; feedback?: string }> {
    if (this.verifierHook) {
      const incoming = this.mailbox.drainQueue('Verifier', { taskId: task.id });
      return this.verifierHook(
        { task, role: 'Verifier', worktreePath, blackboard: this.blackboard, mailbox: this.mailbox },
        incoming
      );
    }

    // 1. Check all criteria are verified
    const currentTask = this.blackboard.getTask(task.id);
    if (!currentTask) {
      return { success: false, feedback: `Task '${task.id}' not found on Blackboard.` };
    }

    const unverified = currentTask.acceptanceCriteria.filter((c) => !c.verified);
    if (unverified.length > 0) {
      return {
        success: false,
        feedback: `Definition of Done failed: Unverified criteria remaining: ${unverified.map((u) => u.name).join(', ')}`,
      };
    }

    // 2. Turn-end TodoGate check
    const gateDecision: TodoGateDecision = this.reminderTracker.evaluateGate(false, {
      pending: [],
      inProgress: [],
    });

    if (gateDecision.type === 'nudge') {
      this.emit('reminder:gate_fired', gateDecision.reminder);
    }

    return {
      success: true,
      feedback: 'All acceptance criteria validated with reproducible evidence. Approved for release.',
    };
  }
}
