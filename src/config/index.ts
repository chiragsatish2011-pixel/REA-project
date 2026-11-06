/**
 * Nomin Code: Configuration Manager & Environment Loader
 * Supports NVIDIA NIM, OpenAI, Anthropic, DeepSeek, and local Ollama/vLLM endpoints.
 * State & Filesystem Resilience Architecture.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ReasoningEffort } from '../provider/types.js';
import { ModelCatalogManager } from '../provider/model-catalog.js';

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
  reasoningEffort?: ReasoningEffort;
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
  modelSettings?: Record<string, any>;
  fallbackChains?: Record<string, string[]>;
  favorites?: string[];
  recentlyUsed?: string[];
  retiredModels?: Record<string, string>;
  autoApprovePermissions?: boolean;
  planMode?: boolean;
}

const DEFAULT_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/**
 * Resolves the root installation directory of the Nomin Code package.
 */
export function findInstallRootDir(): string {
  try {
    let current = path.dirname(fileURLToPath(import.meta.url));
    while (current && current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        return current;
      }
      current = path.dirname(current);
    }
  } catch (_) {}
  return path.resolve('.');
}

/**
 * Sanitizes an API key string by stripping accidental quotes, whitespace, \r\n, and Bearer prefix.
 */
export function sanitizeApiKey(rawKey?: string): string {
  if (!rawKey) return '';
  return rawKey
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/[\r\n]+/g, '')
    .trim();
}

/**
 * Masks an API key for safe user display (e.g. nvapi-abcd...wxyz or NONE FOUND).
 */
export function maskApiKey(key?: string): string {
  if (!key) return 'NONE FOUND';
  const clean = sanitizeApiKey(key);
  if (!clean) return 'NONE FOUND';
  if (clean.length <= 8) return '••••••••';
  const prefixLen = clean.startsWith('nvapi-') ? 10 : 8;
  return `${clean.slice(0, prefixLen)}...${clean.slice(-4)}`;
}

export interface ResolvedApiKeyInfo {
  apiKey: string;
  source: string;
  masked: string;
}

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
 * Checks whether a directory is the user's home directory.
 */
export function isHomeDir(dir: string): boolean {
  try {
    const resolved = path.resolve(dir);
    const home = path.resolve(os.homedir());
    return resolved.toLowerCase() === home.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Checks whether a directory is a drive root (e.g. C:\ or /).
 */
export function isDriveRootDir(dir: string): boolean {
  try {
    const resolved = path.resolve(dir);
    const parsed = path.parse(resolved);
    return resolved.toLowerCase() === parsed.root.toLowerCase();
  } catch {
    return false;
  }
}

export interface WorkspaceSafetyAudit {
  isProject: boolean;
  isHome: boolean;
  isDriveRoot: boolean;
  isSystemDir: boolean;
  projectMarkers: string[];
  warning?: string;
}

/**
 * Inspects a directory to determine whether it is a legitimate project workspace
 * versus a user home directory, drive root, or system path.
 */
export function detectWorkspaceProject(dir: string): WorkspaceSafetyAudit {
  const isHome = isHomeDir(dir);
  const isDriveRoot = isDriveRootDir(dir);
  const isSys = isSystemDir(dir);

  const markers = [
    '.git',
    'package.json',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'requirements.txt',
    'setup.py',
    'pom.xml',
    'build.gradle',
    'Makefile',
    'CMakeLists.txt',
    'composer.json',
    'tsconfig.json',
  ];

  const foundMarkers: string[] = [];
  try {
    if (fs.existsSync(dir)) {
      for (const m of markers) {
        if (fs.existsSync(path.join(dir, m))) {
          foundMarkers.push(m);
        }
      }
    }
  } catch (_) {}

  // A folder is considered a valid project if it has project markers AND is not a system/home root
  const isProject = foundMarkers.length > 0 && !isSys && !isDriveRoot && !isHome;

  let warning: string | undefined;
  if (isHome) {
    warning = 'Current workspace is your user home directory (~). Automated indexing and destructive edits are paused for safety. Use /cd <path> to open a project repo.';
  } else if (isSys || isDriveRoot) {
    warning = 'Current workspace is a system or drive root. Direct modifications and automated indexing are blocked for safety. Use /cd to switch to a project directory.';
  } else if (!isProject) {
    warning = 'Directory does not contain standard project manifests (.git, package.json, pyproject.toml, Cargo.toml). RepoMap disabled until a project is opened.';
  }

  return {
    isProject,
    isHome,
    isDriveRoot,
    isSystemDir: isSys,
    projectMarkers: foundMarkers,
    warning,
  };
}

/**
 * Validates whether a model identifier is compatible with a given provider.
 * Prevents carrying model IDs across incompatible providers (e.g. NIM meta/llama model to OpenAI).
 */
export function validateModelProviderMatch(providerId: string, modelId?: string): { valid: boolean; error?: string } {
  if (!modelId) {
    return { valid: true };
  }

  const p = (providerId || '').toLowerCase();
  const m = modelId.trim();

  if (p === 'openai') {
    // OpenAI models do NOT contain organization prefixes like meta/, nvidia/, mistralai/, deepseek-ai/, qwen/
    if (m.includes('/') && !m.startsWith('openai/')) {
      return {
        valid: false,
        error: `Model '${m}' is not an OpenAI model. It appears to belong to another provider. Please pick an OpenAI model or switch provider via /provider.`,
      };
    }
  } else if (p === 'nim') {
    if (m.toLowerCase().startsWith('gpt-') || m.toLowerCase().startsWith('o1') || m.toLowerCase().startsWith('o3')) {
      return {
        valid: false,
        error: `Model '${m}' is an OpenAI model and is not available on NVIDIA NIM. Use a NIM-hosted model or switch provider to OpenAI.`,
      };
    }
  } else if (p === 'anthropic') {
    if (!m.toLowerCase().startsWith('claude')) {
      return {
        valid: false,
        error: `Model '${m}' is not an Anthropic model. Anthropic requires a Claude model.`,
      };
    }
  } else if (p === 'deepseek') {
    if (!m.toLowerCase().startsWith('deepseek')) {
      return {
        valid: false,
        error: `Model '${m}' is not a DeepSeek model. DeepSeek Official API requires a DeepSeek model.`,
      };
    }
  }

  return { valid: true };
}

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

  const globalConfigDir = process.env.NOMIN_GLOBAL_DIR || path.join(os.homedir(), '.nomin');
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

  public static sanitizeApiKey(key?: string): string {
    return sanitizeApiKey(key);
  }

  public static maskApiKey(key?: string): string {
    return maskApiKey(key);
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
    const trimmed = modelId.trim();
    const match = validateModelProviderMatch(this.config.activeProvider, trimmed);
    if (!match.valid) {
      throw new Error(match.error);
    }
    this.addModel(trimmed);
    this.updateConfig({ mode: 'solo', activeModel: trimmed });
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
        reasoningEffort: this.config.reasoningEffort,
        modelSettings: this.config.modelSettings || {},
        fallbackChains: this.config.fallbackChains || {},
        favorites: this.config.favorites || [],
        recentlyUsed: this.config.recentlyUsed || [],
        retiredModels: this.config.retiredModels || {},
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

  public markModelRetired(modelId: string, reason: string): void {
    const trimmed = modelId.trim();
    const retiredModels = { ...(this.config.retiredModels || {}), [trimmed]: reason };
    this.updateConfig({ retiredModels });
    this.saveGlobalConfig();
  }

  public isModelRetired(modelId: string): boolean {
    return Boolean(this.config.retiredModels?.[modelId.trim()]);
  }

  public getModelSettings(modelId?: string): any {
    const target = (modelId || this.config.activeModel || '').trim();
    if (!target) return undefined;
    return this.config.modelSettings?.[target];
  }

  public setModelSettings(modelId: string, settings: any): void {
    const target = modelId.trim();
    const current = this.config.modelSettings?.[target] || { modelId: target, providerId: this.config.activeProvider };
    const updated = { ...current, ...settings };
    const modelSettings = { ...(this.config.modelSettings || {}), [target]: updated };
    this.updateConfig({ modelSettings });
    this.saveGlobalConfig();
  }

  public getFallbackChain(modelId?: string): string[] {
    const target = (modelId || this.config.activeModel || '').trim();
    return this.config.fallbackChains?.[target] || [];
  }

  public setFallbackChain(modelId: string, fallbacks: string[]): void {
    const target = modelId.trim();
    const fallbackChains = { ...(this.config.fallbackChains || {}), [target]: fallbacks };
    this.updateConfig({ fallbackChains });
    this.saveGlobalConfig();
  }

  public addFavorite(modelId: string): void {
    const target = modelId.trim();
    const current = new Set(this.config.favorites || []);
    current.add(target);
    this.updateConfig({ favorites: Array.from(current) });
    this.saveGlobalConfig();
  }

  public removeFavorite(modelId: string): void {
    const target = modelId.trim();
    const favorites = (this.config.favorites || []).filter(m => m !== target);
    this.updateConfig({ favorites });
    this.saveGlobalConfig();
  }

  public recordRecentlyUsed(modelId: string): void {
    const target = modelId.trim();
    if (!target) return;
    const existing = (this.config.recentlyUsed || []).filter(m => m !== target);
    existing.unshift(target);
    if (existing.length > 20) existing.pop();
    this.updateConfig({ recentlyUsed: existing });
    this.saveGlobalConfig();
  }

  public setActiveModel(modelId: string): void {
    const trimmed = modelId.trim();
    this.updateConfig({ activeModel: trimmed });
    this.recordRecentlyUsed(trimmed);
    this.saveGlobalConfig();
  }

  public getProviderKeyInfo(providerId?: string): ResolvedApiKeyInfo {
    const pid = (providerId || this.config.activeProvider || 'nim').toLowerCase();
    const globalDir = this.config.globalConfigDir || path.join(os.homedir(), '.nomin');
    const globalConfigPath = path.join(globalDir, 'config.json');

    // 1. Check ~/.nomin/config.json
    try {
      if (fs.existsSync(globalConfigPath)) {
        const parsed = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
        const key = sanitizeApiKey(parsed.providers?.[pid]?.apiKey);
        if (key) {
          return {
            apiKey: key,
            source: path.join(os.homedir(), '.nomin', 'config.json'),
            masked: maskApiKey(key),
          };
        }
      }
    } catch (_) {}

    // 2. Check runtime in-memory config
    const inMemKey = sanitizeApiKey(this.config.providers?.[pid]?.apiKey);
    if (inMemKey) {
      return {
        apiKey: inMemKey,
        source: 'runtime active config',
        masked: maskApiKey(inMemKey),
      };
    }

    // 3. Check environment variables in priority order
    if (pid === 'nim' || pid === 'nvidia') {
      const nimKeys = [
        { name: 'NVIDIA_NIM_API_KEY', val: process.env.NVIDIA_NIM_API_KEY },
        { name: 'NIM_API_KEY', val: process.env.NIM_API_KEY },
        { name: 'NVIDIA_API_KEY', val: process.env.NVIDIA_API_KEY },
      ];
      for (const k of nimKeys) {
        const clean = sanitizeApiKey(k.val);
        if (clean) {
          return {
            apiKey: clean,
            source: `environment variable (${k.name})`,
            masked: maskApiKey(clean),
          };
        }
      }
    } else if (pid === 'openai') {
      const clean = sanitizeApiKey(process.env.OPENAI_API_KEY);
      if (clean) return { apiKey: clean, source: 'environment variable (OPENAI_API_KEY)', masked: maskApiKey(clean) };
    } else if (pid === 'anthropic') {
      const clean = sanitizeApiKey(process.env.ANTHROPIC_API_KEY);
      if (clean) return { apiKey: clean, source: 'environment variable (ANTHROPIC_API_KEY)', masked: maskApiKey(clean) };
    } else if (pid === 'deepseek') {
      const clean = sanitizeApiKey(process.env.DEEPSEEK_API_KEY);
      if (clean) return { apiKey: clean, source: 'environment variable (DEEPSEEK_API_KEY)', masked: maskApiKey(clean) };
    } else if (pid === 'openrouter') {
      const clean = sanitizeApiKey(process.env.OPENROUTER_API_KEY);
      if (clean) return { apiKey: clean, source: 'environment variable (OPENROUTER_API_KEY)', masked: maskApiKey(clean) };
    } else if (pid === 'groq') {
      const clean = sanitizeApiKey(process.env.GROQ_API_KEY);
      if (clean) return { apiKey: clean, source: 'environment variable (GROQ_API_KEY)', masked: maskApiKey(clean) };
    }

    // 4. Check installation directory .env
    const installRoot = findInstallRootDir();
    if (installRoot) {
      const installEnv = path.join(installRoot, '.env');
      if (fs.existsSync(installEnv)) {
        try {
          const content = fs.readFileSync(installEnv, 'utf8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
              const varName = trimmed.substring(0, eqIdx).trim();
              const varVal = sanitizeApiKey(trimmed.substring(eqIdx + 1).trim());
              if (
                (pid === 'nim' && (varName === 'NVIDIA_NIM_API_KEY' || varName === 'NIM_API_KEY' || varName === 'NVIDIA_API_KEY')) ||
                (pid === 'openai' && varName === 'OPENAI_API_KEY') ||
                (pid === 'anthropic' && varName === 'ANTHROPIC_API_KEY') ||
                (pid === 'deepseek' && varName === 'DEEPSEEK_API_KEY')
              ) {
                if (varVal) {
                  return { apiKey: varVal, source: `${path.basename(installRoot)}/.env`, masked: maskApiKey(varVal) };
                }
              }
            }
          }
        } catch (_) {}
      }
    }

    return {
      apiKey: '',
      source: 'NONE FOUND',
      masked: 'NONE FOUND',
    };
  }

  public setActiveProvider(providerId: string, customConfig?: Partial<ProviderEndpointConfig>): void {
    const existing = this.config.providers[providerId] || {
      id: providerId,
      name: providerId.toUpperCase(),
      baseUrl: 'http://localhost:8000/v1',
      defaultRpm: 60,
      defaultTpm: 100000,
      defaultConcurrency: 4,
    };

    const updatedProvider = { ...existing, ...customConfig };
    const providers = { ...this.config.providers, [providerId]: updatedProvider };

    // Clear activeModel if incompatible with new provider (never carry invalid models across providers)
    let activeModel = this.config.activeModel;
    if (activeModel && !validateModelProviderMatch(providerId, activeModel).valid) {
      activeModel = undefined;
    }

    this.updateConfig({ activeProvider: providerId, providers, activeModel });
    this.saveGlobalConfig();
  }

  public setProviderApiKey(providerId: string, apiKey: string): void {
    const cleanKey = apiKey.trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
    const existing = this.config.providers[providerId] || {
      id: providerId,
      name: providerId.toUpperCase(),
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      defaultRpm: 60,
      defaultTpm: 100000,
      defaultConcurrency: 4,
    };
    existing.apiKey = cleanKey;
    this.updateConfig({ providers: { ...this.config.providers, [providerId]: existing } });
    this.saveGlobalConfig();
  }

  public setProviderBaseUrl(providerId: string, baseUrl: string): void {
    const existing = this.config.providers[providerId];
    if (existing) {
      existing.baseUrl = baseUrl.trim();
      this.updateConfig({ providers: { ...this.config.providers, [providerId]: existing } });
      this.saveGlobalConfig();
    }
  }

  public getReasoningEffort(): ReasoningEffort {
    return this.config.reasoningEffort || 'medium';
  }

  public setReasoningEffort(effort: ReasoningEffort): void {
    this.updateConfig({ reasoningEffort: effort });
    this.saveGlobalConfig();
  }

  public getPopularModelsForProvider(providerId?: string): string[] {
    const p = (providerId || this.config.activeProvider || 'nim').toLowerCase();
    return ModelCatalogManager.getPopularAlivePresets(p);
  }

  private loadConfig(workdir: string): NominConfig {
    // 1. Load from environment variables (.env in install dir, ~/.nomin/.env, and workspace)
    // Priority: ~/.nomin/.env and workspace, but always fallback to install root .env
    const installRoot = findInstallRootDir();
    if (installRoot) {
      const installEnv = path.join(installRoot, '.env');
      if (fs.existsSync(installEnv)) {
        this.loadEnvFromFile(installEnv);
      }
    }
    const globalEnvPath = path.join(os.homedir(), '.nomin', '.env');
    if (fs.existsSync(globalEnvPath)) {
      this.loadEnvFromFile(globalEnvPath);
    }
    if (!isSystemDir(workdir)) {
      this.loadDotEnv(workdir);
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

    // Strict priority resolution for provider API keys:
    // 1. ~/.nomin/config.json (user's explicit /key or /auth)
    // 2. Process environment variables (NVIDIA_NIM_API_KEY, NIM_API_KEY, NVIDIA_API_KEY, etc.)
    // 3. Workspace local config or install directory .env
    const resolveInitialKey = (providerId: string, envKeys: (string | undefined)[]): string => {
      const globalKey = sanitizeApiKey(globalFileConfig.providers?.[providerId]?.apiKey);
      if (globalKey) return globalKey;
      for (const envVal of envKeys) {
        const clean = sanitizeApiKey(envVal);
        if (clean) return clean;
      }
      const localKey = sanitizeApiKey(localFileConfig.providers?.[providerId]?.apiKey);
      if (localKey) return localKey;
      return '';
    };

    const nimKey = resolveInitialKey('nim', [
      process.env.NVIDIA_NIM_API_KEY,
      process.env.NIM_API_KEY,
      process.env.NVIDIA_API_KEY,
    ]);
    const openAiKey = resolveInitialKey('openai', [process.env.OPENAI_API_KEY]);
    const deepseekKey = resolveInitialKey('deepseek', [process.env.DEEPSEEK_API_KEY]);
    const anthropicKey = resolveInitialKey('anthropic', [process.env.ANTHROPIC_API_KEY]);
    const openrouterKey = resolveInitialKey('openrouter', [process.env.OPENROUTER_API_KEY]);
    const groqKey = resolveInitialKey('groq', [process.env.GROQ_API_KEY]);

    const defaultProviders: Record<string, ProviderEndpointConfig> = {
      nim: {
        id: 'nim',
        name: 'NVIDIA NIM',
        baseUrl: process.env.NVIDIA_BASE_URL || DEFAULT_NIM_BASE_URL,
        apiKey: nimKey,
        defaultRpm: 30,
        defaultTpm: 60000,
        defaultConcurrency: 4,
      },
      openai: {
        id: 'openai',
        name: 'OpenAI API',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        apiKey: openAiKey,
        defaultRpm: 60,
        defaultTpm: 150000,
        defaultConcurrency: 8,
      },
      deepseek: {
        id: 'deepseek',
        name: 'DeepSeek Official API',
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        apiKey: deepseekKey,
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
      anthropic: {
        id: 'anthropic',
        name: 'Anthropic Claude API',
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
        apiKey: anthropicKey,
        defaultRpm: 50,
        defaultTpm: 100000,
        defaultConcurrency: 4,
      },
      openrouter: {
        id: 'openrouter',
        name: 'OpenRouter AI Gateway',
        baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: openrouterKey,
        defaultRpm: 60,
        defaultTpm: 200000,
        defaultConcurrency: 6,
      },
      groq: {
        id: 'groq',
        name: 'Groq LPU Cloud',
        baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        apiKey: groqKey,
        defaultRpm: 30,
        defaultTpm: 30000,
        defaultConcurrency: 4,
      },
    };

    const fileProviders: Record<string, ProviderEndpointConfig> = {
      ...(globalFileConfig.providers || {}),
      ...(localFileConfig.providers || {}),
    };

    // Merge providers and guarantee apiKey is sanitized and non-empty if default resolved one
    const mergedProviders: Record<string, ProviderEndpointConfig> = { ...defaultProviders };
    for (const [pId, pCfg] of Object.entries(fileProviders)) {
      mergedProviders[pId] = {
        ...defaultProviders[pId],
        ...pCfg,
        apiKey: sanitizeApiKey(pCfg.apiKey) || defaultProviders[pId]?.apiKey || '',
      };
    }

    const activeProvider = process.env.NOMIN_PROVIDER || 
      localFileConfig.activeProvider ||
      globalFileConfig.activeProvider ||
      (nimKey ? 'nim' : 
       deepseekKey ? 'deepseek' : 
       openAiKey ? 'openai' : 'nim');

    // User-controlled mode (default: solo)
    const mode: SwarmMode = (localFileConfig.mode || globalFileConfig.mode || 'solo') as SwarmMode;

    const retiredMap: Record<string, string> = {
      ...(globalFileConfig.retiredModels || {}),
      ...(localFileConfig.retiredModels || {}),
    };

    // User-selected models pool (NO built-in or hardcoded models)
    const selectedModels: string[] = Array.from(new Set([
      ...(globalFileConfig.selectedModels || []),
      ...(localFileConfig.selectedModels || []),
    ]));

    const nonRetiredSelected = selectedModels.filter(m => !retiredMap[m]);

    const rawSavedModel = process.env.NOMIN_MODEL || localFileConfig.activeModel || globalFileConfig.activeModel;
    const cleanSavedModel = (rawSavedModel && rawSavedModel !== 'undefined' && rawSavedModel !== 'none') ? rawSavedModel : undefined;

    let activeModel: string | undefined = cleanSavedModel ||
      (nonRetiredSelected.length > 0 ? nonRetiredSelected[0] : (selectedModels.length > 0 ? selectedModels[0] : undefined));

    // Enforce strict provider-model compatibility (never carry invalid models across providers)
    if (activeModel && !validateModelProviderMatch(activeProvider, activeModel).valid) {
      activeModel = undefined;
    }

    // User-configured team roles (NO built-in or hardcoded role models)
    const resolvedRoles: RoleModelConfig = {
      ...(globalFileConfig.roles || {}),
      ...(localFileConfig.roles || {}),
    };
    if (process.env.MODEL_CODER) resolvedRoles.coder = process.env.MODEL_CODER;
    if (process.env.MODEL_ARCHITECT) resolvedRoles.architect = process.env.MODEL_ARCHITECT;
    if (process.env.MODEL_TESTER) resolvedRoles.tester = process.env.MODEL_TESTER;
    if (process.env.MODEL_VERIFIER) resolvedRoles.verifier = process.env.MODEL_VERIFIER;

    const reasoningEffort = (localFileConfig.reasoningEffort || globalFileConfig.reasoningEffort || 'medium') as ReasoningEffort;

    return {
      mode,
      activeModel,
      selectedModels,
      reasoningEffort,
      activeProvider,
      providers: mergedProviders,
      roles: resolvedRoles,
      modelSettings: { ...(globalFileConfig.modelSettings || {}), ...(localFileConfig.modelSettings || {}) },
      fallbackChains: { ...(globalFileConfig.fallbackChains || {}), ...(localFileConfig.fallbackChains || {}) },
      favorites: Array.from(new Set([...(globalFileConfig.favorites || []), ...(localFileConfig.favorites || [])])),
      recentlyUsed: Array.from(new Set([...(globalFileConfig.recentlyUsed || []), ...(localFileConfig.recentlyUsed || [])])),
      retiredModels: { ...(globalFileConfig.retiredModels || {}), ...(localFileConfig.retiredModels || {}) },
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
