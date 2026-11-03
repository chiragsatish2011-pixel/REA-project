/**
 * Nomin Code: Claude Code & OpenCode Inspired Terminal UX & Styling
 * Features clean hairlines, telemetry booting cards, message input boxes, and multi-agent activity cards.
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

  // Backgrounds
  bgBlack: '\x1b[40m',
  bgDark: '\x1b[48;5;235m',
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m',

  // Cursor & clear
  clearLine: '\x1b[2K\r',
  clearScreen: '\x1b[2J\x1b[3J\x1b[H',
};

export interface BootingTelemetry {
  version: string;
  providerName: string;
  providerUrl: string;
  workdir: string;
  gitBranch?: string;
  architectModel: string;
  coderModel: string;
  testerModel: string;
  verifierModel: string;
  rpmLimit: number;
  tpmLimit: number;
  concurrency: number;
}

export class TerminalUI {
  public static width(): number {
    return Math.min(process.stdout.columns || 80, 100);
  }

  /**
   * Prints the Claude Code & OpenCode inspired booting sequence.
   */
  public static printBootSequence(telemetry: BootingTelemetry): void {
    const w = TerminalUI.width();

    console.log();
    console.log(`  ${ANSI.bold}${ANSI.brightCyan}◆ NOMIN CODE${ANSI.reset}  ${ANSI.gray}v${telemetry.version}${ANSI.reset}  ${ANSI.dim}— Model-Agnostic Multi-Agent Autonomous Coding Swarm${ANSI.reset}`);
    console.log(`  ${ANSI.gray}NVIDIA NIM · OpenAI Compatible · DeepSeek · Qwen · Local vLLM/Ollama${ANSI.reset}`);
    console.log();

    // Boxed Telemetry Card
    const headerBorder = '─'.repeat(Math.max(0, w - 24));
    console.log(`  ${ANSI.gray}╭─ System Telemetry ${headerBorder}╮${ANSI.reset}`);
    console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.cyan}● Provider:${ANSI.reset}   ${telemetry.providerName} ${ANSI.dim}(${telemetry.providerUrl})${ANSI.reset}`);
    console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.cyan}● Workspace:${ANSI.reset}  ${telemetry.workdir} ${ANSI.gray}[branch: ${telemetry.gitBranch || 'main'}]${ANSI.reset}`);
    console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.cyan}● Swarm:${ANSI.reset}      4 Specialized Agents ${ANSI.dim}[Architect · Coder · Tester · Verifier]${ANSI.reset}`);
    console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.cyan}● Models:${ANSI.reset}     Architect: ${ANSI.brightCyan}${telemetry.architectModel}${ANSI.reset} | Coder: ${ANSI.brightGreen}${telemetry.coderModel}${ANSI.reset}`);
    console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.cyan}● Gateways:${ANSI.reset}   ${ANSI.green}[DoD Evidence Gate]${ANSI.reset} ${ANSI.yellow}[Grok TodoGate]${ANSI.reset} ${ANSI.blue}[PageRank RepoMap]${ANSI.reset}`);
    console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.cyan}● Limits:${ANSI.reset}     ${telemetry.rpmLimit} RPM · ${telemetry.tpmLimit.toLocaleString()} TPM · Concurrency Cap: ${telemetry.concurrency}`);
    if (isSystemDirectory(telemetry.workdir)) {
      console.log(`  ${ANSI.gray}│${ANSI.reset}`);
      console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.brightYellow}⚠️ Running in system directory. Workspace state sandboxed to ~/.nomin.${ANSI.reset}`);
      console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.brightCyan}💡 Tip: Use 'cd <path>' or start with 'nomin <path>' to work on a project.${ANSI.reset}`);
    }
    console.log(`  ${ANSI.gray}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders a system directory sandboxing tip warning.
   */
  public static renderSystemDirWarning(): void {
    console.log(`  ${ANSI.brightYellow}⚠️ Running in system directory. Workspace state sandboxed to ~/.nomin.${ANSI.reset}`);
    console.log(`  ${ANSI.brightCyan}💡 Tip: Use 'cd <path>' or start with 'nomin <path>' to work on a project.${ANSI.reset}\n`);
  }

  /**
   * Renders the dynamic directory switch card.
   */
  public static renderWorkspaceSwitchedCard(workdir: string, gitBranch: string): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 26));
    console.log();
    console.log(`  ${ANSI.gray}╭─ [WORKSPACE SWITCHED] ${border}╮${ANSI.reset}`);
    console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.cyan}● New Working Directory:${ANSI.reset} ${workdir}`);
    console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.cyan}● Active Branch:${ANSI.reset}          ${gitBranch}`);
    console.log(`  ${ANSI.gray}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    console.log();
  }

  /**
   * Renders the boxed message bar prompt header.
   */
  public static renderMessageBarHeader(): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 46));
    console.log(`  ${ANSI.gray}╭─ Message ─ ${ANSI.dim}(Enter goal or /help for commands)${ANSI.gray} ${border}╮${ANSI.reset}`);
  }

  /**
   * Renders the boxed message bar prompt footer.
   */
  public static renderMessageBarFooter(): void {
    const w = TerminalUI.width();
    const border = '─'.repeat(Math.max(0, w - 60));
    console.log(`  ${ANSI.gray}╰─ ${ANSI.dim}[Ctrl+C Exit] [/cd] [/status] [/repomap] [/models] [/config]${ANSI.gray} ${border}╯${ANSI.reset}`);
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

    if (r === 'CODER') badgeColor = ANSI.brightGreen;
    else if (r === 'TESTER') badgeColor = ANSI.brightYellow;
    else if (r === 'VERIFIER') badgeColor = ANSI.brightMagenta;
    else if (r === 'SYSTEM') badgeColor = ANSI.gray;

    const title = `[${badgeColor}${r}${ANSI.reset}${ANSI.gray} · ${ANSI.dim}${modelName}${ANSI.reset}${ANSI.gray}]`;
    const lineLen = Math.max(0, w - title.length + 10);

    console.log();
    console.log(`  ${ANSI.gray}╭─ ${title} ${'─'.repeat(lineLen)}╮${ANSI.reset}`);
    
    // Split message into indented lines
    for (const line of message.split('\n')) {
      console.log(`  ${ANSI.gray}│${ANSI.reset}  ${line}`);
    }

    if (details && details.length > 0) {
      console.log(`  ${ANSI.gray}│${ANSI.reset}`);
      for (const d of details) {
        console.log(`  ${ANSI.gray}│${ANSI.reset}  ${ANSI.dim}• ${d}${ANSI.reset}`);
      }
    }

    console.log(`  ${ANSI.gray}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
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
  public static renderVerdictCard(approved: boolean, reason: string, criteriaCount: number, evidenceCount: number): void {
    const w = TerminalUI.width();
    console.log();
    if (approved) {
      const border = '─'.repeat(Math.max(0, w - 28));
      console.log(`  ${ANSI.green}╭─ [VERIFIED & RELEASED] ${border}╮${ANSI.reset}`);
      console.log(`  ${ANSI.green}│${ANSI.reset}  ${ANSI.brightGreen}${ANSI.bold}✔ Definition-of-Done Satisfied with Physical Proof${ANSI.reset}`);
      console.log(`  ${ANSI.green}│${ANSI.reset}  ${ANSI.dim}Passed Criteria: ${criteriaCount}/${criteriaCount} | Evidence Logs: ${evidenceCount} | AST Violations: 0${ANSI.reset}`);
      console.log(`  ${ANSI.green}│${ANSI.reset}  ${reason}`);
      console.log(`  ${ANSI.green}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    } else {
      const border = '─'.repeat(Math.max(0, w - 29));
      console.log(`  ${ANSI.red}╭─ [VERIFICATION REJECTED] ${border}╮${ANSI.reset}`);
      console.log(`  ${ANSI.red}│${ANSI.reset}  ${ANSI.brightRed}${ANSI.bold}✖ Release Gate Blocked${ANSI.reset}`);
      console.log(`  ${ANSI.red}│${ANSI.reset}  ${reason}`);
      console.log(`  ${ANSI.red}╰${'─'.repeat(Math.max(0, w - 4))}╯${ANSI.reset}`);
    }
    console.log();
  }

  /**
   * Renders colored unified diffs with green additions and red deletions.
   */
  public static renderDiff(diffText: string): void {
    if (!diffText.trim()) return;

    console.log(`  ${ANSI.bold}${ANSI.dim}─── Git Diff ───────────────────────────────────────────────${ANSI.reset}`);
    for (const line of diffText.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        console.log(`  ${ANSI.bold}${line}${ANSI.reset}`);
      } else if (line.startsWith('+')) {
        console.log(`  ${ANSI.green}${line}${ANSI.reset}`);
      } else if (line.startsWith('-')) {
        console.log(`  ${ANSI.red}${line}${ANSI.reset}`);
      } else if (line.startsWith('@@')) {
        console.log(`  ${ANSI.cyan}${line}${ANSI.reset}`);
      } else {
        console.log(`  ${ANSI.gray}${line}${ANSI.reset}`);
      }
    }
    console.log(`  ${ANSI.bold}${ANSI.dim}────────────────────────────────────────────────────────────${ANSI.reset}`);
  }
}

/**
 * Backwards compatibility alias for TerminalUI.
 */
export const UI = TerminalUI;
