/**
 * Nomin Code: Universal Provider & Model Layer Types
 * Reverse-engineered from OpenCode, DeepSeek Harness, and Anthropic protocol specifications.
 * Zero external dependencies.
 */

import type { RequestPurpose } from './request-ledger.js';

export type ProviderType = 
  | 'nvidia-nim' 
  | 'openai' 
  | 'anthropic' 
  | 'ollama' 
  | 'vllm' 
  | 'deepseek' 
  | 'qwen' 
  | 'custom';

export const DEFAULT_BASE_URLS: Readonly<Record<ProviderType, string>> = {
  'nvidia-nim': 'https://integrate.api.nvidia.com/v1',
  'openai': 'https://api.openai.com/v1',
  'anthropic': 'https://api.anthropic.com/v1',
  'deepseek': 'https://api.deepseek.com/v1',
  'qwen': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'ollama': 'http://127.0.0.1:11434/v1',
  'vllm': 'http://127.0.0.1:8000/v1',
  'custom': '',
};

export enum RequestPriority {
  LIVE_TURN = 0,
  CRITICAL = 0,    // Architect task dispatch, Verifier completion gate
  TOOL_CONTINUATION = 1,
  INTERACTIVE = 1, // User direct intervention, CLI prompt
  VERIFIER = 2,
  BACKGROUND = 3,  // Coder / Tester iterative execution, linter runs, probes
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'developer';

export interface FunctionCall {
  name: string;
  arguments: string; // JSON string (may require repair if truncated)
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: FunctionCall;
}

export interface ChatMessage {
  role: MessageRole;
  content: string | null;
  reasoningContent?: string;
  reasoning_content?: string;
  name?: string;
  toolCalls?: ToolCall[];
  tool_calls?: ToolCall[];
  toolCallId?: string;
  tool_call_id?: string;
}

export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: Record<string, unknown>;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: {
      type: 'object';
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
  };
}

export type ToolChoice = 
  | 'none' 
  | 'auto' 
  | 'required' 
  | { type: 'function'; function: { name: string } };

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max';

export interface RetryCountdownInfo {
  provider: string;
  model: string;
  delaySec: number;
  attempt: number;
  maxAttempts: number;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
  reasoningEffort?: ReasoningEffort;
  stop?: string | string[];
  priority?: RequestPriority;
  purpose?: RequestPurpose;
  signal?: AbortSignal;
  speculativeToolExecution?: boolean;
  onSpeculativeToolCall?: (toolCall: ToolCall, isPartial: boolean) => void;
  headers?: Record<string, string>;
  enablePromptCaching?: boolean;
  onRetryCountdown?: (info: RetryCountdownInfo) => void;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export type FinishReasonKind = 
  | 'stop' 
  | 'tool-calls' 
  | 'max-tokens' 
  | 'content-filter' 
  | 'error' 
  | 'unknown';

export interface StreamTextDelta {
  type: 'text-delta';
  text: string;
  index?: number;
}

export interface StreamReasoningDelta {
  type: 'reasoning-delta';
  text: string;
  index?: number;
}

export interface StreamToolCallDelta {
  type: 'tool-call-delta';
  index: number;
  id?: string;
  name?: string;
  argumentsDelta: string;
}

export interface StreamBlockStart {
  type: 'block-start';
  blockType: 'text' | 'reasoning' | 'tool-call';
  index: number;
}

export interface StreamBlockEnd {
  type: 'block-end';
  blockType: 'text' | 'reasoning' | 'tool-call';
  index: number;
  toolCall?: ToolCall;
}

export interface StreamUsageChunk {
  type: 'usage';
  usage: TokenUsage;
}

export interface StreamFinishChunk {
  type: 'finish';
  reason: FinishReasonKind;
  raw?: unknown;
}

export type StreamChunk = 
  | StreamTextDelta 
  | StreamReasoningDelta 
  | StreamToolCallDelta 
  | StreamBlockStart 
  | StreamBlockEnd 
  | StreamUsageChunk 
  | StreamFinishChunk;

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: TokenUsage;
  metrics?: {
    ttftMs?: number;
    totalDurationMs?: number;
  };
  created?: number;
}

export interface RateLimiterConfig {
  rpmLimit: number;
  tpmLimit: number;
  maxConcurrency: number;
  minConcurrency?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxRetries?: number;
  maxTimeoutRetries?: number;
  leakyBucketIntervalMs?: number;
  aimdSuccessWindow?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export type ToolCallMode = 
  | 'native_openai' 
  | 'native_anthropic' 
  | 'xml_embedded' 
  | 'react_json' 
  | 'none';

export type ReasoningChannel = 
  | 'reasoning_content' 
  | 'tagged_think' 
  | 'anthropic_thinking' 
  | 'none';

export type ModelFamily = 
  | 'deepseek' 
  | 'qwen' 
  | 'llama' 
  | 'claude' 
  | 'gpt' 
  | 'mistral' 
  | 'other';

export interface FimTokens {
  prefix: string;
  middle: string;
  suffix: string;
}

export interface ModelProfile {
  modelId: string;
  providerType: ProviderType;
  family: ModelFamily;
  contextWindow: number;
  maxOutputTokens: number;
  toolCallMode: ToolCallMode;
  reasoningChannel: ReasoningChannel;
  reasoningReplayRequired: boolean;
  fimSupport: boolean;
  fimTokens?: FimTokens;
  compactionThreshold: number;
  recommendedTemperature: number;
  recommendedTopP?: number;
  probedAt: number;
}

export interface ProviderConfig {
  id?: string;
  name?: string;
  type: ProviderType;
  baseURL: string;
  apiKey?: string;
  defaultModel?: string;
  models?: string[];
  headers?: Record<string, string>;
  rateLimit?: Partial<RateLimiterConfig>;
  timeoutMs?: number;
  streamIdleTimeoutMs?: number;
  maxSockets?: number;
  keepAliveMsecs?: number;
}

export type ModelType =
  | 'chat'
  | 'completion'
  | 'embedding'
  | 'rerank'
  | 'image'
  | 'audio'
  | 'guard'
  | 'other';

export interface DiscoveredModel {
  id: string;
  providerId: string;
  publisher: string;
  modelType: ModelType;
  object?: string;
  created?: number;
  owned_by?: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  lastProbedAt?: number;
  isAlive?: boolean;
  retiredReason?: string;
  rateLimits?: {
    rpm?: number;
    tpm?: number;
  };
}

export interface ModelSettings {
  modelId: string;
  providerId?: string;
  reasoningEffort?: ReasoningEffort;
  reasoningBudgetTokens?: number;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxOutputTokens?: number;
  stop?: string | string[];
  seed?: number;
  contextBudget?: number;
  stream?: boolean;
  toolCallMode?: ToolCallMode;
  timeoutMs?: number;
  rpmLimit?: number;
}

export interface CatalogCache {
  providerId: string;
  baseUrl: string;
  fetchedAt: number;
  models: DiscoveredModel[];
}

export interface PoolModelItem {
  providerId: string;
  modelId: string;
  addedAt: number;
  isRetired?: boolean;
  retiredReason?: string;
  isFavorite?: boolean;
  lastUsedAt?: number;
  lastVerifiedAt?: number;
}
