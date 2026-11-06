/**
 * @file environment-context.ts
 * @description Dynamic Environment Context Engine for Nomin Code.
 * Generates rich, real-time environment telemetry including:
 *   - Absolute workspace path & git relative path
 *   - Host operating system, architecture, and shell
 *   - Timestamp and local timezone
 *   - Git branch, short HEAD sha, and porcelain status summary
 *   - Top-level workspace directory listing (up to 50 items)
 * Zero external dependencies (pure Node.js).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface TopLevelEntry {
  name: string;
  isDirectory: boolean;
  sizeBytes?: number;
}

export interface EnvironmentContext {
  workspacePath: string;
  gitRoot: string | null;
  gitRelPath: string | null;
  osInfo: string;
  shellInfo: string;
  currentDateTime: string;
  gitBranch: string;
  gitHeadSha: string;
  gitStatusSummary: string;
  topLevelEntries: TopLevelEntry[];
  totalWorkspaceEntries: number;
}

export class EnvironmentContextEngine {
  /**
   * Generates dynamic environment context for a given workspace directory.
   */
  public static async generate(workdir: string): Promise<EnvironmentContext> {
    const absWorkdir = path.resolve(workdir);

    // 1. OS & Architecture Info
    const platform = os.platform();
    const release = os.release();
    const arch = os.arch();
    let friendlyOs = `${platform} ${arch} (${release})`;
    if (platform === 'win32') {
      friendlyOs = `Windows (win32 ${arch}, build ${release})`;
    } else if (platform === 'darwin') {
      friendlyOs = `macOS (darwin ${arch}, release ${release})`;
    } else if (platform === 'linux') {
      friendlyOs = `Linux (linux ${arch}, release ${release})`;
    }

    // 2. Shell Info
    let shell = 'unknown';
    if (platform === 'win32') {
      shell = process.env.PSModulePath ? 'powershell.exe' : (process.env.ComSpec ? path.basename(process.env.ComSpec) : 'powershell.exe');
    } else {
      shell = process.env.SHELL ? path.basename(process.env.SHELL) : 'bash';
    }

    // 3. Current Timestamp & Timezone
    const now = new Date();
    const isoDate = now.toISOString();
    let humanDate = '';
    try {
      humanDate = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
    } catch {
      humanDate = now.toString();
    }
    const currentDateTime = `${isoDate} (${humanDate})`;

    // 4. Git Info
    let gitRoot: string | null = null;
    let gitRelPath: string | null = null;
    let gitBranch = '(none - not a git repository)';
    let gitHeadSha = '(no commits)';
    let gitStatusSummary = 'clean';

    try {
      const { stdout: rootOut } = await execAsync('git rev-parse --show-toplevel', { cwd: absWorkdir });
      if (rootOut && rootOut.trim()) {
        gitRoot = path.resolve(rootOut.trim());
        gitRelPath = path.relative(gitRoot, absWorkdir) || '.';
      }
    } catch (_) {}

    if (gitRoot) {
      try {
        const { stdout: branchOut } = await execAsync('git branch --show-current', { cwd: absWorkdir });
        gitBranch = branchOut.trim() || 'detached HEAD';
      } catch (_) {
        gitBranch = 'main';
      }

      try {
        const { stdout: shaOut } = await execAsync('git rev-parse --short HEAD', { cwd: absWorkdir });
        gitHeadSha = shaOut.trim();
      } catch (_) {
        gitHeadSha = '(no commits yet)';
      }

      try {
        const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd: absWorkdir });
        const trimmedStatus = statusOut.trim();
        if (!trimmedStatus) {
          gitStatusSummary = 'clean working tree (0 changes)';
        } else {
          const lines = trimmedStatus.split('\n').filter(Boolean);
          gitStatusSummary = `${lines.length} uncommitted changes (${lines.slice(0, 5).map(l => l.trim()).join(', ')}${lines.length > 5 ? '...' : ''})`;
        }
      } catch (_) {
        gitStatusSummary = 'unknown';
      }
    }

    // 5. Top-Level Directory Entries
    const topLevelEntries: TopLevelEntry[] = [];
    let totalWorkspaceEntries = 0;

    try {
      if (fs.existsSync(absWorkdir) && fs.statSync(absWorkdir).isDirectory()) {
        const dirItems = fs.readdirSync(absWorkdir, { withFileTypes: true });
        totalWorkspaceEntries = dirItems.length;

        // Sort: directories first, then alphabetical
        const sorted = [...dirItems].sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        for (const item of sorted.slice(0, 50)) {
          let sizeBytes: number | undefined;
          if (item.isFile()) {
            try {
              sizeBytes = fs.statSync(path.join(absWorkdir, item.name)).size;
            } catch (_) {}
          }
          topLevelEntries.push({
            name: item.name,
            isDirectory: item.isDirectory(),
            sizeBytes,
          });
        }
      }
    } catch (_) {}

    return {
      workspacePath: absWorkdir,
      gitRoot,
      gitRelPath,
      osInfo: friendlyOs,
      shellInfo: shell,
      currentDateTime,
      gitBranch,
      gitHeadSha,
      gitStatusSummary,
      topLevelEntries,
      totalWorkspaceEntries,
    };
  }

  /**
   * Formats the environment context into a structured markdown block for the LLM system prompt.
   */
  public static formatPromptBlock(context: EnvironmentContext): string {
    const formatBytes = (bytes?: number) => {
      if (bytes === undefined) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const entriesList = context.topLevelEntries.map((e) => {
      if (e.isDirectory) {
        return `  - [DIR]  ${e.name}/`;
      }
      const sz = e.sizeBytes !== undefined ? ` (${formatBytes(e.sizeBytes)})` : '';
      return `  - [FILE] ${e.name}${sz}`;
    });

    const moreNotice = context.totalWorkspaceEntries > context.topLevelEntries.length
      ? `\n  - ... and ${context.totalWorkspaceEntries - context.topLevelEntries.length} more entries`
      : '';

    return `
## Environment & Workspace Context
- **Workspace Root**: \`${context.workspacePath}\`
- **Operating System**: ${context.osInfo}
- **Shell**: \`${context.shellInfo}\`
- **Current Date & Time**: ${context.currentDateTime}
- **Git Context**: Branch \`${context.gitBranch}\` (HEAD: \`${context.gitHeadSha}\`), status: ${context.gitStatusSummary}
${context.gitRelPath ? `- **Directory Relative to Git Root**: \`${context.gitRelPath}\`` : ''}

### Top-Level Workspace Entries (${context.topLevelEntries.length} shown, ${context.totalWorkspaceEntries} total):
${entriesList.length > 0 ? entriesList.join('\n') + moreNotice : '  (workspace directory is empty)'}

### Operational Directives
- The workspace is the user's current directory. When the user says "this directory", "here", or asks what files exist, reference the workspace context above or execute tools to inspect it.
- You are an autonomous agent capable of executing tools. You do not ask the user to run commands for you or paste file contents when you have tools to read them yourself.
- Never claim you have performed an action, checked a directory, or edited a file unless a tool was actually executed in this turn.
- If you need to inspect subdirectories or read file contents, invoke the appropriate tool (list_dir, read_file, execute_command, search_grep).`;
  }

  /**
   * Formats the environment context for terminal display via `/context`.
   */
  public static formatTerminalReport(
    context: EnvironmentContext,
    messageCount: number,
    registeredTools: string[]
  ): string[] {
    const lines: string[] = [];
    lines.push(`  ◈ Environment & Context Telemetry`);
    lines.push(`  ─────────────────────────────────────────────────────────────`);
    lines.push(`  Workspace:        ${context.workspacePath}`);
    if (context.gitRoot) {
      lines.push(`  Git Root:         ${context.gitRoot} (rel: ${context.gitRelPath})`);
      lines.push(`  Git Branch:       ${context.gitBranch} [${context.gitHeadSha}]`);
      lines.push(`  Git Status:       ${context.gitStatusSummary}`);
    } else {
      lines.push(`  Git Status:       (not a git repository)`);
    }
    lines.push(`  Operating System: ${context.osInfo}`);
    lines.push(`  Shell:            ${context.shellInfo}`);
    lines.push(`  Current Time:     ${context.currentDateTime}`);
    lines.push(`  History Turns:    ${messageCount} message(s) in active session`);
    lines.push(`  Tools Count:      ${registeredTools.length} registered tools (${registeredTools.join(', ')})`);
    lines.push(`  Top Entries:      ${context.topLevelEntries.length} items shown (${context.totalWorkspaceEntries} total in workspace)`);
    lines.push(`  ─────────────────────────────────────────────────────────────`);
    return lines;
  }
}
