/**
 * Nomin Code: Provider Plugins Registry
 */

import { ProviderPlugin } from '../plugin-interface.js';
import { NvidiaNimProvider } from './nim-plugin.js';
import { OpenAiProvider } from './openai-plugin.js';
import { AnthropicProvider } from './anthropic-plugin.js';
import { DeepSeekProvider } from './deepseek-plugin.js';
import { GenericOpenAiCompatibleProvider } from './generic-openai-plugin.js';

export * from '../plugin-interface.js';
export * from './nim-plugin.js';
export * from './openai-plugin.js';
export * from './anthropic-plugin.js';
export * from './deepseek-plugin.js';
export * from './generic-openai-plugin.js';

export class ProviderPluginRegistry {
  private static plugins: Map<string, ProviderPlugin> = new Map();

  static {
    this.register(new NvidiaNimProvider());
    this.register(new OpenAiProvider());
    this.register(new AnthropicProvider());
    this.register(new DeepSeekProvider());
    this.register(new GenericOpenAiCompatibleProvider('ollama', 'Ollama Local Host', 'http://127.0.0.1:11434/v1'));
    this.register(new GenericOpenAiCompatibleProvider('vllm', 'vLLM Local / Cluster', 'http://127.0.0.1:8000/v1'));
    this.register(new GenericOpenAiCompatibleProvider('openrouter', 'OpenRouter Gateway', 'https://openrouter.ai/api/v1'));
    this.register(new GenericOpenAiCompatibleProvider('groq', 'Groq LPU Cloud', 'https://api.groq.com/openai/v1'));
  }

  public static register(plugin: ProviderPlugin): void {
    this.plugins.set(plugin.id.toLowerCase(), plugin);
  }

  public static get(providerId: string): ProviderPlugin {
    const p = this.plugins.get(providerId.toLowerCase());
    if (p) return p;
    return new GenericOpenAiCompatibleProvider(providerId, providerId.toUpperCase());
  }

  public static getAll(): ProviderPlugin[] {
    return Array.from(this.plugins.values());
  }
}
