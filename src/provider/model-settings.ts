/**
 * Nomin Code: Model Settings & Reasoning Effort Adapter Engine
 * Manages per-model sampling configurations, reasoning effort levels, and tool modes.
 * Supports OpenAI reasoning_effort, Anthropic budget_tokens, and native thinking replay.
 * Persists cleanly in plain JSON inside ConfigManager.
 */

import { ReasoningEffort, ModelSettings, DiscoveredModel, ToolCallMode } from './types.js';

export interface ReasoningEffortDescriptor {
  effort: ReasoningEffort;
  budgetTokens: number;
  label: string;
  description: string;
}

export const REASONING_EFFORT_LEVELS: Record<ReasoningEffort, ReasoningEffortDescriptor> = {
  off: {
    effort: 'off',
    budgetTokens: 0,
    label: 'Off',
    description: 'Direct output with zero reasoning tokens (fastest, lowest token spend)',
  },
  low: {
    effort: 'low',
    budgetTokens: 1024,
    label: 'Low (~1K tokens)',
    description: 'Lightweight chain-of-thought for simple edits, queries, or quick code inspection',
  },
  medium: {
    effort: 'medium',
    budgetTokens: 2048,
    label: 'Medium (~2K tokens)',
    description: 'Balanced depth (standard default for coding, refactoring, and planning)',
  },
  high: {
    effort: 'high',
    budgetTokens: 4096,
    label: 'High (~4K tokens)',
    description: 'Deep exhaustive reasoning for complex architecture, algorithms, and debugging',
  },
  max: {
    effort: 'max',
    budgetTokens: 8192,
    label: 'Max (~8K tokens)',
    description: 'Maximum allowable reasoning depth for adversarial verification and hard proofs',
  },
};

export class ModelSettingsManager {
  /**
   * Checks whether a given model supports reasoning effort adjustments.
   * Examines model metadata, family, and capability tags.
   */
  public static supportsReasoningEffort(modelId: string, modelInfo?: Partial<DiscoveredModel>): boolean {
    const lower = modelId.toLowerCase();
    // Non-chat models never support reasoning
    if (
      lower.includes('embed') ||
      lower.includes('guard') ||
      lower.includes('retriever') ||
      lower.includes('rerank') ||
      lower.includes('reward') ||
      lower.includes('parse')
    ) {
      return false;
    }

    if (modelInfo?.supportsReasoning !== undefined) {
      return modelInfo.supportsReasoning;
    }

    return (
      lower.includes('nemotron-70b') ||
      lower.includes('nemotron-ultra') ||
      (lower.includes('nemotron') && lower.includes('340b')) ||
      lower.includes('cosmos-reason') ||
      (lower.includes('deepseek') && lower.includes('r1')) ||
      lower.startsWith('o1') ||
      lower.startsWith('o3') ||
      lower.includes('o1-') ||
      lower.includes('o3-') ||
      lower.includes('claude-3-7') ||
      lower.includes('claude-3.7')
    );
  }

  /**
   * Adapts the outbound API request payload for reasoning effort based on the target model family.
   * If the model does not support reasoning effort, does NOT inject unsupported parameters.
   */
  public static adaptPayload(
    payload: Record<string, unknown>,
    settings?: ModelSettings,
    modelInfo?: Partial<DiscoveredModel>
  ): void {
    if (!settings) return;

    // Apply sampling settings (only when explicitly set by user, preserving blank defaults)
    if (settings.temperature !== undefined) payload.temperature = settings.temperature;
    if (settings.topP !== undefined) payload.top_p = settings.topP;
    if (settings.maxTokens !== undefined) payload.max_tokens = settings.maxTokens;
    if (settings.stop !== undefined) payload.stop = settings.stop;
    if (settings.seed !== undefined) payload.seed = settings.seed;

    const modelId = String(payload.model || settings.modelId || '');
    const isReasoningSupported = this.supportsReasoningEffort(modelId, modelInfo);

    if (!isReasoningSupported || !settings.reasoningEffort || settings.reasoningEffort === 'off') {
      return;
    }

    const lower = modelId.toLowerCase();
    const effort = settings.reasoningEffort;
    const budget = settings.reasoningBudgetTokens ?? REASONING_EFFORT_LEVELS[effort].budgetTokens;

    // 1. Anthropic Claude 3.7 family
    if (lower.includes('claude-3-7') || lower.includes('claude-sonnet-3.7') || lower.includes('claude-3.7')) {
      payload.thinking = {
        type: 'enabled',
        budget_tokens: budget,
      };
      return;
    }

    // 2. OpenAI and NIM reasoning models (only injected for models that support reasoning effort)
    if (
      lower.startsWith('o1') ||
      lower.startsWith('o3') ||
      lower.includes('o1-') ||
      lower.includes('o3-') ||
      lower.includes('nemotron-70b') ||
      lower.includes('nemotron-ultra') ||
      (lower.includes('nemotron') && lower.includes('340b')) ||
      lower.includes('cosmos-reason') ||
      (lower.includes('deepseek') && lower.includes('r1'))
    ) {
      const openAiEffort = effort === 'max' ? 'high' : effort;
      payload.reasoning_effort = openAiEffort;
    }
  }

  /**
   * Formats a human-readable one-line string summarizing active model settings for the status bar.
   */
  public static formatStatusBar(settings?: ModelSettings): string {
    if (!settings) return 'default';
    const parts: string[] = [];

    if (settings.reasoningEffort) {
      parts.push(`effort: ${settings.reasoningEffort}`);
    }
    if (settings.temperature !== undefined) {
      parts.push(`temp: ${settings.temperature}`);
    }
    if (settings.maxTokens !== undefined) {
      parts.push(`max_tokens: ${settings.maxTokens}`);
    }
    if (settings.toolCallMode && settings.toolCallMode !== 'native_openai') {
      parts.push(`tools: ${settings.toolCallMode}`);
    }

    return parts.length > 0 ? parts.join(' · ') : 'provider defaults';
  }
}
