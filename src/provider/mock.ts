/**
 * Nomin Code: High-Fidelity Mock LLM Provider & Simulation Runtime
 * 
 * Provides an offline, zero-API-cost simulation engine modeled after elite testing setups
 * at MIT CSAIL and IIT. Enables rigorous deterministic and adversarial benchmarking
 * of the entire Nomin Code harness (tools, coordinator, rate limiter, DoD engine,
 * blackboard, and mailbox) without live LLMs or external credentials.
 * 
 * Features:
 * - Full compatibility with NominHttpClient (subclassing NominHttpClient with zero network overhead)
 * - Programmable multi-turn scripted sequences (turns 1..N with tool calls and completions)
 * - High-fidelity SSE streaming chunking (reasoning deltas, text deltas, tool-call deltas)
 * - Configurable artificial delay (0ms for instant unit tests, N ms for concurrency benchmarks)
 * - Comprehensive adversarial modes:
 *     * Malformed JSON in tool arguments (validates JsonRepair)
 *     * Hallucinated tools not registered in ToolRegistry
 *     * Premature completion claims ("I am done") without DoD verification
 *     * Infinite tool-calling loops (validates turn limits & reminder policies)
 *     * Intermittent HTTP 429 & 503 error injection with Retry-After headers (validates RateLimiter)
 *     * AST integrity cheat attempts (TODO stubs, test skipping)
 * - Integrated AgentSimulationHarness for end-to-end SWE multi-turn tasks
 */

import * as crypto from 'node:crypto';
import {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  TokenUsage,
  ToolCall,
  StreamChunk,
  FinishReasonKind,
  RequestPriority,
} from './types.js';
import { NominHttpClient, NominHttpError } from './client.js';
import { NominRateLimitScheduler } from './rate-limiter.js';
import { JsonRepair } from './json-repair.js';
import { ToolRegistry, defaultToolRegistry, ToolResult } from '../tools/index.js';
import { DoDEngine, type ReviewVerdict } from '../verifier/dod-engine.js';
import { AstIntegrityInspector } from '../verifier/ast-integrity.js';
import { ReminderTracker } from '../swarm/reminder-policy.js';
import type { AcceptanceCriterion, SwarmRole } from '../swarm/types.js';

export type AdversarialMode =
  | 'none'
  | 'malformed_json'
  | 'hallucinated_tool'
  | 'premature_completion'
  | 'infinite_tool_loop'
  | 'rate_limit_429'
  | 'service_unavailable_503'
  | 'ast_cheat_todo'
  | 'ast_cheat_skip_test';

export interface AdversarialConfig {
  mode: AdversarialMode;
  failuresBeforeSuccess?: number;
  retryAfterSeconds?: number;
  malformedStyle?: 'single_quotes' | 'trailing_comma' | 'unescaped_newline' | 'truncated' | 'markdown_fence';
  hallucinatedToolName?: string;
  infiniteToolName?: string;
  infiniteToolArgs?: Record<string, any>;
  stubCode?: string;
}

export interface MockToolCallSpec {
  id?: string;
  name?: string;
  type?: 'function';
  function?: {
    name: string;
    arguments: string | Record<string, any>;
  };
  args?: string | Record<string, any>;
  arguments?: string | Record<string, any>;
}

export interface MockTurnResponse {
  content?: string | null;
  reasoningContent?: string;
  reasoning_content?: string;
  toolCalls?: MockToolCallSpec[];
  finishReason?: FinishReasonKind;
  usage?: Partial<TokenUsage>;
  error?: {
    status: number;
    message: string;
    headers?: Record<string, string>;
    code?: string;
  };
  delayMs?: number;
}

export type DynamicTurnHandler = (
  options: ChatCompletionOptions,
  turnIndex: number
) => MockTurnResponse | Promise<MockTurnResponse>;

export interface MockProviderOptions {
  model?: string;
  chunkDelayMs?: number;
  scheduler?: NominRateLimitScheduler;
  scenarios?: MockTurnResponse[];
  turnHandler?: DynamicTurnHandler;
  adversarial?: AdversarialConfig | AdversarialMode;
}

/**
 * Splits text into realistic slices for streaming simulation.
 */
function sliceIntoChunks(text: string, maxChunks: number = 3): string[] {
  if (!text || text.length <= 15) return [text];
  const count = Math.min(maxChunks, Math.max(2, Math.floor(text.length / 20)));
  const chunkSize = Math.ceil(text.length / count);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * MockLLMProvider: Drop-in offline implementation of NominHttpClient.
 */
export class MockLLMProvider extends NominHttpClient {
  private responseQueue: MockTurnResponse[] = [];
  private turnCount: number = 0;
  private history: Array<{ options: ChatCompletionOptions; response: MockTurnResponse }> = [];
  private turnHandler?: DynamicTurnHandler;
  private adversarialConfig?: AdversarialConfig;
  private chunkDelayMs: number;
  private defaultModel: string;
  private errorCounters: Map<string, number> = new Map();

  constructor(options: MockProviderOptions = {}) {
    super({
      config: {
        type: 'custom',
        baseURL: 'http://mock.internal/v1',
        apiKey: 'mock-key-nomin-benchmark',
        models: [
          'mock-default',
          'mock-claude-3-7-sonnet',
          'mock-deepseek-r1',
          'mock-nim-llama3-70b',
          'mock-qwen-2.5-coder',
        ],
      },
      scheduler: options.scheduler,
    });

    this.defaultModel = options.model || 'mock-default';
    this.chunkDelayMs = options.chunkDelayMs ?? 0;
    this.turnHandler = options.turnHandler;

    if (options.scenarios && options.scenarios.length > 0) {
      this.responseQueue.push(...options.scenarios);
    }

    if (options.adversarial) {
      this.setAdversarialConfig(options.adversarial);
    }
  }

  /**
   * Clears all state, counters, and history.
   */
  public reset(): void {
    this.responseQueue = [];
    this.turnCount = 0;
    this.history = [];
    this.errorCounters.clear();
    this.adversarialConfig = undefined;
    this.turnHandler = undefined;
  }

  public queueResponse(response: MockTurnResponse): this {
    this.responseQueue.push(response);
    return this;
  }

  public queueResponses(responses: MockTurnResponse[]): this {
    this.responseQueue.push(...responses);
    return this;
  }

  public setTurnHandler(handler: DynamicTurnHandler): this {
    this.turnHandler = handler;
    return this;
  }

  public setAdversarialConfig(config: AdversarialConfig | AdversarialMode): this {
    if (typeof config === 'string') {
      this.adversarialConfig = { mode: config };
    } else {
      this.adversarialConfig = config;
    }
    return this;
  }

  public getTurnCount(): number {
    return this.turnCount;
  }

  public getHistory(): Array<{ options: ChatCompletionOptions; response: MockTurnResponse }> {
    return [...this.history];
  }

  public getLastTurn(): MockTurnResponse | undefined {
    return this.history[this.history.length - 1]?.response;
  }

  public getQueueLength(): number {
    return this.responseQueue.length;
  }

  public override async listModels(): Promise<Array<{ id: string; object?: string; created?: number; owned_by?: string }>> {
    return [
      { id: 'mock-default', object: 'model', created: 1700000000, owned_by: 'nomin-mock' },
      { id: 'mock-claude-3-7-sonnet', object: 'model', created: 1700000000, owned_by: 'nomin-mock' },
      { id: 'mock-deepseek-r1', object: 'model', created: 1700000000, owned_by: 'nomin-mock' },
      { id: 'mock-nim-llama3-70b', object: 'model', created: 1700000000, owned_by: 'nomin-mock' },
      { id: 'mock-qwen-2.5-coder', object: 'model', created: 1700000000, owned_by: 'nomin-mock' },
    ];
  }

  /**
   * Resolves the next mock turn response taking into account:
   * 1. Adversarial mode injections (429, 503, malformed JSON, stubs, etc.)
   * 2. Dynamic turnHandler callback
   * 3. Response queue FIFO order
   * 4. Default fallback turn
   */
  public async getNextTurn(options: ChatCompletionOptions): Promise<MockTurnResponse> {
    const currentTurn = this.turnCount;
    this.turnCount++;

    // 1. Adversarial Mode handling
    if (this.adversarialConfig && this.adversarialConfig.mode !== 'none') {
      const mode = this.adversarialConfig.mode;

      if (mode === 'rate_limit_429') {
        const key = 'rate_limit_429';
        const attempts = this.errorCounters.get(key) ?? 0;
        const requiredFailures = this.adversarialConfig.failuresBeforeSuccess ?? 1;

        if (attempts < requiredFailures) {
          this.errorCounters.set(key, attempts + 1);
          const retrySec = this.adversarialConfig.retryAfterSeconds ?? 1;
          const errTurn: MockTurnResponse = {
            error: {
              status: 429,
              message: 'Rate limit exceeded: Too Many Requests on mock endpoint',
              headers: {
                'retry-after': String(retrySec),
                'x-ratelimit-reset': String(retrySec),
              },
              code: 'rate_limit_exceeded',
            },
          };
          this.history.push({ options, response: errTurn });
          return errTurn;
        }
      }

      if (mode === 'service_unavailable_503') {
        const key = 'service_unavailable_503';
        const attempts = this.errorCounters.get(key) ?? 0;
        const requiredFailures = this.adversarialConfig.failuresBeforeSuccess ?? 1;

        if (attempts < requiredFailures) {
          this.errorCounters.set(key, attempts + 1);
          const retrySec = this.adversarialConfig.retryAfterSeconds ?? 1;
          const errTurn: MockTurnResponse = {
            error: {
              status: 503,
              message: 'Service Unavailable: Mock backend temporary cluster overload',
              headers: {
                'retry-after': String(retrySec),
              },
              code: 'service_unavailable',
            },
          };
          this.history.push({ options, response: errTurn });
          return errTurn;
        }
      }

      if (mode === 'premature_completion') {
        const turn: MockTurnResponse = {
          reasoningContent: 'Everything looks completely fine and all requirements are met.',
          content: 'Task completed successfully! All code is verified and passing without running additional tests.',
        };
        this.history.push({ options, response: turn });
        return turn;
      }

      if (mode === 'hallucinated_tool') {
        const toolName = this.adversarialConfig.hallucinatedToolName || 'magic_auto_solve_all';
        const turn: MockTurnResponse = {
          reasoningContent: `Attempting to call hallucinated capability: ${toolName}`,
          toolCalls: [
            {
              id: `call_${crypto.randomUUID().slice(0, 8)}`,
              name: toolName,
              args: { target: 'all_files', fix_everything: true },
            },
          ],
        };
        this.history.push({ options, response: turn });
        return turn;
      }

      if (mode === 'infinite_tool_loop') {
        const toolName = this.adversarialConfig.infiniteToolName || 'read_file';
        const toolArgs = this.adversarialConfig.infiniteToolArgs || { path: 'index.ts' };
        const turn: MockTurnResponse = {
          reasoningContent: `Infinite loop cycle ${currentTurn}: re-reading file...`,
          toolCalls: [
            {
              id: `call_${crypto.randomUUID().slice(0, 8)}`,
              name: toolName,
              args: toolArgs,
            },
          ],
        };
        this.history.push({ options, response: turn });
        return turn;
      }

      if (mode === 'malformed_json') {
        const style = this.adversarialConfig.malformedStyle || 'single_quotes';
        let rawArgs: string;
        switch (style) {
          case 'trailing_comma':
            rawArgs = '{"path": "calculator.ts", "search_block": "return a - b;", "replace_block": "return a + b;",}';
            break;
          case 'single_quotes':
            rawArgs = "{'path': 'calculator.ts', 'search_block': 'return a - b;', 'replace_block': 'return a + b;'}";
            break;
          case 'unescaped_newline':
            rawArgs = '{"path": "calculator.ts", "replace_block": "line1\nline2"}';
            break;
          case 'truncated':
            rawArgs = '{"path": "calculator.ts", "search_block": "return a - b';
            break;
          case 'markdown_fence':
            rawArgs = '```json\n{"path": "calculator.ts", "search_block": "return a - b;", "replace_block": "return a + b;"}\n```';
            break;
          default:
            rawArgs = "{'path': 'calculator.ts'}";
        }

        const turn: MockTurnResponse = {
          reasoningContent: 'Emitting tool call with malformed/truncated JSON to test JsonRepair resilience.',
          toolCalls: [
            {
              id: `call_${crypto.randomUUID().slice(0, 8)}`,
              name: 'edit_file',
              args: rawArgs,
            },
          ],
        };
        this.history.push({ options, response: turn });
        return turn;
      }

      if (mode === 'ast_cheat_todo') {
        const turn: MockTurnResponse = {
          reasoningContent: 'Attempting to satisfy interface by inserting a placeholder stub.',
          toolCalls: [
            {
              id: `call_${crypto.randomUUID().slice(0, 8)}`,
              name: 'edit_file',
              args: {
                path: 'calculator.ts',
                search_block: 'return a - b;',
                replace_block: '// TODO: implement later\nreturn 0;',
              },
            },
          ],
        };
        this.history.push({ options, response: turn });
        return turn;
      }

      if (mode === 'ast_cheat_skip_test') {
        const turn: MockTurnResponse = {
          reasoningContent: 'Attempting to pass verification by skipping the failing test.',
          toolCalls: [
            {
              id: `call_${crypto.randomUUID().slice(0, 8)}`,
              name: 'edit_file',
              args: {
                path: 'test.js',
                search_block: 'it("adds numbers"',
                replace_block: 'it.skip("adds numbers"',
              },
            },
          ],
        };
        this.history.push({ options, response: turn });
        return turn;
      }
    }

    // 2. Dynamic Turn Handler
    if (this.turnHandler) {
      const handled = await this.turnHandler(options, currentTurn);
      this.history.push({ options, response: handled });
      return handled;
    }

    // 3. Response Queue FIFO
    if (this.responseQueue.length > 0) {
      const queued = this.responseQueue.shift()!;
      this.history.push({ options, response: queued });
      return queued;
    }

    // 4. Fallback Turn
    const defaultTurn: MockTurnResponse = {
      content: 'Mock provider turn finished.',
    };
    this.history.push({ options, response: defaultTurn });
    return defaultTurn;
  }

  /**
   * Normalizes tool calls into standard ToolCall array.
   */
  private normalizeToolCalls(specs?: MockToolCallSpec[]): ToolCall[] {
    if (!specs || specs.length === 0) return [];

    return specs.map((spec) => {
      const id = spec.id || `call_${crypto.randomUUID().slice(0, 8)}`;
      const name = spec.name || spec.function?.name || 'unknown_tool';
      let argsString: string;

      if (typeof spec.args === 'string') {
        argsString = spec.args;
      } else if (typeof spec.arguments === 'string') {
        argsString = spec.arguments;
      } else if (spec.function?.arguments) {
        argsString = typeof spec.function.arguments === 'string'
          ? spec.function.arguments
          : JSON.stringify(spec.function.arguments);
      } else if (spec.args) {
        argsString = JSON.stringify(spec.args);
      } else {
        argsString = '{}';
      }

      return {
        id,
        type: 'function',
        function: {
          name,
          arguments: argsString,
        },
      };
    });
  }

  /**
   * Non-streaming chat completion request.
   */
  public override async chat(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
    const execute = async (): Promise<ChatCompletionResponse> => {
      const turn = await this.getNextTurn(options);

      if (turn.error) {
        throw new NominHttpError(
          turn.error.status,
          turn.error.message,
          turn.error.headers || {},
          turn.error.message,
          turn.error.code
        );
      }

      if (turn.delayMs && turn.delayMs > 0) {
        await sleep(turn.delayMs);
      }

      const toolCalls = this.normalizeToolCalls(turn.toolCalls);
      const finishReason: FinishReasonKind = turn.finishReason || (toolCalls.length > 0 ? 'tool-calls' : 'stop');

      const message: ChatMessage = {
        role: 'assistant',
        content: turn.content !== undefined ? turn.content : (toolCalls.length > 0 ? null : 'Mock response.'),
      };

      if (turn.reasoningContent || turn.reasoning_content) {
        const reasoning = turn.reasoningContent || turn.reasoning_content;
        message.reasoningContent = reasoning;
        message.reasoning_content = reasoning;
      }

      if (toolCalls.length > 0) {
        message.toolCalls = toolCalls;
        message.tool_calls = toolCalls;
      }

      const usage: TokenUsage = {
        promptTokens: turn.usage?.promptTokens ?? 100,
        completionTokens: turn.usage?.completionTokens ?? 50,
        totalTokens: turn.usage?.totalTokens ?? 150,
      };

      return {
        id: `chatcmpl_mock_${Date.now()}_${this.turnCount}`,
        model: options.model || this.defaultModel,
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

    const scheduler = (this as any).scheduler as NominRateLimitScheduler | undefined;
    if (scheduler) {
      return scheduler.schedule(execute, {
        promptTokens: 100,
        maxTokens: options.maxTokens ?? 2048,
        priority: options.priority ?? RequestPriority.BACKGROUND,
        signal: options.signal,
      });
    }

    return execute();
  }

  /**
   * Unified streaming interface emitting realistic chunks with configurable delay.
   */
  public override async *chatStream(options: ChatCompletionOptions): AsyncGenerator<StreamChunk> {
    const turn = await this.getNextTurn(options);

    if (turn.error) {
      throw new NominHttpError(
        turn.error.status,
        turn.error.message,
        turn.error.headers || {},
        turn.error.message,
        turn.error.code
      );
    }

    const delay = turn.delayMs ?? this.chunkDelayMs;

    // 1. Stream reasoning delta chunks
    if (turn.reasoningContent || turn.reasoning_content) {
      const reasoning = (turn.reasoningContent || turn.reasoning_content)!;
      yield { type: 'block-start', blockType: 'reasoning', index: 0 };
      const rChunks = sliceIntoChunks(reasoning, 3);
      for (const piece of rChunks) {
        if (delay > 0) await sleep(delay);
        yield { type: 'reasoning-delta', text: piece, index: 0 };
      }
      yield { type: 'block-end', blockType: 'reasoning', index: 0 };
    }

    // 2. Stream content delta chunks
    if (turn.content) {
      yield { type: 'block-start', blockType: 'text', index: 0 };
      const cChunks = sliceIntoChunks(turn.content, 3);
      for (const piece of cChunks) {
        if (delay > 0) await sleep(delay);
        yield { type: 'text-delta', text: piece, index: 0 };
      }
      yield { type: 'block-end', blockType: 'text', index: 0 };
    }

    // 3. Stream tool-call deltas
    const toolCalls = this.normalizeToolCalls(turn.toolCalls);
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      yield { type: 'block-start', blockType: 'tool-call', index: i };

      const argsStr = tc.function.arguments;
      const mid = Math.max(1, Math.floor(argsStr.length / 2));
      const part1 = argsStr.slice(0, mid);
      const part2 = argsStr.slice(mid);

      if (delay > 0) await sleep(delay);
      yield {
        type: 'tool-call-delta',
        index: i,
        id: tc.id,
        name: tc.function.name,
        argumentsDelta: part1,
      };

      if (part2.length > 0) {
        if (delay > 0) await sleep(delay);
        yield {
          type: 'tool-call-delta',
          index: i,
          argumentsDelta: part2,
        };
      }

      yield { type: 'block-end', blockType: 'tool-call', index: i, toolCall: tc };

      if (options.speculativeToolExecution && options.onSpeculativeToolCall) {
        options.onSpeculativeToolCall(tc, false);
      }
    }

    // 4. Token usage chunk
    yield {
      type: 'usage',
      usage: {
        promptTokens: turn.usage?.promptTokens ?? 100,
        completionTokens: turn.usage?.completionTokens ?? 50,
        totalTokens: turn.usage?.totalTokens ?? 150,
      },
    };

    // 5. Finish chunk
    const finishReason: FinishReasonKind = turn.finishReason || (toolCalls.length > 0 ? 'tool-calls' : 'stop');
    yield { type: 'finish', reason: finishReason };
  }
}

/**
 * Fluent builder for scriptable multi-turn scenarios.
 */
export class MockScenarioBuilder {
  private turns: MockTurnResponse[] = [];

  public grep(query: string, options?: { reasoning?: string; path?: string }): this {
    this.turns.push({
      reasoningContent: options?.reasoning ?? `Searching codebase for pattern "${query}"...`,
      toolCalls: [
        {
          name: 'search_grep',
          args: { query, path: options?.path ?? '.' },
        },
      ],
    });
    return this;
  }

  public glob(pattern: string, options?: { reasoning?: string; path?: string }): this {
    this.turns.push({
      reasoningContent: options?.reasoning ?? `Scanning files matching "${pattern}"...`,
      toolCalls: [
        {
          name: 'search_glob',
          args: { pattern, path: options?.path ?? '.' },
        },
      ],
    });
    return this;
  }

  public readFile(path: string, options?: { reasoning?: string; startLine?: number; endLine?: number }): this {
    this.turns.push({
      reasoningContent: options?.reasoning ?? `Reading contents of ${path}...`,
      toolCalls: [
        {
          name: 'read_file',
          args: {
            path,
            start_line: options?.startLine,
            end_line: options?.endLine,
          },
        },
      ],
    });
    return this;
  }

  public editFile(path: string, searchBlock: string, replaceBlock: string, options?: { reasoning?: string }): this {
    this.turns.push({
      reasoningContent: options?.reasoning ?? `Applying replacement block to ${path}...`,
      toolCalls: [
        {
          name: 'edit_file',
          args: {
            path,
            search_block: searchBlock,
            replace_block: replaceBlock,
          },
        },
      ],
    });
    return this;
  }

  public editFileAider(path: string, content: string, options?: { reasoning?: string }): this {
    this.turns.push({
      reasoningContent: options?.reasoning ?? `Applying Aider SEARCH/REPLACE diff to ${path}...`,
      toolCalls: [
        {
          name: 'edit_file',
          args: { path, content },
        },
      ],
    });
    return this;
  }

  public bash(command: string, options?: { reasoning?: string }): this {
    this.turns.push({
      reasoningContent: options?.reasoning ?? `Executing bash command: "${command}"...`,
      toolCalls: [
        {
          name: 'bash',
          args: { command },
        },
      ],
    });
    return this;
  }

  public complete(message: string, options?: { reasoning?: string }): this {
    this.turns.push({
      reasoningContent: options?.reasoning ?? 'All modifications applied and verified.',
      content: message,
    });
    return this;
  }

  public turn(turn: MockTurnResponse): this {
    this.turns.push(turn);
    return this;
  }

  public build(): MockTurnResponse[] {
    return [...this.turns];
  }
}

/**
 * Options for the AgentSimulationHarness.
 */
export interface SimulationHarnessOptions {
  workspaceRoot: string;
  provider: MockLLMProvider;
  toolRegistry?: ToolRegistry;
  maxTurns?: number;
  acceptanceCriteria?: AcceptanceCriterion[];
  model?: string;
  systemPrompt?: string;
  role?: SwarmRole;
}

export interface SimulationHarnessResult {
  success: boolean;
  reason?: string;
  turns: number;
  messages: ChatMessage[];
  verdict?: ReviewVerdict;
  accumulatedDiff: string;
  executedCommands: Array<{ command: string; exitCode: number; stdout: string; stderr: string }>;
  integrityViolations: string[];
}

/**
 * AgentSimulationHarness: Executes multi-turn agent loops with tool calls,
 * automatic JsonRepair, ReminderPolicy, and DoD verification gates.
 */
export class AgentSimulationHarness {
  private workspaceRoot: string;
  private provider: MockLLMProvider;
  private toolRegistry: ToolRegistry;
  private maxTurns: number;
  private acceptanceCriteria: AcceptanceCriterion[];
  private model: string;
  private systemPrompt: string;
  private role: SwarmRole;
  private reminderTracker: ReminderTracker;

  constructor(options: SimulationHarnessOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry || defaultToolRegistry;
    this.maxTurns = options.maxTurns ?? 15;
    this.acceptanceCriteria = options.acceptanceCriteria || [];
    this.model = options.model || 'mock-default';
    this.role = options.role || 'Coder';
    this.reminderTracker = new ReminderTracker({
      todo_gate: { enabled: true, max_fires_per_prompt: 2 },
    });
    this.systemPrompt = options.systemPrompt ||
      'You are Nomin Code, an autonomous AI software engineer executing tasks with rigorous Definition-of-Done compliance.';
  }

  /**
   * Executes the autonomous multi-turn loop for a given objective.
   */
  public async run(goal: string): Promise<SimulationHarnessResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: goal },
    ];

    const currentFileDiffs = new Map<string, string>();
    let accumulatedDiff = '';
    const executedCommands: Array<{ command: string; exitCode: number; stdout: string; stderr: string }> = [];
    const allViolations: string[] = [];
    let lastVerdict: ReviewVerdict | undefined;
    let turnCount = 0;

    while (turnCount < this.maxTurns) {
      turnCount++;
      this.reminderTracker.onTurnStart();

      const nudge = this.reminderTracker.evaluateNudge();
      if (nudge.shouldNudge) {
        messages.push({
          role: 'system',
          content: `[SYSTEM REMINDER]: ${nudge.reminderText}`,
        });
      }

      const response = await this.provider.chat({
        model: this.model,
        messages,
        tools: this.toolRegistry.getSchemas() as any,
      });

      const assistantMsg = response.choices[0].message;
      messages.push(assistantMsg);

      const toolCalls = assistantMsg.toolCalls || assistantMsg.tool_calls;

      // Case A: Model invoked tool calls
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const toolName = tc.function.name;
          const rawArgs = tc.function.arguments;
          let parsedArgs: Record<string, any>;

          try {
            parsedArgs = JsonRepair.parse(rawArgs);
          } catch (err: any) {
            messages.push({
              role: 'tool',
              toolCallId: tc.id,
              tool_call_id: tc.id,
              content: JSON.stringify({ error: `JSON Parse Failure: ${err.message}` }),
            });
            continue;
          }

          const toolResult = await this.toolRegistry.executeTool(toolName, parsedArgs, {
            sessionID: `sim-session-${turnCount}`,
            agentID: `agent-${this.role.toLowerCase()}`,
            worktreePath: this.workspaceRoot,
            callID: tc.id,
          });

          // Track diffs from edit_file per target file
          if (toolName === 'edit_file' && toolResult.success) {
            const diff = toolResult.data?.diff || toolResult.output;
            const targetPath = parsedArgs.path || 'unknown';
            if (diff) {
              currentFileDiffs.set(targetPath, diff);
              accumulatedDiff = Array.from(currentFileDiffs.values()).join('\n');
            }
          }

          // Track executed commands from bash / execute_command
          if (toolName === 'bash' || toolName === 'execute_command') {
            executedCommands.push({
              command: parsedArgs.command || '',
              exitCode: toolResult.data?.exitCode ?? (toolResult.success ? 0 : 1),
              stdout: toolResult.data?.stdout || toolResult.output || '',
              stderr: toolResult.data?.stderr || toolResult.error || '',
            });
          }

          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            tool_call_id: tc.id,
            content: toolResult.output || toolResult.error || (toolResult.success ? 'Success' : 'Failed'),
          });
        }
        continue;
      }

      // Case B: Model returned a completion text (no tool calls)
      // Check AST Integrity and Acceptance Criteria through DoDEngine
      const integrityCheck = AstIntegrityInspector.inspectDiff(accumulatedDiff);
      if (!integrityCheck.passed) {
        allViolations.push(...integrityCheck.violations);
      }

      const verdict = await DoDEngine.verifyTask(
        { id: `task-${Date.now()}`, acceptanceCriteria: this.acceptanceCriteria },
        { worktreePath: this.workspaceRoot, diffText: accumulatedDiff }
      );
      lastVerdict = verdict;

      if (verdict.approved) {
        return {
          success: true,
          turns: turnCount,
          messages,
          verdict,
          accumulatedDiff,
          executedCommands,
          integrityViolations: allViolations,
        };
      }

      // If rejected by DoD gate, provide structured feedback to agent for next turn
      messages.push({
        role: 'user',
        content: `[VERIFICATION REJECTED]: ${verdict.reason}\n${verdict.feedback || ''}\nPlease resolve the failures and re-verify before claiming completion.`,
      });
    }

    // Exhausted maximum turns
    return {
      success: false,
      reason: `Maximum turns exceeded (${this.maxTurns}) without satisfying Definition-of-Done gate.`,
      turns: turnCount,
      messages,
      verdict: lastVerdict,
      accumulatedDiff,
      executedCommands,
      integrityViolations: allViolations,
    };
  }
}
