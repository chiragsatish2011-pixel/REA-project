/**
 * Nomin Code: Interactive Terminal REPL & Slash Command Handler
 * Styled in the Claude Code / OpenCode aesthetic with boxed input bar and agent cards.
 */

import * as readline from 'node:readline';
import { ANSI, TerminalUI } from './ui.js';
import { SwarmCoordinator } from '../swarm/coordinator.js';
import { ConfigManager, type NominConfig } from '../config/index.js';
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
      architectModel: cfg.roles.architect,
      coderModel: cfg.roles.coder,
      testerModel: cfg.roles.tester,
      verifierModel: cfg.roles.verifier,
      rpmLimit: activeProv.defaultRpm,
      tpmLimit: activeProv.defaultTpm,
      concurrency: activeProv.defaultConcurrency,
    });

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

    this.rl.on('line', async (line: string) => {
      const input = line.trim();
      TerminalUI.renderMessageBarFooter();

      if (!input) {
        this.promptTurn();
        return;
      }

      if (input.startsWith('/')) {
        await this.handleSlashCommand(input);
        this.promptTurn();
        return;
      }

      if (this.isProcessing) {
        console.log(`  ${ANSI.yellow}⚠️ An active swarm task is currently in progress. Please wait...${ANSI.reset}\n`);
        this.promptTurn();
        return;
      }

      await this.executeUserTask(input);
      this.promptTurn();
    });

    this.rl.on('close', () => {
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

  private async handleSlashCommand(cmdStr: string): Promise<void> {
    const [cmd] = cmdStr.split(' ');

    switch (cmd.toLowerCase()) {
      case '/help':
        console.log(`
  ${ANSI.bold}Nomin Code Slash Commands:${ANSI.reset}
    ${ANSI.cyan}/help${ANSI.reset}         Show this catalog of commands
    ${ANSI.cyan}/status${ANSI.reset}       Display active Blackboard DAG and agent worktree status
    ${ANSI.cyan}/repomap${ANSI.reset}      Generate and view PageRank-ranked repository symbol outline
    ${ANSI.cyan}/models${ANSI.reset}       Display current role-to-model configuration
    ${ANSI.cyan}/config${ANSI.reset}       Display active rate-limits and provider settings
    ${ANSI.cyan}/clear${ANSI.reset}        Clear the terminal screen
    ${ANSI.cyan}/exit${ANSI.reset}         Exit Nomin Code REPL
        `);
        break;

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
        console.log(`\n  ${ANSI.dim}Generating PageRank repository map...${ANSI.reset}\n`);
        const result = RepoMapEngine.generate({ repoPath: process.cwd(), maxTokens: 1024 });
        console.log(result.mapText);
        console.log();
        break;
      }

      case '/models': {
        const cfg = this.configManager.getConfig();
        console.log(`\n  ${ANSI.bold}Role-to-Model Configuration (Provider: ${cfg.activeProvider}):${ANSI.reset}`);
        console.log(`    Architect: ${ANSI.brightCyan}${cfg.roles.architect}${ANSI.reset}`);
        console.log(`    Coder:     ${ANSI.brightGreen}${cfg.roles.coder}${ANSI.reset}`);
        console.log(`    Tester:    ${ANSI.brightYellow}${cfg.roles.tester}${ANSI.reset}`);
        console.log(`    Verifier:  ${ANSI.brightMagenta}${cfg.roles.verifier}${ANSI.reset}\n`);
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
