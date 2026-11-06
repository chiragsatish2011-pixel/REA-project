/**
 * Nomin Code: Live Provider Authentication & Key Management Workflow
 *
 * Implements:
 * - `nomin auth add <provider>`: interactive masked input, validation ping, model list retrieval,
 *   capability probing, encrypted storage, and zero-restart hot-reload into ConfigManager.
 * - `nomin auth list`: displays keys with redaction masks, labels, status, and RPM/TPM limits.
 * - `nomin auth remove <label|id>`: deletes key from vault.
 * - `nomin auth test <label|id>`: verifies key against live endpoint.
 * - `nomin auth rotate <provider>`: switches active key for a provider.
 * - `nomin auth limits <label|id> --rpm <n> --tpm <n> --concurrency <n>`: live limit update.
 */

import { URL } from 'node:url';
import { NominKeyStore, StoredCredential, ProviderLimits, RedactionEngine } from './keychain.js';
import { ConfigManager } from './index.js';
import { CapabilityProbe } from '../provider/capability-probe.js';
import { ModelProfile } from '../provider/types.js';
import { NominHttpClient } from '../provider/client.js';

export interface AuthAddOptions {
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  label?: string;
  limits?: Partial<ProviderLimits>;
  skipProbe?: boolean;
}

export interface ModelInfo {
  id: string;
  ownedBy?: string;
  contextWindow?: number;
}

export interface ValidationResult {
  success: boolean;
  status: number;
  message: string;
  models: ModelInfo[];
  latencyMs: number;
  headers: Record<string, string>;
}

export class NominAuthManager {
  private readonly keyStore: NominKeyStore;
  private readonly configManager: ConfigManager;

  constructor(keyStore?: NominKeyStore, configManager?: ConfigManager) {
    this.keyStore = keyStore || new NominKeyStore();
    this.configManager = configManager || ConfigManager.getInstance();
  }

  public getKeyStore(): NominKeyStore {
    return this.keyStore;
  }

  /**
   * Resolves the default base URL for standard providers.
   */
  public getDefaultBaseUrl(providerId: string): string {
    switch (providerId.toLowerCase()) {
      case 'nim':
      case 'nvidia':
        return 'https://integrate.api.nvidia.com/v1';
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'deepseek':
        return 'https://api.deepseek.com/v1';
      case 'anthropic':
        return 'https://api.anthropic.com/v1';
      case 'ollama':
        return 'http://127.0.0.1:11434/v1';
      case 'vllm':
        return 'http://127.0.0.1:8000/v1';
      default:
        return 'https://api.openai.com/v1';
    }
  }

  /**
   * Default rate and concurrency limits per provider.
   */
  public getDefaultLimits(providerId: string): ProviderLimits {
    switch (providerId.toLowerCase()) {
      case 'nim':
      case 'nvidia':
        return { rpm: 30, tpm: 60000, concurrency: 4 };
      case 'openai':
        return { rpm: 60, tpm: 150000, concurrency: 8 };
      case 'deepseek':
        return { rpm: 60, tpm: 100000, concurrency: 5 };
      case 'anthropic':
        return { rpm: 50, tpm: 80000, concurrency: 4 };
      case 'ollama':
      case 'vllm':
        return { rpm: 120, tpm: 500000, concurrency: 2 };
      default:
        return { rpm: 60, tpm: 100000, concurrency: 4 };
    }
  }

  /**
   * Validates an API key with a lightweight HTTP request to /models.
   */
  public async validateKey(
    providerId: string,
    apiKey: string,
    baseUrl?: string
  ): Promise<ValidationResult> {
    const targetUrl = baseUrl || this.getDefaultBaseUrl(providerId);
    const cleanUrl = targetUrl.replace(/\/+$/, '');
    const startTime = Date.now();

    // Anthropic uses /v1/models with x-api-key header; OpenAI / NIM uses /models with Bearer
    const isAnthropic = providerId.toLowerCase() === 'anthropic';
    const modelsUrl = new URL(isAnthropic ? `${cleanUrl}/models` : `${cleanUrl}/models`);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'NominCode-CLI/1.0.0',
    };

    if (isAnthropic) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const { status, body, resHeaders } = await this.httpRequest(modelsUrl, 'GET', headers);
      const latencyMs = Date.now() - startTime;

      if (status >= 200 && status < 300) {
        let models: ModelInfo[] = [];
        try {
          const parsed = JSON.parse(body);
          if (Array.isArray(parsed.data)) {
            models = parsed.data.map((m: any) => ({
              id: m.id || m.name,
              ownedBy: m.owned_by || m.root,
            }));
          } else if (Array.isArray(parsed.models)) {
            models = parsed.models.map((m: any) => ({
              id: m.id || m.name,
            }));
          }
        } catch {
          // Non-JSON or irregular response, still considered valid HTTP status
        }

        return {
          success: true,
          status,
          message: `Authenticated successfully (${models.length} models retrieved)`,
          models,
          latencyMs,
          headers: resHeaders,
        };
      } else {
        return {
          success: false,
          status,
          message: `Authentication failed (HTTP ${status}): ${body.slice(0, 150)}`,
          models: [],
          latencyMs,
          headers: resHeaders,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        status: 0,
        message: `Connection failed: ${err.message}`,
        models: [],
        latencyMs: Date.now() - startTime,
        headers: {},
      };
    }
  }

  /**
   * Adds an API key, validates it live, retrieves models, and updates ConfigManager immediately.
   */
  public async addKey(options: AuthAddOptions): Promise<{
    credential: StoredCredential;
    validation: ValidationResult;
    probedCapabilities?: ModelProfile;
  }> {
    const { providerId, apiKey, baseUrl, label, limits, skipProbe } = options;

    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty.');
    }

    const trimmedKey = apiKey.trim();
    const effectiveBaseUrl = baseUrl || this.getDefaultBaseUrl(providerId);

    // 1. Live Validation Call
    const validation = await this.validateKey(providerId, trimmedKey, effectiveBaseUrl);
    if (!validation.success) {
      throw new Error(`API key validation failed: ${validation.message}`);
    }

    // 2. Optional capability probing on the first discovered model
    let probedCapabilities: ModelProfile | undefined;
    const modelIds = validation.models.map(m => m.id);

    if (!skipProbe && modelIds.length > 0) {
      const probeTargetModel = modelIds[0];
      try {
        const client = new NominHttpClient({
          config: {
            id: providerId,
            name: providerId,
            type: (providerId === 'anthropic' ? 'anthropic' : 'nvidia-nim'),
            apiKey: trimmedKey,
            baseURL: effectiveBaseUrl,
          },
        });
        probedCapabilities = await CapabilityProbe.probe(client, probeTargetModel);
      } catch {
        // Fallback: capability probing is non-fatal
      }
    }

    // 3. Store Credential Securely
    const credId = `cred_${providerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const effectiveLimits: ProviderLimits = {
      ...this.getDefaultLimits(providerId),
      ...(limits || {}),
    };

    const credential: StoredCredential = {
      id: credId,
      providerId,
      label: label || `${providerId}-${Date.now().toString().slice(-4)}`,
      apiKey: trimmedKey,
      baseUrl: effectiveBaseUrl,
      models: modelIds,
      limits: effectiveLimits,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      isActive: true,
    };

    // Automatically record learned limits from response headers
    this.keyStore.addCredential(credential);
    this.keyStore.recordLearnedLimits(providerId, validation.headers);

    // 4. Zero-Restart Hot Reload into ConfigManager
    this.hotReloadConfig(credential);

    return { credential, validation, probedCapabilities };
  }

  /**
   * Immediately updates the in-memory running ConfigManager without process restart.
   */
  private hotReloadConfig(credential: StoredCredential): void {
    const currentConfig = this.configManager.getConfig();

    const updatedProviders = {
      ...currentConfig.providers,
      [credential.providerId]: {
        id: credential.providerId,
        name: credential.label || credential.providerId.toUpperCase(),
        baseUrl: credential.baseUrl || this.getDefaultBaseUrl(credential.providerId),
        apiKey: credential.apiKey,
        defaultRpm: credential.limits.rpm,
        defaultTpm: credential.limits.tpm,
        defaultConcurrency: credential.limits.concurrency,
      },
    };

    // Update active provider and models
    const updatedSelectedModels = Array.from(
      new Set([...currentConfig.selectedModels, ...(credential.models?.slice(0, 5) || [])])
    );

    this.configManager.updateConfig({
      activeProvider: credential.providerId,
      providers: updatedProviders,
      selectedModels: updatedSelectedModels,
      activeModel: currentConfig.activeModel || (credential.models?.[0] ?? undefined),
    });

    this.configManager.saveGlobalConfig();
  }

  /**
   * Lists all credentials formatted for display with redaction masks.
   */
  public listKeys(providerId?: string): {
    id: string;
    provider: string;
    label: string;
    maskedKey: string;
    isActive: boolean;
    baseUrl: string;
    limits: ProviderLimits;
    modelCount: number;
    createdAt: string;
  }[] {
    const credentials = this.keyStore.listCredentials(providerId);
    return credentials.map(c => ({
      id: c.id,
      provider: c.providerId,
      label: c.label,
      maskedKey: RedactionEngine.maskKey(c.apiKey),
      isActive: c.isActive,
      baseUrl: c.baseUrl || this.getDefaultBaseUrl(c.providerId),
      limits: c.limits,
      modelCount: c.models?.length || 0,
      createdAt: new Date(c.createdAt).toISOString(),
    }));
  }

  /**
   * Removes a credential by ID or label.
   */
  public removeKey(idOrLabel: string): boolean {
    return this.keyStore.removeCredential(idOrLabel);
  }

  /**
   * Tests an existing stored credential against the live API.
   */
  public async testKey(idOrLabel: string): Promise<ValidationResult> {
    const cred = this.keyStore.getCredential(idOrLabel) ||
      this.keyStore.listCredentials().find(c => c.label === idOrLabel);

    if (!cred) {
      throw new Error(`Credential '${idOrLabel}' not found.`);
    }

    const validation = await this.validateKey(cred.providerId, cred.apiKey, cred.baseUrl);
    if (validation.success) {
      cred.lastUsedAt = Date.now();
      if (validation.models.length > 0) {
        cred.models = validation.models.map(m => m.id);
      }
      this.keyStore.saveToVault();
      this.keyStore.recordLearnedLimits(cred.providerId, validation.headers);
    }

    return validation;
  }

  /**
   * Pure Node.js HTTP/HTTPS helper routed through NominHttpClient transport.
   */
  private httpRequest(
    url: URL,
    method: string,
    headers: Record<string, string>
  ): Promise<{ status: number; body: string; resHeaders: Record<string, string> }> {
    return NominHttpClient.rawHttpRequest(url, { method, headers });
  }
}
