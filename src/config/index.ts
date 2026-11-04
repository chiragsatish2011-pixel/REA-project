/**
 * Nomin Code: Configuration Manager & Environment Loader
 * Supports NVIDIA NIM, OpenAI, Anthropic, DeepSeek, and local Ollama/vLLM endpoints.
 * State & Filesystem Resilience Architecture.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export type SwarmMode = 'solo' | 'team';

export interface RoleModelConfig {
  [roleName: string]: string;
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
  mode: SwarmMode;
  activeModel?: string;
  selectedModels: string[];
  roles: RoleModelConfig;
  activeProvider: string;
  providers: Record<string, ProviderEndpointConfig>;
  workdir: string;
  stateDir: string;
  worktreeDir: string;
  maxTurnPerSubtask: number;
  enableDoDGate: boolean;
  enableTodoGate: boolean;
  enableWorktreeIsolation: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  isSystemDir?: boolean;
  isFallbackState?: boolean;
  globalConfigDir?: string;
}

const DEFAULT_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/**
 * Checks whether a given directory (or its closest ancestor if non-existent) is writable.
 */
export function isWritableDir(dir: string): boolean {
  try {
    let target = path.resolve(dir);

    // If dir does not exist, navigate upwards to find nearest existing directory
    while (!fs.existsSync(target)) {
      const parent = path.dirname(target);
      if (parent === target) break; // Reached filesystem root
      target = parent;
    }

    if (!fs.existsSync(target)) {
      return false;
    }

    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      return false;
    }

    // Fast check via accessSync
    try {
      fs.accessSync(target, fs.constants.W_OK | fs.constants.R_OK);
    } catch {
      return false;
    }

    // Concrete test write to guarantee filesystem write permissions (handles Windows ACL quirks)
    const probeFile = path.join(
      target,
      `.nomin_write_test_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    try {
      fs.writeFileSync(probeFile, 'test', 'utf8');
      fs.unlinkSync(probeFile);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Checks whether a directory is a system-protected path.
 * Windows: SystemRoot (C:\Windows), System32, Program Files, ProgramData, drive roots.
 * POSIX: /, /bin, /sbin, /usr, /etc, /var, /lib, /lib64, /opt, /sys, /proc, /dev, /boot, /root.
 */
export function isSystemDir(dir: string): boolean {
  try {
    const raw = dir.trim();
    const resolved = path.resolve(dir);

    if (process.platform === 'win32') {
      // Direct drive root check (e.g., "C:", "C:\", "D:")
      if (/^[a-zA-Z]:\\?$/.test(raw)) {
        return true;
      }

      const normalized = path.normalize(resolved).toLowerCase();

      const envKeys = [
        'SystemRoot',
        'windir',
        'ProgramFiles',
        'ProgramFiles(x86)',
        'ProgramW6432',
        'ProgramData',
        'CommonProgramFiles',
        'CommonProgramFiles(x86)',
      ];

      const sysDirs: string[] = [];
      for (const k of envKeys) {
        const val = process.env[k];
        if (val) sysDirs.push(val);
      }

      // Hardcoded standard Windows system roots
      sysDirs.push(
        'c:\\windows',
        'c:\\program files',
        'c:\\program files (x86)',
        'c:\\programdata'
      );

      for (const s of sysDirs) {
        const normS = path.normalize(s).toLowerCase();
        if (normalized === normS || normalized.startsWith(normS + path.sep)) {
          return true;
        }
      }

      // Root of any drive on Windows (e.g., C:\, D:\) where creating project folders is restricted
      const parsed = path.parse(resolved);
      const normRoot = path.normalize(parsed.root).toLowerCase();
      if (normalized === normRoot || normalized === normRoot.replace(/\\$/, '')) {
        return true;
      }
    } else {
      // POSIX root and protected system prefixes
      if (resolved === '/') {
        return true;
      }

      const protectedPrefixes = [
        '/bin',
        '/sbin',
        '/usr',
        '/etc',
        '/var',
        '/lib',
        '/lib64',
        '/opt',
        '/sys',
        '/proc',
        '/dev',
        '/boot',
        '/root',
      ];

      for (const p of protectedPrefixes) {
        if (resolved === p || resolved.startsWith(p + '/')) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

export const isSystemDirectory = isSystemDir;

/**
 * Computes a safe, deterministic slug and hash for a workspace path.
 */
export function hashOrSlug(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const basename = path.basename(resolved) || 'root';
  const cleanBase = basename.replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 10);
  return `${cleanBase}_${hash}`;
}

/**
 * Safely creates a directory with multi-tier fallback: target -> fallbackDir -> os.homedir()/.nomin -> os.tmpdir()/.nomin.
 */
export function safeMkdirSync(targetDir: string, fallbackDir?: string): string {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    if (isWritableDir(targetDir)) {
      return targetDir;
    }
  } catch {
    // Continue to fallbacks
  }

  if (fallbackDir) {
    try {
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
      }
      if (isWritableDir(fallbackDir)) {
        return fallbackDir;
      }
    } catch {
      // Continue to next fallback
    }
  }

  // Fallback to ~/.nomin
  try {
    const homeNomin = path.join(os.homedir(), '.nomin');
    if (!fs.existsSync(homeNomin)) {
      fs.mkdirSync(homeNomin, { recursive: true });
    }
    if (isWritableDir(homeNomin)) {
      return homeNomin;
    }
  } catch {
    // Continue to tmp fallback
  }

  // Fallback to tmpdir/.nomin
  try {
    const tmpNomin = path.join(os.tmpdir(), '.nomin');
    if (!fs.existsSync(tmpNomin)) {
      fs.mkdirSync(tmpNomin, { recursive: true });
    }
    return tmpNomin;
  } catch {
    return os.tmpdir();
  }
}

export interface ResolvedNominPaths {
  stateDir: string;
  worktreeDir: string;
  globalConfigDir: string;
  isSystemDir: boolean;
  isFallbackState: boolean;
}

/**
 * Resolves bulletproof paths for Nomin state and worktrees.
 */
export function resolveNominPaths(workdir: string): ResolvedNominPaths {
  const isSys = isSystemDir(workdir);
  const isWritable = isWritableDir(workdir);

  const globalConfigDir = path.join(os.homedir(), '.nomin');
  safeMkdirSync(globalConfigDir);

  // If workdir is writable and NOT a system directory, keep metadata inside workdir/.nomin
  if (!isSys && isWritable) {
    const candidateNominDir = path.join(workdir, '.nomin');
    const candidateStateDir = path.join(candidateNominDir, 'state');
    const candidateWorktreeDir = path.join(candidateNominDir, 'worktrees');

    try {
      if (!fs.existsSync(candidateStateDir)) {
        fs.mkdirSync(candidateStateDir, { recursive: true });
      }
      if (!fs.existsSync(candidateWorktreeDir)) {
        fs.mkdirSync(candidateWorktreeDir, { recursive: true });
      }

      return {
        stateDir: candidateStateDir,
        worktreeDir: candidateWorktreeDir,
        globalConfigDir,
        isSystemDir: false,
        isFallbackState: false,
      };
    } catch {
      // If mkdir throws EPERM or any filesystem error, seamlessly fall through to global workspace fallback
    }
  }

  // Fallback path: store in ~/.nomin/workspaces/<hashOrSlug>
  const slug = hashOrSlug(workdir);
  const fallbackWorkspaceBase = path.join(globalConfigDir, 'workspaces', slug);
  const fallbackStateDir = path.join(fallbackWorkspaceBase, 'state');
  const fallbackWorktreeDir = path.join(fallbackWorkspaceBase, 'worktrees');

  try {
    if (!fs.existsSync(fallbackStateDir)) {
      fs.mkdirSync(fallbackStateDir, { recursive: true });
    }
    if (!fs.existsSync(fallbackWorktreeDir)) {
      fs.mkdirSync(fallbackWorktreeDir, { recursive: true });
    }

    return {
      stateDir: fallbackStateDir,
      worktreeDir: fallbackWorktreeDir,
      globalConfigDir,
      isSystemDir: isSys,
      isFallbackState: true,
    };
  } catch {
    // If ~/.nomin is also restricted, fallback to os.tmpdir()/.nomin/workspaces/<slug>
    const tmpWorkspaceBase = path.join(os.tmpdir(), '.nomin', 'workspaces', slug);
    const tmpStateDir = path.join(tmpWorkspaceBase, 'state');
    const tmpWorktreeDir = path.join(tmpWorkspaceBase, 'worktrees');

    safeMkdirSync(tmpStateDir);
    safeMkdirSync(tmpWorktreeDir);

    return {
      stateDir: tmpStateDir,
      worktreeDir: tmpWorktreeDir,
      globalConfigDir: path.join(os.tmpdir(), '.nomin'),
      isSystemDir: isSys,
      isFallbackState: true,
    };
  }
}

export class ConfigManager {
  private static instance: ConfigManager;
  private config: NominConfig;

  private constructor(workdir: string = process.cwd()) {
    this.config = this.loadConfig(workdir);
  }

  public static getInstance(workdir?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(workdir);
    } else if (workdir && path.resolve(workdir) !== path.resolve(ConfigManager.instance.config.workdir)) {
      ConfigManager.instance = new ConfigManager(workdir);
    }
    return ConfigManager.instance;
  }

  public static resetInstance(): void {
    ConfigManager.instance = undefined as any;
  }

  public getConfig(): NominConfig {
    return this.config;
  }

  public updateConfig(partial: Partial<NominConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  public hasConfiguredModel(): boolean {
    if (this.config.mode === 'solo') {
      return Boolean(this.config.activeModel);
    }
    return Object.keys(this.config.roles).length > 0;
  }

  public setMode(mode: SwarmMode): void {
    this.updateConfig({ mode });
    this.saveGlobalConfig();
  }

  public setSoloModel(modelId: string): void {
    this.addModel(modelId);
    this.updateConfig({ mode: 'solo', activeModel: modelId });
    this.saveGlobalConfig();
  }

  public setTeamRole(role: string, modelId: string): void {
    this.addModel(modelId);
    const roles = { ...this.config.roles, [role]: modelId };
    this.updateConfig({ mode: 'team', roles });
    this.saveGlobalConfig();
  }

  public addModel(modelId: string): void {
    const trimmed = modelId.trim();
    if (!trimmed) return;
    const existing = new Set(this.config.selectedModels || []);
    existing.add(trimmed);
    const selectedModels = Array.from(existing);
    const update: Partial<NominConfig> = { selectedModels };
    if (!this.config.activeModel) {
      update.activeModel = trimmed;
    }
    this.updateConfig(update);
    this.saveGlobalConfig();
  }

  public removeModel(modelId: string): void {
    const trimmed = modelId.trim();
    const selectedModels = (this.config.selectedModels || []).filter(m => m !== trimmed);
    const roles = { ...this.config.roles };
    for (const [r, m] of Object.entries(roles)) {
      if (m === trimmed) delete roles[r];
    }
    const update: Partial<NominConfig> = { selectedModels, roles };
    if (this.config.activeModel === trimmed) {
      update.activeModel = selectedModels[0] || undefined;
    }
    this.updateConfig(update);
    this.saveGlobalConfig();
  }

  public saveGlobalConfig(partial?: Partial<NominConfig>): void {
    if (partial) {
      this.updateConfig(partial);
    }
    try {
      const globalDir = this.config.globalConfigDir || path.join(os.homedir(), '.nomin');
      safeMkdirSync(globalDir);
      const globalPath = path.join(globalDir, 'config.json');
      const toSave = {
        mode: this.config.mode,
        activeModel: this.config.activeModel,
        selectedModels: this.config.selectedModels,
        activeProvider: this.config.activeProvider,
        providers: this.config.providers,
        roles: this.config.roles,
        maxTurnPerSubtask: this.config.maxTurnPerSubtask,
        enableDoDGate: this.config.enableDoDGate,
        enableTodoGate: this.config.enableTodoGate,
        enableWorktreeIsolation: this.config.enableWorktreeIsolation,
        logLevel: this.config.logLevel,
      };
      fs.writeFileSync(globalPath, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (err) {
      console.warn('[ConfigManager] Failed to persist global config:', err);
    }
  }

  private loadConfig(workdir: string): NominConfig {
    // 1. Load from environment variables (.env in workspace, and ~/.nomin/.env)
    this.loadDotEnv(workdir);
    const globalEnvPath = path.join(os.homedir(), '.nomin', '.env');
    if (fs.existsSync(globalEnvPath)) {
      this.loadEnvFromFile(globalEnvPath);
    }

    // 2. Resolve resilient paths
    const paths = resolveNominPaths(workdir);

    // 3. Load global config (~/.nomin/config.json)
    const globalConfigPath = path.join(paths.globalConfigDir, 'config.json');
    let globalFileConfig: Partial<NominConfig> = {};
    if (fs.existsSync(globalConfigPath)) {
      try {
        globalFileConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
      } catch (err) {
        console.warn(`[ConfigManager] Failed to parse global config ${globalConfigPath}:`, err);
      }
    }

    // 4. Load local config if present
    let localFileConfig: Partial<NominConfig> = {};
    const localConfigPath = paths.isFallbackState
      ? path.join(path.dirname(paths.stateDir), 'config.json')
      : path.join(workdir, '.nomin', 'config.json');

    if (fs.existsSync(localConfigPath) && localConfigPath !== globalConfigPath) {
      try {
        localFileConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
      } catch (err) {
        console.warn(`[ConfigManager] Failed to parse local config ${localConfigPath}:`, err);
      }
    }

    const fileRoles: Partial<RoleModelConfig> = {
      ...(globalFileConfig.roles || {}),
      ...(localFileConfig.roles || {}),
    };

    const fileProviders: Record<string, ProviderEndpointConfig> = {
      ...(globalFileConfig.providers || {}),
      ...(localFileConfig.providers || {}),
    };

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
      localFileConfig.activeProvider ||
      globalFileConfig.activeProvider ||
      (process.env.NVIDIA_API_KEY ? 'nim' : 
       process.env.DEEPSEEK_API_KEY ? 'deepseek' : 
       process.env.OPENAI_API_KEY ? 'openai' : 'nim');

    // User-controlled mode (default: solo)
    const mode: SwarmMode = (localFileConfig.mode || globalFileConfig.mode || 'solo') as SwarmMode;

    // User-selected models pool (NO built-in or hardcoded models)
    const selectedModels: string[] = Array.from(new Set([
      ...(globalFileConfig.selectedModels || []),
      ...(localFileConfig.selectedModels || []),
    ]));

    const activeModel: string | undefined = process.env.NOMIN_MODEL ||
      localFileConfig.activeModel ||
      globalFileConfig.activeModel ||
      (selectedModels.length > 0 ? selectedModels[0] : undefined);

    // User-configured team roles (NO built-in or hardcoded role models)
    const resolvedRoles: RoleModelConfig = {
      ...(globalFileConfig.roles || {}),
      ...(localFileConfig.roles || {}),
    };
    if (process.env.MODEL_CODER) resolvedRoles.coder = process.env.MODEL_CODER;
    if (process.env.MODEL_ARCHITECT) resolvedRoles.architect = process.env.MODEL_ARCHITECT;
    if (process.env.MODEL_TESTER) resolvedRoles.tester = process.env.MODEL_TESTER;
    if (process.env.MODEL_VERIFIER) resolvedRoles.verifier = process.env.MODEL_VERIFIER;

    return {
      mode,
      activeModel,
      selectedModels,
      activeProvider,
      providers: { ...defaultProviders, ...fileProviders },
      roles: resolvedRoles,
      workdir,
      stateDir: paths.stateDir,
      worktreeDir: paths.worktreeDir,
      maxTurnPerSubtask: localFileConfig.maxTurnPerSubtask ?? globalFileConfig.maxTurnPerSubtask ?? 10,
      enableDoDGate: localFileConfig.enableDoDGate ?? globalFileConfig.enableDoDGate ?? true,
      enableTodoGate: localFileConfig.enableTodoGate ?? globalFileConfig.enableTodoGate ?? true,
      enableWorktreeIsolation: localFileConfig.enableWorktreeIsolation ?? globalFileConfig.enableWorktreeIsolation ?? true,
      logLevel: localFileConfig.logLevel || globalFileConfig.logLevel || 'info',
      isSystemDir: paths.isSystemDir,
      isFallbackState: paths.isFallbackState,
      globalConfigDir: paths.globalConfigDir,
    };
  }

  private loadEnvFromFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
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
    } catch {
      // Ignore unreadable env file
    }
  }

  private loadDotEnv(dir: string): void {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      this.loadEnvFromFile(envPath);
    }
  }
}
