/**
 * Interactive Slash Command Popup Menu
 * Opens as soon as '/' is typed with arrow selection and live fuzzy filter.
 */

import { ThemeManager } from './theme.js';
import { RawInputReader, type KeyStroke } from './raw-input.js';
import { FooterHints } from './components/footer-hints.js';

export interface SlashCommandDef {
  name: string;
  category: 'Core' | 'Swarm' | 'Provider & Models' | 'Tools & Diagnostics';
  description: string;
  syntax?: string;
}

export const ALL_SLASH_COMMANDS: SlashCommandDef[] = [
  { name: '/help', category: 'Core', description: 'Display all available slash commands & guide', syntax: '/help' },
  { name: '/retry', category: 'Core', description: 'Resend the last pending or interrupted turn', syntax: '/retry' },
  { name: '/stats', category: 'Provider & Models', description: 'View rate limits, RPM, 429 count, queue depth, and circuit status', syntax: '/stats' },
  { name: '/rpm', category: 'Provider & Models', description: 'View or set rate limit (RPM) for active provider/model', syntax: '/rpm [limit]' },
  { name: '/context', category: 'Tools & Diagnostics', description: 'Display dynamic environment & workspace telemetry', syntax: '/context' },
  { name: '/debug', category: 'Tools & Diagnostics', description: 'Toggle detailed HTTP payload debug logging to .nomin/debug.log', syntax: '/debug [on|off]' },
  { name: '/chat', category: 'Core', description: 'Force direct conversational turn with model', syntax: '/chat <message>' },
  { name: '/plan', category: 'Swarm', description: 'Force multi-agent Architect planning & DAG decomposition', syntax: '/plan <task>' },
  { name: '/undo', category: 'Tools & Diagnostics', description: 'Interactive commit rollback timeline', syntax: '/undo' },
  { name: '/redo', category: 'Tools & Diagnostics', description: 'Redo previously undone commit', syntax: '/redo' },
  { name: '/rewind', category: 'Core', description: 'Rewind conversation context and file changes', syntax: '/rewind' },
  { name: '/stop', category: 'Core', description: 'Stop and abort active streaming or swarm task', syntax: '/stop' },
  { name: '/provider', category: 'Provider & Models', description: 'Switch or configure LLM Provider (NIM, OpenAI, Anthropic...)', syntax: '/provider' },
  { name: '/key', category: 'Provider & Models', description: 'Set or update provider API key (paste supported)', syntax: '/key <api-key>' },
  { name: '/model', category: 'Provider & Models', description: 'Interactive arrow-key model switcher', syntax: '/model' },
  { name: '/models', category: 'Provider & Models', description: 'Open live model catalog browser', syntax: '/models' },
  { name: '/effort', category: 'Provider & Models', description: 'Configure reasoning effort slider (off, low, medium, high, max)', syntax: '/effort' },
  { name: '/mode', category: 'Swarm', description: 'Switch between SOLO (1 agent) and TEAM (multi-agent) mode', syntax: '/mode <solo|team>' },
  { name: '/team', category: 'Swarm', description: 'Assign models to swarm roles (architect, coder, tester, verifier)', syntax: '/team' },
  { name: '/status', category: 'Swarm', description: 'View active Swarm Task DAG and agent execution statuses', syntax: '/status' },
  { name: '/board', category: 'Swarm', description: 'Full-screen Blackboard state & DoD acceptance criteria', syntax: '/board' },
  { name: '/compact', category: 'Swarm', description: 'Proactively compact context window', syntax: '/compact' },
  { name: '/cost', category: 'Provider & Models', description: 'View session token usage, turns, and estimated spend', syntax: '/cost' },
  { name: '/config', category: 'Provider & Models', description: 'Interactive settings menu & plain config sync', syntax: '/config' },
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
  { name: '/diff', category: 'Tools & Diagnostics', description: 'Inspect active worktree git diffs', syntax: '/diff' },
  { name: '/clear', category: 'Core', description: 'Clear the terminal screen', syntax: '/clear' },
  { name: '/exit', category: 'Core', description: 'Exit Nomin Code session', syntax: '/exit' },
];

export class SlashMenu {
  private filteredCommands: SlashCommandDef[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private pageSize = 8;
  private query: string;

  constructor(initialQuery: string = '') {
    this.query = initialQuery.startsWith('/') ? initialQuery.slice(1) : initialQuery;
    this.applyFilter();
  }

  public getSelected(): SlashCommandDef | null {
    if (this.filteredCommands.length === 0) return null;
    return this.filteredCommands[this.selectedIndex] || null;
  }

  public setQuery(query: string): void {
    this.query = query.startsWith('/') ? query.slice(1) : query;
    this.applyFilter();
  }

  private applyFilter(): void {
    const q = this.query.trim().toLowerCase();
    const matches = ALL_SLASH_COMMANDS.filter(cmd => {
      if (!q) return true;
      const cmdName = cmd.name.slice(1).toLowerCase();
      const desc = cmd.description.toLowerCase();
      return cmdName.startsWith(q) || cmdName.includes(q) || desc.includes(q);
    });

    // Rank prefix matches first, then name contains, then description contains
    this.filteredCommands = matches.sort((a, b) => {
      const aName = a.name.slice(1).toLowerCase();
      const bName = b.name.slice(1).toLowerCase();
      const aPrefix = aName.startsWith(q);
      const bPrefix = bName.startsWith(q);
      if (aPrefix && !bPrefix) return -1;
      if (!aPrefix && bPrefix) return 1;
      const aIncludes = aName.includes(q);
      const bIncludes = bName.includes(q);
      if (aIncludes && !bIncludes) return -1;
      if (!aIncludes && bIncludes) return 1;
      return 0;
    });

    if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = Math.max(0, this.filteredCommands.length - 1);
    }
    this.adjustScroll();
  }

  private adjustScroll(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.pageSize) {
      this.scrollOffset = this.selectedIndex - this.pageSize + 1;
    }
  }

  public handleKey(key: KeyStroke): 'continue' | 'select' | 'cancel' {
    const total = this.filteredCommands.length;

    if (key.name === 'up') {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'down') {
      if (this.selectedIndex < total - 1) {
        this.selectedIndex++;
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'backspace') {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
      } else {
        return 'cancel';
      }
      return 'continue';
    }

    if (key.name === 'char' && key.char) {
      this.query += key.char;
      this.applyFilter();
      return 'continue';
    }

    if (key.name === 'enter' || key.name === 'tab') {
      return this.filteredCommands.length > 0 ? 'select' : 'cancel';
    }

    if (key.name === 'escape') {
      return 'cancel';
    }

    return 'continue';
  }

  public render(): string[] {
    const c = ThemeManager.getColors();
    const lines: string[] = [];
    const total = this.filteredCommands.length;

    if (total === 0) {
      lines.push(`  ${c.secondary}No matching commands.${c.reset}`);
      return lines;
    }

    const termWidth = process.stdout.columns || 80;
    const cardWidth = Math.max(54, Math.min(termWidth - 4, 76));
    const nameWidth = 14;
    const descWidth = Math.max(24, cardWidth - nameWidth - 4);
    const boxWidth = nameWidth + descWidth + 3;

    lines.push(`  ${c.border}╭${'─'.repeat(boxWidth)}╮${c.reset}`);

    const visible = this.filteredCommands.slice(this.scrollOffset, this.scrollOffset + this.pageSize);

    visible.forEach((cmd, localIdx) => {
      const globalIdx = this.scrollOffset + localIdx;
      const isSelected = globalIdx === this.selectedIndex;

      let desc = cmd.description;
      if (desc.length > descWidth) {
        desc = desc.slice(0, descWidth - 1) + '…';
      }

      const namePadded = cmd.name.padEnd(nameWidth, ' ');
      const descPadded = desc.padEnd(descWidth, ' ');

      if (isSelected) {
        // OpenCode signature peach active selection row
        lines.push(`  ${c.border}│${c.reset}${c.peachBg} ${namePadded} ${descPadded} ${c.reset}${c.border}│${c.reset}`);
      } else {
        lines.push(`  ${c.border}│${c.reset} ${c.bold}${c.text}${namePadded}${c.reset} ${c.secondary}${descPadded}${c.reset} ${c.border}│${c.reset}`);
      }
    });

    lines.push(`  ${c.border}╰${'─'.repeat(boxWidth)}╯${c.reset}`);

    return lines;
  }
}
