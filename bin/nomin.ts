#!/usr/bin/env node
/**
 * Nomin Code: Main Executable CLI Binary
 * Bootstraps Provider layer, Tool engine, Swarm coordinator, and DoD verifier.
 * Supports interactive REPL mode and headless CI/CD execution.
 */

import * as process from 'node:process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigManager } from '../src/config/index.js';
import { SwarmCoordinator } from '../src/swarm/coordinator.js';
import { ReplServer } from '../src/cli/repl.js';
import { UI, ANSI } from '../src/cli/ui.js';

export interface CliArgs {
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

${ANSI.bold}USAGE:${ANSI.reset}
  nomin [OPTIONS] [path] [task]
  nomin .
  nomin ./project "Implement feature X"
  nomin "Implement feature X"
  nomin --task "Implement feature X" --headless

${ANSI.bold}ARGUMENTS:${ANSI.reset}
  ${ANSI.cyan}[path]${ANSI.reset}                         Working directory path (e.g. '.', '..', 'C:\\path', '/var/www')
  ${ANSI.cyan}[task]${ANSI.reset}                         Initial prompt / objective to execute

${ANSI.bold}OPTIONS:${ANSI.reset}
  ${ANSI.cyan}--task <string>${ANSI.reset}         The prompt / goal to execute
  ${ANSI.cyan}--headless${ANSI.reset}              Run non-interactively and exit with status code (CI/CD mode)
  ${ANSI.cyan}--provider <name>${ANSI.reset}       Provider endpoint (nim, openai, deepseek, ollama, vllm)
  ${ANSI.cyan}--model <model-id>${ANSI.reset}      Model override for swarm workers
  ${ANSI.cyan}--api-key <key>${ANSI.reset}         API Key for active provider
  ${ANSI.cyan}--workdir <path>${ANSI.reset}        Target workspace path (defaults to current directory)
  ${ANSI.cyan}--concurrency <n>${ANSI.reset}       Maximum concurrent agent tasks (default: 4)
  ${ANSI.cyan}-v, --version${ANSI.reset}           Print version and exit
  ${ANSI.cyan}-h, --help${ANSI.reset}              Show this help message
`;
  console.log(usage);
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
    const cfg = configManager.getConfig();
    configManager.updateConfig({
      roles: {
        architect: args.model,
        coder: args.model,
        tester: args.model,
        verifier: args.model,
      },
    });
  }

  const cfg = configManager.getConfig();

  if (cfg.isFallbackState) {
    UI.logAgent('SYSTEM', `${ANSI.yellow}Notice: Running in ${cfg.isSystemDir ? 'system-protected' : 'read-only'} directory.${ANSI.reset}`);
    UI.logAgent('SYSTEM', `${ANSI.yellow}State safely redirected to: ${cfg.stateDir}${ANSI.reset}`);
  }

  const coordinator = new SwarmCoordinator({
    workspaceRoot: workdir,
    stateDir: cfg.stateDir,
    worktreeDir: cfg.worktreeDir,
    useGitWorktrees: cfg.enableWorktreeIsolation,
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
