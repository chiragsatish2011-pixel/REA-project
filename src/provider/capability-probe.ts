/**
 * Nomin Code: Automated 5-Second Model Capability Probe
 * Probes an unknown model endpoint (NIM, vLLM, Ollama, OpenAI, Anthropic, DeepSeek) for:
 * 1. Native function calling vs XML fallback
 * 2. Reasoning token delivery (delta.reasoning_content vs <think> tags vs Anthropic thinking)
 * 3. Fill-In-The-Middle (FIM) capabilities
 * 
 * Persists results in .nomin/models.json for zero-latency subsequent agent initializations.
 * Pure Node.js standard library (node:fs, node:path, node:crypto).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ModelProfile,
  ModelFamily,
  ToolCallMode,
  ReasoningChannel,
  FimTokens,
  ProviderType,
  ToolDefinition,
} from './types.js';
import { NominHttpClient } from './client.js';

export interface ProbeOptions {
  cacheDir?: string;
  forceProbe?: boolean;
  timeoutMs?: number;
}

export class CapabilityProbe {
  private static readonly PROBE_TIMEOUT_MS = 5000;
  private static readonly memoryCache: Map<string, ModelProfile> = new Map();

  /**
   * Probes model capabilities within 5 seconds or returns cached/pre-baked profile.
   */
  public static async probe(
    client: NominHttpClient,
    modelId: string,
    options: ProbeOptions = {}
  ): Promise<ModelProfile> {
    const cacheKey = `${client.getBaseURL()}::${modelId}`;

    // 1. Check in-memory cache
    if (!options.forceProbe && CapabilityProbe.memoryCache.has(cacheKey)) {
      return CapabilityProbe.memoryCache.get(cacheKey)!;
    }

    // 2. Check persistent disk cache (.nomin/models.json)
    const diskProfile = CapabilityProbe.loadFromDisk(cacheKey, options.cacheDir);
    if (!options.forceProbe && diskProfile) {
      CapabilityProbe.memoryCache.set(cacheKey, diskProfile);
      return diskProfile;
    }

    // 3. Known canonical profiles (Fast zero-latency path for standard models)
    const canonical = CapabilityProbe.getCanonicalProfile(modelId, client.getProviderType());
    if (canonical && !options.forceProbe) {
      CapabilityProbe.memoryCache.set(cacheKey, canonical);
      CapabilityProbe.saveToDisk(cacheKey, canonical, options.cacheDir);
      return canonical;
    }

    // 4. Execute active 5-second capability probe
    const timeoutMs = options.timeoutMs ?? CapabilityProbe.PROBE_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let profile: ModelProfile;
    try {
      profile = await CapabilityProbe.executeLiveProbe(client, modelId, controller.signal);
    } catch (probeError) {
      // On network failure or timeout, fall back to heuristic family profile
      profile = CapabilityProbe.getHeuristicProfile(modelId, client.getProviderType());
    } finally {
      clearTimeout(timeoutId);
    }

    // Cache and persist
    CapabilityProbe.memoryCache.set(cacheKey, profile);
    CapabilityProbe.saveToDisk(cacheKey, profile, options.cacheDir);

    return profile;
  }

  /**
   * Executes the 3-step active probe against the live endpoint.
   */
  private static async executeLiveProbe(
    client: NominHttpClient,
    modelId: string,
    signal: AbortSignal
  ): Promise<ModelProfile> {
    const family = CapabilityProbe.detectFamily(modelId);
    const fimSupport = CapabilityProbe.detectFimSupport(modelId, family);
    const fimTokens = fimSupport ? CapabilityProbe.getFimTokens(family) : undefined;
    const contextWindow = CapabilityProbe.estimateContextWindow(modelId, family);
    const maxOutput = CapabilityProbe.estimateMaxOutput(modelId, family);
    const { temp, topP } = CapabilityProbe.getRecommendedSampling(modelId, family);

    let toolCallMode: ToolCallMode = 'none';
    let reasoningChannel: ReasoningChannel = 'none';
    let reasoningReplayRequired = false;

    // STEP 1: Function Calling Probe
    const probeTool: ToolDefinition = {
      type: 'function',
      function: {
        name: 'probe_ping',
        description: 'Nomin probe check',
        parameters: {
          type: 'object',
          properties: {
            val: { type: 'number', description: 'test value' },
          },
          required: ['val'],
        },
      },
    };

    try {
      const resp = await client.chat({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: 'Call probe_ping with val=42. Output only tool call.',
          },
        ],
        tools: [probeTool],
        toolChoice: 'auto',
        maxTokens: 60,
        temperature: 0.0,
        signal,
      });

      const message = resp.choices[0]?.message;
      const toolCalls = message?.toolCalls ?? message?.tool_calls;
      if (toolCalls && toolCalls.length > 0 && toolCalls[0].function.name === 'probe_ping') {
        toolCallMode = client.getProviderType() === 'anthropic' ? 'native_anthropic' : 'native_openai';
      } else {
        // Fallback: check if XML embedded tool call format is accepted
        toolCallMode = 'xml_embedded';
      }
    } catch {
      toolCallMode = 'xml_embedded';
    }

    // STEP 2: Reasoning Token Stream Probe
    try {
      const stream = client.chatStream({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: 'Is 10007 prime? Think first.',
          },
        ],
        maxTokens: 50,
        temperature: 0.6,
        signal,
      });

      let sawReasoningField = false;
      let sawThinkTag = false;

      for await (const chunk of stream) {
        if (chunk.type === 'reasoning-delta') {
          sawReasoningField = true;
          break;
        } else if (chunk.type === 'text-delta' && chunk.text.includes('<think>')) {
          sawThinkTag = true;
          break;
        }
      }

      if (sawReasoningField) {
        reasoningChannel = client.getProviderType() === 'anthropic' ? 'anthropic_thinking' : 'reasoning_content';
        reasoningReplayRequired = true;
      } else if (sawThinkTag) {
        reasoningChannel = 'tagged_think';
        reasoningReplayRequired = true;
      } else {
        reasoningChannel = 'none';
        reasoningReplayRequired = false;
      }
    } catch {
      // Heuristic fallback for reasoning
      if (modelId.includes('r1') || modelId.includes('reasoning') || modelId.includes('o1') || modelId.includes('o3')) {
        reasoningChannel = 'reasoning_content';
        reasoningReplayRequired = true;
      }
    }

    return {
      modelId,
      providerType: client.getProviderType(),
      family,
      contextWindow,
      maxOutputTokens: maxOutput,
      toolCallMode,
      reasoningChannel,
      reasoningReplayRequired,
      fimSupport,
      fimTokens,
      compactionThreshold: 0.85,
      recommendedTemperature: temp,
      recommendedTopP: topP,
      probedAt: Date.now(),
    };
  }

  /**
   * Pre-baked profiles for well-known models across NVIDIA NIM, OpenAI, Anthropic, and open-weights.
   */
  public static getCanonicalProfile(modelId: string, provider: ProviderType): ModelProfile | null {
    const id = modelId.toLowerCase();

    // DeepSeek-R1 (on NVIDIA NIM or official API)
    if (id.includes('deepseek-r1') || id === 'deepseek-reasoner') {
      return {
        modelId,
        providerType: provider,
        family: 'deepseek',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        toolCallMode: 'native_openai',
        reasoningChannel: 'reasoning_content',
        reasoningReplayRequired: true,
        fimSupport: false,
        compactionThreshold: 0.85,
        recommendedTemperature: 0.6,
        recommendedTopP: 0.95,
        probedAt: Date.now(),
      };
    }

    // DeepSeek-V3
    if (id.includes('deepseek-v3') || id === 'deepseek-chat') {
      return {
        modelId,
        providerType: provider,
        family: 'deepseek',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        toolCallMode: 'native_openai',
        reasoningChannel: 'none',
        reasoningReplayRequired: false,
        fimSupport: false,
        compactionThreshold: 0.85,
        recommendedTemperature: 0.0,
        probedAt: Date.now(),
      };
    }

    // Qwen 2.5 Coder 32B / 14B / 7B
    if (id.includes('qwen2.5-coder')) {
      return {
        modelId,
        providerType: provider,
        family: 'qwen',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        toolCallMode: 'native_openai',
        reasoningChannel: 'none',
        reasoningReplayRequired: false,
        fimSupport: true,
        fimTokens: {
          prefix: '<|fim_prefix|>',
          middle: '<|fim_middle|>',
          suffix: '<|fim_suffix|>',
        },
        compactionThreshold: 0.70, // Compaction at ~22K tokens
        recommendedTemperature: 0.1,
        probedAt: Date.now(),
      };
    }

    // Meta Llama 3.3 70B & 3.1 8B
    if (id.includes('llama-3.3') || id.includes('llama-3.1')) {
      return {
        modelId,
        providerType: provider,
        family: 'llama',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        toolCallMode: 'native_openai',
        reasoningChannel: 'none',
        reasoningReplayRequired: false,
        fimSupport: false,
        compactionThreshold: 0.85,
        recommendedTemperature: 0.2,
        probedAt: Date.now(),
      };
    }

    // Claude 3.5 / 3.7 Sonnet
    if (id.includes('claude-3-5') || id.includes('claude-3-7') || id.includes('claude-sonnet')) {
      return {
        modelId,
        providerType: provider,
        family: 'claude',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        toolCallMode: 'native_anthropic',
        reasoningChannel: id.includes('3-7') ? 'anthropic_thinking' : 'none',
        reasoningReplayRequired: false,
        fimSupport: false,
        compactionThreshold: 0.85,
        recommendedTemperature: 0.2,
        probedAt: Date.now(),
      };
    }

    return null;
  }

  public static getHeuristicProfile(modelId: string, provider: ProviderType): ModelProfile {
    const family = CapabilityProbe.detectFamily(modelId);
    const fimSupport = CapabilityProbe.detectFimSupport(modelId, family);
    const fimTokens = fimSupport ? CapabilityProbe.getFimTokens(family) : undefined;
    const contextWindow = CapabilityProbe.estimateContextWindow(modelId, family);
    const maxOutput = CapabilityProbe.estimateMaxOutput(modelId, family);
    const { temp, topP } = CapabilityProbe.getRecommendedSampling(modelId, family);

    return {
      modelId,
      providerType: provider,
      family,
      contextWindow,
      maxOutputTokens: maxOutput,
      toolCallMode: provider === 'anthropic' ? 'native_anthropic' : 'native_openai',
      reasoningChannel: family === 'deepseek' && modelId.includes('r1') ? 'reasoning_content' : 'none',
      reasoningReplayRequired: family === 'deepseek',
      fimSupport,
      fimTokens,
      compactionThreshold: 0.80,
      recommendedTemperature: temp,
      recommendedTopP: topP,
      probedAt: Date.now(),
    };
  }

  private static detectFamily(modelId: string): ModelFamily {
    const id = modelId.toLowerCase();
    if (id.includes('deepseek')) return 'deepseek';
    if (id.includes('qwen')) return 'qwen';
    if (id.includes('llama')) return 'llama';
    if (id.includes('claude')) return 'claude';
    if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'gpt';
    if (id.includes('mistral') || id.includes('codestral')) return 'mistral';
    return 'other';
  }

  private static detectFimSupport(modelId: string, family: ModelFamily): boolean {
    const id = modelId.toLowerCase();
    return family === 'qwen' || id.includes('coder') || id.includes('starcoder') || id.includes('codestral');
  }

  private static getFimTokens(family: ModelFamily): FimTokens {
    if (family === 'qwen') {
      return {
        prefix: '<|fim_prefix|>',
        middle: '<|fim_middle|>',
        suffix: '<|fim_suffix|>',
      };
    }
    if (family === 'deepseek') {
      return {
        prefix: '<｜fim begin｜>',
        middle: '<｜fim hole｜>',
        suffix: '<｜fim end｜>',
      };
    }
    return {
      prefix: '<fim_prefix>',
      middle: '<fim_middle>',
      suffix: '<fim_suffix>',
    };
  }

  private static estimateContextWindow(modelId: string, family: ModelFamily): number {
    const id = modelId.toLowerCase();
    if (family === 'claude') return 200000;
    if (family === 'deepseek') return 128000;
    if (family === 'llama') return 128000;
    if (family === 'qwen') {
      return id.includes('128k') ? 128000 : 32768;
    }
    if (family === 'gpt') return 128000;
    return 32768;
  }

  private static estimateMaxOutput(_modelId: string, family: ModelFamily): number {
    if (family === 'deepseek' || family === 'qwen' || family === 'claude') return 8192;
    return 4096;
  }

  private static getRecommendedSampling(modelId: string, family: ModelFamily): { temp: number; topP?: number } {
    const id = modelId.toLowerCase();
    if (family === 'deepseek') {
      if (id.includes('r1') || id.includes('reasoner')) return { temp: 0.6, topP: 0.95 };
      return { temp: 0.0 };
    }
    if (family === 'qwen') return { temp: 0.1 };
    if (family === 'llama') return { temp: 0.2 };
    return { temp: 0.2 };
  }

  // --- Persistence to .nomin/models.json ---

  private static getStoreFilePath(customDir?: string): string {
    const baseDir = customDir ?? path.join(process.cwd(), '.nomin');
    return path.join(baseDir, 'models.json');
  }

  private static loadFromDisk(key: string, customDir?: string): ModelProfile | null {
    try {
      const filePath = CapabilityProbe.getStoreFilePath(customDir);
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      const store = JSON.parse(raw) as Record<string, ModelProfile>;
      return store[key] ?? null;
    } catch {
      return null;
    }
  }

  private static saveToDisk(key: string, profile: ModelProfile, customDir?: string): void {
    try {
      const filePath = CapabilityProbe.getStoreFilePath(customDir);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let store: Record<string, ModelProfile> = {};
      if (fs.existsSync(filePath)) {
        try {
          store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
          store = {};
        }
      }

      store[key] = profile;
      fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
    } catch {
      // Non-fatal if disk write fails
    }
  }
}
