/**
 * Nomin Code: Claude Code & OpenCode Inspired Terminal UX & Styling
 * 
 * Features clean hairlines, warm cozy color tokens, Claude Code thinking blocks,
 * tool invocation callouts, unified diff previews with syntax highlights,
 * markdown terminal renderer, token/cost tracking cards, and multi-agent swarm dashboards.
 * Zero external dependencies — pure Node.js standard library.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { isSystemDirectory } from '../config/index.js';

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright Foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Cozy 256-Color Claude Code & OpenCode Palette
  amber: '\x1b[38;5;215m',        // Warm Claude Code peach/amber
  coral: '\x1b[38;5;203m',        // Accent coral
  mint: '\x1b[38;5;114m',         // Fresh code green
  sky: '\x1b[38;5;111m',          // Soft informative blue
  lavender: '\x1b[38;5;176m',     // Muted purple / verifier
  gold: '\x1b[38;5;221m',         // Warning / tester yellow
  slate: '\x1b[38;5;244m',        // Neutral secondary text
  darkSlate: '\x1b[38;5;240m',    // Subtle hairline borders
  borderMuted: '\x1b[38;5;238m',  // Very soft line border
  codeHighlight: '\x1b[38;5;153m',// Inline code variable

  // Backgrounds
  bgBlack: '\x1b[40m',
  bgDark: '\x1b[48;5;235m',
  bgCard: '\x1b[48;5;236m',
  bgChip: '\x1b[48;5;237m',
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m',
  bgGreenMuted: '\x1b[48;5;22m',
  bgRedMuted: '\x1b[48;5;52m',

  // Cursor & clear
  clearLine: '\x1b[2K\r',
  clearScreen: '\x1b[2J\x1b[3J\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
};

export interface BootingTelemetry {
  version: string;
  providerName: string;
  providerUrl: string;
  workdir: string;
  gitBranch?: string;
  mode?: 'solo' | 'team';
  activeModel?: string;
  roles?: Record<string, string>;
  selectedModels?: string[];
  rpmLimit: number;
  tpmLimit: number;
  concurrency: number;
}

export interface CostTelemetry {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  totalTokens: number;
  estimatedCostUsd: number;
  turnsCount?: number;
}

export class TerminalUI {
  private static spinnerInterval: NodeJS.Timeout | null = null;
  private static spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private static spinnerIdx = 0;
  private static currentSpinnerLabel = '';

  /**
   * Starts a smooth in-place braille terminal spinner with animated status label.
   */
  public static startSpinner(label: string): void {
    if (TerminalUI.spinnerInterval) clearInterval(TerminalUI.spinnerInterval);
    TerminalUI.currentSpinnerLabel = label;
    TerminalUI.spinnerIdx = 0;
    try {
      process.stdout.write(ANSI.hideCursor);
    } catch (_) {}

    TerminalUI.spinnerInterval = setInterval(() => {
      const frame = TerminalUI.spinnerFrames[TerminalUI.spinnerIdx % TerminalUI.spinnerFrames.length];
      TerminalUI.spinnerIdx++;
      try {
        process.stdout.write(`${ANSI.clearLine}  ${ANSI.amber}${frame}${ANSI.reset} ${ANSI.dim}${TerminalUI.currentSpinnerLabel}${ANSI.reset}`);
      } catch (_) {}
    }, 80);
  }

  /**
   * Updates the in-place spinner label without flickering.
   */
  public static updateSpinner(label: string): void {
    TerminalUI.currentSpinnerLabel = label;
  }

  /**
   * Stops the in-place spinner and prints an optional final outcome line.
   */
  public static stopSpinner(finalMessage?: string): void {
    if (TerminalUI.spinnerInterval) {
      clearInterval(TerminalUI.spinnerInterval);
      TerminalUI.spinnerInterval = null;
    }
    try {
      process.stdout.write(ANSI.clearLine);
      process.stdout.write(ANSI.showCursor);
    } catch (_) {}
    if (finalMessage) {
      console.log(`  ${finalMessage}`);
    }
  }

  public static width(): number {
    const cols = process.stdout.columns || 88;
    return Math.max(60, Math.min(cols, 100));
  }

  /**
   * Strips ANSI escape sequences to accurately compute visual string length.
   */
  public static stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Word-wraps text safely respecting a target visual character width.
   */
  public static wrapText(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const rawLine of text.split('\n')) {
      if (TerminalUI.stripAnsi(rawLine).length <= maxWidth) {
        lines.push(rawLine);
        continue;
      }
      const words = rawLine.split(' ');
      let cur = '';
      for (const w of words) {
        const testLen = TerminalUI.stripAnsi(cur ? `${cur} ${w}` : w).length;
        if (testLen <= maxWidth) {
          cur = cur ? `${cur} ${w}` : w;
        } else {
          if (cur) lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
    }
    return lines;
  }

  /**
   * Truncates text with trailing ellipsis if exceeding maxLength.
   */
  public static truncate(text: string, maxLength: number): string {
    const visible = TerminalUI.stripAnsi(text);
    if (visible.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '…';
  }

  /**
   * Prints the sleek model-agnostic booting banner styled after Claude Code and OpenCode.
   */
  public static printBootSequence(telemetry: BootingTelemetry): void {
    const w = TerminalUI.width();

    console.log();
    // Warm top brand title
    console.log(`  ${ANSI.bold}${ANSI.amber}◈ NOMIN CODE${ANSI.reset}  ${ANSI.slate}v${telemetry.version}${ANSI.reset}  ${ANSI.dim}— Model-Agnostic Autonomous Coding Swarm${ANSI.reset}`);
    console.log(`  ${ANSI.slate}NVIDIA NIM & OpenAI Compatible Endpoints · 100% User-Controlled Models${ANSI.reset}`);
    console.log();

    // Boxed Telemetry Card with rounded hairlines
    const headerBorder = '─'.repeat(Math.max(0, w - 24));
    console.log(`  ${ANSI.darkSlate}╭─ System Telemetry ${headerBorder}╮${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Provider:${ANSI.reset}   ${telemetry.providerName} ${ANSI.dim}(${telemetry.providerUrl})${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Workspace:${ANSI.reset}  ${telemetry.workdir} ${ANSI.dim}[branch: ${telemetry.gitBranch || 'main'}]${ANSI.reset}`);

    const hasRoles = telemetry.roles && Object.keys(telemetry.roles).length > 0;
    const hasModel = Boolean(telemetry.activeModel) || hasRoles;

    if (!hasModel) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.gold}● Mode:${ANSI.reset}       SETUP REQUIRED`);
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.gold}● Models:${ANSI.reset}     ⚠️  No models selected.`);
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}                ${ANSI.dim}Run 'nomin setup' or 'nomin model add <model-id>' to select models.${ANSI.reset}`);
    } else if (telemetry.mode === 'team' || (!telemetry.mode && hasRoles)) {
      const roleKeys = Object.keys(telemetry.roles || {});
      const roleSummary = roleKeys
        .map(k => `${k}: ${ANSI.brightCyan}${telemetry.roles![k]}${ANSI.reset}`)
        .join(' | ');
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Mode:${ANSI.reset}       TEAM [${roleKeys.length} Agents · Shared Blackboard & Mailbox]`);
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Roles:${ANSI.reset}      ${roleSummary || ANSI.dim + '(unassigned)' + ANSI.reset}`);
    } else {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Mode:${ANSI.reset}       SOLO [1 Model · Fresh-Context Verifier Gate]`);
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Model:${ANSI.reset}      ${ANSI.amber}${telemetry.activeModel || 'default'}${ANSI.reset}`);
    }

    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Gateways:${ANSI.reset}   ${ANSI.mint}[DoD Evidence Gate]${ANSI.reset} ${ANSI.gold}[Grok TodoGate]${ANSI.reset} ${ANSI.sky}[PageRank RepoMap]${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Limits:${ANSI.reset}     ${telemetry.rpmLimit} RPM · ${telemetry.tpmLimit.toLocaleString()} TPM · Concurrency Cap: ${telemetry.concurrency}`);
    
    if (isSystemDirectory(telemetry.workdir)) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}`);
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.gold}⚠️ Running in system directory. Workspace state sandboxed to ~/.nomin.${ANSI.reset}`);
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.amber}💡 Tip: Use 'cd <path>' or start with 'nomin <path>' to work on a project.${ANSI.reset}`);
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders a system directory sandboxing tip warning.
   */
  public static renderSystemDirWarning(): void {
    console.log(`  ${ANSI.gold}⚠️ Running in system directory. Workspace state sandboxed to ~/.nomin.${ANSI.reset}`);
    console.log(`  ${ANSI.amber}💡 Tip: Use 'cd <path>' or start with 'nomin <path>' to work on a project.${ANSI.reset}\n`);
  }

  /**
   * Renders the dynamic directory switch card.
   */
  public static renderWorkspaceSwitchedCard(workdir: string, gitBranch: string): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 26));
    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ [WORKSPACE SWITCHED] ${border}╮${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● New Working Directory:${ANSI.reset} ${workdir}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}● Active Branch:${ANSI.reset}          ${gitBranch}`);
    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders the boxed message bar prompt header (Claude Code style).
   */
  public static renderMessageBarHeader(): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 46));
    console.log(`  ${ANSI.darkSlate}╭─ Message ─ ${ANSI.dim}(Enter goal or /help for commands)${ANSI.darkSlate} ${border}╮${ANSI.reset}`);
  }

  /**
   * Renders the boxed message bar prompt footer.
   */
  public static renderMessageBarFooter(): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 60));
    console.log(`  ${ANSI.darkSlate}╰─ ${ANSI.dim}[Ctrl+C Exit] [/cd] [/status] [/cost] [/repomap] [/models]${ANSI.darkSlate} ${border}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Claude Code style boxed prompt frame.
   */
  public static renderPromptBox(options?: { promptText?: string; tokenStats?: string; branch?: string }): void {
    const w = TerminalUI.width();
    const branch = options?.branch ? ` (${options.branch})` : '';
    const stats = options?.tokenStats ? ` ${options.tokenStats}` : '';
    const headerTitle = ` Prompt${branch}${stats} `;
    const lineLen = Math.max(0, w - TerminalUI.stripAnsi(headerTitle).length - 6);

    console.log(`  ${ANSI.darkSlate}╭─${ANSI.amber}${headerTitle}${ANSI.darkSlate}${'─'.repeat(lineLen)}╮${ANSI.reset}`);
  }

  /**
   * Renders a real-time status line / pill.
   */
  public static renderStatusBar(info: { mode: string; model: string; branch: string; tokens: number; costUsd: number; status: string }): void {
    const tokenStr = info.tokens >= 1000 ? `${(info.tokens / 1000).toFixed(1)}k` : `${info.tokens}`;
    const costStr = `$${info.costUsd.toFixed(4)}`;
    const line = `[◈ NOMIN · ${info.mode.toUpperCase()} · ${info.model} · ⎇ ${info.branch} · ${tokenStr} tok (${costStr}) · ${info.status}]`;
    console.log(`  ${ANSI.dim}${ANSI.slate}${line}${ANSI.reset}`);
  }

  /**
   * Renders Claude Code signature "Thinking" reasoning process card.
   */
  public static renderThinking(
    role: string,
    modelName: string,
    thinkingText: string,
    durationMs?: number
  ): void {
    const w = TerminalUI.width();
    const durationStr = durationMs !== undefined ? ` · ${(durationMs / 1000).toFixed(1)}s` : '';
    const title = `💭 Thinking (${role} · ${modelName}${durationStr})`;
    const lineLen = Math.max(0, w - TerminalUI.stripAnsi(title).length - 6);

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ ${ANSI.lavender}${title}${ANSI.darkSlate} ${'─'.repeat(lineLen)}╮${ANSI.reset}`);

    const wrapped = TerminalUI.wrapText(thinkingText.trim(), w - 8);
    const maxLines = 16;
    const displayLines = wrapped.slice(0, maxLines);

    for (const l of displayLines) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}${ANSI.slate}${l}${ANSI.reset}`);
    }

    if (wrapped.length > maxLines) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}... [${wrapped.length - maxLines} lines condensed]${ANSI.reset}`);
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
  }

  /**
   * Renders Claude Code style dedicated tool invocation callout.
   */
  public static renderToolCall(toolName: string, params: Record<string, any>, summary?: string): void {
    const w = TerminalUI.width();
    let icon = '⚡';
    let toolBadge = toolName;
    let mainParam = '';

    if (toolName === 'bash') {
      icon = '⚡';
      toolBadge = 'Bash';
      mainParam = params.command || '';
    } else if (toolName === 'edit_file') {
      icon = '✏️ ';
      toolBadge = 'Edit File';
      mainParam = params.path || '';
    } else if (toolName === 'read_file') {
      icon = '📖';
      toolBadge = 'Read File';
      const range = params.start_line ? ` (lines ${params.start_line}-${params.end_line || ''})` : '';
      mainParam = `${params.path || ''}${range}`;
    } else if (toolName === 'search' || toolName === 'search_grep') {
      icon = '🔍';
      toolBadge = 'Search Grep';
      mainParam = `"${params.query || ''}"`;
    } else if (toolName === 'search_glob') {
      icon = '📁';
      toolBadge = 'Search Glob';
      mainParam = `"${params.pattern || ''}"`;
    } else if (toolName === 'repomap') {
      icon = '🗺️ ';
      toolBadge = 'RepoMap';
      mainParam = params.path || 'PageRank Skeleton';
    }

    const title = `${icon} ${toolBadge}: ${mainParam}`;
    const lineLen = Math.max(0, w - TerminalUI.stripAnsi(title).length - 6);

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ ${ANSI.bold}${ANSI.sky}${title}${ANSI.reset}${ANSI.darkSlate} ${'─'.repeat(lineLen)}╮${ANSI.reset}`);
    if (summary) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}${summary}${ANSI.reset}`);
    }
    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
  }

  /**
   * Renders a tool execution result card with exit code and duration badge.
   */
  public static renderToolResult(
    toolName: string,
    result: { success: boolean; output: string; durationMs?: number; exitCode?: number }
  ): void {
    const w = TerminalUI.width();
    const statusIcon = result.success ? `${ANSI.mint}✔ Success${ANSI.reset}` : `${ANSI.coral}✖ Error${ANSI.reset}`;
    const duration = result.durationMs !== undefined ? ` ${(result.durationMs / 1000).toFixed(2)}s` : '';
    const exitCodeStr = result.exitCode !== undefined ? ` [code ${result.exitCode}]` : '';
    const title = `Result: ${toolName} · ${statusIcon}${duration}${exitCodeStr}`;
    const lineLen = Math.max(0, w - TerminalUI.stripAnsi(title).length - 6);

    console.log(`  ${ANSI.darkSlate}╭─ ${title}${ANSI.darkSlate} ${'─'.repeat(lineLen)}╮${ANSI.reset}`);

    const rawOutput = (result.output || '').trim();
    if (!rawOutput) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}(no output returned)${ANSI.reset}`);
    } else {
      const lines = rawOutput.split('\n');
      const maxDisplay = 12;
      const slice = lines.slice(0, maxDisplay);
      for (const line of slice) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${line}`);
      }
      if (lines.length > maxDisplay) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}... [${lines.length - maxDisplay} lines truncated]${ANSI.reset}`);
      }
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders Claude Code style file reading card with syntax dimmed line numbers.
   */
  public static renderFileRead(
    filePath: string,
    range: { start: number; end: number; total: number },
    content: string
  ): void {
    const w = TerminalUI.width();
    const title = `📖 Read: ${filePath} (lines ${range.start}-${range.end} of ${range.total})`;
    const lineLen = Math.max(0, w - TerminalUI.stripAnsi(title).length - 6);

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ ${ANSI.sky}${title}${ANSI.darkSlate} ${'─'.repeat(lineLen)}╮${ANSI.reset}`);

    const lines = content.split('\n');
    let lineNum = range.start;
    const maxShow = 20;

    for (let i = 0; i < Math.min(lines.length, maxShow); i++) {
      const numStr = String(lineNum + i).padStart(4, ' ');
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.darkSlate}${numStr} │${ANSI.reset} ${lines[i]}`);
    }

    if (lines.length > maxShow) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}     ... [${lines.length - maxShow} more lines]${ANSI.reset}`);
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders Claude Code style file modification card with statistics and diff preview.
   */
  public static renderFileEdit(
    filePath: string,
    diffText: string,
    stats?: { added: number; removed: number }
  ): void {
    const w = TerminalUI.width();
    const addedStr = stats ? ` ${ANSI.mint}+${stats.added}${ANSI.reset}` : '';
    const removedStr = stats ? ` ${ANSI.coral}-${stats.removed}${ANSI.reset}` : '';
    const title = `✏️  Edit: ${filePath}${addedStr}${removedStr}`;
    const lineLen = Math.max(0, w - TerminalUI.stripAnsi(title).length - 6);

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ ${ANSI.amber}${title}${ANSI.darkSlate} ${'─'.repeat(lineLen)}╮${ANSI.reset}`);

    if (diffText && diffText.trim()) {
      for (const line of diffText.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) {
          console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.bold}${line}${ANSI.reset}`);
        } else if (line.startsWith('+')) {
          console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.mint}${line}${ANSI.reset}`);
        } else if (line.startsWith('-')) {
          console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.coral}${line}${ANSI.reset}`);
        } else if (line.startsWith('@@')) {
          console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}${line}${ANSI.reset}`);
        } else {
          console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.slate}${line}${ANSI.reset}`);
        }
      }
    } else {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}Changes applied successfully.${ANSI.reset}`);
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders search match results in a cozy card.
   */
  public static renderSearch(
    query: string,
    matchesCount: number,
    fileCount: number,
    samples?: string[]
  ): void {
    const w = TerminalUI.width();
    const title = `🔍 Search: "${query}" · ${matchesCount} matches across ${fileCount} files`;
    const lineLen = Math.max(0, w - TerminalUI.stripAnsi(title).length - 6);

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ ${ANSI.sky}${title}${ANSI.darkSlate} ${'─'.repeat(lineLen)}╮${ANSI.reset}`);

    if (samples && samples.length > 0) {
      for (const s of samples.slice(0, 8)) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}•${ANSI.reset} ${s}`);
      }
      if (samples.length > 8) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}... [${samples.length - 8} more matches]${ANSI.reset}`);
      }
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders a dedicated agent speech card with hairlines and badges.
   */
  public static renderAgentCard(
    role: 'ARCHITECT' | 'CODER' | 'TESTER' | 'VERIFIER' | 'SYSTEM' | string,
    modelName: string,
    message: string,
    details?: string[]
  ): void {
    const w = TerminalUI.width();
    const r = role.toUpperCase();
    let badgeColor = ANSI.brightCyan;

    if (r === 'CODER') badgeColor = ANSI.mint;
    else if (r === 'TESTER') badgeColor = ANSI.gold;
    else if (r === 'VERIFIER') badgeColor = ANSI.lavender;
    else if (r === 'SYSTEM') badgeColor = ANSI.slate;
    else if (r === 'ARCHITECT') badgeColor = ANSI.amber;

    const title = `[${badgeColor}${r}${ANSI.reset}${ANSI.darkSlate} · ${ANSI.dim}${modelName}${ANSI.reset}${ANSI.darkSlate}]`;
    const lineLen = Math.max(0, w - TerminalUI.stripAnsi(title).length - 6);

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ ${title} ${'─'.repeat(lineLen)}╮${ANSI.reset}`);

    for (const line of message.split('\n')) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${line}`);
    }

    if (details && details.length > 0) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}`);
      for (const d of details) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}• ${d}${ANSI.reset}`);
      }
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
  }

  /**
   * Alias helper for logging agent speech.
   */
  public static logAgent(role: string, message: string, details?: string[]): void {
    TerminalUI.renderAgentCard(role, 'Swarm', message, details);
  }

  /**
   * Renders a verified release gate pass / rejection banner.
   */
  public static renderVerdictCard(
    approved: boolean,
    reason: string,
    criteriaCount: number,
    evidenceCount: number,
    details?: string[]
  ): void {
    const w = TerminalUI.width();
    console.log();
    if (approved) {
      const border = '─'.repeat(Math.max(0, w - 28));
      console.log(`  ${ANSI.mint}╭─ [VERIFIED & RELEASED] ${border}╮${ANSI.reset}`);
      console.log(`  ${ANSI.mint}│${ANSI.reset}  ${ANSI.mint}${ANSI.bold}✔ Definition-of-Done Satisfied with Physical Proof${ANSI.reset}`);
      console.log(`  ${ANSI.mint}│${ANSI.reset}  ${ANSI.dim}Passed Criteria: ${criteriaCount}/${criteriaCount} | Evidence Logs: ${evidenceCount} | AST Violations: 0${ANSI.reset}`);
      console.log(`  ${ANSI.mint}│${ANSI.reset}  ${reason}`);

      if (details && details.length > 0) {
        console.log(`  ${ANSI.mint}│${ANSI.reset}`);
        for (const d of details) {
          console.log(`  ${ANSI.mint}│${ANSI.reset}  ${ANSI.dim}✔ ${d}${ANSI.reset}`);
        }
      }

      console.log(`  ${ANSI.mint}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    } else {
      const border = '─'.repeat(Math.max(0, w - 29));
      console.log(`  ${ANSI.coral}╭─ [VERIFICATION REJECTED] ${border}╮${ANSI.reset}`);
      console.log(`  ${ANSI.coral}│${ANSI.reset}  ${ANSI.coral}${ANSI.bold}✖ Release Gate Blocked${ANSI.reset}`);
      console.log(`  ${ANSI.coral}│${ANSI.reset}  ${reason}`);

      if (details && details.length > 0) {
        console.log(`  ${ANSI.coral}│${ANSI.reset}`);
        for (const d of details) {
          console.log(`  ${ANSI.coral}│${ANSI.reset}  ${ANSI.dim}✖ ${d}${ANSI.reset}`);
        }
      }

      console.log(`  ${ANSI.coral}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    }
    console.log();
  }

  /**
   * Renders colored unified diffs with green additions and red deletions.
   */
  public static renderDiff(diffText: string, filePath?: string): void {
    if (!diffText.trim()) return;
    const w = TerminalUI.width();
    const title = filePath ? ` Git Diff: ${filePath} ` : ' Git Diff ';
    const lineLen = Math.max(0, w - title.length - 6);

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─${ANSI.bold}${title}${ANSI.darkSlate}${'─'.repeat(lineLen)}╮${ANSI.reset}`);
    for (const line of diffText.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.bold}${line}${ANSI.reset}`);
      } else if (line.startsWith('+')) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.mint}${line}${ANSI.reset}`);
      } else if (line.startsWith('-')) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.coral}${line}${ANSI.reset}`);
      } else if (line.startsWith('@@')) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}${line}${ANSI.reset}`);
      } else {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.slate}${line}${ANSI.reset}`);
      }
    }
    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Terminal Markdown Renderer: parses headings, bold/italic, inline code,
   * fenced code blocks, lists, and blockquotes with clean ANSI styling.
   */
  public static renderMarkdown(markdown: string): void {
    const lines = markdown.split('\n');
    let inCodeBlock = false;
    let codeLanguage = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Fenced code block toggle
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLanguage = line.slice(3).trim() || 'code';
          console.log(`  ${ANSI.darkSlate}┌── ${ANSI.dim}${codeLanguage}${ANSI.darkSlate} ${'─'.repeat(Math.max(0, 50 - codeLanguage.length))}┐${ANSI.reset}`);
        } else {
          inCodeBlock = false;
          console.log(`  ${ANSI.darkSlate}└──${'─'.repeat(54)}┘${ANSI.reset}`);
        }
        continue;
      }

      if (inCodeBlock) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.codeHighlight}${line}${ANSI.reset}`);
        continue;
      }

      // Headings
      if (line.startsWith('# ')) {
        console.log(`\n  ${ANSI.bold}${ANSI.brightWhite}${line.slice(2)}${ANSI.reset}`);
        console.log(`  ${ANSI.darkSlate}${'─'.repeat(Math.min(60, line.length + 8))}${ANSI.reset}`);
        continue;
      } else if (line.startsWith('## ')) {
        console.log(`\n  ${ANSI.bold}${ANSI.sky}${line.slice(3)}${ANSI.reset}`);
        continue;
      } else if (line.startsWith('### ')) {
        console.log(`  ${ANSI.bold}${ANSI.mint}${line.slice(4)}${ANSI.reset}`);
        continue;
      }

      // Blockquotes
      if (line.startsWith('> ')) {
        console.log(`  ${ANSI.slate}│${ANSI.reset}  ${ANSI.italic}${line.slice(2)}${ANSI.reset}`);
        continue;
      }

      // Bullet lists
      if (line.match(/^[\s]*[-*+]\s+/)) {
        const indent = line.search(/\S/);
        const item = line.replace(/^[\s]*[-*+]\s+/, '');
        const formatted = TerminalUI.formatInlineMarkdown(item);
        console.log(`  ${' '.repeat(indent)}${ANSI.amber}•${ANSI.reset} ${formatted}`);
        continue;
      }

      // Numbered lists
      if (line.match(/^[\s]*\d+\.\s+/)) {
        const match = line.match(/^[\s]*(\d+)\.\s+(.*)/);
        if (match) {
          const formatted = TerminalUI.formatInlineMarkdown(match[2]);
          console.log(`  ${ANSI.sky}${match[1]}.${ANSI.reset} ${formatted}`);
          continue;
        }
      }

      // Horizontal rule
      if (line.match(/^---+$|^\*\*\*+$/)) {
        console.log(`  ${ANSI.darkSlate}${'─'.repeat(60)}${ANSI.reset}`);
        continue;
      }

      // Standard prose
      console.log(`  ${TerminalUI.formatInlineMarkdown(line)}`);
    }
    console.log();
  }

  /**
   * Helper to format inline markdown tokens: `code`, **bold**, *italic*.
   */
  private static formatInlineMarkdown(text: string): string {
    return text
      // Inline code `...`
      .replace(/`([^`]+)`/g, `${ANSI.bgChip}${ANSI.brightCyan} $1 ${ANSI.reset}`)
      // Bold **...**
      .replace(/\*\*([^*]+)\*\*/g, `${ANSI.bold}$1${ANSI.reset}`)
      // Italic *...*
      .replace(/\*([^*]+)\*/g, `${ANSI.italic}$1${ANSI.reset}`);
  }

  /**
   * Renders token usage and session cost telemetry card (/cost command).
   */
  public static renderCostSummary(usage: CostTelemetry): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 30));

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ Usage & Cost Telemetry ${border}╮${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}Prompt Tokens:${ANSI.reset}     ${usage.promptTokens.toLocaleString()} tokens`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}Completion Tokens:${ANSI.reset} ${usage.completionTokens.toLocaleString()} tokens`);
    if (usage.cachedTokens !== undefined) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}Cached Read Tokens:${ANSI.reset}${usage.cachedTokens.toLocaleString()} tokens`);
    }
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.sky}Total Session:${ANSI.reset}     ${usage.totalTokens.toLocaleString()} tokens`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.amber}${ANSI.bold}Estimated Cost:${ANSI.reset}    $${usage.estimatedCostUsd.toFixed(4)} USD`);
    if (usage.turnsCount !== undefined) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}Swarm Turns:        ${usage.turnsCount} turns executed${ANSI.reset}`);
    }
    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders the full-screen Multi-Agent Swarm Dashboard.
   */
  public static renderSwarmDashboard(state: {
    tasks: Array<{ id: string; title: string; status: string; assignedRole: string }>;
    agents?: Record<string, any>;
    activeWorktrees?: string[];
  }): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 28));

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ ◈ SWARM ACTIVITY DASHBOARD ${border}╮${ANSI.reset}`);

    // Tasks DAG summary
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.bold}Task Dependency DAG (${state.tasks.length} tasks):${ANSI.reset}`);
    if (state.tasks.length === 0) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.dim}(no tasks active on Blackboard)${ANSI.reset}`);
    } else {
      for (const t of state.tasks) {
        let badge = `${ANSI.slate}[PENDING]${ANSI.reset}`;
        if (t.status === 'VERIFIED') badge = `${ANSI.mint}[✔ VERIFIED]${ANSI.reset}`;
        else if (t.status === 'IN_PROGRESS') badge = `${ANSI.gold}[⏳ RUNNING]${ANSI.reset}`;
        else if (t.status === 'CODE_SUBMITTED') badge = `${ANSI.sky}[REVIEW]${ANSI.reset}`;
        else if (t.status === 'REJECTED') badge = `${ANSI.coral}[✖ REJECTED]${ANSI.reset}`;

        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}   ${badge} ${ANSI.bold}${t.id}:${ANSI.reset} ${t.title} ${ANSI.dim}(${t.assignedRole})${ANSI.reset}`);
      }
    }

    // Worktrees
    if (state.activeWorktrees && state.activeWorktrees.length > 0) {
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}`);
      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.bold}Active Isolated Worktrees:${ANSI.reset}`);
      for (const wt of state.activeWorktrees) {
        console.log(`  ${ANSI.darkSlate}│${ANSI.reset}   ${ANSI.mint}⎇${ANSI.reset} ${wt}`);
      }
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders the categorized slash commands palette (/help command).
   */
  public static renderCommandCatalog(): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 24));

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ Command Catalog ${border}╮${ANSI.reset}`);

    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.amber}${ANSI.bold}Core Commands:${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/help${ANSI.reset}               Display this command catalog`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/cd <path>${ANSI.reset}          Switch workspace directory & git branch`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/clear${ANSI.reset}              Clear the terminal screen`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/exit${ANSI.reset}               Exit Nomin Code session`);

    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.amber}${ANSI.bold}Swarm & Multi-Agent:${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/status${ANSI.reset}             View active Swarm Task DAG and agent statuses`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/mode <solo|team>${ANSI.reset}   Switch between SOLO (1 agent) and TEAM mode`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/team <role>=<id>${ANSI.reset}   Assign model to swarm role (e.g. coder=qwen)`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/board${ANSI.reset}              Full-screen Blackboard & acceptance criteria`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/compact${ANSI.reset}            Trigger proactive context compaction`);

    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.amber}${ANSI.bold}Tools & Diagnostics:${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/repomap${ANSI.reset}            Generate PageRank symbol outline`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/diff${ANSI.reset}               Inspect staged worktree git diffs`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/doctor${ANSI.reset}             Run system & connectivity diagnostics`);

    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${ANSI.amber}${ANSI.bold}Models & Rate Limits:${ANSI.reset}`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/models${ANSI.reset}             List selected models and active configuration`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/cost${ANSI.reset}               View session tokens, turns, and cost estimate`);
    console.log(`  ${ANSI.darkSlate}│${ANSI.reset}    ${ANSI.sky}/config${ANSI.reset}             Display provider rate quotas and endpoints`);

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders the system doctor diagnostic health checks.
   */
  public static renderDoctor(
    checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string }>
  ): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 24));

    console.log();
    console.log(`  ${ANSI.darkSlate}╭─ System Diagnostics ${border}╮${ANSI.reset}`);

    for (const c of checks) {
      let icon = `${ANSI.mint}✔ PASS${ANSI.reset}`;
      if (c.status === 'warn') icon = `${ANSI.gold}⚠ WARN${ANSI.reset}`;
      else if (c.status === 'fail') icon = `${ANSI.coral}✖ FAIL${ANSI.reset}`;

      console.log(`  ${ANSI.darkSlate}│${ANSI.reset}  ${icon}  ${ANSI.bold}${c.name.padEnd(20, ' ')}${ANSI.reset} ${ANSI.dim}${c.detail}${ANSI.reset}`);
    }

    console.log(`  ${ANSI.darkSlate}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }
}

/**
 * Backwards compatibility alias for TerminalUI.
 */
export const UI = TerminalUI;
