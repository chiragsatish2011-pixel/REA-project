/**
 * Nomin Code: Definition-of-Done (DoD) Verification Engine
 * Extracts machine-executable criteria, executes test runners/linters in isolated worktrees,
 * collects evidence logs, and holds the final release gate against regressions and integrity violations.
 */

import { exec, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { AstIntegrityInspector, type IntegrityCheckResult } from './ast-integrity.js';
import type { AcceptanceCriterion, ReviewVerdict, TaskItem } from '../types.js';

export interface CriterionExecutionResult {
  criterionId: string;
  name: string;
  command: string;
  exitCode: number;
  expectedExitCode: number;
  passed: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  timestamp: number;
}

export interface VerificationOptions {
  worktreePath?: string;
  diffText?: string;
  timeoutOverrideSeconds?: number;
  failFast?: boolean;
}

export class DoDEngine {
  /**
   * Extracts machine-executable acceptance criteria from Architect specifications or raw markdown.
   */
  public static extractAcceptanceCriteria(specText: string): AcceptanceCriterion[] {
    const criteria: AcceptanceCriterion[] = [];
    if (!specText || typeof specText !== 'string') {
      return criteria;
    }

    // Try parsing JSON block if present
    const jsonBlockMatch = specText.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1]);
        if (Array.isArray(parsed)) {
          for (let i = 0; i < parsed.length; i++) {
            const item = parsed[i];
            if (item && typeof item.command === 'string') {
              criteria.push({
                id: item.id || `crit_${i + 1}`,
                name: item.name || `Criterion ${i + 1}`,
                command: item.command.trim(),
                timeoutSeconds: Number(item.timeoutSeconds) || 60,
                expectedExitCode: item.expectedExitCode !== undefined ? Number(item.expectedExitCode) : 0,
                description: item.description || item.name || item.command,
              });
            }
          }
          if (criteria.length > 0) return criteria;
        }
      } catch {
        // Fall back to line-by-line regex parsing
      }
    }

    const lines = specText.split('\n');
    let counter = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Pattern 1: - [ ] `command`: description or - `command` (description)
      const backtickMatch = line.match(/(?:[-*+]|\d+\.)\s*(?:\[[ xX]?\])?\s*`([^`]+)`(?:\s*[:-]?\s*(.*))?/);
      if (backtickMatch) {
        const cmd = backtickMatch[1].trim();
        const desc = (backtickMatch[2] || cmd).trim();
        if (DoDEngine.isExecutableCommand(cmd)) {
          criteria.push({
            id: `crit_${counter++}`,
            name: desc ? desc.substring(0, 40) : `Check ${cmd.substring(0, 30)}`,
            command: cmd,
            timeoutSeconds: 60,
            expectedExitCode: 0,
            description: desc || `Execute ${cmd}`,
          });
          continue;
        }
      }

      // Pattern 2: Explicit "Command: <cmd>" or "verify: <cmd>"
      const cmdPrefixMatch = line.match(/(?:Command|verify|execute|criterion|run):\s*[`"']?([^`"']+)`?'?/i);
      if (cmdPrefixMatch) {
        const cmd = cmdPrefixMatch[1].trim();
        if (DoDEngine.isExecutableCommand(cmd)) {
          criteria.push({
            id: `crit_${counter++}`,
            name: `Command step ${counter}`,
            command: cmd,
            timeoutSeconds: 60,
            expectedExitCode: 0,
            description: `Verify ${cmd}`,
          });
        }
      }
    }

    // Pattern 3: Fenced bash/sh code blocks with commands
    if (criteria.length === 0) {
      const codeBlocks = specText.match(/```(?:bash|sh|shell|zsh)?\s*([\s\S]*?)```/gi);
      if (codeBlocks) {
        for (const block of codeBlocks) {
          const innerLines = block
            .replace(/```(?:bash|sh|shell|zsh)?/gi, '')
            .replace(/```/g, '')
            .split('\n');

          for (const rawLine of innerLines) {
            const clean = rawLine.trim();
            if (clean && !clean.startsWith('#') && DoDEngine.isExecutableCommand(clean)) {
              criteria.push({
                id: `crit_${counter++}`,
                name: `Run ${clean.split(' ')[0]}`,
                command: clean,
                timeoutSeconds: 60,
                expectedExitCode: 0,
                description: `Execute acceptance verification: ${clean}`,
              });
            }
          }
        }
      }
    }

    return criteria;
  }

  /**
   * Checks if string resembles a CLI command (e.g. npm, node, tsc, pytest, cargo, git).
   */
  private static isExecutableCommand(str: string): boolean {
    const trimmed = str.trim();
    if (!trimmed || trimmed.length > 300) return false;
    const commandWords = [
      'npm', 'npx', 'node', 'tsx', 'yarn', 'pnpm', 'tsc',
      'pytest', 'python', 'python3', 'cargo', 'go', 'make',
      'mvn', 'gradle', 'vitest', 'jest', 'eslint', 'prettier',
      'git', 'sh', 'bash', 'bun', 'deno'
    ];
    const firstWord = trimmed.split(/[\s|&;]+/)[0].toLowerCase();
    return commandWords.includes(firstWord) || firstWord.endsWith('.sh') || firstWord.endsWith('.js');
  }

  /**
   * Executes a single criterion in the given worktree directory with timeout and evidence collection.
   */
  public static async executeCriterion(
    criterion: AcceptanceCriterion,
    worktreePath: string = process.cwd()
  ): Promise<CriterionExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = (criterion.timeoutSeconds || 60) * 1000;

    return new Promise<CriterionExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const cwd = fs.existsSync(worktreePath) ? worktreePath : process.cwd();
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
      const shellArgs = isWindows ? ['/d', '/s', '/c', criterion.command] : ['-c', criterion.command];

      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
        windowsVerbatimArguments: isWindows,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (isWindows && child.pid) {
            exec(`taskkill /pid ${child.pid} /T /F`);
          } else if (child.pid) {
            child.kill('SIGKILL');
          }
        } catch {
          // Process might already be dead
        }
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > 200000) {
          stdout = stdout.substring(0, 200000) + '\n... [TRUNCATED STDOUT]';
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 200000) {
          stderr = stderr.substring(0, 200000) + '\n... [TRUNCATED STDERR]';
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          criterionId: criterion.id,
          name: criterion.name,
          command: criterion.command,
          exitCode: -1,
          expectedExitCode: criterion.expectedExitCode,
          passed: false,
          stdout,
          stderr: stderr + `\nProcess execution error: ${err.message}`,
          durationMs,
          timestamp: startTime,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const finalExitCode = timedOut ? 124 : (code ?? -1);

        if (timedOut) {
          stderr += `\nCommand timed out after ${criterion.timeoutSeconds} seconds.`;
        }

        const passed = !timedOut && finalExitCode === criterion.expectedExitCode;

        resolve({
          criterionId: criterion.id,
          name: criterion.name,
          command: criterion.command,
          exitCode: finalExitCode,
          expectedExitCode: criterion.expectedExitCode,
          passed,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs,
          timestamp: startTime,
        });
      });
    });
  }

  /**
   * Executes a collection of acceptance criteria and aggregates execution results.
   */
  public static async runAllCriteria(
    criteria: AcceptanceCriterion[],
    worktreePath: string = process.cwd(),
    failFast: boolean = false
  ): Promise<CriterionExecutionResult[]> {
    const results: CriterionExecutionResult[] = [];

    for (const criterion of criteria) {
      const result = await DoDEngine.executeCriterion(criterion, worktreePath);
      results.push(result);

      if (failFast && !result.passed) {
        break;
      }
    }

    return results;
  }

  /**
   * Holds the final verification gate for a task.
   * Blocks completion if:
   * 1. Any acceptance criterion fails.
   * 2. AST diff inspection detects deleted tests, weakened assertions, or stubs.
   */
  public static async verifyTask(
    task: { id: string; acceptanceCriteria?: AcceptanceCriterion[] } | string,
    options: VerificationOptions = {}
  ): Promise<ReviewVerdict> {
    const taskId = typeof task === 'string' ? task : task.id;
    const criteria: AcceptanceCriterion[] =
      typeof task === 'object' && task.acceptanceCriteria ? task.acceptanceCriteria : [];

    const worktreePath = options.worktreePath || process.cwd();
    const verifiedCriteria: string[] = [];
    const failedCriteria: string[] = [];
    const evidenceLogs: Array<{
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
    }> = [];

    // Step 1: Adversarial AST Diff Inspection
    let integrityViolation = false;
    let integrityFeedback = '';

    if (options.diffText) {
      const integrityCheck: IntegrityCheckResult = AstIntegrityInspector.inspectDiff(options.diffText);
      if (!integrityCheck.passed) {
        integrityViolation = true;
        integrityFeedback = integrityCheck.violations.join('\n');
      }
    }

    // Step 2: If integrity violation detected, immediately fail gate
    if (integrityViolation) {
      return {
        approved: false,
        taskId,
        reason: 'INTEGRITY_VIOLATION: Code submitted contains stubs, deleted assertions, or skipped tests.',
        feedback: integrityFeedback,
        integrityViolation: true,
        verifiedCriteria,
        failedCriteria,
        evidenceLogs,
      };
    }

    // Step 3: Execute all acceptance criteria
    const execResults = await DoDEngine.runAllCriteria(criteria, worktreePath, options.failFast ?? false);

    for (const res of execResults) {
      evidenceLogs.push({
        command: res.command,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
      });

      if (res.passed) {
        verifiedCriteria.push(res.criterionId);
      } else {
        failedCriteria.push(res.criterionId);
      }
    }

    // Step 4: Final gate release decision
    const allPassed = failedCriteria.length === 0 && (criteria.length === 0 || verifiedCriteria.length === criteria.length);

    if (allPassed) {
      return {
        approved: true,
        taskId,
        reason: criteria.length === 0
          ? 'No acceptance criteria specified; AST integrity inspection passed.'
          : `All ${verifiedCriteria.length} acceptance criteria passed successfully.`,
        integrityViolation: false,
        verifiedCriteria,
        failedCriteria,
        evidenceLogs,
      };
    }

    const failedDetails = execResults
      .filter((r) => !r.passed)
      .map((r) => `[FAIL] "${r.command}" exited with ${r.exitCode} (expected ${r.expectedExitCode})\nSTDERR: ${r.stderr || '(empty)'}\nSTDOUT: ${r.stdout || '(empty)'}`)
      .join('\n---\n');

    return {
      approved: false,
      taskId,
      reason: `Definition of Done failed: ${failedCriteria.length} of ${criteria.length} criteria failed.`,
      feedback: failedDetails,
      integrityViolation: false,
      verifiedCriteria,
      failedCriteria,
      evidenceLogs,
    };
  }
}

// Export alias for DefinitionOfDoneEngine
export { DoDEngine as DefinitionOfDoneEngine };
