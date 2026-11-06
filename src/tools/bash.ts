/**
 * @file bash.ts
 * @description Sandboxed command execution engine for Nomin Code.
 * Features:
 *   - Strict timeout enforcement (SIGTERM -> SIGKILL)
 *   - Cross-platform shell dispatch (PowerShell on Windows, sh on POSIX)
 *   - Stream capture for stdout/stderr
 *   - Output truncation preserving head and tail to protect LLM context windows
 *   - AbortSignal support for cooperative swarm cancellation
 * Zero external dependencies (pure Node.js).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { isSystemDir, isDriveRootDir } from '../config/index.js';
import type {
  Tool,
  ToolExecutionContext,
  ToolResult,
  ToolParametersSchema,
  BashInput,
  BashResult,
} from './types.js';

const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_MAX_OUTPUT_LENGTH = 32000; // ~8000 tokens

export interface ExecutionResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export interface BashOptions {
  cwd?: string;
  timeoutSeconds?: number;
  maxOutputChars?: number;
  env?: Record<string, string>;
}

export interface CommandExecutionOptions {
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
  maxOutputLength?: number;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

/**
 * Truncates long output string by keeping both head and tail, inserting truncation marker.
 */
export function truncateOutput(output: string, maxLength: number): { text: string; truncated: boolean } {
  if (output.length <= maxLength) {
    return { text: output, truncated: false };
  }

  const headSize = Math.floor(maxLength * 0.2);
  const tailSize = Math.floor(maxLength * 0.7);
  const omittedCount = output.length - headSize - tailSize;

  const head = output.slice(0, headSize);
  const tail = output.slice(output.length - tailSize);
  const banner = `\n\n[... OUTPUT TRUNCATED: ${omittedCount} characters omitted to protect context window ...]\n\n`;

  return {
    text: `${head}${banner}${tail}`,
    truncated: true,
  };
}

/**
 * Executes a shell command with strict timeout and output controls.
 */
export async function executeCommand(options: CommandExecutionOptions): Promise<BashResult> {
  const startTime = Date.now();
  const isWindows = os.platform() === 'win32';
  const timeoutMs = (options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS) * 1000;
  const maxOutputLen = options.maxOutputLength || DEFAULT_MAX_OUTPUT_LENGTH;

  return new Promise<BashResult>((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let killed = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    const child: ChildProcess = spawn(options.command, {
      shell: true,
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      windowsHide: true,
    });

    const cleanupTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    };

    // Timeout handling
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killed = true;
      child.kill('SIGTERM');

      // Escalate to SIGKILL if process lingers
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process might already be dead
        }
      }, 1500);
    }, timeoutMs);

    // AbortSignal handling
    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        cleanupTimers();
        child.kill('SIGKILL');
        return resolve({
          command: options.command,
          exitCode: -1,
          stdout: '',
          stderr: 'Command aborted before execution.',
          executionTimeMs: 0,
          truncated: false,
          timedOut: false,
        });
      }

      options.abortSignal.addEventListener(
        'abort',
        () => {
          cleanupTimers();
          child.kill('SIGKILL');
        },
        { once: true }
      );
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        const str = chunk.toString('utf-8');
        stdoutData += str;
        if (options.onStdout) options.onStdout(str);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        const str = chunk.toString('utf-8');
        stderrData += str;
        if (options.onStderr) options.onStderr(str);
      });
    }

    child.on('error', (err: Error) => {
      cleanupTimers();
      const executionTimeMs = Date.now() - startTime;
      resolve({
        command: options.command,
        exitCode: -1,
        stdout: stdoutData,
        stderr: `${stderrData}\nFailed to spawn process: ${err.message}`.trim(),
        executionTimeMs,
        truncated: false,
        timedOut: false,
      });
    });

    child.on('close', (code: number | null) => {
      cleanupTimers();
      const executionTimeMs = Date.now() - startTime;
      const exitCode = timedOut ? 124 : (code ?? (killed ? -1 : 0));

      const truncStdout = truncateOutput(stdoutData, maxOutputLen);
      const truncStderr = truncateOutput(stderrData, maxOutputLen);
      const isTruncated = truncStdout.truncated || truncStderr.truncated;

      resolve({
        command: options.command,
        exitCode,
        stdout: truncStdout.text,
        stderr: truncStderr.text,
        executionTimeMs,
        truncated: isTruncated,
        timedOut,
      });
    });
  });
}

/**
 * Sandboxed Command Execution Tool implementing Tool interface.
 */
export class BashTool implements Tool {
  public readonly name = 'execute_command';
  public readonly description =
    'Executes a shell command in the agent worktree sandbox with strict timeout controls, stdout/stderr streaming, exit code capture, and context window truncation protection.';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command string to execute.',
      },
      timeout_seconds: {
        type: 'integer',
        description: 'Maximum time in seconds to allow command to run before terminating (default: 60).',
        default: 60,
      },
      cwd: {
        type: 'string',
        description: 'Working directory to run the command in (defaults to agent worktree).',
      },
    },
    required: ['command'],
  };

  /**
   * Static helper method for programmatic invocations.
   */
  public static async execute(command: string, options: BashOptions = {}): Promise<ExecutionResult> {
    const res = await executeCommand({
      command,
      cwd: options.cwd,
      timeoutSeconds: options.timeoutSeconds,
      maxOutputLength: options.maxOutputChars,
      env: options.env,
    });
    return {
      command: res.command,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      durationMs: res.executionTimeMs,
      truncated: res.truncated,
    };
  }

  public async execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const command = args.command as string;
    if (!command) {
      return { success: false, output: '', error: 'Missing required argument: command' };
    }

    const workingDir = args.cwd
      ? (path.isAbsolute(args.cwd) ? args.cwd : path.resolve(context.worktreePath, args.cwd))
      : context.worktreePath;

    if (workingDir && (isSystemDir(workingDir) || isDriveRootDir(workingDir))) {
      return {
        success: false,
        output: '',
        error: `Refusing to execute command in system-protected directory '${workingDir}'. Please 'cd <project-path>' or start Nomin in a project directory.`,
      };
    }

    const timeoutSeconds = typeof args.timeout_seconds === 'number' && args.timeout_seconds > 0
      ? args.timeout_seconds
      : DEFAULT_TIMEOUT_SECONDS;

    const result = await executeCommand({
      command,
      cwd: workingDir,
      timeoutSeconds,
      abortSignal: context.abortSignal,
    });

    const isSuccess = result.exitCode === 0;

    let output = '';
    if (result.stdout.trim().length > 0) {
      output += result.stdout.trim();
    }
    if (result.stderr.trim().length > 0) {
      if (output.length > 0) output += '\n';
      output += `[stderr]\n${result.stderr.trim()}`;
    }
    if (result.timedOut) {
      if (output.length > 0) output += '\n';
      output += `[TIMEOUT: Command exceeded limit of ${timeoutSeconds}s and was killed]`;
    }
    if (output.length === 0) {
      output = `(Command finished with exit code ${result.exitCode} and produced no output)`;
    }

    return {
      success: isSuccess,
      output,
      data: result,
      error: !isSuccess ? `Command exited with code ${result.exitCode}` : undefined,
      metadata: {
        exitCode: result.exitCode,
        executionTimeMs: result.executionTimeMs,
        timedOut: result.timedOut,
        truncated: result.truncated,
      },
    };
  }
}
