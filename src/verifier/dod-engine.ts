/**
 * Nomin Code: Definition-of-Done (DoD) Verification Engine & Proof Hardener
 *
 * Extracts machine-executable criteria, executes test runners/linters in isolated worktrees,
 * collects empirical stdout/stderr evidence, runs multi-language adversarial AST integrity audits,
 * and generates tamper-evident, SHA-256 signed TaskCompletionCertificates.
 */

import { exec, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { AstIntegrityInspector, type IntegrityCheckResult } from './ast-integrity.js';
import type { AcceptanceCriterion, ReviewVerdict } from '../types.js';

export type { AcceptanceCriterion, ReviewVerdict };
import { isSystemDir, isWritableDir, resolveNominPaths, safeMkdirSync } from '../config/index.js';
import type {
  AstAudit,
  CertificateVerificationResult,
  CriterionResult,
  DiffSummary,
  FinalGateOptions,
  FinalGateResult,
  TaskCompletionCertificate,
} from './types.js';

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

export interface VerificationOptions extends FinalGateOptions {}

export class DoDEngine {
  private workspaceRoot: string;

  constructor(options: { workspaceRoot?: string } = {}) {
    this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  }

  /**
   * Sets or updates the active workspace root.
   */
  public setWorkspaceRoot(newRoot: string): void {
    this.workspaceRoot = path.resolve(newRoot);
  }

  /**
   * Deterministic, recursively sorted JSON serializer for canonical hashing.
   */
  public static canonicalJson(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map((item) => DoDEngine.canonicalJson(item)).join(',') + ']';
    }
    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    return '{' + sortedKeys.map((key) => JSON.stringify(key) + ':' + DoDEngine.canonicalJson(record[key])).join(',') + '}';
  }

  /**
   * Computes SHA-256 digital signature over a canonical certificate payload.
   */
  public static computeCertificateSignature(
    payload: Omit<TaskCompletionCertificate, 'signature'>
  ): string {
    const canonical = DoDEngine.canonicalJson(payload);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Verifies the cryptographic integrity of a TaskCompletionCertificate.
   * Detects tampering, manual edits, or forged approval flags.
   */
  public static verifyCertificateIntegrity(
    certificate: TaskCompletionCertificate
  ): CertificateVerificationResult {
    if (!certificate || typeof certificate !== 'object') {
      return {
        valid: false,
        expectedSignature: '',
        actualSignature: '',
        reason: 'Certificate is null or invalid object.',
      };
    }

    const { signature, ...payload } = certificate;
    if (!signature || typeof signature !== 'string') {
      return {
        valid: false,
        expectedSignature: '',
        actualSignature: '',
        reason: 'Missing digital signature on certificate.',
      };
    }

    const expected = DoDEngine.computeCertificateSignature(payload);

    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');

      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return {
          valid: false,
          expectedSignature: expected,
          actualSignature: signature,
          reason: 'Tamper detected: SHA-256 signature mismatch. Certificate content was altered.',
        };
      }

      return {
        valid: true,
        expectedSignature: expected,
        actualSignature: signature,
      };
    } catch (err: any) {
      return {
        valid: false,
        expectedSignature: expected,
        actualSignature: signature,
        reason: `Cryptographic verification error: ${err.message}`,
      };
    }
  }

  /**
   * Parses git diff text to compute filesChanged, insertions, and deletions.
   */
  public static parseDiffSummary(diffText: string): DiffSummary {
    let insertions = 0;
    let deletions = 0;
    const seenFiles = new Set<string>();

    if (!diffText || typeof diffText !== 'string') {
      return { filesChanged: 0, insertions: 0, deletions: 0 };
    }

    const lines = diffText.split('\n');
    for (const line of lines) {
      if (line.startsWith('diff --git ') || line.startsWith('+++ b/')) {
        const match = line.match(/(?:b\/|diff --git a\/.* b\/)(.*)/);
        if (match && match[1]) {
          seenFiles.add(match[1].trim());
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        insertions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    const filesChanged =
      seenFiles.size > 0 ? seenFiles.size : insertions > 0 || deletions > 0 ? 1 : 0;

    return { filesChanged, insertions, deletions };
  }

  /**
   * Resolves the persistent proof directory with sandboxed fallback in system/read-only dirs.
   */
  public static resolveProofDir(workdir: string = process.cwd()): string {
    const candidate = path.join(workdir, '.nomin', 'proofs');
    if (isWritableDir(workdir) && !isSystemDir(workdir)) {
      try {
        if (!fs.existsSync(candidate)) {
          fs.mkdirSync(candidate, { recursive: true });
        }
        return candidate;
      } catch {
        // Fallback to global state
      }
    }

    const resolved = resolveNominPaths(workdir);
    const fallback = path.join(resolved.stateDir, 'proofs');
    safeMkdirSync(fallback);
    return fallback;
  }

  /**
   * Saves a TaskCompletionCertificate to `.nomin/proofs/task_<id>.json`.
   */
  public static saveCertificate(
    certificate: TaskCompletionCertificate,
    workdir: string = process.cwd()
  ): string {
    const dir = DoDEngine.resolveProofDir(workdir);
    const sanitizedId = certificate.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(dir, `task_${sanitizedId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(certificate, null, 2), 'utf8');
    return filePath;
  }

  /**
   * Loads a TaskCompletionCertificate from disk.
   */
  public static loadCertificate(
    taskId: string,
    workdir: string = process.cwd()
  ): TaskCompletionCertificate | null {
    const dir = DoDEngine.resolveProofDir(workdir);
    const sanitizedId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(dir, `task_${sanitizedId}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as TaskCompletionCertificate;
    } catch {
      return null;
    }
  }

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
   * Checks if string resembles an executable CLI command.
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
   * Holds the final Release Verification Gate for a task.
   * Generates a tamper-evident, SHA-256 signed TaskCompletionCertificate.
   *
   * Blocks release if:
   * 1. AST diff inspection detects stubs, skips, or deleted assertions.
   * 2. Any acceptance criterion fails to execute cleanly.
   * 3. Certificate cannot be cryptographically verified.
   */
  public static async verifyFinalGate(
    task: { id: string; acceptanceCriteria?: AcceptanceCriterion[] } | string,
    options: FinalGateOptions = {}
  ): Promise<FinalGateResult> {
    const taskId = typeof task === 'string' ? task : task.id;
    const criteria: AcceptanceCriterion[] =
      typeof task === 'object' && task.acceptanceCriteria ? task.acceptanceCriteria : [];

    const worktreePath = options.worktreePath || process.cwd();
    const verifiedCriteria: string[] = [];
    const failedCriteria: string[] = [];
    const criteriaResults: CriterionResult[] = [];
    const evidenceLogs: Array<{
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
    }> = [];

    const diffText = options.diffText || '';
    const diffSummary = DoDEngine.parseDiffSummary(diffText);
    const baseSha = options.baseSha || '0000000000000000000000000000000000000000';
    const headSha = options.headSha || 'c0ffee1111111111111111111111111111111111';

    // Step 1: Adversarial AST Diff Inspection
    const astAudit: AstAudit = AstIntegrityInspector.audit(diffText, true);

    // Step 2: If AST integrity violation detected, immediately fail gate & generate rejection certificate
    if (!astAudit.clean) {
      const certPayload: Omit<TaskCompletionCertificate, 'signature'> = {
        taskId,
        baseSha,
        headSha,
        diffSummary,
        criteriaResults: [],
        astAudit,
        verifierRole: 'Verifier',
        timestamp: new Date().toISOString(),
        verified: false,
      };

      const signature = DoDEngine.computeCertificateSignature(certPayload);
      const certificate: TaskCompletionCertificate = {
        ...certPayload,
        signature,
      };

      const certPath = DoDEngine.saveCertificate(certificate, worktreePath);
      const feedback = [
        ...astAudit.stubsFound.map((s) => `[STUB] ${s}`),
        ...astAudit.testsSkipped.map((t) => `[TEST_SKIP] ${t}`),
      ].join('\n');

      return {
        approved: false,
        taskId,
        reason:
          'INTEGRITY_VIOLATION: Code contains stubs, deleted assertions, or artificially skipped tests.',
        feedback,
        integrityViolation: true,
        verifiedCriteria,
        failedCriteria,
        certificate,
        certificatePath: certPath,
        evidenceLogs,
      };
    }

    // Step 3: Execute all acceptance criteria
    const execResults = await DoDEngine.runAllCriteria(criteria, worktreePath, options.failFast ?? false);

    for (const res of execResults) {
      const stdoutHash = crypto.createHash('sha256').update(res.stdout || '', 'utf8').digest('hex');

      criteriaResults.push({
        command: res.command,
        exitCode: res.exitCode,
        stdoutHash,
        durationMs: res.durationMs,
      });

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

    // Step 4: Release Decision & Tamper-Evident Certificate Generation
    const allPassed =
      failedCriteria.length === 0 &&
      (criteria.length === 0 || verifiedCriteria.length === criteria.length);

    const verified = allPassed && astAudit.clean;

    const certPayload: Omit<TaskCompletionCertificate, 'signature'> = {
      taskId,
      baseSha,
      headSha,
      diffSummary,
      criteriaResults,
      astAudit,
      verifierRole: 'Verifier',
      timestamp: new Date().toISOString(),
      verified,
    };

    const signature = DoDEngine.computeCertificateSignature(certPayload);
    const certificate: TaskCompletionCertificate = {
      ...certPayload,
      signature,
    };

    const certPath = DoDEngine.saveCertificate(certificate, worktreePath);

    if (verified) {
      return {
        approved: true,
        taskId,
        reason:
          criteria.length === 0
            ? 'No acceptance criteria specified; AST integrity inspection passed.'
            : `All ${verifiedCriteria.length} acceptance criteria passed successfully.`,
        integrityViolation: false,
        verifiedCriteria,
        failedCriteria,
        certificate,
        certificatePath: certPath,
        evidenceLogs,
      };
    }

    const failedDetails = execResults
      .filter((r) => !r.passed)
      .map(
        (r) =>
          `[FAIL] "${r.command}" exited with ${r.exitCode} (expected ${r.expectedExitCode})\nSTDERR: ${
            r.stderr || '(empty)'
          }\nSTDOUT: ${r.stdout || '(empty)'}`
      )
      .join('\n---\n');

    return {
      approved: false,
      taskId,
      reason: `Definition of Done failed: ${failedCriteria.length} of ${criteria.length} criteria failed.`,
      feedback: failedDetails,
      integrityViolation: false,
      verifiedCriteria,
      failedCriteria,
      certificate,
      certificatePath: certPath,
      evidenceLogs,
    };
  }

  /**
   * Instance method wrapper for verifyFinalGate.
   */
  public async verifyFinalGate(
    task: { id: string; acceptanceCriteria?: AcceptanceCriterion[] } | string,
    options: FinalGateOptions = {}
  ): Promise<FinalGateResult> {
    const mergedOptions: FinalGateOptions = {
      worktreePath: options.worktreePath || this.workspaceRoot,
      ...options,
    };
    return DoDEngine.verifyFinalGate(task, mergedOptions);
  }

  /**
   * Backwards-compatible verifyTask method wrapping verifyFinalGate.
   */
  public static async verifyTask(
    task: { id: string; acceptanceCriteria?: AcceptanceCriterion[] } | string,
    options: VerificationOptions = {}
  ): Promise<ReviewVerdict> {
    const gateResult = await DoDEngine.verifyFinalGate(task, options);

    return {
      approved: gateResult.approved,
      taskId: gateResult.taskId,
      reason: gateResult.reason,
      feedback: gateResult.feedback,
      integrityViolation: gateResult.integrityViolation,
      certificate: gateResult.certificate,
      verifiedCriteria: gateResult.verifiedCriteria,
      failedCriteria: gateResult.failedCriteria,
      evidenceLogs: gateResult.evidenceLogs,
    };
  }

  /**
   * Instance method wrapper for verifyTask.
   */
  public async verifyTask(
    task: { id: string; acceptanceCriteria?: AcceptanceCriterion[] } | string,
    options: VerificationOptions = {}
  ): Promise<ReviewVerdict> {
    return DoDEngine.verifyTask(task, {
      worktreePath: options.worktreePath || this.workspaceRoot,
      ...options,
    });
  }
}

// Export alias for DefinitionOfDoneEngine
export { DoDEngine as DefinitionOfDoneEngine };
