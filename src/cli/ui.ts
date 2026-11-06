/**
 * Nomin Code: Clean Terminal UX & Styling
 * 
 * Features quiet whitespace, calm typography, single status line,
 * collapsed tool one-liners, unified diff previews, and zero nested box borders.
 * Zero external dependencies — pure Node.js standard library.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { isSystemDirectory, type ProviderEndpointConfig } from '../config/index.js';
import { BuildStampEngine } from '../config/build-stamp.js';
import { ANSI } from './ansi.js';
import { ThemeManager } from './theme.js';
import { StatusLine, type StatusLineProps } from './components/status-line.js';
import { FooterHints, type KeyHint } from './components/footer-hints.js';
import { DiffViewer } from './components/diff-viewer.js';

export { ANSI } from './ansi.js';

export interface SlashCommandItem {
  name: string;
  category: 'Core' | 'Swarm' | 'Provider & Models' | 'Tools & Diagnostics';
  description: string;
  syntax?: string;
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  { name: '/help', category: 'Core', description: 'Display all available slash commands & guide', syntax: '/help' },
  { name: '/chat', category: 'Core', description: 'Force direct conversational turn with model (no planning or swarm)', syntax: '/chat <message>' },
  { name: '/plan', category: 'Swarm', description: 'Force multi-agent Architect planning & swarm decomposition', syntax: '/plan <task>' },
  { name: '/undo', category: 'Tools & Diagnostics', description: 'Undo last git commit created by Nomin Code', syntax: '/undo' },
  { name: '/redo', category: 'Tools & Diagnostics', description: 'Redo previously undone commit', syntax: '/redo' },
  { name: '/rewind', category: 'Core', description: 'Rewind conversation context and file changes', syntax: '/rewind' },
  { name: '/stop', category: 'Core', description: 'Stop and abort active streaming or swarm task', syntax: '/stop' },
  { name: '/provider', category: 'Provider & Models', description: 'Switch or configure LLM Provider (NIM, OpenAI, Anthropic...)', syntax: '/provider' },
  { name: '/key', category: 'Provider & Models', description: 'Set or update provider API key (paste supported)', syntax: '/key <api-key>' },
  { name: '/model', category: 'Provider & Models', description: 'Interactive arrow-key model switcher', syntax: '/model' },
  { name: '/models', category: 'Provider & Models', description: 'Open live model catalog browser', syntax: '/models' },
  { name: '/effort', category: 'Provider & Models', description: 'Configure reasoning effort & thinking budget (off, low, medium, high, max)', syntax: '/effort' },
  { name: '/mode', category: 'Swarm', description: 'Switch between SOLO (1 agent) and TEAM (multi-agent) mode', syntax: '/mode <solo|team>' },
  { name: '/team', category: 'Swarm', description: 'Assign models to swarm roles (architect, coder, tester, verifier)', syntax: '/team' },
  { name: '/status', category: 'Swarm', description: 'View active Swarm Task DAG and agent execution statuses', syntax: '/status' },
  { name: '/board', category: 'Swarm', description: 'Full-screen Blackboard state & DoD acceptance criteria', syntax: '/board' },
  { name: '/compact', category: 'Swarm', description: 'Proactively compact context window', syntax: '/compact' },
  { name: '/cost', category: 'Provider & Models', description: 'View session token usage, turns, and estimated spend', syntax: '/cost' },
  { name: '/config', category: 'Provider & Models', description: 'Display provider rate quotas, endpoints, and credentials', syntax: '/config' },
  { name: '/permissions', category: 'Core', description: 'Interactive permission rule editor & policy manager', syntax: '/permissions' },
  { name: '/mcp', category: 'Tools & Diagnostics', description: 'Configure Model Context Protocol servers', syntax: '/mcp' },
  { name: '/agents', category: 'Swarm', description: 'Manage background and swarm agents', syntax: '/agents' },
  { name: '/hooks', category: 'Tools & Diagnostics', description: 'Configure pre/post turn lifecycle hooks', syntax: '/hooks' },
  { name: '/review', category: 'Tools & Diagnostics', description: 'Run fresh-context Verifier Gate code review', syntax: '/review' },
  { name: '/doctor', category: 'Tools & Diagnostics', description: 'Run system environment and connectivity diagnostics', syntax: '/doctor' },
  { name: '/init', category: 'Core', description: 'Generate starter guidelines in workspace', syntax: '/init' },
  { name: '/memory', category: 'Core', description: 'View or edit workspace memory guidelines', syntax: '/memory' },
  { name: '/export', category: 'Core', description: 'Export session conversation transcript', syntax: '/export' },
  { name: '/resume', category: 'Core', description: 'Interactive session history & resume picker', syntax: '/resume' },
  { name: '/theme', category: 'Core', description: 'Switch color theme (dark, light, high-contrast, colorblind)', syntax: '/theme' },
  { name: '/vim', category: 'Core', description: 'Toggle vim-style modal input navigation', syntax: '/vim' },
  { name: '/cd', category: 'Core', description: 'Switch workspace directory & git branch', syntax: '/cd <path>' },
  { name: '/new', category: 'Core', description: 'Create new project folder & switch workspace', syntax: '/new <name>' },
  { name: '/version', category: 'Core', description: 'Display exact build stamp, commit hash & entry binary', syntax: '/version' },
  { name: '/repomap', category: 'Tools & Diagnostics', description: 'Generate PageRank symbol outline of repository', syntax: '/repomap' },
  { name: '/diff', category: 'Tools & Diagnostics', description: 'Inspect staged worktree git diffs across swarm', syntax: '/diff' },
  { name: '/clear', category: 'Core', description: 'Clear the terminal screen', syntax: '/clear' },
  { name: '/exit', category: 'Core', description: 'Exit Nomin Code session', syntax: '/exit' },
];

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
  reasoningEffort?: string;
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
      const c = ThemeManager.getColors();
      const frame = TerminalUI.spinnerFrames[TerminalUI.spinnerIdx % TerminalUI.spinnerFrames.length];
      TerminalUI.spinnerIdx++;
      try {
        process.stdout.write(`${ANSI.clearLine}  ${c.accent}${frame}${c.reset} ${c.secondary}${TerminalUI.currentSpinnerLabel}${c.reset}`);
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
   * Prints the single sleek, compact Unicode header card (Claude Code / OpenCode standard).
   * Collapses workspace warnings into a single inline badge with zero redundant paragraphs.
   */
  public static printBootSequence(telemetry: BootingTelemetry): void {
    const c = ThemeManager.getColors();
    const isSys = isSystemDirectory(telemetry.workdir);

    const modeBadge = telemetry.mode === 'team' ? 'TEAM' : 'SOLO';
    let model = telemetry.activeModel;
    if (!model || model === 'undefined' || model === 'none') {
      if (telemetry.roles) {
        const validRole = Object.values(telemetry.roles).find(v => v && v !== 'undefined' && v !== 'none');
        if (validRole) model = validRole;
      }
    }
    const hasModel = Boolean(model && model !== 'undefined' && model !== 'none');
    const modelDisplay = hasModel ? `${c.text}${model}${c.reset}` : `${c.secondary}(no model selected)${c.reset}`;
    const modelPlain = hasModel ? model! : '(no model selected)';
    const branch = telemetry.gitBranch && telemetry.gitBranch !== '(none - not a git repository)'
      ? ` (${telemetry.gitBranch})`
      : '';

    const stamp = BuildStampEngine.getStamp();

    // Line 1: ◈ NOMIN CODE v1.0.0 [commit] · [Provider] · Model · Mode
    const l1Left = `${c.accent}${c.bold}◈ NOMIN CODE${c.reset} ${c.secondary}v${telemetry.version} [${stamp.commitHash}]${c.reset} ${c.border}·${c.reset} ${c.info}[${telemetry.providerName}]${c.reset} ${c.border}·${c.reset} ${modelDisplay} ${c.border}·${c.reset} ${c.success}${modeBadge}${c.reset}`;
    const l1Plain = `◈ NOMIN CODE v${telemetry.version} [${stamp.commitHash}] · [${telemetry.providerName}] · ${modelPlain} · ${modeBadge}`;

    // Line 2: Workspace: <path> (optional branch) [· ⚠ Sandboxed (~/.nomin) · Use /cd <path>]
    let l2Left = `${c.secondary}Workspace:${c.reset} ${c.text}${telemetry.workdir}${branch}${c.reset}`;
    let l2Plain = `Workspace: ${telemetry.workdir}${branch}`;
    if (isSys) {
      l2Left += ` ${c.border}·${c.reset} ${c.warning}⚠ Sandboxed (~/.nomin) · Use /cd <path>${c.reset}`;
      l2Plain += ` · ⚠ Sandboxed (~/.nomin) · Use /cd <path>`;
    }

    const termWidth = process.stdout.columns || 80;
    const cardWidth = Math.max(76, Math.min(termWidth - 4, Math.max(l1Plain.length, l2Plain.length) + 6));
    const pad1 = ' '.repeat(Math.max(0, cardWidth - 6 - l1Plain.length));
    const pad2 = ' '.repeat(Math.max(0, cardWidth - 6 - l2Plain.length));

    console.log();
    // OpenCode top tab bar
    const projectName = path.basename(telemetry.workdir) || 'Workspace';
    const activeTab = `.: ${projectName}`;
    console.log(`  ${c.secondary}Multi-agent coding swarm on${c.reset}  ${c.bgHighlight || '\x1b[48;2;36;41;46m'}${c.bold}${c.text} ${activeTab} ${c.reset}  ${c.secondary}New session   +${c.reset}`);
    console.log(`  ${c.border}╭─ ${l1Left} ${pad1}${c.border}─╮${c.reset}`);
    console.log(`  ${c.border}╰─ ${l2Left} ${pad2}${c.border}─╯${c.reset}`);

    // Centered OpenCode-style retro-modern chunky block logo (aligned with header card)
    const logoL1 = '█▄ █ █▀█ █▀▄▀█ █ █▄ █   █▀▀ █▀█ █▀▄ █▀▀';
    const logoL2 = '█ ▀█ █▄█ █ ▀ █ █ █ ▀█   █▄▄ █▄█ █▄▀ ██▄';
    const logoMargin = Math.max(2, 2 + Math.floor((cardWidth - 39) / 2));
    const padLogo = ' '.repeat(logoMargin);
    const logoColor = c.text || '\x1b[38;2;220;220;220m';
    const dimLogoColor = c.secondary || '\x1b[38;2;140;140;140m';

    console.log();
    console.log(`${padLogo}${c.bold}${logoColor}${logoL1}${c.reset}`);
    console.log(`${padLogo}${dimLogoColor}${logoL2}${c.reset}`);
    console.log();
  }

  /**
   * Renders a system directory sandboxing tip warning.
   */
  public static renderSystemDirWarning(): void {
    const c = ThemeManager.getColors();
    console.log(`  ${c.warning}⚠️  Running in system directory. Workspace state sandboxed to ~/.nomin.${c.reset}`);
    console.log(`  ${c.accent}💡 Tip: Use 'cd <path>' or start with 'nomin <path>' to work on a project.${c.reset}\n`);
  }

  /**
   * Renders the dynamic directory switch card.
   */
  public static renderWorkspaceSwitchedCard(workdir: string, gitBranch: string): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.success}● Workspace switched:${c.reset} ${c.text}${workdir}${c.reset}  ${c.secondary}[branch: ${gitBranch}]${c.reset}`);
    console.log();
  }

  public static renderMessageBarHeader(): void {
    // Quiet hairline indicator
  }

  public static renderMessageBarFooter(): void {
    // Dim hints line
  }

  public static renderPromptBox(options?: { promptText?: string; tokenStats?: string; branch?: string }): void {
    // Minimal prompt separator
  }

  /**
   * Renders a real-time status line / pill.
   */
  public static renderStatusBar(info: { mode: string; model: string; branch: string; tokens: number; costUsd: number; status: string }): void {
    const c = ThemeManager.getColors();
    const tokenStr = info.tokens >= 1000 ? `${(info.tokens / 1000).toFixed(1)}k` : `${info.tokens}`;
    const costStr = `$${info.costUsd.toFixed(4)}`;
    console.log(`  ${c.secondary}[${c.accent}◈ NOMIN${c.reset} ${c.border}·${c.reset} ${c.info}${info.mode.toUpperCase()}${c.reset} ${c.border}·${c.reset} ${c.text}${info.model}${c.reset} ${c.border}·${c.reset} ${c.secondary}⎇ ${info.branch}${c.reset} ${c.border}·${c.reset} ${c.secondary}${tokenStr} tok (${costStr})${c.reset} ${c.border}·${c.reset} ${c.success}${info.status}${c.reset}${c.secondary}]${c.reset}`);
  }

  /**
   * Renders collapsible thinking process block matching OpenCode standard (+ Thought · 1.5s).
   * Eliminates emoji spam and internal chain-of-thought dumps.
   */
  public static renderThinking(
    role: string,
    modelName: string,
    thinkingText: string,
    durationMs?: number,
    expanded: boolean = false
  ): void {
    const c = ThemeManager.getColors();
    const durSeconds = durationMs !== undefined ? (durationMs / 1000).toFixed(1) : '1.2';
    console.log();
    console.log(`  ${c.amber}+ Thought${c.reset} ${c.secondary}· ${durSeconds}s${c.reset}`);

    const raw = thinkingText.trim();
    if (!raw) return;

    if (expanded) {
      console.log();
      const wrapped = TerminalUI.wrapText(raw, TerminalUI.width() - 6);
      for (const l of wrapped) {
        console.log(`  ${c.secondary}${l}${c.reset}`);
      }
      console.log();
    } else {
      // Extract clean high-level summary, filtering out internal meta phrasing
      const lines = raw.split('\n').map(l => l.trim()).filter(l => Boolean(l));
      const cleanLine = lines.find(l => !l.toLowerCase().includes('thinking process') && !l.startsWith('I should') && l.length > 10) || lines[0] || '';
      if (cleanLine && !cleanLine.toLowerCase().includes('thinking process')) {
        console.log();
        console.log(`  ${c.text}${TerminalUI.truncate(cleanLine, 90)}${c.reset}`);
      }
    }
  }

  /**
   * Renders sleek tool call matching OpenCode standard ($ <command> or → Explored).
   * Eliminates emoji clutter.
   */
  public static renderToolCall(toolName: string, params: Record<string, any>, summary?: string): void {
    const c = ThemeManager.getColors();
    if (toolName === 'bash') {
      const cmd = params.command || '';
      console.log(`\n  ${c.secondary}$${c.reset} ${c.bold}${c.text}${cmd}${c.reset}`);
      return;
    }

    if (toolName === 'read_file') {
      const range = params.start_line ? ` (lines ${params.start_line}-${params.end_line || ''})` : '';
      console.log(`  ${c.secondary}→${c.reset} ${c.text}Explored: read ${params.path || ''}${range}${c.reset}`);
      return;
    }

    if (toolName === 'search' || toolName === 'search_grep' || toolName === 'search_glob') {
      const q = params.query || params.pattern || '';
      console.log(`  ${c.secondary}→${c.reset} ${c.text}Explored: search "${q}"${c.reset}`);
      return;
    }

    if (toolName === 'repomap') {
      console.log(`  ${c.secondary}→${c.reset} ${c.text}Explored: repository symbol map${c.reset}`);
      return;
    }

    const sum = summary ? `  ${c.secondary}(${summary})${c.reset}` : '';
    console.log(`  ${c.secondary}→${c.reset} ${c.text}${toolName}${c.reset}${sum}`);
  }

  /**
   * Renders tool result output matching OpenCode terminal cards.
   */
  public static renderToolResult(
    toolName: string,
    result: { success: boolean; output: string; durationMs?: number; exitCode?: number }
  ): void {
    const c = ThemeManager.getColors();
    if (toolName === 'bash') {
      const raw = (result.output || '').trim();
      if (!raw) {
        console.log(`  ${c.secondary}(no output)${c.reset}\n`);
        return;
      }
      const lines = raw.split('\n');
      const maxShow = 15;
      if (lines.length > maxShow) {
        console.log(`  ${c.secondary}(${lines.length - maxShow} earlier lines)${c.reset}`);
      }
      for (const line of lines.slice(-maxShow)) {
        console.log(`  ${c.text}${line}${c.reset}`);
      }
      console.log();
      return;
    }

    if (!result.success) {
      console.log(`  ${c.error}✖ ${toolName} failed:${c.reset} ${result.output}`);
    }
  }

  /**
   * Renders file reading card with syntax line numbers.
   */
  public static renderFileRead(
    filePath: string,
    range: { start: number; end: number; total: number },
    content: string
  ): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.info}📖 Read: ${filePath}${c.reset} ${c.secondary}(lines ${range.start}-${range.end} of ${range.total})${c.reset}`);

    const lines = content.split('\n');
    let lineNum = range.start;
    const maxShow = 12;

    for (let i = 0; i < Math.min(lines.length, maxShow); i++) {
      const numStr = String(lineNum + i).padStart(4, ' ');
      console.log(`    ${c.border}${numStr} │${c.reset} ${lines[i]}`);
    }

    if (lines.length > maxShow) {
      console.log(`    ${c.secondary}... [${lines.length - maxShow} more lines]${c.reset}`);
    }
    console.log();
  }

  /**
   * Renders file edit matching OpenCode standard (← Edit <path> with line-numbered gutters & row tints).
   */
  public static renderFileEdit(
    filePath: string,
    diffText: string,
    stats?: { added: number; removed: number }
  ): void {
    console.log();
    const rendered = DiffViewer.renderOpenCodeEdit(filePath, diffText);
    for (const line of rendered) {
      console.log(line);
    }
    console.log();
  }

  /**
   * Renders search matches cleanly.
   */
  public static renderSearch(
    query: string,
    matchesCount: number,
    fileCount: number,
    samples?: string[]
  ): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.info}🔍 Search: "${query}"${c.reset}  ${c.secondary}(${matchesCount} matches across ${fileCount} files)${c.reset}`);
    if (samples && samples.length > 0) {
      for (const s of samples.slice(0, 6)) {
        console.log(`    ${c.secondary}•${c.reset} ${s}`);
      }
    }
    console.log();
  }

  public static renderAgentCard(
    role: string,
    modelName: string,
    message: string,
    details?: string[]
  ): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.accent}${role.toUpperCase()}${c.reset} ${c.secondary}(${modelName})${c.reset}:`);
    for (const line of message.split('\n')) {
      console.log(`    ${line}`);
    }
    if (details && details.length > 0) {
      for (const d of details) {
        console.log(`    ${c.secondary}• ${d}${c.reset}`);
      }
    }
    console.log();
  }

  public static logAgent(role: string, message: string, details?: string[]): void {
    TerminalUI.renderAgentCard(role, 'Swarm', message, details);
  }

  /**
   * Renders DoD verification gate pass/rejection banner.
   */
  public static renderVerdictCard(
    approved: boolean,
    reason: string,
    criteriaCount: number,
    evidenceCount: number,
    details?: string[]
  ): void {
    const c = ThemeManager.getColors();
    console.log();
    if (approved) {
      console.log(`  ${c.success}${c.bold}✔ DoD Passed & Released${c.reset}  ${c.secondary}(${criteriaCount}/${criteriaCount} criteria · ${evidenceCount} proofs)${c.reset}`);
      console.log(`  ${c.secondary}${reason}${c.reset}`);
    } else {
      console.log(`  ${c.error}${c.bold}✖ DoD Gate Blocked${c.reset}`);
      console.log(`  ${c.secondary}${reason}${c.reset}`);
    }

    if (details && details.length > 0) {
      for (const d of details) {
        const mark = approved ? `${c.success}✔${c.reset}` : `${c.error}✖${c.reset}`;
        console.log(`    ${mark} ${c.secondary}${d}${c.reset}`);
      }
    }
    console.log();
  }

  /**
   * Renders unified diff.
   */
  public static renderDiff(diffText: string, filePath?: string): void {
    if (!diffText || !diffText.trim()) return;
    const lines = DiffViewer.renderUnified(filePath || 'Worktree Diff', diffText);
    console.log();
    for (const l of lines) {
      console.log(l);
    }
    console.log();
  }

  /**
   * Terminal Markdown Renderer.
   */
  public static renderMarkdown(markdown: string): void {
    const lines = markdown.split('\n');
    let inCodeBlock = false;
    let codeLanguage = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLanguage = line.slice(3).trim() || 'code';
          console.log(`  ${ANSI.dim}┌── ${codeLanguage}${ANSI.reset}`);
        } else {
          inCodeBlock = false;
          console.log(`  ${ANSI.dim}└──${ANSI.reset}`);
        }
        continue;
      }

      if (inCodeBlock) {
        console.log(`    ${ANSI.codeHighlight}${line}${ANSI.reset}`);
        continue;
      }

      if (line.startsWith('# ')) {
        console.log(`\n  ${ANSI.bold}${ANSI.brightWhite}${line.slice(2)}${ANSI.reset}`);
        continue;
      } else if (line.startsWith('## ')) {
        console.log(`\n  ${ANSI.bold}${ANSI.sky}${line.slice(3)}${ANSI.reset}`);
        continue;
      } else if (line.startsWith('### ')) {
        console.log(`  ${ANSI.bold}${ANSI.mint}${line.slice(4)}${ANSI.reset}`);
        continue;
      }

      if (line.startsWith('> ')) {
        console.log(`  ${ANSI.slate}│${ANSI.reset}  ${ANSI.italic}${line.slice(2)}${ANSI.reset}`);
        continue;
      }

      if (line.match(/^[\s]*[-*+]\s+/)) {
        const item = line.replace(/^[\s]*[-*+]\s+/, '');
        console.log(`  ${ANSI.amber}•${ANSI.reset} ${TerminalUI.formatInlineMarkdown(item)}`);
        continue;
      }

      if (line.match(/^[\s]*\d+\.\s+/)) {
        const match = line.match(/^[\s]*(\d+)\.\s+(.*)/);
        if (match) {
          console.log(`  ${ANSI.sky}${match[1]}.${ANSI.reset} ${TerminalUI.formatInlineMarkdown(match[2])}`);
          continue;
        }
      }

      console.log(`  ${TerminalUI.formatInlineMarkdown(line)}`);
    }
    console.log();
  }

  public static formatInlineMarkdown(text: string): string {
    const c = ThemeManager.getColors();
    return text
      .replace(/`([^`]+)`/g, `${c.info || ANSI.brightCyan}$1${c.reset || ANSI.reset}`)
      .replace(/\*\*([^*]+)\*\*/g, `${c.bold || ANSI.bold}$1${c.reset || ANSI.reset}`)
      .replace(/\*([^*]+)\*/g, `${c.dim || ANSI.italic}$1${c.reset || ANSI.reset}`);
  }

  /**
   * Renders cost summary telemetry.
   */
  public static renderCostSummary(usage: CostTelemetry): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.bold}Session Token & Cost Telemetry${c.reset}`);
    console.log(`  ${c.secondary}Prompt Tokens:${c.reset}     ${c.text}${usage.promptTokens.toLocaleString()}${c.reset}`);
    console.log(`  ${c.secondary}Completion Tokens:${c.reset} ${c.text}${usage.completionTokens.toLocaleString()}${c.reset}`);
    console.log(`  ${c.secondary}Total Tokens:${c.reset}      ${c.info}${usage.totalTokens.toLocaleString()}${c.reset}`);
    console.log(`  ${c.accent}Estimated Cost:${c.reset}    ${c.bold}$${usage.estimatedCostUsd.toFixed(4)} USD${c.reset}`);
    if (usage.turnsCount !== undefined) {
      console.log(`  ${c.secondary}Swarm Turns:        ${usage.turnsCount}${c.reset}`);
    }
    console.log();
  }

  /**
   * Renders Swarm Dashboard.
   */
  public static renderSwarmDashboard(state: {
    tasks: Array<{ id: string; title: string; status: string; assignedRole: string }>;
    agents?: Record<string, any>;
    activeWorktrees?: string[];
  }): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.accent}${c.bold}◈ SWARM ACTIVITY DASHBOARD${c.reset}  ${c.secondary}(${state.tasks.length} tasks)${c.reset}`);
    for (const t of state.tasks) {
      let badge = `${c.secondary}[PENDING]${c.reset}`;
      if (t.status === 'VERIFIED') badge = `${c.success}[✔ VERIFIED]${c.reset}`;
      else if (t.status === 'IN_PROGRESS') badge = `${c.warning}[⏳ RUNNING]${c.reset}`;
      else if (t.status === 'CODE_SUBMITTED') badge = `${c.info}[REVIEW]${c.reset}`;
      else if (t.status === 'REJECTED') badge = `${c.error}[✖ REJECTED]${c.reset}`;

      console.log(`    ${badge} ${c.bold}${t.id}:${c.reset} ${t.title} ${c.secondary}(${t.assignedRole})${c.reset}`);
    }
    console.log();
  }

  public static renderCommandCatalog(): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.accent}${c.bold}Nomin Code Slash Commands${c.reset}`);
    for (const cmd of SLASH_COMMANDS) {
      console.log(`    ${c.accent}${cmd.name.padEnd(14, ' ')}${c.reset} ${c.secondary}[${cmd.category}]${c.reset} ${cmd.description}`);
    }
    console.log();
  }

  public static renderDoctor(
    checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string }>
  ): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.bold}System Health & Diagnostics${c.reset}`);
    for (const cCheck of checks) {
      let icon = `${c.success}✔ PASS${c.reset}`;
      if (cCheck.status === 'warn') icon = `${c.warning}⚠ WARN${c.reset}`;
      else if (cCheck.status === 'fail') icon = `${c.error}✖ FAIL${c.reset}`;
      console.log(`    ${icon}  ${c.bold}${cCheck.name.padEnd(20, ' ')}${c.reset} ${c.secondary}${cCheck.detail}${c.reset}`);
    }
    console.log();
  }

  public static renderCommandPopup(options: {
    query?: string;
    selectedIndex?: number;
    maxVisible?: number;
    print?: boolean;
  } = {}): { lines: string[]; filtered: SlashCommandItem[]; selected: SlashCommandItem | undefined } {
    const c = ThemeManager.getColors();
    const rawQ = (options.query || '').trim().toLowerCase();
    const q = rawQ.startsWith('/') ? rawQ : (rawQ ? `/${rawQ}` : '');
    const maxVisible = options.maxVisible ?? 8;

    const filtered = SLASH_COMMANDS.filter((cmd) => {
      if (!q || q === '/') return true;
      return (
        cmd.name.toLowerCase().startsWith(q) ||
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(rawQ)
      );
    });

    const selectedIndex = Math.max(0, Math.min(options.selectedIndex ?? 0, Math.max(0, filtered.length - 1)));
    const selected = filtered[selectedIndex];

    const lines: string[] = [];
    const title = q && q !== '/' ? `Commands matching "${q}"` : 'Slash Commands (↑/↓ move · enter select · esc cancel)';
    lines.push(`  ${c.bold}${title}${c.reset}`);

    if (filtered.length === 0) {
      lines.push(`    ${c.secondary}No matching commands.${c.reset}`);
    } else {
      const visible = filtered.slice(0, maxVisible);
      visible.forEach((item, idx) => {
        const isSelected = idx === selectedIndex;
        const cursor = isSelected ? `${c.accent}❯${c.reset}` : ' ';
        const nameColor = isSelected ? `${c.bold}${c.accent}` : `${c.info}`;
        lines.push(`  ${cursor} ${nameColor}${item.name.padEnd(14, ' ')}${c.reset} ${c.secondary}[${item.category}]${c.reset} ${item.description}`);
      });
    }

    if (options.print !== false) {
      for (const line of lines) {
        console.log(line);
      }
    }

    return { lines, filtered, selected };
  }

  public static renderProviderManagerCard(options: {
    activeProvider: ProviderEndpointConfig;
    providers: Record<string, ProviderEndpointConfig>;
    statusMessage?: string;
    isError?: boolean;
  }): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.accent}${c.bold}LLM Provider Manager${c.reset}`);
    console.log(`  ${c.secondary}Active Provider:${c.reset} ${c.info}${options.activeProvider.name}${c.reset} (${options.activeProvider.baseUrl})`);
    const key = options.activeProvider.apiKey || '';
    const masked = key ? (key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '••••••••') : `${c.warning}(not configured)${c.reset}`;
    console.log(`  ${c.secondary}API Key:${c.reset}         ${masked}`);
    console.log();
  }

  public static renderModelManagerCard(options: {
    mode: 'solo' | 'team';
    activeModel?: string;
    roles: Record<string, string>;
    selectedModels: string[];
    popularPresets: string[];
    providerName: string;
    reasoningEffort?: string;
    totalCatalogCount?: number;
    statusMessage?: string;
  }): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.accent}${c.bold}Model Management${c.reset}  ${c.secondary}(${options.mode.toUpperCase()})${c.reset}`);
    if (options.mode === 'solo') {
      console.log(`  ${c.secondary}Active Model:${c.reset} ${c.success}${options.activeModel || 'none'}${c.reset}`);
    } else {
      console.log(`  ${c.secondary}Roles:${c.reset}`);
      for (const [r, m] of Object.entries(options.roles)) {
        console.log(`    ${r}: ${c.info}${m}${c.reset}`);
      }
    }
    console.log();
  }

  public static renderReasoningEffortCard(currentEffort: string = 'medium'): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.bold}Reasoning Effort & Thinking Budget${c.reset}  ${c.secondary}[Current: ${currentEffort.toUpperCase()}]${c.reset}`);
    console.log(`    ${c.info}off${c.reset}    — Direct output without reasoning tokens`);
    console.log(`    ${c.info}low${c.reset}    — ~1,024 token budget`);
    console.log(`    ${c.info}medium${c.reset} — ~2,048 token budget (default)`);
    console.log(`    ${c.info}high${c.reset}   — ~4,096 token budget`);
    console.log(`    ${c.info}max${c.reset}    — ~8,192 token budget`);
    console.log();
  }

  public static renderModelDeprecatedCard(options: {
    model: string;
    provider: string;
    detail?: string;
    replacements: string[];
  }): void {
    const c = ThemeManager.getColors();
    console.log();
    console.log(`  ${c.error}${c.bold}Model Deprecated (HTTP 410 Gone):${c.reset} ${options.model} (${options.provider})`);
    if (options.detail) console.log(`  ${c.secondary}${options.detail}${c.reset}`);
    if (options.replacements && options.replacements.length > 0) {
      console.log(`  ${c.secondary}Available replacements:${c.reset} ${options.replacements.join(', ')}`);
    }
    console.log();
  }

  public static renderModelCatalogList(options: {
    models: Array<{ id: string; name?: string; family?: string; category?: string; contextWindow?: number; supportsReasoning?: boolean }>;
    page: number;
    pageSize: number;
    totalCount: number;
    activeModel?: string;
    query?: string;
  }): void {
    const c = ThemeManager.getColors();
    console.log();
    const title = options.query
      ? `Model Catalog Search: "${options.query}" (${options.totalCount} matches)`
      : `Live Model Catalog (Page ${options.page} · ${options.totalCount} models)`;
    console.log(`  ${c.bold}${title}${c.reset}`);
    const startIdx = (options.page - 1) * options.pageSize;
    const pageItems = options.models.slice(startIdx, startIdx + options.pageSize);
    for (const m of pageItems) {
      const isCur = m.id === options.activeModel ? ` ${c.success}[ACTIVE]${c.reset}` : '';
      console.log(`    • ${c.info}${m.id}${c.reset}${isCur}`);
    }
    console.log();
  }
}

export const UI = TerminalUI;

/**
 * Line-buffered real-time streaming markdown renderer for live LLM responses.
 * Formats code fences, bold, bullet points, headers, and blockquotes with clean indentation.
 */
export class StreamingMarkdownRenderer {
  private lineBuffer: string = '';
  private inCodeBlock: boolean = false;
  private codeLanguage: string = '';

  public write(chunk: string): void {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      this.renderLine(line);
    }
  }

  public flush(): void {
    if (this.lineBuffer.length > 0) {
      this.renderLine(this.lineBuffer);
      this.lineBuffer = '';
    }
    if (this.inCodeBlock) {
      const c = ThemeManager.getColors();
      console.log(`  ${c.secondary}└──${c.reset}\n`);
      this.inCodeBlock = false;
    }
  }

  private renderLine(line: string): void {
    const c = ThemeManager.getColors();

    if (line.startsWith('```')) {
      if (!this.inCodeBlock) {
        this.inCodeBlock = true;
        this.codeLanguage = line.slice(3).trim() || 'code';
        console.log(`\n  ${c.secondary}┌── ${c.bold}${c.info}${this.codeLanguage}${c.reset}`);
      } else {
        this.inCodeBlock = false;
        console.log(`  ${c.secondary}└──${c.reset}\n`);
      }
      return;
    }

    if (this.inCodeBlock) {
      console.log(`    ${this.colorizeCode(line)}`);
      return;
    }

    if (line.startsWith('# ')) {
      console.log(`\n  ${c.bold}${line.slice(2)}${c.reset}`);
      return;
    } else if (line.startsWith('## ')) {
      console.log(`\n  ${c.bold}${c.accent}${line.slice(3)}${c.reset}`);
      return;
    } else if (line.startsWith('### ')) {
      console.log(`\n  ${c.bold}${c.info}${line.slice(4)}${c.reset}`);
      return;
    }

    if (line.startsWith('> ')) {
      console.log(`  ${c.secondary}│${c.reset}  ${c.dim}${line.slice(2)}${c.reset}`);
      return;
    }

    if (line.match(/^[\s]*[-*+]\s+/)) {
      const item = line.replace(/^[\s]*[-*+]\s+/, '');
      console.log(`  ${c.amber}•${c.reset} ${TerminalUI.formatInlineMarkdown(item)}`);
      return;
    }

    if (line.match(/^[\s]*\d+\.\s+/)) {
      const match = line.match(/^[\s]*(\d+)\.\s+(.*)/);
      if (match) {
        console.log(`  ${c.info}${match[1]}.${c.reset} ${TerminalUI.formatInlineMarkdown(match[2])}`);
        return;
      }
    }

    console.log(`  ${TerminalUI.formatInlineMarkdown(line)}`);
  }

  private colorizeCode(line: string): string {
    const c = ThemeManager.getColors();
    // Keywords
    let colored = line.replace(/\b(const|let|var|function|return|import|export|from|class|async|await|if|else|for|while|try|catch|new|type|interface|def|self)\b/g, `${c.info}$1${c.reset}${c.text}`);
    // String literals
    colored = colored.replace(/(["'`])(.*?)\1/g, `${c.success}$1$2$1${c.reset}${c.text}`);
    // Numbers
    colored = colored.replace(/\b(\d+)\b/g, `${c.amber}$1${c.reset}${c.text}`);
    // Comments
    colored = colored.replace(/(\/\/.*$|#.*$)/g, `${c.secondary}$1${c.reset}`);
    return `${c.text}${colored}${c.reset}`;
  }
}
