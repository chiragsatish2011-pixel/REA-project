/**
 * Nomin Code: Universal Unified LLM HTTP Client
 * Supports NVIDIA NIM (https://integrate.api.nvidia.com/v1), OpenAI, Anthropic,
 * DeepSeek, Qwen/DashScope, and Ollama/vLLM.
 * 
 * Features:
 * - High-performance Node.js connection pooling (http.Agent / https.Agent keep-alive)
 * - Pure Node.js standard library (node:https, node:http, node:crypto, node:events)
 * - Robust line-delimited Server-Sent Events (SSE) streaming parser
 * - Live reasoning token separation (delta.reasoning_content vs <think> tags vs Anthropic thinking)
 * - Native thinking replay serialization for DeepSeek / NIM models
 * - Speculative tool-call parsing with JsonRepair
 * - Tight integration with NominRateLimitScheduler
 */

import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import { EventEmitter } from 'node:events';
import {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ProviderConfig,
  ProviderType,
  StreamChunk,
  TokenUsage,
  ToolCall,
  DEFAULT_BASE_URLS,
  RequestPriority,
} from './types.js';
import { NominRateLimitScheduler } from './rate-limiter.js';
import { JsonRepair } from './json-repair.js';

export interface HttpClientOptions {
  config: ProviderConfig;
  scheduler?: NominRateLimitScheduler;
}

export class NominHttpError extends Error {
  public readonly status: number;
  public readonly headers: Record<string, string>;
  public readonly body: string;
  public readonly code?: string;

  constructor(status: number, message: string, headers: Record<string, string> = {}, body: string = '', code?: string) {
    super(`[HTTP ${status}] ${message}`);
    this.name = 'NominHttpError';
    this.status = status;
    this.headers = headers;
    this.body = body;
    this.code = code;
  }
}

export class NominHttpClient extends EventEmitter {
  private readonly config: ProviderConfig;
  private readonly scheduler?: NominRateLimitScheduler;
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor(options: HttpClientOptions) {
    super();
    this.config = options.config;
    this.scheduler = options.scheduler;

    const maxSockets = this.config.maxSockets ?? 64;
    const keepAliveMsecs = this.config.keepAliveMsecs ?? 60000;

    this.httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs,
      maxSockets,
      maxFreeSockets: 16,
      timeout: this.config.timeoutMs ?? 60000,
    });

    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs,
      maxSockets,
      maxFreeSockets: 16,
      timeout: this.config.timeoutMs ?? 60000,
    });
  }

  public getProviderType(): ProviderType {
    return this.config.type;
  }

  public getBaseURL(): string {
    return this.config.baseURL || DEFAULT_BASE_URLS[this.config.type] || 'https://integrate.api.nvidia.com/v1';
  }

  public getConfig(): ProviderConfig {
    return this.config;
  }

  /**
   * Fetches live available model catalog from provider (GET /models).
   * Used for dynamic model discovery from the user's NVIDIA NIM account.
   */
  public async listModels(): Promise<Array<{ id: string; object?: string; created?: number; owned_by?: string }>> {
    const rawUrl = `${this.getBaseURL().replace(/\/+$/, '')}/models`;
    const url = new URL(rawUrl);
    const isHttps = url.protocol === 'https:';
    const agent = isHttps ? this.httpsAgent : this.httpAgent;
    const clientModule = isHttps ? https : http;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'NominCode-UniversalClient/1.0',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return new Promise((resolve, reject) => {
      const req = clientModule.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          agent,
          headers,
          timeout: this.config.timeoutMs ?? 30000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(data);
                const models = Array.isArray(parsed.data) ? parsed.data : (Array.isArray(parsed) ? parsed : []);
                resolve(models.map((m: any) => ({
                  id: typeof m === 'string' ? m : m.id,
                  object: m.object,
                  created: m.created,
                  owned_by: m.owned_by,
                })));
              } catch (err) {
                reject(new Error(`Failed to parse models response: ${(err as Error).message}`));
              }
            } else {
              reject(new NominHttpError(res.statusCode || 500, `Failed to list models: ${data.slice(0, 200)}`, {}, data));
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timed out listing models from provider.'));
      });
      req.end();
    });
  }

  /**
   * Non-streaming chat completion request with rate-limiting and retry logic.
   */
  public async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    const execute = async (): Promise<ChatCompletionResponse> => {
      let accumulatedText = '';
      let accumulatedReasoning = '';
      const toolCallsMap = new Map<number, ToolCall>();
      let finishReason = 'stop';
      let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      // Consume stream to aggregate complete response
      for await (const chunk of this.chatStreamInternal(options)) {
        if (chunk.type === 'text-delta') {
          accumulatedText += chunk.text;
        } else if (chunk.type === 'reasoning-delta') {
          accumulatedReasoning += chunk.text;
        } else if (chunk.type === 'tool-call-delta') {
          const existing = toolCallsMap.get(chunk.index) ?? {
            id: chunk.id ?? `call_${Math.random().toString(36).slice(2, 9)}`,
            type: 'function',
            function: { name: chunk.name ?? '', arguments: '' },
          };
          if (chunk.name) existing.function.name = chunk.name;
          if (chunk.id) existing.id = chunk.id;
          existing.function.arguments += chunk.argumentsDelta;
          toolCallsMap.set(chunk.index, existing);
        } else if (chunk.type === 'usage') {
          usage = chunk.usage;
        } else if (chunk.type === 'finish') {
          finishReason = chunk.reason;
        }
      }

      // Repair arguments on accumulated tool calls
      const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map(tc => {
        try {
          tc.function.arguments = JsonRepair.repair(tc.function.arguments);
        } catch {
          // Keep raw if repair failed
        }
        return tc;
      });

      const message: ChatMessage = {
        role: 'assistant',
        content: accumulatedText.length > 0 ? accumulatedText : null,
      };

      if (accumulatedReasoning.length > 0) {
        message.reasoningContent = accumulatedReasoning;
        message.reasoning_content = accumulatedReasoning;
      }

      if (toolCalls.length > 0) {
        message.toolCalls = toolCalls;
        message.tool_calls = toolCalls;
      }

      return {
        id: `chatcmpl_${Date.now()}`,
        model: options.model,
        choices: [
          {
            index: 0,
            message,
            finish_reason: finishReason,
          },
        ],
        usage,
        created: Math.floor(Date.now() / 1000),
      };
    };

    if (this.scheduler) {
      const estimatedPromptTokens = this.estimateTokens(options.messages);
      const estimatedMaxTokens = options.maxTokens ?? 2048;

      return this.scheduler.schedule(execute, {
        promptTokens: estimatedPromptTokens,
        maxTokens: estimatedMaxTokens,
        priority: options.priority ?? RequestPriority.BACKGROUND,
        signal: options.signal,
      });
    }

    return execute();
  }

  /**
   * Unified streaming interface emitting normalized StreamChunk tokens.
   */
  public async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    if (this.scheduler) {
      // In scheduler mode, the stream generation is queued and scheduled
      const estimatedPromptTokens = this.estimateTokens(options.messages);
      const estimatedMaxTokens = options.maxTokens ?? 2048;

      // Create a shared generator queue to pull through the scheduler
      const queue: (StreamChunk | null)[] = [];
      let notify: (() => void) | null = null;
      let errorOccurred: unknown = null;
      let isDone = false;

      const pushChunk = (chunk: StreamChunk | null) => {
        queue.push(chunk);
        if (notify) {
          notify();
          notify = null;
        }
      };

      const streamPromise = this.scheduler.schedule(async () => {
        try {
          for await (const chunk of this.chatStreamInternal(options)) {
            pushChunk(chunk);
          }
        } catch (err) {
          errorOccurred = err;
        } finally {
          isDone = true;
          pushChunk(null);
        }
      }, {
        promptTokens: estimatedPromptTokens,
        maxTokens: estimatedMaxTokens,
        priority: options.priority ?? RequestPriority.BACKGROUND,
        signal: options.signal,
      });

      // Avoid unhandled rejection on streamPromise
      void streamPromise.catch(err => {
        errorOccurred = err;
        isDone = true;
        pushChunk(null);
      });

      while (!isDone || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>(res => { notify = res; });
        }
        while (queue.length > 0) {
          const item = queue.shift();
          if (item === null) {
            if (errorOccurred) throw errorOccurred;
            return;
          }
          if (item) yield item;
        }
      }
      return;
    }

    yield* this.chatStreamInternal(options);
  }

  /**
   * Internal streaming pipeline that dispatches to OpenAI or Anthropic protocol.
   */
  private async *chatStreamInternal(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    if (this.config.type === 'anthropic') {
      yield* this.streamAnthropic(options);
    } else {
      yield* this.streamOpenAiCompatible(options);
    }
  }

  /**
   * Handles OpenAI, NVIDIA NIM, DeepSeek, Qwen, Ollama, and vLLM endpoints.
   */
  private async *streamOpenAiCompatible(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const baseURL = this.getBaseURL().replace(/\/+$/, '');
    const endpointUrl = new URL(`${baseURL}/chat/completions`);

    // Prepare serialized request payload
    const payload = this.serializeOpenAiPayload(options);
    const bodyStr = JSON.stringify(payload);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      ...this.config.headers,
      ...options.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    // Speculative tool accumulation buffers
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

    // Parser state for models that emit thinking via <think>...</think> tags
    let insideThinkTag = false;

    const sseLines = this.requestSseStream(endpointUrl, headers, bodyStr, options.signal);

    for await (const line of sseLines) {
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr) continue;
      if (dataStr === '[DONE]') {
        yield { type: 'finish', reason: 'stop' };
        break;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        continue;
      }

      // Check usage chunk (often present in OpenAI or DeepSeek stream options)
      if (parsed.usage) {
        yield {
          type: 'usage',
          usage: {
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0,
            totalTokens: parsed.usage.total_tokens ?? 0,
            cacheReadTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? parsed.usage.cache_read_input_tokens,
            reasoningTokens: parsed.usage.completion_tokens_details?.reasoning_tokens,
          },
        };
      }

      const choice = parsed.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      if (!delta) {
        if (choice.finish_reason) {
          const finishReason = this.normalizeFinishReason(choice.finish_reason);
          yield { type: 'finish', reason: finishReason, raw: choice.finish_reason };
        }
        continue;
      }

      // 1. Check reasoning_content field (DeepSeek-R1 / NIM / vLLM native thinking)
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        yield {
          type: 'reasoning-delta',
          text: delta.reasoning_content,
        };
      }

      // 2. Check standard content chunk
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        const text = delta.content;

        // Check for <think> and </think> delimiters
        if (text.includes('<think>')) {
          insideThinkTag = true;
          const parts = text.split('<think>');
          if (parts[0]) yield { type: 'text-delta', text: parts[0] };
          if (parts[1]) yield { type: 'reasoning-delta', text: parts[1] };
          continue;
        }

        if (text.includes('</think>')) {
          insideThinkTag = false;
          const parts = text.split('</think>');
          if (parts[0]) yield { type: 'reasoning-delta', text: parts[0] };
          if (parts[1]) yield { type: 'text-delta', text: parts[1] };
          continue;
        }

        if (insideThinkTag) {
          yield { type: 'reasoning-delta', text };
        } else {
          yield { type: 'text-delta', text };
        }
      }

      // 3. Check tool_calls chunk
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0;
          const deltaArgs = tc.function?.arguments ?? '';
          const name = tc.function?.name;
          const id = tc.id;

          let buf = toolCallBuffers.get(index);
          if (!buf) {
            buf = { id: id ?? `call_${index}`, name: name ?? '', args: '' };
            toolCallBuffers.set(index, buf);
            yield { type: 'block-start', blockType: 'tool-call', index };
          }

          if (name) buf.name = name;
          if (id) buf.id = id;
          buf.args += deltaArgs;

          yield {
            type: 'tool-call-delta',
            index,
            id: buf.id,
            name: buf.name,
            argumentsDelta: deltaArgs,
          };

          // Speculative tool execution hook
          if (options.speculativeToolExecution && options.onSpeculativeToolCall && buf.args.length > 2) {
            try {
              const specParsed = JsonRepair.parse(buf.args);
              options.onSpeculativeToolCall({
                id: buf.id,
                type: 'function',
                function: { name: buf.name, arguments: JSON.stringify(specParsed) },
              }, true);
            } catch {
              // Incomplete JSON is expected during streaming
            }
          }
        }
      }

      // 4. Finish reason
      if (choice.finish_reason) {
        // Emit block-end for tool calls
        for (const [index, buf] of toolCallBuffers.entries()) {
          const repaired = JsonRepair.repair(buf.args);
          yield {
            type: 'block-end',
            blockType: 'tool-call',
            index,
            toolCall: {
              id: buf.id,
              type: 'function',
              function: { name: buf.name, arguments: repaired },
            },
          };
        }

        const finishReason = this.normalizeFinishReason(choice.finish_reason);
        yield { type: 'finish', reason: finishReason, raw: choice.finish_reason };
      }
    }
  }

  /**
   * Translates unified chat completion options to Anthropic's /v1/messages protocol.
   * Reverse-engineered from DeepSeek Harness and Anthropic Messages specs.
   */
  private async *streamAnthropic(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const baseURL = this.getBaseURL().replace(/\/+$/, '');
    const endpointUrl = new URL(baseURL.endsWith('/v1') ? `${baseURL}/messages` : `${baseURL}/v1/messages`);

    const { systemPrompt, anthropicMessages } = this.serializeAnthropicMessages(options.messages);

    const payload: Record<string, unknown> = {
      model: options.model,
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
      temperature: options.temperature ?? 0.0,
    };

    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map(t => ({
        name: t.function.name,
        description: t.function.description ?? '',
        input_schema: t.function.parameters ?? { type: 'object', properties: {} },
      }));
    }

    if (options.reasoningEffort && options.reasoningEffort !== 'off') {
      payload.thinking = {
        type: 'enabled',
        budget_tokens: 2048,
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'anthropic-version': '2023-06-01',
      ...this.config.headers,
      ...options.headers,
    };

    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
    const bodyStr = JSON.stringify(payload);
    const sseLines = this.requestSseStream(endpointUrl, headers, bodyStr, options.signal);

    for await (const line of sseLines) {
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr) continue;

      let event: any;
      try {
        event = JSON.parse(dataStr);
      } catch {
        continue;
      }

      switch (event.type) {
        case 'message_start':
          if (event.message?.usage) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: event.message.usage.input_tokens ?? 0,
                completionTokens: event.message.usage.output_tokens ?? 0,
                totalTokens: (event.message.usage.input_tokens ?? 0) + (event.message.usage.output_tokens ?? 0),
                cacheReadTokens: event.message.usage.cache_read_input_tokens,
                cacheWriteTokens: event.message.usage.cache_creation_input_tokens,
              },
            };
          }
          break;

        case 'content_block_start': {
          const index = event.index ?? 0;
          const block = event.content_block;
          if (block?.type === 'text') {
            yield { type: 'block-start', blockType: 'text', index };
            if (block.text) yield { type: 'text-delta', text: block.text, index };
          } else if (block?.type === 'thinking') {
            yield { type: 'block-start', blockType: 'reasoning', index };
            if (block.thinking) yield { type: 'reasoning-delta', text: block.thinking, index };
          } else if (block?.type === 'tool_use') {
            toolCallBuffers.set(index, { id: block.id, name: block.name, args: '' });
            yield { type: 'block-start', blockType: 'tool-call', index };
            yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: '' };
          }
          break;
        }

        case 'content_block_delta': {
          const index = event.index ?? 0;
          const delta = event.delta;
          if (delta?.type === 'text_delta') {
            yield { type: 'text-delta', text: delta.text, index };
          } else if (delta?.type === 'thinking_delta') {
            yield { type: 'reasoning-delta', text: delta.thinking, index };
          } else if (delta?.type === 'input_json_delta') {
            const buf = toolCallBuffers.get(index);
            if (buf) {
              buf.args += delta.partial_json;
              yield {
                type: 'tool-call-delta',
                index,
                id: buf.id,
                name: buf.name,
                argumentsDelta: delta.partial_json,
              };

              if (options.speculativeToolExecution && options.onSpeculativeToolCall && buf.args.length > 2) {
                try {
                  const specParsed = JsonRepair.parse(buf.args);
                  options.onSpeculativeToolCall({
                    id: buf.id,
                    type: 'function',
                    function: { name: buf.name, arguments: JSON.stringify(specParsed) },
                  }, true);
                } catch {
                  // Partial JSON
                }
              }
            }
          }
          break;
        }

        case 'content_block_stop': {
          const index = event.index ?? 0;
          const buf = toolCallBuffers.get(index);
          if (buf) {
            const repaired = JsonRepair.repair(buf.args);
            yield {
              type: 'block-end',
              blockType: 'tool-call',
              index,
              toolCall: {
                id: buf.id,
                type: 'function',
                function: { name: buf.name, arguments: repaired },
              },
            };
          } else {
            yield { type: 'block-end', blockType: 'text', index };
          }
          break;
        }

        case 'message_delta': {
          if (event.usage) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: 0,
                completionTokens: event.usage.output_tokens ?? 0,
                totalTokens: event.usage.output_tokens ?? 0,
              },
            };
          }
          if (event.delta?.stop_reason) {
            const reason = this.normalizeFinishReason(event.delta.stop_reason);
            yield { type: 'finish', reason, raw: event.delta.stop_reason };
          }
          break;
        }

        case 'message_stop':
          yield { type: 'finish', reason: 'stop' };
          break;
      }
    }
  }

  /**
   * Pure Node.js HTTP/HTTPS SSE client with persistent connection pooling.
   */
  private async *requestSseStream(
    url: URL,
    headers: Record<string, string>,
    body: string,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    const isHttps = url.protocol === 'https:';
    const agent = isHttps ? this.httpsAgent : this.httpAgent;
    const requestModule = isHttps ? https : http;

    const requestOptions: https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers,
      agent,
    };

    let responseStream: http.IncomingMessage;

    try {
      responseStream = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = requestModule.request(requestOptions, res => {
          const status = res.statusCode ?? 500;
          if (status >= 400) {
            let errorBody = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { errorBody += chunk; });
            res.on('end', () => {
              const resHeaders: Record<string, string> = {};
              for (const [k, v] of Object.entries(res.headers)) {
                if (typeof v === 'string') resHeaders[k] = v;
                else if (Array.isArray(v)) resHeaders[k] = v.join(', ');
              }
              reject(new NominHttpError(status, res.statusMessage || `HTTP ${status}`, resHeaders, errorBody));
            });
            return;
          }
          resolve(res);
        });

        req.on('error', err => reject(err));

        if (signal) {
          const onAbort = () => {
            req.destroy(new Error('Request aborted by caller'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
          req.on('close', () => signal.removeEventListener('abort', onAbort));
        }

        req.write(body);
        req.end();
      });
    } catch (err: any) {
      if (signal?.aborted) {
        throw new Error('Request aborted by signal');
      }
      throw err;
    }

    // Line buffering for SSE frames
    let buffer = '';
    responseStream.setEncoding('utf8');

    for await (const chunk of responseStream) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        yield line;
      }
    }

    if (buffer.length > 0) {
      yield buffer;
    }
  }

  /**
   * Serializes messages for OpenAI-compatible endpoints with native reasoning replay support.
   */
  private serializeOpenAiPayload(options: ChatCompletionOptions): Record<string, unknown> {
    const serializedMessages = options.messages.map(msg => {
      const formatted: Record<string, unknown> = {
        role: msg.role === 'developer' ? 'system' : msg.role,
        content: msg.content,
      };

      // Native thinking replay for DeepSeek-R1 / NIM models:
      // Preserving reasoning_content in assistant history maintains reasoning depth
      const reasoning = msg.reasoningContent ?? msg.reasoning_content;
      if (msg.role === 'assistant' && reasoning) {
        formatted.reasoning_content = reasoning;
      }

      if (msg.name) formatted.name = msg.name;
      if (msg.toolCallId || msg.tool_call_id) formatted.tool_call_id = msg.toolCallId ?? msg.tool_call_id;

      const tools = msg.toolCalls ?? msg.tool_calls;
      if (tools && tools.length > 0) {
        formatted.tool_calls = tools.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      return formatted;
    });

    const payload: Record<string, unknown> = {
      model: options.model,
      messages: serializedMessages,
      stream: true,
    };

    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (options.topP !== undefined) payload.top_p = options.topP;
    if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens;
    if (options.stop !== undefined) payload.stop = options.stop;

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
      if (options.toolChoice) payload.tool_choice = options.toolChoice;
    }

    return payload;
  }

  /**
   * Maps messages into Anthropic format (system extracted, user/assistant turns alternating).
   */
  private serializeAnthropicMessages(messages: ChatMessage[]): {
    systemPrompt: string | undefined;
    anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown[] }>;
  } {
    let systemPrompt: string | undefined;
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = [];

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content ?? ''}` : (msg.content ?? '');
        continue;
      }

      if (msg.role === 'tool') {
        // Tool results map to Anthropic user turn with tool_result block
        const toolBlock = {
          type: 'tool_result',
          tool_use_id: msg.toolCallId ?? msg.tool_call_id,
          content: msg.content ?? '',
        };

        const last = anthropicMessages[anthropicMessages.length - 1];
        if (last && last.role === 'user') {
          last.content.push(toolBlock);
        } else {
          anthropicMessages.push({ role: 'user', content: [toolBlock] });
        }
        continue;
      }

      const contentBlocks: unknown[] = [];

      // Assistant thinking block
      const reasoning = msg.reasoningContent ?? msg.reasoning_content;
      if (msg.role === 'assistant' && reasoning) {
        contentBlocks.push({ type: 'thinking', thinking: reasoning });
      }

      if (msg.content) {
        contentBlocks.push({ type: 'text', text: msg.content });
      }

      const tools = msg.toolCalls ?? msg.tool_calls;
      if (tools) {
        for (const tc of tools) {
          let parsedInput = {};
          try {
            parsedInput = JsonRepair.parse(tc.function.arguments);
          } catch {
            // Empty if repair failed
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedInput,
          });
        }
      }

      if (contentBlocks.length === 0) continue;

      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      const last = anthropicMessages[anthropicMessages.length - 1];
      if (last && last.role === role) {
        last.content.push(...contentBlocks);
      } else {
        anthropicMessages.push({ role, content: contentBlocks });
      }
    }

    return { systemPrompt, anthropicMessages };
  }

  private normalizeFinishReason(reason: unknown): 'stop' | 'tool-calls' | 'max-tokens' | 'content-filter' | 'error' | 'unknown' {
    if (reason === 'stop' || reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
    if (reason === 'tool_calls' || reason === 'tool_use') return 'tool-calls';
    if (reason === 'length' || reason === 'max_tokens') return 'max-tokens';
    if (reason === 'content_filter') return 'content-filter';
    return 'unknown';
  }

  private estimateTokens(messages: ChatMessage[]): number {
    let charCount = 0;
    for (const msg of messages) {
      if (msg.content) charCount += msg.content.length;
      if (msg.reasoningContent) charCount += msg.reasoningContent.length;
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          charCount += tc.function.name.length + tc.function.arguments.length;
        }
      }
    }
    // Heuristic: ~4 chars per token + 50 tokens overhead
    return Math.max(10, Math.ceil(charCount / 4) + 50);
  }

  public destroy(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    this.removeAllListeners();
  }
}
