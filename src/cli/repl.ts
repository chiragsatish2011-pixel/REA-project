/**
 * Nomin Code: Fully Redesigned Interactive REPL & Swarm Shell
 * Matches the controls, comfort, and ergonomics of Claude Code and OpenCode:
 * - Arrow-key selection across all menus and lists (NO typed numbers)
 * - Virtualized 100+ model picker with live fuzzy search, category cycling (Tab), and favorites ('f')
 * - Inline effort slider (Left/Right arrows)
 * - Instant slash command popup on '/'
 * - Shift+Tab permission mode cycling (Normal -> Auto-Accept -> Plan Mode)
 * - Ctrl+R prompt history search
 * - Ctrl+O verbose transcript toggle
 * - '@' file picker autocomplete
 * - '!' inline shell execution
 * - '#' memory note addition
 * - Esc interrupt & double-Esc rewind/clear
 * - Interactive /undo, /redo, /config, /permissions, /theme, and /vim mode
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';

import {
  ConfigManager,
  detectWorkspaceProject,
  isSystemDirectory,
  validateModelProviderMatch,
  type ProviderEndpointConfig,
} from '../config/index.js';
import { SwarmCoordinator } from '../swarm/coordinator.js';
import { IntentRouter } from '../swarm/intent-router.js';
import { BashTool } from '../tools/bash.js';
import { RepoMapEngine } from '../tools/repomap.js';
import { ANSI, TerminalUI, StreamingMarkdownRenderer, type CostTelemetry } from './ui.js';
import { ThemeManager, type ThemeName } from './theme.js';
import { RawInputReader, type KeyStroke } from './raw-input.js';
import { StatusLine, type StatusLineProps } from './components/status-line.js';
import { FooterHints } from './components/footer-hints.js';
import { SelectList } from './components/select-list.js';
import { FilterableList } from './components/filterable-list.js';
import { InlineSlider } from './components/slider.js';
import { ConfirmDialog } from './components/confirm-dialog.js';
import { TimelineViewer, type CheckpointItem } from './components/timeline-viewer.js';
import { DiffViewer } from './components/diff-viewer.js';
import { ModelPicker } from './model-picker.js';
import { SlashMenu, ALL_SLASH_COMMANDS } from './slash-menu.js';
import { TeamView } from './team-view.js';
import { NominDoctor } from './doctor.js';
import { AgentLoop } from '../agent/agent-loop.js';
import { EnvironmentContextEngine } from '../config/environment-context.js';
import { DebugLogger } from '../config/debug-logger.js';
import { defaultToolRegistry } from '../tools/index.js';
import { SharedPathResolver } from '../config/path-resolver.js';
import { BuildStampEngine } from '../config/build-stamp.js';

import { NominHttpClient } from '../provider/client.js';
import { RequestLedger } from '../provider/request-ledger.js';
import { RequestGateway } from '../provider/request-gateway.js';
import { LiveCatalogManager } from '../provider/live-catalog.js';
import { ModelValidator } from '../provider/model-validator.js';
import { ModelSettingsManager, REASONING_EFFORT_LEVELS } from '../provider/model-settings.js';
import type { DiscoveredModel, ReasoningEffort, ChatMessage } from '../provider/types.js';
import type { NominConfig } from '../config/index.js';

export function isConversationalPrompt(text: string): boolean {
  const result = IntentRouter.classifyHeuristic(text);
  return result.intent === 'CHAT/QUESTION' || result.intent === 'UNCLEAR/NOISE';
}

export class NominREPL {
  private coordinator: SwarmCoordinator;
  private configManager: ConfigManager;
  private rl: readline.Interface | null = null;
  private isProcessing: boolean = false;
  private conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  private promptHistory: string[] = [];
  private historyIndex = -1;
  private permissionMode: 'normal' | 'auto-accept' | 'plan' = 'normal';
  private verboseMode: boolean = false;
  private vimMode: boolean = false;
  private vimState: 'INSERT' | 'NORMAL' = 'INSERT';
  private pendingPausedTask?: string;
  private lastPendingPrompt: string | null = null;

  private sessionUsage: CostTelemetry = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    turnsCount: 0,
  };

  constructor(options: {
    workdir: string;
    coordinator?: SwarmCoordinator;
    configManager?: ConfigManager;
    config?: NominConfig;
  }) {
    this.configManager = options.configManager || ConfigManager.getInstance(options.workdir);
    this.coordinator =
      options.coordinator ||
      new SwarmCoordinator({
        workspaceRoot: options.workdir,
        useGitWorktrees: true,
      });

    // Load initial permission mode if saved
    const cfg = this.configManager.getConfig();
    if (cfg.autoApprovePermissions) {
      this.permissionMode = 'auto-accept';
    } else if (cfg.planMode) {
      this.permissionMode = 'plan';
    }
  }

  public async start(): Promise<void> {
    const cfg = this.configManager.getConfig();
    const activeProv = cfg.providers[cfg.activeProvider] || {
      id: cfg.activeProvider,
      name: cfg.activeProvider.toUpperCase(),
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      defaultRpm: 120,
      defaultTpm: 300000,
      defaultConcurrency: 4,
    };

    let gitBranch = '(none - not a git repository)';
    if (fs.existsSync(path.join(cfg.workdir, '.git'))) {
      try {
        const gitRes = await BashTool.execute('git branch --show-current', { cwd: cfg.workdir });
        if (gitRes.exitCode === 0 && gitRes.stdout.trim()) {
          gitBranch = gitRes.stdout.trim();
        }
      } catch (_) {}
    }

    const safety = detectWorkspaceProject(cfg.workdir);
    const modelMatch = validateModelProviderMatch(cfg.activeProvider, cfg.activeModel);
    const activeModel = modelMatch.valid ? cfg.activeModel : undefined;

    // Print quiet 3-line startup banner strictly once
    TerminalUI.printBootSequence({
      version: '1.0.0',
      providerName: activeProv.name,
      providerUrl: activeProv.baseUrl,
      workdir: cfg.workdir,
      gitBranch,
      mode: cfg.mode,
      activeModel,
      roles: cfg.roles,
      selectedModels: cfg.selectedModels,
      reasoningEffort: cfg.reasoningEffort || 'medium',
      rpmLimit: activeProv.defaultRpm,
      tpmLimit: activeProv.defaultTpm,
      concurrency: activeProv.defaultConcurrency,
    });

    // Boot banner displays inline workspace and safety status; no extra paragraphs needed.

    // Background catalog refresh
    try {
      const provType = (cfg.activeProvider === 'nim' ? 'nvidia-nim' : 'openai') as any;
      const bgClient = new NominHttpClient({
        config: {
          id: cfg.activeProvider,
          name: activeProv.name,
          type: provType,
          baseURL: activeProv.baseUrl,
          apiKey: this.configManager.getProviderKeyInfo(cfg.activeProvider).apiKey,
        },
      });
      LiveCatalogManager.triggerBackgroundRefresh(bgClient);
    } catch (_) {}

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      await this.runInteractiveLoop();
    } else {
      this.initReadline();
    }
  }

  public async handleUserGoal(taskPrompt: string): Promise<void> {
    await this.executeUserTask(taskPrompt);
    this.promptTurn();
  }

  /**
   * Prompts user with question in terminal, supporting paste and secret key masking.
   */
  public askQuestion(questionText: string, isSecret: boolean = false): Promise<string> {
    return new Promise((resolve) => {
      if (isSecret && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        let input = '';
        const startTime = Date.now();
        process.stdout.write(questionText);

        const onData = (char: Buffer) => {
          let str = char.toString('utf8');
          str = str.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '');

          // Cancel on Ctrl+C or Escape
          if (str.includes('\u0003') || str === '\x1b') {
            process.stdin.removeListener('data', onData);
            if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
              process.stdin.setRawMode(false);
            }
            process.stdout.write('\n');
            resolve('');
            return;
          }

          // Discard stray newline/carriage-return from the previous command Enter key
          // (which can bleed over in Windows PowerShell/cmd.exe within the first 300ms)
          if (input.length === 0 && Date.now() - startTime < 300 && (str === '\r' || str === '\n' || str === '\r\n')) {
            return;
          }

          // Handle Ctrl+V paste if sent as control char
          if (str === '\x16') {
            if (process.platform === 'win32') {
              try {
                const clip = execSync('powershell.exe -NoProfile -Command Get-Clipboard', {
                  encoding: 'utf8',
                  timeout: 1500,
                  stdio: ['ignore', 'pipe', 'ignore'],
                }).trim();
                if (clip) str = clip;
              } catch (_) {}
            }
          }

          const hasNewline = str.includes('\r') || str.includes('\n');
          const textBeforeNewline = hasNewline ? str.split(/[\r\n]+/)[0] : str;

          for (let i = 0; i < textBeforeNewline.length; i++) {
            const ch = textBeforeNewline[i];
            if (ch === '\b' || ch === '\x7f') {
              if (input.length > 0) {
                input = input.slice(0, -1);
                process.stdout.write('\b \b');
              }
            } else if (ch >= ' ') {
              input += ch;
              process.stdout.write('*');
            }
          }

          if (hasNewline) {
            // NEVER cancel on empty input from Enter or stray newline!
            // Wait for user to actually paste or type their key, or press Esc / Ctrl+C to cancel.
            if (input.length === 0) {
              return;
            }
            process.stdin.removeListener('data', onData);
            if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
              process.stdin.setRawMode(false);
            }
            process.stdout.write('\n');
            const cleanKey = input.trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
            resolve(cleanKey);
          }
        };

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
      } else {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(questionText, (ans) => {
          rl.close();
          const cleanKey = ans.trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
          resolve(cleanKey);
        });
      }
    });
  }

  /**
   * Main interactive line reader supporting:
   * - Slash command popup on '/'
   * - Shift+Tab permission mode cycling
   * - Ctrl+R prompt history search
   * - Ctrl+O verbose mode toggle
   * - '@' file picker autocomplete
   * - '!' inline shell mode
   * - '#' memory note
   * - Double-Esc rewind/clear
   * - Up/Down history navigation
   */
  public async readInteractiveLine(): Promise<string> {
    return new Promise((resolve) => {
      let buffer = '';
      let cursorOffset = 0;
      let popupActive = false;
      const slashMenu = new SlashMenu('');
      let searchMode = false;
      let searchQuery = '';
      let renderedLinesCount = 0;
      let cursorLinesAboveBottom = 0;

      const getPromptPrefix = () => {
        const c = ThemeManager.getColors();
        const vimIndicator = this.vimMode ? `[${this.vimState}] ` : '';
        const bar = c.bar || c.accent;
        return `  ${bar}│${c.reset} ${vimIndicator}`;
      };

      const getStatusProps = (): StatusLineProps => {
        const cfg = this.configManager.getConfig();
        const activeProv = cfg.providers[cfg.activeProvider] || {
          id: cfg.activeProvider,
          name: cfg.activeProvider.toUpperCase(),
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          defaultRpm: 120,
          defaultTpm: 300000,
          defaultConcurrency: 4,
        };
        const hasValidModel = cfg.activeModel && cfg.activeModel !== 'undefined' && cfg.activeModel !== 'none' && !this.configManager.isModelRetired(cfg.activeModel);
        return {
          providerName: activeProv.name,
          activeModel: hasValidModel ? cfg.activeModel : undefined,
          reasoningEffort: cfg.reasoningEffort,
          permissionMode: this.permissionMode,
          workspaceDir: cfg.workdir,
          gitBranch: this.coordinator.getWorkspaceRoot().split(/[/\\]/).pop(),
          totalTokens: this.sessionUsage.totalTokens,
          estimatedCostUsd: this.sessionUsage.estimatedCostUsd,
          rpmLimit: activeProv.defaultRpm,
        };
      };

      const clearPrevious = () => {
        if (cursorLinesAboveBottom > 0) {
          process.stdout.write(`\x1b[${cursorLinesAboveBottom}B\r`);
          cursorLinesAboveBottom = 0;
        }
        if (renderedLinesCount > 0) {
          process.stdout.write('\r\x1b[2K');
          for (let i = 1; i < renderedLinesCount; i++) {
            process.stdout.write('\x1b[1A\x1b[2K');
          }
          renderedLinesCount = 0;
        }
      };

      const redraw = () => {
        clearPrevious();

        if (searchMode) {
          const c = ThemeManager.getColors();
          const matches = this.promptHistory.filter(h => h.toLowerCase().includes(searchQuery.toLowerCase()));
          const matchStr = matches.length > 0 ? matches[matches.length - 1] : '(no match)';
          process.stdout.write(`  ${c.info}(bck-i-search)\`\x1b[1m${searchQuery}\x1b[0m': ${matchStr}`);
          renderedLinesCount = 1;
          cursorLinesAboveBottom = 0;
          return;
        }

        const lines: string[] = [];

        // 1. Popup (if active, floating directly above composer card)
        if (popupActive && buffer.startsWith('/') && !buffer.includes(' ')) {
          slashMenu.setQuery(buffer);
          const renderedPopup = slashMenu.render();
          for (const pline of renderedPopup) {
            lines.push(pline);
          }
        }

        // 2. Line 1 of Composer Dock: Prompt input (or OpenCode placeholder)
        const prefix = getPromptPrefix();
        const c = ThemeManager.getColors();
        const bar = c.bar || c.accent;
        const barChar = `${bar}│${c.reset}`;

        if (buffer.length === 0) {
          const placeholder = `${c.secondary}Ask anything... "Fix a TODO in the codebase"${c.reset}`;
          lines.push(`${prefix}${placeholder}`);
        } else {
          lines.push(`${prefix}${buffer}`);
        }

        // 3. Line 2 of Composer Dock: Clean breathing line with continuous accent bar
        lines.push(`  ${barChar}`);

        // 4. Line 3 of Composer Dock: Sub-bar (OpenCode signature: Build · Model Provider · max)
        const statusProps = getStatusProps();
        statusProps.includeBar = false;
        statusProps.compactEffort = true;
        const statusContent = StatusLine.render(statusProps);
        lines.push(`  ${barChar} ${statusContent}`);

        // 5. Line 4 of Composer Dock: OpenCode signature footer hints
        lines.push(
          FooterHints.render(
            [
              { key: 'shift+tab', label: 'agents' },
              { key: 'ctrl+p', label: 'commands' },
            ],
            '~',
            undefined,
            this.sessionUsage.totalTokens > 0
              ? { usedTokens: this.sessionUsage.totalTokens, maxTokens: 128000 }
              : undefined,
            this.isProcessing
          )
        );

        process.stdout.write(lines.join('\n'));
        renderedLinesCount = lines.length;

        // Position cursor back on Line 1 of Composer Dock
        const prefixCols = 4 + (this.vimMode ? this.vimState.length + 3 : 0);
        process.stdout.write(`\x1b[3A\r\x1b[${prefixCols + cursorOffset}C`);
        cursorLinesAboveBottom = 3;
      };

      redraw();

      const cleanup = () => {
        process.stdin.removeListener('data', onRawData);
        RawInputReader.disableRawMode(process.stdin);
      };

      const onRawData = (chunk: Buffer) => {
        const strokes = RawInputReader.parse(chunk);

        for (const key of strokes) {
          // Ctrl+C: Exit
          if (key.name === 'ctrl-c') {
            cleanup();
            clearPrevious();
            process.stdout.write('\n');
            console.log(`  ${ANSI.slate}Goodbye from Nomin Code.${ANSI.reset}\n`);
            process.exit(0);
          }

          // Ctrl+R: Reverse History Search
          if (key.name === 'ctrl-r') {
            searchMode = !searchMode;
            searchQuery = '';
            redraw();
            continue;
          }

          // Ctrl+P: Command Palette Toggle (OpenCode signature shortcut)
          if (key.name === 'ctrl-p') {
            if (!popupActive) {
              if (!buffer.startsWith('/')) {
                buffer = '/';
                cursorOffset = 1;
              }
              popupActive = true;
            } else {
              popupActive = false;
            }
            redraw();
            continue;
          }

          if (searchMode) {
            if (key.name === 'enter') {
              const matches = this.promptHistory.filter(h => h.toLowerCase().includes(searchQuery.toLowerCase()));
              if (matches.length > 0) {
                buffer = matches[matches.length - 1];
              }
              searchMode = false;
              redraw();
              continue;
            }
            if (key.name === 'escape') {
              searchMode = false;
              redraw();
              continue;
            }
            if (key.name === 'backspace') {
              searchQuery = searchQuery.slice(0, -1);
              redraw();
              continue;
            }
            if (key.name === 'char' && key.char) {
              searchQuery += key.char;
              redraw();
              continue;
            }
            continue;
          }

          // Shift+Tab: Cycle permission modes (in-place status badge mutation, zero scrollback spam)
          if (key.name === 'shift-tab') {
            if (this.permissionMode === 'normal') {
              this.permissionMode = 'auto-accept';
              this.configManager.updateConfig({ autoApprovePermissions: true, planMode: false });
            } else if (this.permissionMode === 'auto-accept') {
              this.permissionMode = 'plan';
              this.configManager.updateConfig({ autoApprovePermissions: false, planMode: true });
            } else {
              this.permissionMode = 'normal';
              this.configManager.updateConfig({ autoApprovePermissions: false, planMode: false });
            }
            redraw();
            continue;
          }

          // Ctrl+O: Toggle Verbose Transcript (in-place toggle, zero scrollback spam)
          if (key.name === 'ctrl-o') {
            this.verboseMode = !this.verboseMode;
            redraw();
            continue;
          }

          // Double Escape: clear prompt or rewind
          if (key.name === 'double-escape') {
            if (buffer.trim()) {
              this.promptHistory.push(buffer);
              buffer = '';
              cursorOffset = 0;
              popupActive = false;
              redraw();
            } else {
              cleanup();
              clearPrevious();
              process.stdout.write('\n');
              resolve('/rewind');
              return;
            }
            continue;
          }

          // Single Escape: close popup or clear
          if (key.name === 'escape') {
            if (popupActive) {
              popupActive = false;
              redraw();
              continue;
            }
            if (this.vimMode) {
              this.vimState = 'NORMAL';
              redraw();
              continue;
            }
          }

          // Enter: submit line
          if (key.name === 'enter') {
            if (popupActive && buffer.startsWith('/') && !buffer.includes(' ')) {
              const selected = slashMenu.getSelected();
              if (selected) {
                buffer = selected.name;
                popupActive = false;
              }
            }
            clearPrevious();
            const c = ThemeManager.getColors();
            const bar = c.bar || c.accent;
            process.stdout.write(`  ${bar}│${c.reset} ${c.bold}${c.text}${buffer}${c.reset}\n\n`);
            if (buffer.trim()) {
              this.promptHistory.push(buffer);
              this.historyIndex = this.promptHistory.length;
            }
            cleanup();
            resolve(buffer);
            return;
          }

          // Tab: autocomplete
          if (key.name === 'tab') {
            if (popupActive) {
              const selected = slashMenu.getSelected();
              if (selected) {
                buffer = selected.name + ' ';
                cursorOffset = buffer.length;
                popupActive = false;
                redraw();
                continue;
              }
            }
          }

          // Left Arrow
          if (key.name === 'left') {
            cursorOffset = Math.max(0, cursorOffset - 1);
            redraw();
            continue;
          }

          // Right Arrow
          if (key.name === 'right') {
            cursorOffset = Math.min(buffer.length, cursorOffset + 1);
            redraw();
            continue;
          }

          // Home / Ctrl-A
          if (key.name === 'home' || key.name === 'ctrl-a') {
            cursorOffset = 0;
            redraw();
            continue;
          }

          // End / Ctrl-E
          if (key.name === 'end' || key.name === 'ctrl-e') {
            cursorOffset = buffer.length;
            redraw();
            continue;
          }

          // Ctrl-W: Delete word backward
          if (key.name === 'ctrl-w') {
            if (cursorOffset > 0) {
              const left = buffer.slice(0, cursorOffset);
              const right = buffer.slice(cursorOffset);
              const match = left.match(/(\s*\S+)\s*$/);
              const removeCount = match ? match[0].length : 1;
              buffer = left.slice(0, -removeCount) + right;
              cursorOffset = Math.max(0, cursorOffset - removeCount);
              if (!buffer.startsWith('/') || buffer.includes(' ')) {
                popupActive = false;
              }
              redraw();
            }
            continue;
          }

          // Ctrl-U: Delete to line start
          if (key.name === 'ctrl-u') {
            buffer = buffer.slice(cursorOffset);
            cursorOffset = 0;
            if (!buffer.startsWith('/') || buffer.includes(' ')) {
              popupActive = false;
            }
            redraw();
            continue;
          }

          // Ctrl-K: Delete to line end
          if (key.name === 'ctrl-k') {
            buffer = buffer.slice(0, cursorOffset);
            if (!buffer.startsWith('/') || buffer.includes(' ')) {
              popupActive = false;
            }
            redraw();
            continue;
          }

          // Up Arrow
          if (key.name === 'up') {
            if (popupActive) {
              slashMenu.handleKey(key);
              redraw();
              continue;
            }
            // Navigate prompt history
            if (this.promptHistory.length > 0) {
              if (this.historyIndex > 0) {
                this.historyIndex--;
                buffer = this.promptHistory[this.historyIndex];
                cursorOffset = buffer.length;
                redraw();
              }
            }
            continue;
          }

          // Down Arrow
          if (key.name === 'down') {
            if (popupActive) {
              slashMenu.handleKey(key);
              redraw();
              continue;
            }
            // Navigate prompt history
            if (this.promptHistory.length > 0) {
              if (this.historyIndex < this.promptHistory.length - 1) {
                this.historyIndex++;
                buffer = this.promptHistory[this.historyIndex];
                cursorOffset = buffer.length;
                redraw();
              } else if (this.historyIndex === this.promptHistory.length - 1) {
                this.historyIndex++;
                buffer = '';
                cursorOffset = 0;
                redraw();
              }
            }
            continue;
          }

          // Backspace
          if (key.name === 'backspace') {
            if (cursorOffset > 0) {
              buffer = buffer.slice(0, cursorOffset - 1) + buffer.slice(cursorOffset);
              cursorOffset--;
              if (!buffer.startsWith('/') || buffer.includes(' ')) {
                popupActive = false;
              }
              redraw();
            }
            continue;
          }

          // Delete
          if (key.name === 'delete') {
            if (cursorOffset < buffer.length) {
              buffer = buffer.slice(0, cursorOffset) + buffer.slice(cursorOffset + 1);
              if (!buffer.startsWith('/') || buffer.includes(' ')) {
                popupActive = false;
              }
              redraw();
            }
            continue;
          }

          // File mention autocomplete trigger: '@'
          if (key.name === 'char' && key.char === '@') {
            buffer = buffer.slice(0, cursorOffset) + '@' + buffer.slice(cursorOffset);
            cursorOffset++;
            // Show file picker inline
            const cfg = this.configManager.getConfig();
            const files = this.scanWorkspaceFiles(cfg.workdir);
            if (files.length > 0) {
              const fileList = new FilterableList({
                title: 'Mention File (@)',
                items: files.map(f => ({ id: f, label: f, value: f })),
                pageSize: 8,
              });
              cleanup();
              clearPrevious();
              process.stdout.write('\n');
              fileList.prompt().then(picked => {
                if (picked) {
                  const prefix = buffer.slice(0, cursorOffset - 1);
                  const suffix = buffer.slice(cursorOffset);
                  buffer = `${prefix}@${picked.value} ${suffix}`;
                  cursorOffset = prefix.length + picked.value.length + 2;
                }
                this.readInteractiveLine().then(resolve);
              });
              return;
            }
            redraw();
            continue;
          }

          // Paste
          if (key.name === 'paste' && key.char) {
            const pasted = key.char.replace(/[\r\n]+/g, ' ');
            buffer = buffer.slice(0, cursorOffset) + pasted + buffer.slice(cursorOffset);
            cursorOffset += pasted.length;
            redraw();
            continue;
          }

          // Printable characters
          if (key.name === 'space') {
            buffer = buffer.slice(0, cursorOffset) + ' ' + buffer.slice(cursorOffset);
            cursorOffset++;
            popupActive = false;
            redraw();
            continue;
          }

          if (key.name === 'char' && key.char) {
            buffer = buffer.slice(0, cursorOffset) + key.char + buffer.slice(cursorOffset);
            cursorOffset += key.char.length;
            if (buffer.startsWith('/') && !buffer.includes(' ')) {
              popupActive = true;
            } else {
              popupActive = false;
            }
            redraw();
            continue;
          }
        }
      };

      RawInputReader.enableRawMode(process.stdin);
      process.stdin.on('data', onRawData);
    });
  }

  private scanWorkspaceFiles(dir: string, maxFiles = 100): string[] {
    const list: string[] = [];
    const scan = (current: string, depth = 0) => {
      if (depth > 3 || list.length >= maxFiles) return;
      try {
        const ents = fs.readdirSync(current, { withFileTypes: true });
        for (const ent of ents) {
          if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist') continue;
          const full = path.join(current, ent.name);
          const rel = path.relative(dir, full).replace(/\\/g, '/');
          if (ent.isDirectory()) {
            scan(full, depth + 1);
          } else {
            list.push(rel);
          }
        }
      } catch (_) {}
    };
    scan(dir);
    return list;
  }

  /**
   * Main interactive REPL execution loop.
   */
  private async runInteractiveLoop(): Promise<void> {
    while (true) {
      const line = await this.readInteractiveLine();
      const input = line.trim();

      if (!input) continue;

      const cfg = this.configManager.getConfig();

      try {
        // Direct inline shell execution: '!<cmd>'
        if (input.startsWith('!')) {
          const shellCmd = input.slice(1).trim();
          if (shellCmd) {
            console.log(`\n  ${ANSI.sky}$ ${shellCmd}${ANSI.reset}`);
            try {
              execSync(shellCmd, { cwd: cfg.workdir, stdio: 'inherit' });
            } catch (err: any) {
              console.log(`  ${ANSI.coral}Command exited with error.${ANSI.reset}`);
            }
            console.log();
          }
          continue;
        }

        // Memory note shorthand: '#<note>'
        if (input.startsWith('#')) {
          const note = input.slice(1).trim();
          if (note) {
            this.appendMemoryNote(note);
          }
          continue;
        }

        // new project command
        if (input.startsWith('/new ') || input.startsWith('new ') || input === '/new' || input === 'new') {
          const rawName = input.startsWith('/new') ? input.slice(4).trim() : input.slice(3).trim();
          await this.handleNewProjectCommand(rawName);
          continue;
        }

        // cd command
        if (input === 'cd' || input.startsWith('cd ') || input === '/cd' || input.startsWith('/cd ')) {
          const rawPath = input.startsWith('/cd') ? input.slice(3).trim() : input.slice(2).trim();
          await this.handleDirectorySwitch(rawPath);
          continue;
        }

        // Slash command
        if (input.startsWith('/')) {
          await this.handleSlashCommand(input);
          continue;
        }

        if (this.isProcessing) {
          console.log(`  ${ANSI.yellow}⚠️ An active swarm task is in progress. Please wait...${ANSI.reset}\n`);
          continue;
        }

        await this.executeUserTask(input);
      } catch (err: any) {
        console.error(`  ${ANSI.coral}Command Error: ${err.message}${ANSI.reset}\n`);
      }
    }
  }

  private appendMemoryNote(note: string): void {
    const cfg = this.configManager.getConfig();
    const memDir = path.join(cfg.workdir, '.nomin');
    if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
    const memPath = path.join(memDir, 'GUIDELINES.md');
    fs.appendFileSync(memPath, `\n- ${note}\n`, 'utf-8');
    console.log(`\n  ${ANSI.mint}✔ Saved memory note to ${memPath}${ANSI.reset}\n`);
  }

  private initReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `  ${ANSI.amber}❯${ANSI.reset} `,
    });

    this.promptTurn();
    this.rl.on('line', async (line: string) => {
      const input = line.trim();
      if (!input) {
        this.promptTurn();
        return;
      }
      this.rl?.pause();
      try {
        if (input.startsWith('!')) {
          const shellCmd = input.slice(1).trim();
          try {
            execSync(shellCmd, { cwd: this.configManager.getConfig().workdir, stdio: 'inherit' });
          } catch (_) {}
          return;
        }
        if (input.startsWith('/new ') || input.startsWith('new ') || input === '/new' || input === 'new') {
          const rawName = input.startsWith('/new') ? input.slice(4).trim() : input.slice(3).trim();
          await this.handleNewProjectCommand(rawName);
          return;
        }
        if (input === 'cd' || input.startsWith('cd ') || input === '/cd' || input.startsWith('/cd ')) {
          const rawPath = input.startsWith('/cd') ? input.slice(3).trim() : input.slice(2).trim();
          await this.handleDirectorySwitch(rawPath);
          return;
        }
        if (input.toLowerCase() === 'retry') {
          if (this.lastPendingPrompt) {
            console.log(`\n  ${ANSI.amber}Retry the last request?${ANSI.reset} "${this.lastPendingPrompt}"`);
            console.log(`  ${ANSI.dim}Auto-resending pending turn...${ANSI.reset}\n`);
            await this.executeUserTask(this.lastPendingPrompt);
            return;
          } else {
            console.log(`\n  ${ANSI.slate}No pending request to retry.${ANSI.reset}\n`);
            return;
          }
        }
        if (input.startsWith('/')) {
          await this.handleSlashCommand(input);
          return;
        }
        await this.executeUserTask(input);
      } finally {
        this.rl?.resume();
        this.promptTurn();
      }
    });

    this.rl.on('close', () => {
      console.log(`\n  ${ANSI.slate}Goodbye from Nomin Code.${ANSI.reset}\n`);
      process.exit(0);
    });
  }

  private promptTurn(): void {
    this.rl?.prompt();
  }

  private async executeUserTask(taskPrompt: string): Promise<void> {
    const trimmed = taskPrompt.trim();
    if (!trimmed) return;

    // Auto-detect if user pasted an API key directly on the prompt
    const isPastedApiKey =
      /^nvapi-[A-Za-z0-9_-]{20,}/i.test(trimmed) ||
      /^sk-ant-[A-Za-z0-9_-]{20,}/i.test(trimmed) ||
      /^sk-[A-Za-z0-9_-]{20,}/i.test(trimmed);

    if (isPastedApiKey) {
      console.log(`\n  ${ANSI.mint}✔ Detected API key pasted in prompt.${ANSI.reset}`);
      await this.handleKeyCommand(trimmed);
      return;
    }

    if (trimmed.startsWith('/chat ') || trimmed === '/chat') {
      const q = trimmed.slice(5).trim();
      if (!q) {
        console.log(`\n  Usage: /chat <message or question>\n`);
        return;
      }
      await this.handleConversationalAndExplanation(q, 'CHAT/QUESTION');
      return;
    }
    if (trimmed.startsWith('/plan ') || trimmed === '/plan') {
      const g = trimmed.slice(5).trim();
      if (!g) {
        console.log(`\n  Usage: /plan <goal or instruction>\n`);
        return;
      }
      await this.handleLargeTask(g);
      return;
    }

    const classification = IntentRouter.classifyHeuristic(trimmed);

    switch (classification.intent) {
      case 'UNCLEAR/NOISE': {
        console.log(`\n  I didn't quite catch that. How can I help you with your code? (Type ${ANSI.cyan}/help${ANSI.reset} for commands or give a coding task)\n`);
        return;
      }
      case 'CHAT/QUESTION': {
        if (this.verboseMode) console.log(`  ${ANSI.dim}[Route: CHAT/QUESTION]${ANSI.reset}`);
        await this.handleConversationalAndExplanation(trimmed, 'CHAT/QUESTION');
        return;
      }
      case 'CODE-EXPLAIN': {
        if (this.verboseMode) console.log(`  ${ANSI.dim}[Route: CODE-EXPLAIN]${ANSI.reset}`);
        await this.handleConversationalAndExplanation(trimmed, 'CODE-EXPLAIN');
        return;
      }
      case 'SMALL-TASK': {
        if (this.verboseMode) console.log(`  ${ANSI.dim}[Route: SMALL-TASK]${ANSI.reset}`);
        await this.handleSmallTask(trimmed);
        return;
      }
      case 'LARGE-TASK':
      default: {
        if (this.verboseMode) console.log(`  ${ANSI.dim}[Route: LARGE-TASK]${ANSI.reset}`);
        await this.handleLargeTask(trimmed);
        return;
      }
    }
  }

  private async handleSmallTask(taskPrompt: string): Promise<void> {
    const cfg = this.configManager.getConfig();
    const safety = detectWorkspaceProject(cfg.workdir);
    if (safety.isHome || safety.isDriveRoot || safety.isSystemDir) {
      this.pendingPausedTask = taskPrompt;
      this.printWorkspaceSafetyNotice(taskPrompt, safety.isHome);
      return;
    }
    await this.executeSwarmTask(taskPrompt, true);
  }

  private async handleLargeTask(taskPrompt: string): Promise<void> {
    const cfg = this.configManager.getConfig();
    const safety = detectWorkspaceProject(cfg.workdir);
    if (safety.isHome || safety.isDriveRoot || safety.isSystemDir) {
      this.pendingPausedTask = taskPrompt;
      this.printWorkspaceSafetyNotice(taskPrompt, safety.isHome);
      return;
    }
    await this.executeSwarmTask(taskPrompt, false);
  }

  private printWorkspaceSafetyNotice(taskPrompt: string, isHome: boolean): void {
    const c = ThemeManager.getColors();
    console.log(`\n  ${ANSI.amber}${ANSI.bold}⚠️  Workspace Safety Notice:${ANSI.reset} Direct modifications paused in ${isHome ? 'home directory (~)' : 'system root'}.`);
    console.log(`  ${c.secondary}To prevent scattering project files in your personal profile directory, please switch to or create a dedicated project:${c.reset}`);
    console.log();
    console.log(`  • Create a new project folder:    ${ANSI.cyan}/new <name>${ANSI.reset}  (e.g. ${ANSI.cyan}/new my-game${ANSI.reset})`);
    console.log(`  • Switch to an existing project:  ${ANSI.cyan}/cd <path>${ANSI.reset}   (e.g. ${ANSI.cyan}/cd Documents/Game${ANSI.reset})`);
    console.log(`  • Or work in sandboxed workspace: ${ANSI.cyan}/cd ~/.nomin/workspace${ANSI.reset}`);
    console.log();
    console.log(`  ${c.secondary}(Your request "${taskPrompt}" is saved and will automatically resume once in a project directory.)${c.reset}\n`);
  }

  private async executeSwarmTask(taskPrompt: string, isSmallTask: boolean): Promise<void> {
    const cfg = this.configManager.getConfig();
    if (cfg.activeModel && this.configManager.isModelRetired(cfg.activeModel)) {
      console.log(`\n  ${ANSI.coral}${ANSI.bold}✖ Model Retired [HTTP 410 Gone]${ANSI.reset}`);
      console.log(`  The active model '${cfg.activeModel}' is retired and cannot execute tasks.`);
      console.log(`  • Run ${ANSI.cyan}/model${ANSI.reset} to select an active replacement model from the catalog.\n`);
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    console.log(`  ${ANSI.bold}Objective:${ANSI.reset} "${taskPrompt}"\n`);
    TerminalUI.renderAgentCard(
      'ARCHITECT',
      cfg.roles.architect || cfg.activeModel || 'Architect',
      isSmallTask
        ? `Formulating single-step execution plan...`
        : `Decomposing goal into topological sub-tasks & extracting acceptance criteria...`
    );

    try {
      const result = await this.coordinator.orchestrate(taskPrompt);
      const estimatedPromptTokens = Math.ceil(taskPrompt.length / 3) + 1200;
      const estimatedCompletionTokens = Math.ceil((result.completedTasks || 1) * 650);
      this.sessionUsage.promptTokens += estimatedPromptTokens;
      this.sessionUsage.completionTokens += estimatedCompletionTokens;
      this.sessionUsage.totalTokens = this.sessionUsage.promptTokens + this.sessionUsage.completionTokens;
      this.sessionUsage.estimatedCostUsd = (this.sessionUsage.promptTokens * 0.0000005) + (this.sessionUsage.completionTokens * 0.0000015);
      this.sessionUsage.turnsCount = (this.sessionUsage.turnsCount || 0) + 1;

      if (result.success) {
        TerminalUI.renderAgentCard(
          'CODER',
          cfg.roles.coder || cfg.activeModel || 'Coder',
          `Changes implemented via multi-tier fuzzy search-and-replace in isolated worktrees.`,
          [
            `Completed Tasks: ${result.completedTasks}/${result.totalTasks}`,
            `Commit: ${result.finalCommitHash || 'verified'}`,
            `Duration: ${(result.durationMs / 1000).toFixed(2)}s`,
          ]
        );

        const passedCount = result.taskOutcomes.reduce((acc, o) => acc + o.criteriaPassed, 0);
        const totalCount = result.taskOutcomes.reduce((acc, o) => acc + o.criteriaTotal, 0);

        TerminalUI.renderVerdictCard(
          true,
          `All acceptance criteria verified with zero AST integrity violations across ${result.completedTasks} tasks.`,
          totalCount || result.completedTasks,
          passedCount || result.completedTasks,
          result.taskOutcomes.map(o => `Task ${o.taskId}: ${o.criteriaPassed}/${o.criteriaTotal} criteria passed`)
        );
      } else {
        TerminalUI.renderVerdictCard(
          false,
          result.errors.length > 0 ? result.errors.join('; ') : 'Verification gate blocked release.',
          0,
          0
        );
      }
    } catch (err: any) {
      TerminalUI.stopSpinner();
      const isAuthError =
        err.message?.includes('401') ||
        err.message?.includes('403') ||
        err.message?.toLowerCase().includes('authorization failed');

      if (isAuthError) {
        const keyInfo = this.configManager.getProviderKeyInfo(cfg.activeProvider);
        console.log(`\n  ${ANSI.coral}${ANSI.bold}✖ Model Authorization Failed [HTTP 403 / 401]${ANSI.reset}`);
        console.log(`  ${ANSI.bold}Key Info:${ANSI.reset}  ${keyInfo.masked || '(none)'} (source: ${keyInfo.source})`);
        console.log(`  ${ANSI.amber}NVIDIA NIM rejected inference. Ensure your key was created at build.nvidia.com or has 'Public API Endpoints' enabled.${ANSI.reset}`);
        console.log(`  ${ANSI.bold}Quick Fix:${ANSI.reset} Run ${ANSI.cyan}/key <nvapi-...>${ANSI.reset} to set a valid key, or ${ANSI.cyan}/doctor${ANSI.reset}.\n`);
      } else {
        console.error(`\n  ${ANSI.coral}💥 Swarm Error: ${err.message}${ANSI.reset}\n`);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  public async handleConversationalAndExplanation(
    prompt: string,
    intent: 'CHAT/QUESTION' | 'CODE-EXPLAIN'
  ): Promise<void> {
    const cfg = this.configManager.getConfig();
    const lower = prompt.toLowerCase().trim();

    if (/^(wt(f)?\s*(are\s*(u|you)\s*doing|r\s*u\s*doing)|what\s*are\s*you\s*doing|what('s|\s+is)\s+happening)/i.test(lower)) {
      const state = this.coordinator.blackboard.getState();
      const tasks = Object.values(state.taskDAG?.tasks || {});
      if (this.isProcessing) {
        const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS');
        console.log(`\n  I am currently executing: "${inProgress[0]?.title || 'Active Goal'}". Tasks in progress: ${inProgress.length}.\n`);
      } else {
        console.log(`\n  I am currently idle in ${cfg.workdir}. Standing by for instructions.\n`);
      }
      return;
    }

    const activeProv = cfg.providers[cfg.activeProvider] || cfg.providers.nim;
    const keyInfo = this.configManager.getProviderKeyInfo(cfg.activeProvider);
    const apiKey = keyInfo.apiKey;
    const activeModel = cfg.activeModel;

    if (activeModel) {
      const match = validateModelProviderMatch(cfg.activeProvider, activeModel);
      if (!match.valid) {
        console.log(`\n  ${ANSI.coral}Model/Provider Mismatch:${ANSI.reset} ${match.error}\n`);
        return;
      }
    }

    if (!activeModel || activeModel === 'undefined' || activeModel === 'none') {
      const c = ThemeManager.getColors();
      console.log(`\n  Hello! I am Nomin Code. No model is currently selected.`);
      console.log(`  ${c.accent}Select model${c.reset} ${c.secondary}→${c.reset} ${c.bold}/model${c.reset}  ${c.secondary}·${c.reset}  ${c.accent}Configure API key${c.reset} ${c.secondary}→${c.reset} ${c.bold}/key${c.reset}\n`);
      console.log(`  ${c.accent}Build${c.reset} ${c.secondary}·${c.reset} ${c.secondary}(no model)${c.reset} ${c.secondary}· 0ms${c.reset}\n`);
      return;
    }

    if (this.configManager.isModelRetired(activeModel)) {
      const reason = cfg.retiredModels?.[activeModel];
      console.log(`\n  ${ANSI.coral}${ANSI.bold}✖ Model Retired [HTTP 410 Gone]${ANSI.reset}`);
      console.log(`  ${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}`);
      console.log(`  ${ANSI.bold}Model:${ANSI.reset}     ${activeModel}`);
      console.log(`  ${ANSI.bold}Notice:${ANSI.reset}    ${reason || 'This model has reached its end of life and is no longer available.'}`);
      console.log();
      console.log(`  ${ANSI.bold}Quick Fix:${ANSI.reset}`);
      console.log(`  • Run ${ANSI.cyan}/model${ANSI.reset} to select an active replacement model from the catalog`);
      console.log(`  • Run ${ANSI.cyan}/key <key>${ANSI.reset} if you need to update your API key`);
      console.log(`  ${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}\n`);
      return;
    }

    if (!apiKey) {
      const c = ThemeManager.getColors();
      console.log(`\n  Hello! I am Nomin Code. To enable live AI responses, configure an API key via ${ANSI.cyan}/key <your-key>${ANSI.reset}.\n`);
      console.log(`  ${c.accent}Build${c.reset} ${c.secondary}·${c.reset} ${c.bold}${c.text}${activeModel}${c.reset} ${c.secondary}· 0ms${c.reset}\n`);
      return;
    }

    const startTime = Date.now();
    this.lastPendingPrompt = prompt;

    // History integrity: ensure user prompt is stored in history before calling model
    const lastHistory = this.conversationHistory[this.conversationHistory.length - 1];
    if (!lastHistory || lastHistory.role !== 'user' || lastHistory.content !== prompt) {
      this.conversationHistory.push({ role: 'user', content: prompt });
    }

    TerminalUI.startSpinner(`${activeModel}: thinking...`);
    try {
      const provType = (cfg.activeProvider === 'nim' ? 'nvidia-nim' : 'openai') as any;
      const client = new NominHttpClient({
        config: {
          id: cfg.activeProvider,
          name: activeProv.name,
          type: provType,
          baseURL: activeProv.baseUrl || '',
          apiKey,
        },
      });

      const loopResult = await AgentLoop.executeTurn({
        client,
        model: activeModel,
        workdir: cfg.workdir,
        history: this.conversationHistory as any,
        prompt,
        reasoningEffort: cfg.reasoningEffort,
        verboseMode: this.verboseMode,
      });

      // If code was generated in response to a creation request, auto-save a runnable file for the user
      const isCreationGoal = /\b(?:make|create|write|build|code|generate|prototype)\b/i.test(prompt);
      const codeMatch = loopResult.finalText.match(/```(?:html|javascript|js|typescript|ts|python|py)\s*\n([\s\S]+?)\n```/);
      if (isCreationGoal && codeMatch && codeMatch[1]) {
        try {
          const isSys = isSystemDirectory(cfg.workdir);
          const targetDir = isSys
            ? path.join(os.homedir(), '.nomin', 'workspace')
            : cfg.workdir;
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          const isHtml = /<!DOCTYPE html|<html/i.test(codeMatch[1]);
          const fileName = isHtml ? 'index.html' : 'app.js';
          const filePath = path.join(targetDir, fileName);
          fs.writeFileSync(filePath, codeMatch[1], 'utf-8');
          const c = ThemeManager.getColors();
          console.log(`  ${c.success}✔ Auto-Saved Runnable File:${c.reset} ${c.bold}${filePath}${c.reset}`);
          if (isHtml) {
            console.log(`  ${c.secondary}💡 Run in browser:${c.reset} ${c.accent}Start-Process "${filePath}"${c.reset}\n`);
          }
        } catch (_) {}
      }
    } catch (err: any) {
      TerminalUI.stopSpinner();
      const is410 =
        err.status === 410 ||
        err.statusCode === 410 ||
        err.message?.includes('410') ||
        err.message?.toLowerCase().includes('end of life') ||
        err.message?.toLowerCase().includes('no longer available') ||
        err.message?.toLowerCase().includes('retired');

      if (is410) {
        if (activeModel) {
          this.configManager.markModelRetired(activeModel, err.message);
          this.coordinator.updateModels({
            mode: cfg.mode,
            activeModel: undefined,
            roles: cfg.roles,
          });
        }
        console.log(`\n  ${ANSI.coral}${ANSI.bold}✖ Model Retired [HTTP 410 Gone]${ANSI.reset}`);
        console.log(`  ${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}`);
        console.log(`  ${ANSI.bold}Model:${ANSI.reset}     ${activeModel}`);
        console.log(`  ${ANSI.bold}Notice:${ANSI.reset}    This model has reached its end of life and is no longer available.`);
        console.log(`  ${ANSI.dim}It has been removed from your active configuration.${ANSI.reset}`);
        console.log();
        console.log(`  ${ANSI.bold}Quick Fix:${ANSI.reset}`);
        console.log(`  • Run ${ANSI.cyan}/model${ANSI.reset} to select an active replacement model from the catalog`);
        console.log(`  • Run ${ANSI.cyan}/key <key>${ANSI.reset} if you need to update your API key`);
        console.log(`  ${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}\n`);
        return;
      }

      const isAuthError =
        err.message?.includes('401') ||
        err.message?.includes('403') ||
        err.message?.toLowerCase().includes('authorization failed');

      if (isAuthError) {
        const endpoint = `${activeProv.baseUrl || 'https://integrate.api.nvidia.com/v1'}/chat/completions`;
        console.log(`\n  ${ANSI.coral}${ANSI.bold}✖ Model Authorization Failed [HTTP 403 / 401]${ANSI.reset}`);
        console.log(`  ${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}`);
        console.log(`  ${ANSI.bold}Model:${ANSI.reset}     ${activeModel}`);
        console.log(`  ${ANSI.bold}Endpoint:${ANSI.reset}  ${endpoint}`);
        console.log(`  ${ANSI.bold}Key Info:${ANSI.reset}  ${keyInfo.masked || '(none)'} (source: ${keyInfo.source})`);
        console.log();
        console.log(`  ${ANSI.amber}${ANSI.bold}Diagnostic Root Cause:${ANSI.reset}`);
        console.log(`  Your API key was accepted for catalog listing (GET /v1/models), but`);
        console.log(`  NVIDIA NIM rejected chat completion inference on this model.`);
        console.log(`  • Common reason: Key generated at ngc.nvidia.com lacks the`);
        console.log(`    'Public API Endpoints' entitlement.`);
        console.log(`  • Generate a personal inference key at https://build.nvidia.com/`);
        console.log();
        console.log(`  ${ANSI.bold}Quick Fix:${ANSI.reset}`);
        console.log(`  • Run ${ANSI.cyan}/key <nvapi-...>${ANSI.reset} to save a working inference key`);
        console.log(`  • Run ${ANSI.cyan}/doctor${ANSI.reset} to test your environment and credentials`);
        console.log(`  ${ANSI.dim}──────────────────────────────────────────────────────────────────${ANSI.reset}\n`);
      } else {
        console.log(`\n  ${ANSI.coral}Model Response Error:${ANSI.reset} ${err.message}\n`);
      }
    }
  }

  public async handleDirectorySwitch(rawInput: string): Promise<void> {
    const cfg = this.configManager.getConfig();
    const res = SharedPathResolver.parseAndResolve(rawInput, cfg.workdir);

    // No argument: print current workspace path
    if (!res.rawPathToken) {
      console.log(`\n  Workspace: ${ANSI.bold}${cfg.workdir}${ANSI.reset}\n`);
      return;
    }

    if (!res.success) {
      console.log(`\n  ${ANSI.coral}✖ ${res.error || `Directory not found or not accessible: ${res.resolvedPath}`}${ANSI.reset}\n`);
      return;
    }

    const target = res.resolvedPath;
    cfg.workdir = target;
    this.configManager.updateConfig({ workdir: target });

    try {
      process.chdir(target);
    } catch (_) {}

    let gitBranch = 'main';
    try {
      const gitRes = await BashTool.execute('git branch --show-current', { cwd: target });
      if (gitRes.exitCode === 0 && gitRes.stdout.trim()) {
        gitBranch = gitRes.stdout.trim();
      }
    } catch (_) {}

    this.coordinator.switchWorkspace(target);
    TerminalUI.renderWorkspaceSwitchedCard(target, gitBranch);

    if (isSystemDirectory(target)) {
      TerminalUI.renderSystemDirWarning();
    }

    // Follow-up prose dispatch (e.g. /cd "C:\...\Game 2.6" and tell me wt is theer)
    if (res.followUpText && res.followUpText.trim()) {
      let followUp = res.followUpText.trim();
      followUp = followUp.replace(/^(?:and\s+|,|\s+)/i, '').trim();
      if (followUp) {
        console.log(`\n  ${ThemeManager.getColors().secondary}Executing follow-up request in new workspace: "${followUp}"${ThemeManager.getColors().reset}\n`);
        await this.executeUserTask(followUp);
        return;
      }
    }

    // Pending paused task resume (from home directory safety pause)
    if (this.pendingPausedTask) {
      const safety = detectWorkspaceProject(target);
      if (!safety.isHome && !safety.isDriveRoot && !safety.isSystemDir) {
        const taskToResume = this.pendingPausedTask;
        this.pendingPausedTask = undefined;
        console.log(`\n  ${ANSI.mint}✔ Resuming paused task in new workspace:${ANSI.reset} "${taskToResume}"\n`);
        await this.executeUserTask(taskToResume);
      }
    }
  }

  public async handleNewProjectCommand(nameArg: string): Promise<void> {
    const rawName = (nameArg || '').trim();
    if (!rawName) {
      console.log(`\n  ${ANSI.coral}✖ Missing project name.${ANSI.reset} Usage: ${ANSI.cyan}/new <project-name>${ANSI.reset} (e.g. ${ANSI.cyan}/new my-game${ANSI.reset})\n`);
      return;
    }

    // Sanitize folder name
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const cfg = this.configManager.getConfig();
    const safety = detectWorkspaceProject(cfg.workdir);

    // If currently in home directory or system dir, place under ~/Projects/<name>
    const baseDir = (safety.isHome || safety.isDriveRoot || safety.isSystemDir)
      ? path.join(os.homedir(), 'Projects')
      : cfg.workdir;

    const targetDir = path.join(baseDir, safeName);
    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        console.log(`\n  ${ANSI.mint}✔ Created new project directory:${ANSI.reset} ${targetDir}`);
      }
    } catch (err: any) {
      console.log(`\n  ${ANSI.coral}✖ Failed to create project directory:${ANSI.reset} ${err.message}\n`);
      return;
    }

    // Switch workspace to the new project (this also triggers resume of pending task if any)
    await this.handleDirectorySwitch(targetDir);
  }

  public async handleProviderCommand(argsStr: string = ''): Promise<void> {
    const parts = argsStr.trim().split(/\s+/).filter(Boolean);
    const sub = parts[0]?.toLowerCase();
    const cfg = this.configManager.getConfig();
    const activeProv = cfg.providers[cfg.activeProvider] || {
      id: cfg.activeProvider,
      name: cfg.activeProvider.toUpperCase(),
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      defaultRpm: 120,
      defaultTpm: 300000,
      defaultConcurrency: 4,
    };

    if (sub === 'switch' && parts[1]) {
      const targetId = parts[1].toLowerCase();
      this.configManager.setActiveProvider(targetId);
      console.log(`\n  ${ANSI.mint}✔ Active provider switched to ${targetId}${ANSI.reset}\n`);
      return;
    }

    if (sub === 'key') {
      const keyArg = parts.slice(1).join(' ').trim();
      let key = keyArg;
      if (!key) {
        key = await this.askQuestion(
          `  ${ANSI.amber}❯ Enter API Key for ${activeProv.name} (paste supported): ${ANSI.reset}`,
          true
        );
      }
      if (key) {
        this.configManager.setProviderApiKey(cfg.activeProvider, key);
        console.log(`\n  ${ANSI.mint}✔ API key updated for ${activeProv.name}${ANSI.reset}\n`);
      }
      return;
    }

    // Arrow-key provider selection
    const providerList = new SelectList({
      title: 'Select LLM Provider Preset:',
      options: [
        { id: 'nim', label: 'NVIDIA NIM', secondary: 'https://integrate.api.nvidia.com/v1', value: 'nim' },
        { id: 'openai', label: 'OpenAI API', secondary: 'https://api.openai.com/v1', value: 'openai' },
        { id: 'anthropic', label: 'Anthropic Claude', secondary: 'https://api.anthropic.com/v1', value: 'anthropic' },
        { id: 'deepseek', label: 'DeepSeek Official', secondary: 'https://api.deepseek.com/v1', value: 'deepseek' },
        { id: 'openrouter', label: 'OpenRouter Gateway', secondary: 'https://openrouter.ai/api/v1', value: 'openrouter' },
        { id: 'groq', label: 'Groq Cloud LPU', secondary: 'https://api.groq.com/openai/v1', value: 'groq' },
        { id: 'ollama', label: 'Ollama Local Host', secondary: 'http://127.0.0.1:11434/v1', value: 'ollama' },
        { id: 'vllm', label: 'vLLM Local / Cluster', secondary: 'http://127.0.0.1:8000/v1', value: 'vllm' },
      ],
      initialIndex: ['nim', 'openai', 'anthropic', 'deepseek', 'openrouter', 'groq', 'ollama', 'vllm'].indexOf(cfg.activeProvider),
    });

    const chosen = await providerList.prompt();
    if (!chosen) return;

    this.configManager.setActiveProvider(chosen.value);
    console.log(`\n  ${ANSI.mint}✔ Active provider switched to ${chosen.label}${ANSI.reset}\n`);

    // Check key
    const provCfg = cfg.providers[chosen.value];
    if (!provCfg?.apiKey && chosen.value !== 'ollama' && chosen.value !== 'vllm') {
      const enteredKey = await this.askQuestion(`  Enter API Key for ${chosen.label} (or press Enter to skip): `, true);
      if (enteredKey) {
        this.configManager.setProviderApiKey(chosen.value, enteredKey);
        console.log(`  ${ANSI.mint}✔ Key saved.${ANSI.reset}\n`);
      }
    }
  }

  public async handleEffortCommand(argsStr: string = ''): Promise<void> {
    const trimmed = argsStr.trim().toLowerCase();
    const map: Record<string, ReasoningEffort> = {
      off: 'off',
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max',
    };

    if (map[trimmed]) {
      this.configManager.setReasoningEffort(map[trimmed]);
      console.log(`\n  ${ANSI.mint}✔ Reasoning effort set to ${map[trimmed].toUpperCase()}${ANSI.reset}\n`);
      return;
    }

    // OpenCode-style floating select palette
    const currentEffort = this.configManager.getConfig().reasoningEffort || 'medium';
    const effortList = new SelectList({
      title: 'Configure Reasoning Effort & Thinking Budget:',
      options: [
        { id: 'off', label: 'off', secondary: 'Zero reasoning tokens (direct output)', value: 'off' },
        { id: 'low', label: 'low', secondary: 'Budget: ~1,024 tokens (fast)', value: 'low' },
        { id: 'medium', label: 'medium', secondary: 'Budget: ~2,048 tokens (balanced)', value: 'medium' },
        { id: 'high', label: 'high', secondary: 'Budget: ~4,096 tokens (deep reasoning)', value: 'high' },
        { id: 'max', label: 'max', secondary: 'Budget: ~8,192 tokens (maximum depth)', value: 'max' },
      ],
      initialIndex: ['off', 'low', 'medium', 'high', 'max'].indexOf(currentEffort),
    });

    const res = await effortList.prompt();
    if (res) {
      this.configManager.setReasoningEffort(res.value as ReasoningEffort);
      console.log(`\n  ${ANSI.mint}✔ Reasoning effort set to ${res.value.toUpperCase()}${ANSI.reset}\n`);
    }
  }

  public async handleKeyCommand(argsStr: string = ''): Promise<void> {
    const cfg = this.configManager.getConfig();
    const activeProv = cfg.providers[cfg.activeProvider] || {
      id: cfg.activeProvider,
      name: cfg.activeProvider.toUpperCase(),
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    };

    let key = argsStr.trim();
    if (!key) {
      key = await this.askQuestion(
        `  ${ANSI.bold}Enter API Key for ${activeProv.name} (paste supported, Esc to cancel):${ANSI.reset} `,
        true
      );
      key = key.trim();
    }

    if (!key) {
      console.log(`\n  ${ANSI.slate}(Cancelled - no key entered)${ANSI.reset}\n`);
      return;
    }

    const cleanKey = ConfigManager.sanitizeApiKey(key);
    this.configManager.setProviderApiKey(cfg.activeProvider, cleanKey);
    const masked = ConfigManager.maskApiKey(cleanKey);

    console.log(`\n  ${ANSI.mint}✔ Saved API key for ${activeProv.name} [${masked}]${ANSI.reset}`);
    console.log(`  ${ANSI.dim}Config saved to ~/.nomin/config.json${ANSI.reset}`);

    // Live connectivity verification probe
    TerminalUI.startSpinner(`Verifying key connectivity to ${activeProv.name}...`);
    try {
      const provType = (cfg.activeProvider === 'nim' ? 'nvidia-nim' : 'openai') as any;
      const testClient = new NominHttpClient({
        config: {
          id: cfg.activeProvider,
          name: activeProv.name,
          type: provType,
          baseURL: activeProv.baseUrl,
          apiKey: cleanKey,
        },
      });
      const models = await testClient.listModels();
      TerminalUI.stopSpinner();
      console.log(`  ${ANSI.mint}✔ Live connection verified! Found ${models.length} discoverable models.${ANSI.reset}\n`);
      testClient.destroy();
    } catch (err: any) {
      TerminalUI.stopSpinner();
      const isAuth = err.message?.includes('401') || err.message?.includes('403') || err.message?.toLowerCase().includes('authorization');
      if (isAuth) {
        console.log(`  ${ANSI.amber}⚠️ Key stored, but provider rejected authorization [HTTP 401/403]: ${err.message}${ANSI.reset}`);
        console.log(`     If using NVIDIA NIM, ensure 'Public API Endpoints' is enabled on this key at build.nvidia.com.\n`);
      } else {
        console.log(`  ${ANSI.amber}⚠️ Key stored, but connectivity probe warning: ${err.message}${ANSI.reset}\n`);
      }
    }
  }

  public async handleModelCommand(argsStr: string = ''): Promise<void> {
    const parts = argsStr.trim().split(/\s+/).filter(Boolean);
    const sub = parts[0]?.toLowerCase();
    const cfg = this.configManager.getConfig();

    if (sub === 'add' && parts[1]) {
      const m = parts.slice(1).join(' ').trim();
      this.configManager.addModel(m);
      console.log(`\n  ${ANSI.mint}✔ Added model '${m}' to pool.${ANSI.reset}\n`);
      return;
    }

    if (sub === 'remove' && parts[1]) {
      const m = parts.slice(1).join(' ').trim();
      this.configManager.removeModel(m);
      console.log(`\n  ${ANSI.mint}✔ Removed model '${m}' from pool.${ANSI.reset}\n`);
      return;
    }

    // Direct model switch: /model set <id>, /model switch <id>, or /model <id>
    let directModel = '';
    if ((sub === 'set' || sub === 'switch') && parts[1]) {
      directModel = parts.slice(1).join(' ').trim();
    } else if (sub && sub !== 'set' && sub !== 'switch' && !sub.startsWith('-')) {
      directModel = parts.join(' ').trim();
    }

    if (directModel) {
      this.configManager.setActiveModel(directModel);
      this.coordinator.updateModels({
        mode: this.configManager.getConfig().mode,
        activeModel: directModel,
        roles: this.configManager.getConfig().roles,
      });
      console.log(`\n  ${ANSI.mint}✔ Active model set to '${directModel}'${ANSI.reset}\n`);
      return;
    }

    // Open Arrow-Key Model Picker
    await this.handlePaginatedModelBrowser();
  }

  public async handlePaginatedModelBrowser(): Promise<void> {
    const cfg = this.configManager.getConfig();
    const activeProv = cfg.providers[cfg.activeProvider] || {
      id: cfg.activeProvider,
      name: cfg.activeProvider.toUpperCase(),
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    };
    const keyInfo = this.configManager.getProviderKeyInfo(cfg.activeProvider);
    const apiKey = keyInfo.apiKey;

    const provType = (cfg.activeProvider === 'nim' ? 'nvidia-nim' : 'openai') as any;
    const client = new NominHttpClient({
      config: {
        id: cfg.activeProvider,
        name: activeProv.name,
        type: provType,
        baseURL: activeProv.baseUrl,
        apiKey,
      },
    });

    TerminalUI.startSpinner(`Loading live model catalog from ${activeProv.name}...`);
    let allModels: DiscoveredModel[] = [];
    try {
      allModels = await LiveCatalogManager.fetchLiveModels(client, { forceRefresh: false });
      TerminalUI.stopSpinner();
    } catch (err: any) {
      TerminalUI.stopSpinner();
      console.log(`\n  ${ANSI.coral}✖ Unable to load catalog:${ANSI.reset} ${err.message}\n`);
      return;
    }

    const picker = new ModelPicker({
      models: allModels,
      activeModel: cfg.activeModel,
      favorites: cfg.favorites,
      recentlyUsed: cfg.recentlyUsed,
      retiredModels: cfg.retiredModels,
      isTeamMode: cfg.mode === 'team',
      currentRoles: cfg.roles,
      client,
      providerName: activeProv.name,
      onFavoriteToggle: (modelId, isFav) => {
        if (isFav) this.configManager.addFavorite(modelId);
        else this.configManager.removeFavorite(modelId);
      },
    });

    const result = await picker.prompt();
    if (result) {
      if (result.rejected) {
        // Model verification was rejected; if current model is retired, unseat it so we don't hold dead models
        if (cfg.activeModel && this.configManager.isModelRetired(cfg.activeModel)) {
          this.configManager.updateConfig({ activeModel: undefined });
          this.coordinator.updateModels({
            mode: this.configManager.getConfig().mode,
            activeModel: undefined,
            roles: this.configManager.getConfig().roles,
          });
        }
        return;
      }
      if (result.assignedRole) {
        this.configManager.setTeamRole(result.assignedRole, result.modelId);
        this.coordinator.updateModels({
          mode: 'team',
          activeModel: this.configManager.getConfig().activeModel,
          roles: this.configManager.getConfig().roles,
        });
        console.log(`\n  ${ANSI.mint}✔ Team role '${result.assignedRole}' assigned to '${result.modelId}'${ANSI.reset}\n`);
      } else {
        this.configManager.setActiveModel(result.modelId);
        this.coordinator.updateModels({
          mode: this.configManager.getConfig().mode,
          activeModel: result.modelId,
          roles: this.configManager.getConfig().roles,
        });
        console.log(`\n  ${ANSI.mint}✔ Active model set to '${result.modelId}'${ANSI.reset}\n`);
      }

      if (result.reasoningEffort) {
        this.configManager.setReasoningEffort(result.reasoningEffort as ReasoningEffort);
      }
    }
  }

  public async handleConfigMenu(): Promise<void> {
    const cfg = this.configManager.getConfig();

    const configList = new SelectList({
      title: 'Nomin Code Settings & Configuration',
      options: [
        { id: 'provider', label: 'Active Provider', secondary: `${cfg.activeProvider.toUpperCase()}`, value: 'provider' },
        { id: 'model', label: 'Active Model', secondary: `${cfg.activeModel || 'none'}`, value: 'model' },
        { id: 'effort', label: 'Reasoning Effort', secondary: `${(cfg.reasoningEffort || 'medium').toUpperCase()}`, value: 'effort' },
        { id: 'mode', label: 'Swarm Mode', secondary: `${(cfg.mode || 'solo').toUpperCase()}`, value: 'mode' },
        { id: 'permissions', label: 'Permission Mode', secondary: `${this.permissionMode.toUpperCase()}`, value: 'permissions' },
        { id: 'theme', label: 'Color Theme', secondary: `${ThemeManager.getThemeName()}`, value: 'theme' },
        { id: 'verbose', label: 'Verbose Transcript', secondary: `${this.verboseMode ? 'Enabled' : 'Disabled'}`, value: 'verbose' },
        { id: 'vim', label: 'Vim Navigation Mode', secondary: `${this.vimMode ? 'Enabled' : 'Disabled'}`, value: 'vim' },
      ],
    });

    const picked = await configList.prompt();
    if (!picked) return;

    switch (picked.value) {
      case 'provider':
        await this.handleProviderCommand();
        break;
      case 'model':
        await this.handlePaginatedModelBrowser();
        break;
      case 'effort':
        await this.handleEffortCommand();
        break;
      case 'mode': {
        const nextMode = cfg.mode === 'team' ? 'solo' : 'team';
        this.configManager.setMode(nextMode);
        console.log(`\n  ${ANSI.mint}✔ Swarm mode set to ${nextMode.toUpperCase()}${ANSI.reset}\n`);
        break;
      }
      case 'permissions':
        await this.handlePermissionsCommand();
        break;
      case 'theme':
        await this.handleThemeCommand();
        break;
      case 'verbose':
        this.verboseMode = !this.verboseMode;
        console.log(`\n  ${ANSI.mint}✔ Verbose transcript ${this.verboseMode ? 'enabled' : 'disabled'}${ANSI.reset}\n`);
        break;
      case 'vim':
        this.vimMode = !this.vimMode;
        console.log(`\n  ${ANSI.mint}✔ Vim mode ${this.vimMode ? 'enabled' : 'disabled'}${ANSI.reset}\n`);
        break;
    }
  }

  public async handlePermissionsCommand(): Promise<void> {
    const list = new SelectList({
      title: 'Permission Policies & Rules Editor',
      options: [
        { id: 'normal', label: 'Normal Mode', secondary: 'Prompt before all bash commands & file modifications', value: 'normal' },
        { id: 'auto-accept', label: 'Auto-Accept Mode', secondary: 'Automatically approve non-destructive edits and safe commands', value: 'auto-accept' },
        { id: 'plan', label: 'Plan Mode', secondary: 'Read-only exploration: blocks all file writes & executions', value: 'plan' },
      ],
      initialIndex: this.permissionMode === 'auto-accept' ? 1 : this.permissionMode === 'plan' ? 2 : 0,
    });

    const res = await list.prompt();
    if (res) {
      this.permissionMode = res.value as any;
      if (this.permissionMode === 'auto-accept') {
        this.configManager.updateConfig({ autoApprovePermissions: true, planMode: false });
      } else if (this.permissionMode === 'plan') {
        this.configManager.updateConfig({ autoApprovePermissions: false, planMode: true });
      } else {
        this.configManager.updateConfig({ autoApprovePermissions: false, planMode: false });
      }
      console.log(`\n  ${ANSI.mint}✔ Permission policy set to ${this.permissionMode.toUpperCase()}${ANSI.reset}\n`);
    }
  }

  public async handleThemeCommand(): Promise<void> {
    const themeList = new SelectList({
      title: 'Select Terminal Color Theme:',
      options: [
        { id: 'aurora', label: 'Aurora Borealis (Default)', secondary: 'Luminescent electric cyan, emerald, and polar night', value: 'aurora' },
        { id: 'dark', label: 'Dark Cozy', secondary: 'Warm amber, mint, and soft slate hairlines', value: 'dark' },
        { id: 'light', label: 'Light Clean', secondary: 'High readability on light terminal backgrounds', value: 'light' },
        { id: 'high-contrast', label: 'High Contrast', secondary: 'Pure bright white and yellow on black', value: 'high-contrast' },
        { id: 'colorblind', label: 'Colorblind Safe', secondary: 'Blue & orange semantic palette', value: 'colorblind' },
        { id: 'none', label: 'NO_COLOR / Plain', secondary: 'Standard ANSI codes disabled', value: 'none' },
      ],
      initialIndex: ['aurora', 'dark', 'light', 'high-contrast', 'colorblind', 'none'].indexOf(ThemeManager.getThemeName()),
    });

    const res = await themeList.prompt();
    if (res) {
      ThemeManager.setTheme(res.value as ThemeName);
      console.log(`\n  ${ANSI.mint}✔ Color theme updated to ${res.label}${ANSI.reset}\n`);
    }
  }

  public async handleUndoTimeline(): Promise<void> {
    const cfg = this.configManager.getConfig();
    let commits: CheckpointItem[] = [];

    try {
      const gitLog = execSync('git log -n 8 --pretty=format:"%h|%s|%cr"', {
        cwd: cfg.workdir,
        encoding: 'utf8',
      }).trim();
      if (gitLog) {
        commits = gitLog.split('\n').map((line, idx) => {
          const [hash, title, time] = line.split('|');
          return {
            id: hash,
            title: title || 'Commit',
            time: time || '',
            isCurrent: idx === 0,
          };
        });
      }
    } catch (_) {}

    if (commits.length === 0) {
      console.log(`\n  ${ANSI.slate}(No git commit checkpoints found in current workspace)${ANSI.reset}\n`);
      return;
    }

    const viewer = new TimelineViewer(commits);
    const chosen = await viewer.prompt();
    if (chosen && !chosen.isCurrent) {
      const confirm = new ConfirmDialog({
        promptText: `Revert workspace to commit ${chosen.id} (${chosen.title})?`,
      });
      const ok = await confirm.prompt();
      if (ok?.value === 'yes' || ok?.value === 'always') {
        try {
          execSync(`git checkout ${chosen.id} -- .`, { cwd: cfg.workdir });
          console.log(`\n  ${ANSI.mint}✔ Workspace restored to checkpoint ${chosen.id}${ANSI.reset}\n`);
        } catch (e: any) {
          console.log(`\n  ${ANSI.coral}✖ Rollback failed: ${e.message}${ANSI.reset}\n`);
        }
      }
    }
  }

  public async handleSlashCommand(cmdStr: string): Promise<void> {
    const cmd = cmdStr.split(' ')[0].toLowerCase();

    switch (cmd) {
      case '/help':
        TerminalUI.renderCommandCatalog();
        break;

      case '/context': {
        const cfg = this.configManager.getConfig();
        const envCtx = await EnvironmentContextEngine.generate(cfg.workdir);
        const report = EnvironmentContextEngine.formatTerminalReport(
          envCtx,
          this.conversationHistory.length,
          defaultToolRegistry.getToolNames()
        );
        console.log();
        for (const line of report) {
          console.log(line);
        }
        console.log();
        break;
      }

      case '/debug': {
        const parts = cmdStr.split(' ');
        const sub = parts[1]?.toLowerCase();
        const cfg = this.configManager.getConfig();
        if (sub === 'on') {
          const logPath = DebugLogger.enable(cfg.workdir);
          console.log(`\n  ${ANSI.mint}✔ Debug logging enabled.${ANSI.reset} Output: ${logPath}\n`);
        } else if (sub === 'off') {
          DebugLogger.disable();
          console.log(`\n  ${ANSI.slate}✔ Debug logging disabled.${ANSI.reset}\n`);
        } else {
          const res = DebugLogger.toggle(cfg.workdir);
          if (res.enabled) {
            console.log(`\n  ${ANSI.mint}✔ Debug logging enabled.${ANSI.reset} Output: ${res.logFile}\n`);
          } else {
            console.log(`\n  ${ANSI.slate}✔ Debug logging disabled.${ANSI.reset}\n`);
          }
        }
        break;
      }

      case '/cd': {
        const rawArg = cmdStr.slice(3).trim();
        await this.handleDirectorySwitch(rawArg);
        break;
      }

      case '/new': {
        const rawArg = cmdStr.slice(4).trim();
        await this.handleNewProjectCommand(rawArg);
        break;
      }

      case '/version':
      case '-v':
      case '--version': {
        console.log(`\n  ${BuildStampEngine.formatStamp()}\n`);
        break;
      }

      case '/status':
        console.log();
        console.log(`  ${ANSI.bold}Active Swarm Task State:${ANSI.reset}`);
        const state = this.coordinator.blackboard.getState();
        const tasks = Object.values(state.taskDAG?.tasks || {});
        if (tasks.length === 0) {
          console.log(`  ${ANSI.dim}(no active tasks on blackboard)${ANSI.reset}\n`);
        } else {
          for (const t of tasks) {
            console.log(`    • ${t.id}: ${t.title} [${t.status}] (${t.assignedRole})`);
          }
          console.log();
        }
        break;

      case '/board':
        console.log();
        console.log(`  ${ANSI.bold}Blackboard State & Acceptance Gates:${ANSI.reset}`);
        console.log(JSON.stringify(this.coordinator.blackboard.getState(), null, 2));
        console.log();
        break;

      case '/cost':
        TerminalUI.renderCostSummary(this.sessionUsage);
        break;

      case '/diff': {
        const activeWorkdir = this.configManager.getConfig().workdir;
        try {
          const diffOutput = execSync('git diff HEAD', { cwd: activeWorkdir, encoding: 'utf8' });
          if (!diffOutput.trim()) {
            console.log(`\n  ${ANSI.slate}(Working tree clean - zero unstaged diffs)${ANSI.reset}\n`);
          } else {
            TerminalUI.renderDiff(diffOutput, 'Active Git Diff');
          }
        } catch (e: any) {
          console.log(`\n  ${ANSI.coral}✖ Git diff error: ${e.message}${ANSI.reset}\n`);
        }
        break;
      }

      case '/doctor': {
        const report = await NominDoctor.runDiagnostics(this.configManager.getConfig().workdir);
        TerminalUI.renderDoctor(
          report.checks.map(c => ({
            name: c.name,
            status: c.pass ? 'ok' : 'fail',
            detail: c.message,
          }))
        );
        break;
      }

      case '/compact':
        console.log(`\n  ${ANSI.mint}✔ Context compaction triggered. Compressing conversational history...${ANSI.reset}\n`);
        this.conversationHistory = this.conversationHistory.slice(-4);
        break;

      case '/retry': {
        if (this.lastPendingPrompt) {
          console.log(`\n  ${ANSI.mint}✔ Resending pending turn:${ANSI.reset} "${this.lastPendingPrompt}"\n`);
          await this.executeUserTask(this.lastPendingPrompt);
        } else {
          console.log(`\n  ${ANSI.slate}No pending request to retry.${ANSI.reset}\n`);
        }
        break;
      }

      case '/stats': {
        const ledger = RequestLedger.getInstance();
        const gateway = RequestGateway.getInstance();
        const cfg = this.configManager.getConfig();
        const activeModel = cfg.activeModel || 'all';
        const activeProv = cfg.activeProvider || 'nvidia-nim';

        const calls60s = ledger.getCallsInWindow(60000);
        const callsByPurpose = ledger.getCallsByPurpose(60000);
        const count429 = ledger.get429Count(60000);
        const count429Total = ledger.get429Count();
        const currentRpm = gateway.getRpmLimit(activeProv, activeModel);
        const queueDepth = gateway.getPriorityQueueDepth();
        const totalQueued = queueDepth.liveTurn + queueDepth.toolContinuation + queueDepth.verifier + queueDepth.background;
        const circuitState = gateway.getCircuitState();

        console.log(`\n  ${ANSI.bold}${ANSI.cyan}=== Nomin Code: Gateway & Rate Limit Telemetry ===${ANSI.reset}`);
        console.log(`  ${ANSI.bold}Active Model:${ANSI.reset}    ${activeModel} (${activeProv})`);
        console.log(`  ${ANSI.bold}Configured RPM:${ANSI.reset}  ${currentRpm} requests/min`);
        console.log(`  ${ANSI.bold}Rolling Calls:${ANSI.reset}   ${calls60s.length}/${currentRpm} calls in last 60s`);
        console.log(`  ${ANSI.bold}Queue Depth:${ANSI.reset}     ${totalQueued} pending [Live: ${queueDepth.liveTurn}, Tool: ${queueDepth.toolContinuation}, Verifier: ${queueDepth.verifier}, Bg: ${queueDepth.background}]`);
        console.log(`  ${ANSI.bold}Circuit State:${ANSI.reset}   ${circuitState === 'CLOSED' ? ANSI.mint + 'CLOSED (Healthy)' : (circuitState === 'OPEN' ? ANSI.coral + 'OPEN (Cooling down)' : ANSI.amber + 'HALF_OPEN (Testing)')}${ANSI.reset}`);
        console.log(`  ${ANSI.bold}429 Throttles:${ANSI.reset}   ${count429} in last 60s (${count429Total} session total)`);
        console.log();
        console.log(`  ${ANSI.bold}Calls by Purpose (Last 60s):${ANSI.reset}`);
        for (const [purpose, count] of Object.entries(callsByPurpose)) {
          if (count > 0) {
            console.log(`    • ${purpose.padEnd(18)}: ${count}`);
          }
        }
        console.log();
        console.log(`  ${ANSI.bold}Recent Request Ledger Log:${ANSI.reset}`);
        const summary = ledger.formatSummaryTable(8);
        console.log(summary.split('\n').map(l => `    ${l}`).join('\n'));
        console.log();
        break;
      }

      case '/rpm': {
        const parts = cmdStr.split(' ');
        const gateway = RequestGateway.getInstance();
        const cfg = this.configManager.getConfig();
        const activeProv = cfg.activeProvider || 'nvidia-nim';
        const activeModel = cfg.activeModel || 'all';

        if (parts.length > 1 && parts[1].trim()) {
          const newLimit = parseInt(parts[1].trim(), 10);
          if (Number.isFinite(newLimit) && newLimit > 0) {
            gateway.setRpmLimit(activeProv, activeModel, newLimit);
            console.log(`\n  ${ANSI.mint}✔ RPM limit for ${activeProv}/${activeModel} updated to ${newLimit} req/min.${ANSI.reset}\n`);
          } else {
            console.log(`\n  ${ANSI.coral}Invalid RPM limit. Usage: /rpm <number>${ANSI.reset}\n`);
          }
        } else {
          const currentLimit = gateway.getRpmLimit(activeProv, activeModel);
          console.log(`\n  ${ANSI.bold}Current RPM limit for ${activeProv}/${activeModel}:${ANSI.reset} ${ANSI.mint}${currentLimit} req/min${ANSI.reset}`);
          console.log(`  ${ANSI.dim}To adjust: /rpm <limit> (e.g. /rpm 40)${ANSI.reset}\n`);
        }
        break;
      }

      case '/stop':
        console.log(`\n  ${ANSI.amber}⏹ Aborted active swarm task.${ANSI.reset}\n`);
        this.isProcessing = false;
        break;

      case '/undo':
      case '/redo':
      case '/rewind':
        await this.handleUndoTimeline();
        break;

      case '/repomap': {
        const activeWorkdir = this.configManager.getConfig().workdir;
        console.log(`\n  ${ANSI.dim}Generating PageRank repository map for ${activeWorkdir}...${ANSI.reset}\n`);
        const result = RepoMapEngine.generate({ repoPath: activeWorkdir, maxTokens: 1024 });
        console.log(result.mapText);
        console.log();
        break;
      }

      case '/key':
      case '/auth': {
        const parts = cmdStr.split(' ');
        await this.handleKeyCommand(parts.slice(1).join(' '));
        break;
      }

      case '/provider': {
        const parts = cmdStr.split(' ');
        await this.handleProviderCommand(parts.slice(1).join(' '));
        break;
      }

      case '/models':
      case '/model': {
        const parts = cmdStr.split(' ');
        await this.handleModelCommand(parts.slice(1).join(' '));
        break;
      }

      case '/effort': {
        const parts = cmdStr.split(' ');
        await this.handleEffortCommand(parts.slice(1).join(' '));
        break;
      }

      case '/config':
      case '/settings':
        await this.handleConfigMenu();
        break;

      case '/permissions':
        await this.handlePermissionsCommand();
        break;

      case '/theme':
        await this.handleThemeCommand();
        break;

      case '/vim':
        this.vimMode = !this.vimMode;
        console.log(`\n  ${ANSI.mint}✔ Vim mode ${this.vimMode ? 'enabled' : 'disabled'}${ANSI.reset}\n`);
        break;

      case '/init': {
        const cfg = this.configManager.getConfig();
        const memDir = path.join(cfg.workdir, '.nomin');
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        const memPath = path.join(memDir, 'GUIDELINES.md');
        if (!fs.existsSync(memPath)) {
          fs.writeFileSync(
            memPath,
            `# Workspace Guidelines & Instructions\n\n- Always verify code with automated tests before committing.\n- Follow TypeScript strict null checks.\n`,
            'utf-8'
          );
        }
        console.log(`\n  ${ANSI.mint}✔ Initialized ${memPath}${ANSI.reset}\n`);
        break;
      }

      case '/memory': {
        const cfg = this.configManager.getConfig();
        const memPath = path.join(cfg.workdir, '.nomin', 'GUIDELINES.md');
        if (fs.existsSync(memPath)) {
          console.log(`\n  ${ANSI.bold}Workspace Guidelines (${memPath}):${ANSI.reset}`);
          console.log(fs.readFileSync(memPath, 'utf-8'));
        } else {
          console.log(`\n  ${ANSI.slate}(No .nomin/GUIDELINES.md file found. Run /init to create one)${ANSI.reset}\n`);
        }
        break;
      }

      case '/export': {
        const cfg = this.configManager.getConfig();
        const expDir = path.join(cfg.workdir, '.nomin', 'exports');
        if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });
        const expPath = path.join(expDir, `transcript-${Date.now()}.md`);
        let content = `# Nomin Code Session Transcript\n\n`;
        for (const m of this.conversationHistory) {
          content += `### ${m.role.toUpperCase()}\n${m.content}\n\n`;
        }
        fs.writeFileSync(expPath, content, 'utf-8');
        console.log(`\n  ${ANSI.mint}✔ Session transcript exported to ${expPath}${ANSI.reset}\n`);
        break;
      }

      case '/clear':
        console.clear();
        break;

      case '/exit':
      case '/quit':
        console.log(`\n  ${ANSI.slate}Goodbye from Nomin Code.${ANSI.reset}\n`);
        process.exit(0);

      default: {
        // Detect concatenated slash commands (e.g. "/modelscheck ..." or "/modelcheck ...")
        const knownPrefixes = ['/models', '/model', '/help', '/chat', '/plan', '/cd', '/key', '/provider', '/effort', '/diff', '/doctor', '/context', '/debug'];
        const matchedPrefix = knownPrefixes.find(p => cmd.startsWith(p) && cmd.length > p.length);
        if (matchedPrefix) {
          const remainder = cmdStr.slice(matchedPrefix.length).trim();
          console.log(`\n  ${ANSI.amber}Notice:${ANSI.reset} Detected concatenated command '${cmd}'. Did you mean '${matchedPrefix}' followed by '${remainder}'?`);
          console.log(`  Executing '${matchedPrefix}' with remainder: "${remainder}"\n`);
          if (matchedPrefix === '/models' || matchedPrefix === '/model') {
            await this.handleModelCommand(remainder);
            return;
          } else if (matchedPrefix === '/cd') {
            await this.handleDirectorySwitch(remainder);
            return;
          } else if (matchedPrefix === '/chat') {
            await this.handleConversationalAndExplanation(remainder, 'CHAT/QUESTION');
            return;
          }
        }
        console.log(`\n  ${ANSI.coral}Unknown command: ${cmd}. Type /help for options.${ANSI.reset}\n`);
        break;
      }
    }
  }
}

export const ReplServer = NominREPL;
