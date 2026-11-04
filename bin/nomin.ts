#!/usr/bin/env node
/**
 * Nomin Code: Main Executable CLI Binary
 * Bootstraps Provider layer, Tool engine, Swarm coordinator, and DoD verifier.
 * Supports interactive REPL mode, headless CI/CD execution, and live NIM model setup.
 * Zero hardcoded models — 100% user-controlled model catalog from NVIDIA NIM.
 */

import * as process from 'node:process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ConfigManager } from '../src/config/index.js';
import { SwarmCoordinator } from '../src/swarm/coordinator.js';
import { ReplServer } from '../src/cli/repl.js';
import { UI, ANSI } from '../src/cli/ui.js';
import { NominHttpClient } from '../src/provider/client.js';

export interface CliArgs {
  subcommand?: 'setup' | 'model' | 'mode' | 'team';
  subcommandArgs?: string[];
  model?: string;
  provider?: string;
  apiKey?: string;
  workdir?: string;
  headless: boolean;
  task?: string;
  concurrency?: number;
  help: boolean;
  version: boolean;
}

export function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {
    headless: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--version' || arg === '-v') {
      parsed.version = true;
    } else if (arg === '--headless') {
      parsed.headless = true;
    } else if (arg === '--model' && i + 1 < args.length) {
      parsed.model = args[++i];
    } else if (arg === '--provider' && i + 1 < args.length) {
      parsed.provider = args[++i];
    } else if (arg === '--api-key' && i + 1 < args.length) {
      parsed.apiKey = args[++i];
    } else if (arg === '--workdir' && i + 1 < args.length) {
      parsed.workdir = args[++i];
    } else if (arg === '--task' && i + 1 < args.length) {
      parsed.task = args[++i];
    } else if (arg === '--concurrency' && i + 1 < args.length) {
      parsed.concurrency = parseInt(args[++i], 10);
    } else if (!arg.startsWith('-')) {
      // Check for first-level subcommands
      if (!parsed.subcommand && ['setup', 'model', 'mode', 'team'].includes(arg)) {
        parsed.subcommand = arg as any;
        parsed.subcommandArgs = args.slice(i + 1);
        break;
      }

      // Check if arg is an existing directory path on disk (e.g. nomin ., nomin C:\..., nomin /var/www, nomin ..)
      let isDir = false;
      try {
        const resolved = path.resolve(arg);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          isDir = true;
        }
      } catch (_) {
        isDir = false;
      }

      if (isDir && !parsed.workdir) {
        parsed.workdir = path.resolve(arg);
      } else if (!parsed.task) {
        parsed.task = arg;
      }
    }
  }

  return parsed;
}

function printUsage(): void {
  const usage = `
${ANSI.bold}Nomin Code — Autonomous Multi-Agent AI Coding Harness${ANSI.reset}
${ANSI.dim}Model-agnostic swarm runtime for NVIDIA NIM and OpenAI-compatible endpoints.${ANSI.reset}

${ANSI.bold}USAGE:${ANSI.reset}
  nomin [OPTIONS] [path] [task]
  nomin setup
  nomin model <list|add|remove> [model-id]
  nomin mode <solo|team>
  nomin team set <role>=<model-id>
  nomin .
  nomin ./project "Implement feature X"
  nomin --task "Implement feature X" --headless

${ANSI.bold}SUBCOMMANDS:${ANSI.reset}
  ${ANSI.cyan}setup${ANSI.reset}                          Interactive setup: connect NIM API key & pick models
  ${ANSI.cyan}model list${ANSI.reset}                     List your selected models and live NIM catalog
  ${ANSI.cyan}model add <id>${ANSI.reset}                 Add a model from NIM catalog to your pool
  ${ANSI.cyan}model remove <id>${ANSI.reset}              Remove a model from your pool
  ${ANSI.cyan}mode <solo|team>${ANSI.reset}               Switch between SOLO (1 model) and TEAM (2-5 agents)
  ${ANSI.cyan}team set <role>=<id>${ANSI.reset}           Assign a model to a team role (e.g. coder=<id>)

${ANSI.bold}OPTIONS:${ANSI.reset}
  ${ANSI.cyan}--task <string>${ANSI.reset}                 The prompt / goal to execute
  ${ANSI.cyan}--headless${ANSI.reset}                      Run non-interactively and exit with status code (CI/CD mode)
  ${ANSI.cyan}--provider <name>${ANSI.reset}               Provider endpoint (nim, openai, deepseek, ollama, vllm)
  ${ANSI.cyan}--model <model-id>${ANSI.reset}              Model override for swarm workers
  ${ANSI.cyan}--api-key <key>${ANSI.reset}                 API Key for active provider
  ${ANSI.cyan}--workdir <path>${ANSI.reset}                Target workspace path (defaults to current directory)
  ${ANSI.cyan}--concurrency <n>${ANSI.reset}               Maximum concurrent agent tasks (default: 4)
  ${ANSI.cyan}-v, --version${ANSI.reset}                   Print version and exit
  ${ANSI.cyan}-h, --help${ANSI.reset}                      Show this help message
`;
  console.log(usage);
}

async function runInteractiveSetup(workdir: string): Promise<void> {
  const configManager = ConfigManager.getInstance(workdir);
  const cfg = configManager.getConfig();
  const prov = cfg.providers.nim || {
    id: 'nim',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKey: '',
    defaultRpm: 30,
    defaultTpm: 60000,
    defaultConcurrency: 4,
  };

  console.log(`\n  ${ANSI.bold}${ANSI.brightCyan}◆ NOMIN CODE SETUP — NVIDIA NIM Live Discovery${ANSI.reset}`);
  console.log(`  ${ANSI.dim}Nomin Code ships with 0 hardcoded models. Models come directly from your NIM account.${ANSI.reset}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

  try {
    let apiKey = prov.apiKey || process.env.NVIDIA_API_KEY || '';
    if (!apiKey) {
      apiKey = await ask(`  Enter your NVIDIA NIM API Key (nvapi-...): `);
      apiKey = apiKey.trim();
      if (!apiKey) {
        console.log(`\n  ${ANSI.red}API Key is required to fetch your live NIM model catalog.${ANSI.reset}\n`);
        return;
      }
      prov.apiKey = apiKey;
      configManager.updateConfig({ providers: { ...cfg.providers, nim: prov } });
      configManager.saveGlobalConfig();
    }

    console.log(`\n  ${ANSI.dim}Connecting to ${prov.baseUrl}/models...${ANSI.reset}`);
    const client = new NominHttpClient({
      config: {
        id: 'nim',
        name: 'NVIDIA NIM',
        type: 'nvidia-nim',
        baseURL: prov.baseUrl,
        apiKey,
      },
    });

    let models: Array<{ id: string }> = [];
    try {
      models = await client.listModels();
      console.log(`  ${ANSI.green}✔ Successfully connected! Found ${models.length} models in your NIM catalog.${ANSI.reset}\n`);
    } catch (err: any) {
      console.log(`  ${ANSI.red}✖ Failed to fetch models from NIM: ${err.message}${ANSI.reset}`);
      console.log(`  ${ANSI.dim}You can still add a model manually: nomin model add <model-id>${ANSI.reset}\n`);
      return;
    }

    const displayCount = Math.min(models.length, 30);
    console.log(`  ${ANSI.bold}Available Models in your NVIDIA NIM Catalog:${ANSI.reset}`);
    for (let i = 0; i < displayCount; i++) {
      console.log(`    ${ANSI.cyan}[${i + 1}]${ANSI.reset} ${models[i].id}`);
    }
    if (models.length > displayCount) {
      console.log(`    ${ANSI.dim}... and ${models.length - displayCount} more${ANSI.reset}`);
    }
    console.log();

    const choice = await ask(`  Enter the number or full model ID you want to select: `);
    const trimmed = choice.trim();
    let selectedId = '';
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= models.length) {
      selectedId = models[num - 1].id;
    } else if (trimmed) {
      selectedId = trimmed;
    }

    if (!selectedId) {
      console.log(`\n  ${ANSI.yellow}No model selected. Setup finished.${ANSI.reset}\n`);
      return;
    }

    configManager.setSoloModel(selectedId);
    console.log(`\n  ${ANSI.brightGreen}✔ Model successfully configured!${ANSI.reset}`);
    console.log(`  Selected Model: ${ANSI.brightCyan}${selectedId}${ANSI.reset}`);
    console.log(`  Swarm Mode:     ${ANSI.cyan}SOLO${ANSI.reset} (1 model with fresh-context DoD verifier gate)`);
    console.log(`\n  Start Nomin Code by running: ${ANSI.brightWhite}nomin${ANSI.reset}\n`);
  } finally {
    rl.close();
  }
}

async function handleModelCommand(subargs: string[], workdir: string): Promise<void> {
  const configManager = ConfigManager.getInstance(workdir);
  const action = subargs[0]?.toLowerCase() || 'list';
  const targetId = subargs[1];

  switch (action) {
    case 'list': {
      const cfg = configManager.getConfig();
      console.log(`\n  ${ANSI.bold}Your Selected Models Pool:${ANSI.reset}`);
      if (!cfg.selectedModels || cfg.selectedModels.length === 0) {
        console.log(`    ${ANSI.dim}(no models selected yet. Run 'nomin setup' or 'nomin model add <id>')${ANSI.reset}`);
      } else {
        for (const m of cfg.selectedModels) {
          const isSolo = m === cfg.activeModel ? ` ${ANSI.green}[ACTIVE SOLO]${ANSI.reset}` : '';
          console.log(`    • ${ANSI.brightCyan}${m}${ANSI.reset}${isSolo}`);
        }
      }
      console.log();
      break;
    }

    case 'add': {
      if (!targetId) {
        console.log(`\n  ${ANSI.red}Error: Model ID required. Usage: nomin model add <model-id>${ANSI.reset}\n`);
        return;
      }
      configManager.addModel(targetId);
      console.log(`\n  ${ANSI.green}✔ Added model '${targetId}' to pool.${ANSI.reset}\n`);
      break;
    }

    case 'remove': {
      if (!targetId) {
        console.log(`\n  ${ANSI.red}Error: Model ID required. Usage: nomin model remove <model-id>${ANSI.reset}\n`);
        return;
      }
      configManager.removeModel(targetId);
      console.log(`\n  ${ANSI.yellow}✔ Removed model '${targetId}'.${ANSI.reset}\n`);
      break;
    }

    default:
      console.log(`\n  Unknown model action: ${action}. Use: list, add, remove.\n`);
      break;
  }
}

async function handleModeCommand(subargs: string[], workdir: string): Promise<void> {
  const configManager = ConfigManager.getInstance(workdir);
  const targetMode = subargs[0]?.toLowerCase();
  const modelArg = subargs[1];

  if (targetMode === 'solo') {
    if (modelArg) {
      configManager.setSoloModel(modelArg);
    } else {
      configManager.setMode('solo');
    }
    console.log(`\n  ${ANSI.green}✔ Swarm mode set to SOLO (1 model with fresh-context DoD verifier)${ANSI.reset}\n`);
  } else if (targetMode === 'team') {
    configManager.setMode('team');
    console.log(`\n  ${ANSI.green}✔ Swarm mode set to TEAM (2-5 specialized agent roles)${ANSI.reset}\n`);
  } else {
    console.log(`\n  Usage: nomin mode <solo|team> [model-id]\n`);
  }
}

async function handleTeamCommand(subargs: string[], workdir: string): Promise<void> {
  const configManager = ConfigManager.getInstance(workdir);
  const action = subargs[0]?.toLowerCase();

  if (action === 'set' && subargs[1]) {
    const [role, modelId] = subargs[1].split('=');
    if (!role || !modelId) {
      console.log(`\n  Usage: nomin team set <role>=<model-id>\n`);
      return;
    }
    configManager.setTeamRole(role.trim(), modelId.trim());
    console.log(`\n  ${ANSI.green}✔ Team role '${role.trim()}' assigned to '${modelId.trim()}'${ANSI.reset}\n`);
  } else {
    const cfg = configManager.getConfig();
    console.log(`\n  ${ANSI.bold}Current Team Role Assignments:${ANSI.reset}`);
    const roles = cfg.roles || {};
    if (Object.keys(roles).length === 0) {
      console.log(`    ${ANSI.dim}(no roles assigned. Use: nomin team set <role>=<model-id>)${ANSI.reset}`);
    } else {
      for (const [r, m] of Object.entries(roles)) {
        console.log(`    • ${ANSI.brightCyan}${r}${ANSI.reset}: ${m}`);
      }
    }
    console.log();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log('@nomincode/cli v1.0.0');
    process.exit(0);
  }

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const workdir = path.resolve(args.workdir || process.cwd());
  const configManager = ConfigManager.getInstance(workdir);

  // Handle dedicated subcommands
  if (args.subcommand === 'setup') {
    await runInteractiveSetup(workdir);
    process.exit(0);
  } else if (args.subcommand === 'model') {
    await handleModelCommand(args.subcommandArgs || [], workdir);
    process.exit(0);
  } else if (args.subcommand === 'mode') {
    await handleModeCommand(args.subcommandArgs || [], workdir);
    process.exit(0);
  } else if (args.subcommand === 'team') {
    await handleTeamCommand(args.subcommandArgs || [], workdir);
    process.exit(0);
  }

  // Apply command-line configuration overrides
  if (args.provider) {
    configManager.updateConfig({ activeProvider: args.provider });
  }

  if (args.apiKey && args.provider) {
    const currentProviders = configManager.getConfig().providers;
    if (currentProviders[args.provider]) {
      currentProviders[args.provider].apiKey = args.apiKey;
      configManager.updateConfig({ providers: currentProviders });
    }
  }

  if (args.model) {
    configManager.setSoloModel(args.model);
  }

  const cfg = configManager.getConfig();

  if (cfg.isFallbackState) {
    UI.logAgent('SYSTEM', `${ANSI.yellow}Notice: Running in ${cfg.isSystemDir ? 'system-protected' : 'read-only'} directory.${ANSI.reset}`);
    UI.logAgent('SYSTEM', `${ANSI.yellow}State safely redirected to: ${cfg.stateDir}${ANSI.reset}`);
  }

  // Check if user has selected at least one model
  const hasModel = configManager.hasConfiguredModel();

  if (!hasModel && args.headless) {
    console.error(`\n  ${ANSI.brightRed}Error: No model selected.${ANSI.reset}`);
    console.error(`  Nomin Code ships with 0 default models. Models are 100% user-controlled.`);
    console.error(`  Run ${ANSI.cyan}nomin setup${ANSI.reset} or ${ANSI.cyan}nomin model add <model-id>${ANSI.reset} to select from your NVIDIA NIM account.\n`);
    process.exit(1);
  }

  const coordinator = new SwarmCoordinator({
    workspaceRoot: workdir,
    stateDir: cfg.stateDir,
    worktreeDir: cfg.worktreeDir,
    useGitWorktrees: cfg.enableWorktreeIsolation,
    mode: cfg.mode,
    activeModel: cfg.activeModel,
    roles: cfg.roles,
  });

  // Headless mode or batch task execution
  if (args.headless && args.task) {
    UI.logAgent('SYSTEM', `Bootstrapping Nomin Code in headless CI/CD mode for: "${args.task}"`);
    try {
      const result = await coordinator.orchestrate(args.task);
      if (result.success) {
        UI.logAgent('SYSTEM', `Execution completed successfully in ${(result.durationMs / 1000).toFixed(1)}s.`);
        process.exit(0);
      } else {
        UI.logAgent('SYSTEM', `Execution rejected: ${result.errors.join('; ')}`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`${ANSI.red}Headless execution failed: ${(err as Error).message}${ANSI.reset}`);
      process.exit(1);
    }
  }

  // Interactive REPL Mode
  const repl = new ReplServer({
    workdir,
    coordinator,
    config: configManager.getConfig(),
  });

  if (args.task) {
    // Start REPL and immediately dispatch initial task
    await repl.start();
    await repl.handleUserGoal(args.task);
  } else {
    await repl.start();
  }
}

const isDirectExecution = !!process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('nomin.js') ||
  process.argv[1].endsWith('nomin.ts') ||
  process.argv[1].endsWith('nomin')
) && !process.env.NODE_TEST_CONTEXT;

if (isDirectExecution) {
  main().catch((err) => {
    console.error(`${ANSI.red}Fatal error: ${err.message}${ANSI.reset}`);
    process.exit(1);
  });
}
