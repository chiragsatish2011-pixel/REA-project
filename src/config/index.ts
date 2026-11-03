/**
 * Nomin Code: Configuration Manager & Environment Loader
 * Supports NVIDIA NIM, OpenAI, Anthropic, DeepSeek, and local Ollama/vLLM endpoints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface RoleModelConfig {
  architect: string;
  coder: string;
  tester: string;
  verifier: string;
}

export interface ProviderEndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultRpm: number;
  defaultTpm: number;
  defaultConcurrency: number;
}

export interface NominConfig {
  activeProvider: string;
  providers: Record<string, ProviderEndpointConfig>;
  roles: RoleModelConfig;
  workdir: string;
  stateDir: string;
  worktreeDir: string;
  maxTurnPerSubtask: number;
  enableDoDGate: boolean;
  enableTodoGate: boolean;
  enableWorktreeIsolation: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: NominConfig;

  private constructor(workdir: string = process.cwd()) {
    this.config = this.loadConfig(workdir);
  }

  public static getInstance(workdir?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(workdir);
    }
    return ConfigManager.instance;
  }

  public getConfig(): NominConfig {
    return this.config;
  }

  public updateConfig(partial: Partial<NominConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  private loadConfig(workdir: string): NominConfig {
    // 1. Load from environment variables
    this.loadDotEnv(workdir);

    const nominDir = path.join(workdir, '.nomin');
    const stateDir = path.join(nominDir, 'state');
    const worktreeDir = path.join(nominDir, 'worktrees');

    // Ensure required metadata directories exist
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    if (!fs.existsSync(worktreeDir)) {
      fs.mkdirSync(worktreeDir, { recursive: true });
    }

    const defaultProviders: Record<string, ProviderEndpointConfig> = {
      nim: {
        id: 'nim',
        name: 'NVIDIA NIM',
        baseUrl: process.env.NVIDIA_BASE_URL || DEFAULT_NIM_BASE_URL,
        apiKey: process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY || '',
        defaultRpm: 30,
        defaultTpm: 60000,
        defaultConcurrency: 4,
      },
      openai: {
        id: 'openai',
        name: 'OpenAI API',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
        defaultRpm: 60,
        defaultTpm: 150000,
        defaultConcurrency: 8,
      },
      deepseek: {
        id: 'deepseek',
        name: 'DeepSeek Official API',
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        defaultRpm: 60,
        defaultTpm: 100000,
        defaultConcurrency: 5,
      },
      ollama: {
        id: 'ollama',
        name: 'Ollama Local Host',
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama',
        defaultRpm: 120,
        defaultTpm: 500000,
        defaultConcurrency: 2,
      },
      vllm: {
        id: 'vllm',
        name: 'vLLM Local / Cluster',
        baseUrl: process.env.VLLM_BASE_URL || 'http://127.0.0.1:8000/v1',
        apiKey: process.env.VLLM_API_KEY || 'vllm',
        defaultRpm: 120,
        defaultTpm: 500000,
        defaultConcurrency: 4,
      },
    };

    const activeProvider = process.env.NOMIN_PROVIDER || 
      (process.env.NVIDIA_API_KEY ? 'nim' : 
       process.env.DEEPSEEK_API_KEY ? 'deepseek' : 
       process.env.OPENAI_API_KEY ? 'openai' : 'nim');

    // Default 4-agent model mappings
    const defaultRoles: RoleModelConfig = {
      architect: process.env.MODEL_ARCHITECT || 'deepseek-ai/deepseek-r1',
      coder: process.env.MODEL_CODER || 'qwen/qwen2.5-coder-32b-instruct',
      tester: process.env.MODEL_TESTER || 'qwen/qwen2.5-coder-32b-instruct',
      verifier: process.env.MODEL_VERIFIER || 'deepseek-ai/deepseek-r1',
    };

    let fileConfig: Partial<NominConfig> = {};
    const configPath = path.join(nominDir, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (err) {
        console.warn(`[ConfigManager] Failed to parse ${configPath}:`, err);
      }
    }

    return {
      activeProvider: fileConfig.activeProvider || activeProvider,
      providers: { ...defaultProviders, ...(fileConfig.providers || {}) },
      roles: { ...defaultRoles, ...(fileConfig.roles || {}) },
      workdir,
      stateDir,
      worktreeDir,
      maxTurnPerSubtask: fileConfig.maxTurnPerSubtask ?? 10,
      enableDoDGate: fileConfig.enableDoDGate ?? true,
      enableTodoGate: fileConfig.enableTodoGate ?? true,
      enableWorktreeIsolation: fileConfig.enableWorktreeIsolation ?? true,
      logLevel: fileConfig.logLevel || 'info',
    };
  }

  private loadDotEnv(dir: string): void {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          let val = trimmed.substring(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}
