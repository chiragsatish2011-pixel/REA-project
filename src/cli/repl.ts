/**
 * Nomin Code: Interactive Terminal REPL & Slash Command Handler
 * Styled in the Claude Code / OpenCode aesthetic with boxed input bar and agent cards.
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ANSI, TerminalUI } from './ui.js';
import { SwarmCoordinator } from '../swarm/coordinator.js';
import { ConfigManager, isSystemDirectory, type NominConfig } from '../config/index.js';
import { RepoMapEngine } from '../tools/repomap.js';
import { BashTool } from '../tools/bash.js';

export interface ReplOptions {
  workdir?: string;
  coordinator: SwarmCoordinator;
  config?: NominConfig;
}

export class NominREPL {
  private coordinator: SwarmCoordinator;
  private configManager: ConfigManager;
  private rl: readline.Interface | null = null;
  private isProcessing: boolean = false;

  constructor(optsOrCoordinator: SwarmCoordinator | ReplOptions) {
    if ('coordinator' in optsOrCoordinator) {
      this.coordinator = optsOrCoordinator.coordinator;
      this.configManager = ConfigManager.getInstance(optsOrCoordinator.workdir);
    } else {
      this.coordinator = optsOrCoordinator;
      this.configManager = ConfigManager.getInstance();
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

    // Query active git branch if available
    let gitBranch = 'main';
    try {
      const gitRes = await BashTool.execute('git branch --show-current', { cwd: cfg.workdir });
      if (gitRes.exitCode === 0 && gitRes.stdout.trim()) {
        gitBranch = gitRes.stdout.trim();
      }
    } catch (_) {
      // Non-git or fallback
    }

    // Print the clean booting sequence
    TerminalUI.printBootSequence({
      version: '1.0.0',
      providerName: activeProv.name,
      providerUrl: activeProv.baseUrl,
      workdir: cfg.workdir,
      gitBranch,
      mode: cfg.mode,
      activeModel: cfg.activeModel,
      roles: cfg.roles,
      selectedModels: cfg.selectedModels,
      rpmLimit: activeProv.defaultRpm,
      tpmLimit: activeProv.defaultTpm,
      concurrency: activeProv.defaultConcurrency,
    });

    if (cfg.isFallbackState) {
      console.log(`  ${ANSI.yellow}⚠ Notice: Running in ${cfg.isSystemDir ? 'system-protected' : 'read-only'} directory.${ANSI.reset}`);
      console.log(`  ${ANSI.yellow}  State & worktrees redirected to: ${ANSI.dim}${cfg.stateDir}${ANSI.reset}\n`);
    }

    this.initReadline();
  }

  public async handleUserGoal(taskPrompt: string): Promise<void> {
    await this.executeUserTask(taskPrompt);
    this.promptTurn();
  }

  private initReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `  ${ANSI.gray}│${ANSI.reset}  ${ANSI.brightCyan}❯${ANSI.reset} `,
    });

    this.promptTurn();
    let isHandlingLine = false;

    this.rl.on('line', async (line: string) => {
      isHandlingLine = true;
      const input = line.trim();
      TerminalUI.renderMessageBarFooter();

      if (!input) {
        isHandlingLine = false;
        this.promptTurn();
        return;
      }

      // Pause readline stream during async action processing
      this.rl?.pause();

      try {
        // Handle cd <path> or /cd <path>
        if (input === 'cd' || input.startsWith('cd ') || input === '/cd' || input.startsWith('/cd ')) {
          const rawPath = input.startsWith('/cd') ? input.slice(3).trim() : input.slice(2).trim();
          await this.handleDirectorySwitch(rawPath);
          return;
        }

        if (input.startsWith('/')) {
          await this.handleSlashCommand(input);
          return;
        }

        if (this.isProcessing) {
          console.log(`  ${ANSI.yellow}⚠️ An active swarm task is currently in progress. Please wait...${ANSI.reset}\n`);
          return;
        }

        await this.executeUserTask(input);
      } finally {
        isHandlingLine = false;
        this.rl?.resume();
        this.promptTurn();
      }
    });

    this.rl.on('close', async () => {
      while (isHandlingLine) {
        await new Promise((r) => setTimeout(r, 10));
      }
      console.log(`\n  ${ANSI.gray}Goodbye from Nomin Code.${ANSI.reset}\n`);
      process.exit(0);
    });
  }

  private promptTurn(): void {
    TerminalUI.renderMessageBarHeader();
    this.rl?.prompt();
  }

  private async executeUserTask(taskPrompt: string): Promise<void> {
    this.isProcessing = true;
    const cfg = this.configManager.getConfig();

    console.log(`  ${ANSI.bold}${ANSI.brightWhite}Objective:${ANSI.reset} "${taskPrompt}"\n`);
    
    // Architect announcement card
    TerminalUI.renderAgentCard(
      'ARCHITECT',
      cfg.roles.architect,
      `Decomposing goal into topological sub-tasks & extracting acceptance criteria...`
    );

    try {
      const result = await this.coordinator.orchestrate(taskPrompt);

      if (result.success) {
        // Coder completion card
        TerminalUI.renderAgentCard(
          'CODER',
          cfg.roles.coder,
          `Changes implemented via multi-tier fuzzy search-and-replace in isolated worktrees.`,
          [
            `Completed Tasks: ${result.completedTasks}/${result.totalTasks}`,
            `Commit: ${result.finalCommitHash || 'verified'}`,
            `Duration: ${(result.durationMs / 1000).toFixed(2)}s`,
          ]
        );

        // Verifier pass card
        const passedCount = result.taskOutcomes.reduce((acc, o) => acc + o.criteriaPassed, 0);
        const totalCount = result.taskOutcomes.reduce((acc, o) => acc + o.criteriaTotal, 0);

        TerminalUI.renderVerdictCard(
          true,
          `All acceptance criteria verified with zero AST integrity violations across ${result.completedTasks} tasks.`,
          totalCount || result.completedTasks,
          passedCount || result.completedTasks
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
      console.error(`\n  ${ANSI.brightRed}💥 Swarm Execution Error: ${err.message}${ANSI.reset}\n`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Dynamically switches the active working directory, synchronizes config & coordinator,
   * checks system directory warnings, and renders the switch status card.
   */
  public async handleDirectorySwitch(rawPath: string): Promise<void> {
    const cfg = this.configManager.getConfig();
    let newPath = (rawPath || '').trim();

    // Strip wrapping quotes
    if ((newPath.startsWith('"') && newPath.endsWith('"')) || (newPath.startsWith("'") && newPath.endsWith("'"))) {
      newPath = newPath.slice(1, -1).trim();
    }

    // Resolve target path (handling ~ or empty)
    let target: string;
    if (!newPath) {
      target = os.homedir();
    } else if (newPath === '~' || newPath.startsWith('~/') || newPath.startsWith('~\\')) {
      target = path.resolve(os.homedir(), newPath.slice(1).replace(/^[\\\/]/, ''));
    } else {
      target = path.resolve(cfg.workdir, newPath);
    }

    // Verify existence and directory status
    let isDir = false;
    try {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        isDir = true;
      }
    } catch (_) {
      isDir = false;
    }

    if (!isDir) {
      console.log(`\n  ${ANSI.brightRed}✖ Directory not found or not accessible: ${target}${ANSI.reset}\n`);
      return;
    }

    // Update config
    cfg.workdir = target;
    this.configManager.updateConfig({ workdir: target });

    // Update process current working directory
    try {
      process.chdir(target);
    } catch (_) {}

    // Re-query Git branch for new target directory
    let gitBranch = 'main';
    try {
      const gitRes = await BashTool.execute('git branch --show-current', { cwd: target });
      if (gitRes.exitCode === 0 && gitRes.stdout.trim()) {
        gitBranch = gitRes.stdout.trim();
      } else {
        const revRes = await BashTool.execute('git rev-parse --abbrev-ref HEAD', { cwd: target });
        if (revRes.exitCode === 0 && revRes.stdout.trim()) {
          gitBranch = revRes.stdout.trim();
        }
      }
    } catch (_) {
      // Non-git fallback
    }

    // Update coordinator's workspace
    this.coordinator.switchWorkspace(target);

    // Render sleek TerminalUI card
    TerminalUI.renderWorkspaceSwitchedCard(target, gitBranch);

    // System directory warning if applicable
    if (isSystemDirectory(target)) {
      TerminalUI.renderSystemDirWarning();
    }
  }

  private async handleSlashCommand(cmdStr: string): Promise<void> {
    const [cmd] = cmdStr.split(' ');

    switch (cmd.toLowerCase()) {
      case '/help':
        console.log(`
  ${ANSI.bold}Nomin Code Slash Commands:${ANSI.reset}
    ${ANSI.cyan}/help${ANSI.reset}         Show this catalog of commands
    ${ANSI.cyan}/cd <path>${ANSI.reset}    Switch active working directory and git context
    ${ANSI.cyan}/status${ANSI.reset}       Display active Blackboard DAG and agent worktree status
    ${ANSI.cyan}/repomap${ANSI.reset}      Generate and view PageRank-ranked repository symbol outline
    ${ANSI.cyan}/models${ANSI.reset}       Display user-selected models and active configuration
    ${ANSI.cyan}/mode <solo|team>${ANSI.reset} Switch between SOLO (1 model) and TEAM (2-5 agents) mode
    ${ANSI.cyan}/team <role>=<model>${ANSI.reset} Assign a model to an agent role (e.g. coder=<model>)
    ${ANSI.cyan}/config${ANSI.reset}       Display active rate-limits and provider settings
    ${ANSI.cyan}/clear${ANSI.reset}        Clear the terminal screen
    ${ANSI.cyan}/exit${ANSI.reset}         Exit Nomin Code REPL
        `);
        break;

      case '/cd': {
        const parts = cmdStr.split(' ');
        const rawPath = parts.slice(1).join(' ').trim();
        await this.handleDirectorySwitch(rawPath);
        break;
      }

      case '/status': {
        const state = this.coordinator.blackboard.getState();
        const tasks = Object.values(state.taskDAG.tasks);
        console.log(`\n  ${ANSI.bold}Active Swarm Task Graph (${tasks.length} tasks):${ANSI.reset}`);
        if (tasks.length === 0) {
          console.log(`  ${ANSI.dim}(No active tasks on Blackboard. Ready for user objective.)${ANSI.reset}\n`);
        } else {
          for (const t of tasks) {
            const statusColor = t.status === 'VERIFIED' ? ANSI.green : t.status === 'IN_PROGRESS' ? ANSI.yellow : ANSI.gray;
            console.log(`  [${statusColor}${t.status}${ANSI.reset}] ${t.id}: ${t.title} (Role: ${t.assignedRole})`);
          }
          console.log();
        }
        break;
      }

      case '/repomap': {
        const activeWorkdir = this.configManager.getConfig().workdir;
        console.log(`\n  ${ANSI.dim}Generating PageRank repository map for ${activeWorkdir}...${ANSI.reset}\n`);
        const result = RepoMapEngine.generate({ repoPath: activeWorkdir, maxTokens: 1024 });
        console.log(result.mapText);
        console.log();
        break;
      }

      case '/models': {
        const cfg = this.configManager.getConfig();
        console.log(`\n  ${ANSI.bold}Model Selection & Runtime Configuration:${ANSI.reset}`);
        console.log(`    Mode:               ${ANSI.brightCyan}${cfg.mode.toUpperCase()}${ANSI.reset}`);
        console.log(`    Selected Pool:      ${cfg.selectedModels && cfg.selectedModels.length > 0 ? cfg.selectedModels.join(', ') : ANSI.dim + '(none - run nomin setup or nomin model add)' + ANSI.reset}`);
        if (cfg.mode === 'solo') {
          console.log(`    Active Model (SOLO):${ANSI.brightGreen} ${cfg.activeModel || '(unassigned)'}${ANSI.reset}`);
        } else {
          console.log(`    Team Role Mappings:`);
          const roles = cfg.roles || {};
          if (Object.keys(roles).length === 0) {
            console.log(`      ${ANSI.dim}(no roles assigned yet - use /team role=<model>)${ANSI.reset}`);
          } else {
            for (const [r, m] of Object.entries(roles)) {
              console.log(`      ${r}: ${ANSI.brightCyan}${m}${ANSI.reset}`);
            }
          }
        }
        console.log();
        break;
      }

      case '/mode': {
        const parts = cmdStr.split(' ');
        const targetMode = parts[1]?.toLowerCase();
        if (targetMode === 'solo' || targetMode === 'team') {
          this.configManager.setMode(targetMode);
          console.log(`\n  ${ANSI.green}✔ Swarm mode set to ${targetMode.toUpperCase()}${ANSI.reset}\n`);
        } else {
          console.log(`\n  Usage: /mode <solo|team>\n`);
        }
        break;
      }

      case '/team': {
        const parts = cmdStr.split(' ');
        const assignment = parts[1];
        if (assignment && assignment.includes('=')) {
          const [role, modelId] = assignment.split('=');
          this.configManager.setTeamRole(role.trim(), modelId.trim());
          console.log(`\n  ${ANSI.green}✔ Team role '${role.trim()}' assigned to '${modelId.trim()}'${ANSI.reset}\n`);
        } else {
          const roles = this.configManager.getConfig().roles || {};
          console.log(`\n  Current Team Roles:`);
          for (const [r, m] of Object.entries(roles)) {
            console.log(`    ${r} = ${m}`);
          }
          console.log(`  Usage to assign: /team <role>=<model-id>\n`);
        }
        break;
      }

      case '/config': {
        const cfg = this.configManager.getConfig();
        const prov = cfg.providers[cfg.activeProvider] || {
          id: cfg.activeProvider,
          name: cfg.activeProvider.toUpperCase(),
          baseUrl: 'Unknown',
          defaultRpm: 120,
          defaultTpm: 300000,
          defaultConcurrency: 4,
        };
        console.log(`\n  ${ANSI.bold}Active Provider Configuration:${ANSI.reset}`);
        console.log(`    Provider ID:  ${prov.id} (${prov.name})`);
        console.log(`    Endpoint URL: ${prov.baseUrl}`);
        console.log(`    Rate Quotas:  ${prov.defaultRpm} RPM | ${prov.defaultTpm.toLocaleString()} TPM | Concurrency: ${prov.defaultConcurrency}\n`);
        break;
      }

      case '/clear':
        console.clear();
        break;

      case '/exit':
      case '/quit':
        console.log(`\n  ${ANSI.gray}Goodbye from Nomin Code.${ANSI.reset}\n`);
        process.exit(0);

      default:
        console.log(`\n  ${ANSI.red}Unknown command: ${cmd}. Type /help for options.${ANSI.reset}\n`);
        break;
    }
  }
}

/**
 * Backwards compatibility alias
 */
export const ReplServer = NominREPL;
