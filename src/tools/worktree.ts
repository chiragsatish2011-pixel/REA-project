/**
 * @file worktree.ts
 * @description Git worktree manager for Nomin Code.
 * Modeled on Grok Build (xai-fast-worktree) & Claude Code (worktrees.md).
 * Manages:
 *   - Isolated agent worktree creation (.nomin/worktrees/<agent_id>)
 *   - Automated micro-commits after successful edits
 *   - Clean 3-way rebase & merge pipeline with conflict detection and rollback
 *   - Safe worktree pruning and branch deletion
 * Zero external dependencies (pure Node.js child_process and fs).
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  WorktreeInfo,
  MicroCommitResult,
  WorktreeMergeResult,
} from './types.js';

/**
 * Runs a git command and returns its stdout, stderr, and exit code.
 */
export async function runGit(
  args: string[],
  cwd: string,
  timeoutMs: number = 30000
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', // Disable any interactive credential prompts
      },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf-8');
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf-8');
      });
    }

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: `Failed to execute git: ${err.message}`,
      });
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? -1),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

/**
 * Git Worktree Manager
 */
export class GitWorktreeManager {
  private repoRoot: string;
  private worktreesBaseDir: string;

  constructor(repoRoot: string) {
    this.repoRoot = path.resolve(repoRoot);
    this.worktreesBaseDir = path.join(this.repoRoot, '.nomin', 'worktrees');
  }

  /**
   * Asserts whether repoRoot is inside an active Git repository.
   */
  public async isGitRepo(): Promise<boolean> {
    const res = await runGit(['rev-parse', '--is-inside-work-tree'], this.repoRoot);
    return res.exitCode === 0 && res.stdout === 'true';
  }

  /**
   * Returns current active branch name of the repository.
   */
  public async getCurrentBranch(): Promise<string> {
    const res = await runGit(['branch', '--show-current'], this.repoRoot);
    if (res.exitCode !== 0) {
      // Fallback for detached HEAD or older git versions
      const revRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], this.repoRoot);
      return revRes.stdout || 'main';
    }
    return res.stdout || 'main';
  }

  /**
   * Creates an isolated worktree for the given agent.
   * Path: .nomin/worktrees/<agentId>
   * Branch: agent/<agentId>
   */
  public async createWorktree(
    agentId: string,
    baseBranch?: string
  ): Promise<WorktreeInfo> {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      throw new Error(`Directory is not a git repository: ${this.repoRoot}`);
    }

    fs.mkdirSync(this.worktreesBaseDir, { recursive: true });

    const sanitizedAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const worktreePath = path.join(this.worktreesBaseDir, sanitizedAgentId);
    const branchName = `agent/${sanitizedAgentId}`;
    const base = baseBranch || (await this.getCurrentBranch()) || 'HEAD';

    // Check if worktree already exists
    const existingWorktrees = await this.listWorktrees();
    const existing = existingWorktrees.find(
      (w) => path.resolve(w.worktreePath) === path.resolve(worktreePath)
    );

    if (existing) {
      return existing;
    }

    // Check if branch already exists
    const checkBranch = await runGit(['show-ref', '--verify', `refs/heads/${branchName}`], this.repoRoot);
    let addArgs: string[];

    if (checkBranch.exitCode === 0) {
      // Branch exists, checkout without -b
      addArgs = ['worktree', 'add', worktreePath, branchName];
    } else {
      // Create branch pointing to base
      addArgs = ['worktree', 'add', '-b', branchName, worktreePath, base];
    }

    const res = await runGit(addArgs, this.repoRoot);
    if (res.exitCode !== 0) {
      throw new Error(`Failed to create git worktree: ${res.stderr || res.stdout}`);
    }

    // Get commit hash in worktree
    const headRes = await runGit(['rev-parse', 'HEAD'], worktreePath);

    return {
      worktreePath,
      branch: branchName,
      commitHash: headRes.stdout,
      isBare: false,
      isLocked: false,
    };
  }

  /**
   * Creates a micro-commit in the agent's worktree for granular progress tracking.
   */
  public async createMicroCommit(
    worktreePath: string,
    message: string
  ): Promise<MicroCommitResult> {
    if (!fs.existsSync(worktreePath)) {
      return {
        success: false,
        message: `Worktree path does not exist: ${worktreePath}`,
        changedFiles: [],
      };
    }

    // Check status
    const statusRes = await runGit(['status', '--porcelain'], worktreePath);
    if (statusRes.exitCode !== 0) {
      return {
        success: false,
        message: `git status failed: ${statusRes.stderr}`,
        changedFiles: [],
      };
    }

    if (statusRes.stdout.trim().length === 0) {
      return {
        success: true,
        message: 'No modified or unstaged files found. Clean working tree.',
        changedFiles: [],
      };
    }

    // Parse changed files
    const changedFiles = statusRes.stdout
      .split('\n')
      .map((line) => line.trim().slice(3))
      .filter((f) => f.length > 0);

    // Stage all changes
    const addRes = await runGit(['add', '-A'], worktreePath);
    if (addRes.exitCode !== 0) {
      return {
        success: false,
        message: `git add failed: ${addRes.stderr}`,
        changedFiles,
      };
    }

    // Commit
    const commitRes = await runGit(['commit', '-m', message], worktreePath);
    if (commitRes.exitCode !== 0) {
      return {
        success: false,
        message: `git commit failed: ${commitRes.stderr}`,
        changedFiles,
      };
    }

    const revRes = await runGit(['rev-parse', 'HEAD'], worktreePath);
    const commitHash = revRes.stdout;

    return {
      success: true,
      commitHash,
      message,
      changedFiles,
    };
  }

  /**
   * Merges an agent's branch cleanly into target branch with automatic conflict detection and rollback.
   */
  public async rebaseAndMerge(
    agentId: string,
    targetBranch?: string
  ): Promise<WorktreeMergeResult> {
    const sanitizedAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sourceBranch = `agent/${sanitizedAgentId}`;
    const target = targetBranch || (await this.getCurrentBranch()) || 'main';

    // Verify source branch exists
    const checkSource = await runGit(['show-ref', '--verify', `refs/heads/${sourceBranch}`], this.repoRoot);
    if (checkSource.exitCode !== 0) {
      return {
        success: false,
        sourceBranch,
        targetBranch: target,
        error: `Source branch ${sourceBranch} does not exist.`,
      };
    }

    // Ensure we are on target branch in repoRoot
    const checkoutRes = await runGit(['checkout', target], this.repoRoot);
    if (checkoutRes.exitCode !== 0) {
      return {
        success: false,
        sourceBranch,
        targetBranch: target,
        error: `Failed to checkout target branch ${target}: ${checkoutRes.stderr}`,
      };
    }

    // Attempt merge with --no-ff
    const mergeRes = await runGit(
      ['merge', sourceBranch, '--no-ff', '-m', `merge(${sourceBranch}): verified worktree submission`],
      this.repoRoot
    );

    if (mergeRes.exitCode !== 0) {
      // Conflict detected!
      const conflictRes = await runGit(['diff', '--name-only', '--diff-filter=U'], this.repoRoot);
      const conflictFiles = conflictRes.stdout
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      // Abort merge to preserve clean state
      await runGit(['merge', '--abort'], this.repoRoot);

      return {
        success: false,
        sourceBranch,
        targetBranch: target,
        conflictFiles,
        error: `Merge conflict between ${sourceBranch} and ${target}. Merge aborted cleanly.`,
      };
    }

    const headRes = await runGit(['rev-parse', 'HEAD'], this.repoRoot);

    return {
      success: true,
      sourceBranch,
      targetBranch: target,
      mergeCommitHash: headRes.stdout,
    };
  }

  /**
   * Safely removes worktree and cleans up disk artifacts.
   */
  public async cleanupWorktree(
    agentId: string,
    deleteBranch: boolean = true
  ): Promise<{ success: boolean; message: string }> {
    const sanitizedAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const worktreePath = path.join(this.worktreesBaseDir, sanitizedAgentId);
    const branchName = `agent/${sanitizedAgentId}`;

    let removed = false;

    // 1. Remove via git worktree remove
    const removeRes = await runGit(['worktree', 'remove', '--force', worktreePath], this.repoRoot);
    if (removeRes.exitCode === 0) {
      removed = true;
    }

    // 2. Fallback: If directory lingers (common on Windows file locks), safely rmSync
    if (fs.existsSync(worktreePath)) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
        removed = true;
      } catch {
        // Lingering file lock
      }
    }

    if (!fs.existsSync(worktreePath)) {
      removed = true;
    }

    // 3. Prune git worktree metadata
    await runGit(['worktree', 'prune'], this.repoRoot);

    // 4. Optionally delete agent branch
    if (deleteBranch) {
      await runGit(['branch', '-D', branchName], this.repoRoot);
    }

    return {
      success: removed,
      message: removed
        ? `Cleaned up worktree for agent ${agentId} (${worktreePath})`
        : `Worktree for agent ${agentId} was not found or could not be completely removed.`,
    };
  }

  /**
   * Lists all active git worktrees.
   */
  public async listWorktrees(): Promise<WorktreeInfo[]> {
    const res = await runGit(['worktree', 'list', '--porcelain'], this.repoRoot);
    if (res.exitCode !== 0) {
      return [];
    }

    const worktrees: WorktreeInfo[] = [];
    const blocks = res.stdout.split('\n\n');

    for (const block of blocks) {
      const lines = block.split('\n');
      let wtPath = '';
      let commitHash = '';
      let branch = '';
      let isBare = false;
      let isLocked = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.slice(9).trim();
        } else if (line.startsWith('HEAD ')) {
          commitHash = line.slice(5).trim();
        } else if (line.startsWith('branch ')) {
          branch = line.slice(7).trim().replace('refs/heads/', '');
        } else if (line === 'bare') {
          isBare = true;
        } else if (line.startsWith('locked')) {
          isLocked = true;
        }
      }

      if (wtPath) {
        worktrees.push({
          worktreePath: wtPath,
          branch,
          commitHash,
          isBare,
          isLocked,
        });
      }
    }

    return worktrees;
  }
}

export { GitWorktreeManager as WorktreeManager };

