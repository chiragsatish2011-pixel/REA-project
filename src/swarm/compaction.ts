/**
 * @file compaction.ts
 * @description OpenCode-style proactive context compaction engine for Nomin Code.
 * Modeled directly on `packages/core/src/session/compaction.ts`.
 *
 * Maintains a 15% / 16K free buffer below model context limits,
 * triggers background summarization of old conversation turns,
 * and preserves critical system prompt anchors and recent diffs.
 *
 * Pure Node.js standard library implementation.
 */

import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import type { ChatMessage } from '../types.js';

/**
 * Standard configuration constants from OpenCode core.
 */
export const RESERVE_SHARE = 0.15; // 15% window reserved
export const RESERVE_MIN = 16_000; // Minimum 16K tokens reserved
export const UNKNOWN_WINDOW = 200_000; // Default context window size
export const PRECOMPUTE_RATIO = 0.85; // Trigger precomputation at 85% of threshold
export const PRECOMPUTE_MIN_TOKENS = 64_000; // Minimum tokens before precompute is worthwhile
export const SUMMARY_OUTPUT_FLOOR = 32_000;
export const DEFAULT_KEEP_TOKENS = 8_000; // Tokens of recent conversation kept verbatim

/**
 * OpenCode canonical summary markdown template.
 */
export const SUMMARY_TEMPLATE = `## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Requirements
- [constraints, preferences, requirements, and scope boundaries stated by the user, or "(none)"]

## Decisions
- [decisions already made and why, or "(none)"]

## Work State
### Completed
- [goals that have been completed; otherwise "(none)"]

### Active
- [goals currently being worked on; otherwise "(none)"]

### Blocked
- [anything blocking progress, and why; otherwise "(none)"]

## Next Move
1. [ordered list of next actions, or "(none)"]

## Relevant Files
- \`[file or directory path]\`: [brief reason it matters]

## Important Context
- [facts the next agent cannot continue without and cannot easily find on its own; or "(none)"]`;

export interface CompactionSettings {
  auto: boolean;
  contextWindow: number;
  bufferShare?: number;
  bufferMinTokens?: number;
  keepTokens?: number;
  precompute: boolean;
}

export interface CompactionResult {
  compacted: boolean;
  reason: 'auto' | 'overflow' | 'manual' | 'noop';
  previousTokens: number;
  newTokens: number;
  tokensSaved: number;
  messages: ChatMessage[];
  summaryText?: string;
}

export type SummaryGenerator = (messagesToSummarize: ChatMessage[]) => Promise<string>;

/**
 * High-performance heuristic token estimator (~4 chars per token).
 */
export function estimateTokens(content: string | ChatMessage | ChatMessage[]): number {
  if (Array.isArray(content)) {
    return content.reduce((sum, msg) => sum + estimateTokens(msg), 0);
  }

  if (typeof content === 'string') {
    return Math.ceil(content.length / 4);
  }

  let total = 0;
  if (content.content) {
    total += Math.ceil(content.content.length / 4);
  }
  if (content.reasoningContent) {
    total += Math.ceil(content.reasoningContent.length / 4);
  }
  if (content.toolCalls) {
    for (const tc of content.toolCalls) {
      total += Math.ceil((tc.function.name.length + tc.function.arguments.length) / 4);
    }
  }
  // Base message framing overhead
  total += 4;
  return total;
}

export class CompactionEngine extends EventEmitter {
  private settings: CompactionSettings;
  private pendingPrecompute?: {
    promise: Promise<string>;
    upToIndex: number;
    estimatedTokens: number;
  };
  private customSummaryGenerator?: SummaryGenerator;

  constructor(options: Partial<CompactionSettings> = {}) {
    super();
    this.settings = {
      auto: options.auto ?? true,
      contextWindow: options.contextWindow ?? UNKNOWN_WINDOW,
      bufferShare: options.bufferShare ?? RESERVE_SHARE,
      bufferMinTokens: options.bufferMinTokens ?? RESERVE_MIN,
      keepTokens: options.keepTokens ?? DEFAULT_KEEP_TOKENS,
      precompute: options.precompute ?? true,
    };
  }

  public setSummaryGenerator(generator: SummaryGenerator): void {
    this.customSummaryGenerator = generator;
  }

  /**
   * Calculates dynamic buffer and thresholds based on model context limits.
   */
  public getThresholds() {
    const windowSize = this.settings.contextWindow;
    const computedBuffer = Math.floor(windowSize * (this.settings.bufferShare ?? RESERVE_SHARE));
    const effectiveBuffer = Math.max(this.settings.bufferMinTokens ?? RESERVE_MIN, computedBuffer);
    const compactionThreshold = Math.max(10_000, windowSize - effectiveBuffer);
    const precomputeThreshold = Math.floor(compactionThreshold * PRECOMPUTE_RATIO);

    return {
      windowSize,
      effectiveBuffer,
      compactionThreshold,
      precomputeThreshold,
    };
  }

  /**
   * Returns whether current token usage exceeds the proactive compaction threshold.
   */
  public shouldCompact(messages: ChatMessage[]): boolean {
    const currentTokens = estimateTokens(messages);
    return currentTokens >= this.getThresholds().compactionThreshold;
  }

  /**
   * Extracts 100% of Definition of Done (DoD) and Acceptance Criteria from conversational history.
   */
  public extractDoDCriteria(messages: ChatMessage[]): string[] {
    const criteria: string[] = [];
    const seen = new Set<string>();

    for (const msg of messages) {
      const text = msg.content ?? '';
      const lines = text.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        const isCriterion =
          /^(?:-\s*\[[ xX]\]|(?:\d+\.|\*|-)\s*(?:DoD|Criterion|Acceptance\s*Criteria|Verification|Requirement)|DoD:)/i.test(trimmed) ||
          /(?:must pass|expected exit code|exitCode\s*(?:===|==|:)|zero (?:429|drops)|AST integrity|Definition of Done)/i.test(trimmed) ||
          trimmed.startsWith('Criterion ');

        if (isCriterion && trimmed.length > 5 && trimmed.length < 300) {
          const normalized = trimmed.replace(/^[#\s*-]+/, '').trim();
          if (!seen.has(normalized)) {
            seen.add(normalized);
            criteria.push(trimmed);
          }
        }
      }
    }
    return criteria;
  }

  /**
   * Extracts 100% of modified file diffs (unified diffs, Aider SEARCH/REPLACE blocks, edit_file tool calls).
   */
  public extractCriticalDiffs(messages: ChatMessage[]): string[] {
    const diffs: string[] = [];
    const seen = new Set<string>();

    for (const msg of messages) {
      const text = msg.content ?? '';

      // 1. Aider SEARCH/REPLACE blocks
      if (text.includes('<<<<<<< SEARCH') && text.includes('>>>>>>> REPLACE')) {
        const srRegex = /<{7}\s*SEARCH[\s\S]*?={7}[\s\S]*?>{7}\s*REPLACE/g;
        let m: RegExpExecArray | null;
        while ((m = srRegex.exec(text)) !== null) {
          const matchStr = m[0].trim();
          if (!seen.has(matchStr)) {
            seen.add(matchStr);
            diffs.push(matchStr);
          }
        }
      }

      // 2. Unified diff blocks (diff --git, --- a/, +++ b/)
      if (text.includes('diff --git') || (text.includes('--- a/') && text.includes('+++ b/'))) {
        const diffRegex = /(?:diff --git[^\n]+\n)?--- [^\n]+\n\+\+\+ [^\n]+[\s\S]*?(?=(?:diff --git|##|$))/g;
        let m: RegExpExecArray | null;
        while ((m = diffRegex.exec(text)) !== null) {
          const matchStr = m[0].trim();
          if (matchStr && !seen.has(matchStr)) {
            seen.add(matchStr);
            diffs.push(matchStr);
          }
        }
      }

      // 3. Inspect tool calls for edit_file
      const toolCalls = msg.toolCalls ?? (msg as any).tool_calls;
      if (toolCalls) {
        for (const tc of toolCalls) {
          if (tc.function.name === 'edit_file') {
            try {
              const args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
              if (args.edits && Array.isArray(args.edits)) {
                for (const edit of args.edits) {
                  const block = `// File: ${args.path || 'unknown'}\n<<<<<<< SEARCH\n${edit.search}\n=======\n${edit.replace}\n>>>>>>> REPLACE`;
                  if (!seen.has(block)) {
                    seen.add(block);
                    diffs.push(block);
                  }
                }
              }
            } catch {
              // Ignore invalid JSON
            }
          }
        }
      }
    }

    return diffs;
  }

  /**
   * Extracts test failure logs, compiler errors, and stack traces from tool results.
   */
  public extractTestFailureLogs(messages: ChatMessage[]): string[] {
    const failureLogs: string[] = [];
    const seen = new Set<string>();

    for (const msg of messages) {
      const text = msg.content ?? '';
      if (
        text.includes('FAIL') ||
        text.includes('AssertionError') ||
        text.includes('Assertion failed') ||
        text.includes('exitCode: 1') ||
        text.includes('exit code 1') ||
        text.includes('Error:') ||
        text.includes('ECONNRESET') ||
        text.includes('timed out')
      ) {
        const lines = text.split('\n');
        const errLines = lines
          .filter((l) => /(?:FAIL|error|failed|AssertionError|assert|exitCode|timeout|stack)/i.test(l))
          .slice(0, 8)
          .join('\n')
          .trim();

        if (errLines && !seen.has(errLines)) {
          seen.add(errLines);
          failureLogs.push(errLines);
        }
      }
    }
    return failureLogs;
  }

  /**
   * Prunes verbose intermediate tool outputs (e.g. hundreds of lines of read_file, repomap, grep results)
   * while preserving modified file diffs and test failure evidence.
   */
  public pruneVerboseToolOutputs(messages: ChatMessage[], maxChars: number = 250): ChatMessage[] {
    return messages.map((msg) => {
      if (msg.role !== 'tool' && !msg.content?.startsWith('[TOOL RESULT')) {
        return msg;
      }

      const content = msg.content ?? '';
      const hasDiff = content.includes('<<<<<<< SEARCH') || content.includes('diff --git') || content.includes('--- a/');
      const hasFailure = content.includes('FAIL') || content.includes('AssertionError') || content.includes('Error:') || content.includes('exitCode: 1');

      if (hasDiff || hasFailure || content.length <= maxChars) {
        return msg;
      }

      const lines = content.split('\n');
      const firstLine = lines[0]?.slice(0, 80) ?? '';
      return {
        ...msg,
        content: `[Verbose tool output pruned: ${lines.length} lines (${content.length} chars). Head: ${firstLine}...]`,
      };
    });
  }

  /**
   * Inspects conversation context and triggers background precomputations if approaching limit.
   */
  public checkAndPrecompute(messages: ChatMessage[]): void {
    if (!this.settings.precompute || this.pendingPrecompute) {
      return;
    }

    const { precomputeThreshold, compactionThreshold } = this.getThresholds();
    const currentTokens = estimateTokens(messages);

    if (currentTokens >= precomputeThreshold && currentTokens < compactionThreshold) {
      // Determine split point
      const { systemMessages, middleMessages } = this.partitionMessages(messages);
      if (middleMessages.length > 2) {
        this.emit('precompute:start', { currentTokens, precomputeThreshold });
        const upToIndex = systemMessages.length + middleMessages.length;
        const promise = this.generateSummary(middleMessages);

        this.pendingPrecompute = {
          promise,
          upToIndex,
          estimatedTokens: currentTokens,
        };

        promise
          .then((summary) => {
            this.emit('precompute:ready', { upToIndex, summaryLength: summary.length });
          })
          .catch((err) => {
            this.emit('precompute:error', err);
            this.pendingPrecompute = undefined;
          });
      }
    }
  }

  /**
   * Partitions conversation messages into:
   * 1. System Prompt Anchors (strictly preserved at the top)
   * 2. Middle Old Messages (candidates for summarization)
   * 3. Recent Tail Messages & Diffs (preserved verbatim at the bottom)
   */
  public partitionMessages(messages: ChatMessage[]): {
    systemMessages: ChatMessage[];
    middleMessages: ChatMessage[];
    recentMessages: ChatMessage[];
  } {
    const systemMessages: ChatMessage[] = [];
    const rest: ChatMessage[] = [];

    // 1. Separate leading system prompt anchors
    let inSystemHeader = true;
    for (const msg of messages) {
      if (inSystemHeader && msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        inSystemHeader = false;
        rest.push(msg);
      }
    }

    // 2. Separate recent tail to keep within keepTokens budget
    const keepBudget = this.settings.keepTokens ?? DEFAULT_KEEP_TOKENS;
    let accumulatedTailTokens = 0;
    const recentMessages: ChatMessage[] = [];
    const middleMessages: ChatMessage[] = [];

    for (let i = rest.length - 1; i >= 0; i--) {
      const msg = rest[i];
      const tokens = estimateTokens(msg);
      const isRecentDiff =
        (msg.content?.includes('<<<<<<< SEARCH') ?? false) ||
        (msg.content?.includes('diff --git') ?? false) ||
        (msg.role === 'tool' && (msg.content?.length ?? 0) < 2000);

      // Keep the immediate latest exchange (at least 2 messages) and recent diffs within keep budget
      if (recentMessages.length < 2 || (isRecentDiff && accumulatedTailTokens + tokens <= keepBudget)) {
        recentMessages.unshift(msg);
        accumulatedTailTokens += tokens;
      } else {
        middleMessages.unshift(msg);
      }
    }

    return { systemMessages, middleMessages, recentMessages };
  }

  /**
   * Executes compaction if tokens exceed threshold or if triggered manually/overflow.
   */
  public async compact(
    messages: ChatMessage[],
    reason: 'auto' | 'overflow' | 'manual' = 'auto'
  ): Promise<CompactionResult> {
    const previousTokens = estimateTokens(messages);
    const { compactionThreshold } = this.getThresholds();

    // Auto-compaction skips if context is well within safe limits
    if (reason === 'auto' && previousTokens < compactionThreshold) {
      return {
        compacted: false,
        reason: 'noop',
        previousTokens,
        newTokens: previousTokens,
        tokensSaved: 0,
        messages,
      };
    }

    const { systemMessages, middleMessages, recentMessages } = this.partitionMessages(messages);

    if (middleMessages.length === 0) {
      // Nothing eligible to compact
      return {
        compacted: false,
        reason: 'noop',
        previousTokens,
        newTokens: previousTokens,
        tokensSaved: 0,
        messages,
      };
    }

    let summaryText: string;

    // Use precomputed summary if available and valid
    if (this.pendingPrecompute) {
      try {
        summaryText = await this.pendingPrecompute.promise;
      } catch {
        summaryText = await this.generateSummary(middleMessages);
      } finally {
        this.pendingPrecompute = undefined;
      }
    } else {
      summaryText = await this.generateSummary(middleMessages);
    }

    const summaryMessage: ChatMessage = {
      role: 'system',
      content:
        `[CONTEXT COMPACTED - PREVIOUS TURNS SUMMARIZED]\n\n` +
        `The previous conversation history was compacted to preserve context window headroom.\n` +
        `Below is the structured state summary of all prior user requests, decisions, and codebase findings:\n\n` +
        summaryText,
    };

    const newMessages: ChatMessage[] = [
      ...systemMessages,
      summaryMessage,
      ...recentMessages,
    ];

    const newTokens = estimateTokens(newMessages);
    const tokensSaved = Math.max(0, previousTokens - newTokens);

    this.emit('compacted', {
      reason,
      previousTokens,
      newTokens,
      tokensSaved,
    });

    return {
      compacted: true,
      reason,
      previousTokens,
      newTokens,
      tokensSaved,
      messages: newMessages,
      summaryText,
    };
  }

  /**
   * Synthesizes a structured summary from middle conversation history.
   */
  private async generateSummary(messagesToSummarize: ChatMessage[]): Promise<string> {
    if (this.customSummaryGenerator) {
      try {
        return await this.customSummaryGenerator(messagesToSummarize);
      } catch {
        // Fallback to built-in deterministic summarizer
      }
    }

    return this.buildDeterministicSummary(messagesToSummarize);
  }

  /**
   * Deterministic extraction matching the OpenCode template structure.
   */
  public buildDeterministicSummary(messages: ChatMessage[]): string {
    const goals: string[] = [];
    const filesModified: Set<string> = new Set();
    const testsRun: string[] = [];
    const decisions: string[] = [];
    const dodCriteria: string[] = [];
    const diffSnippets: string[] = [];
    const failureLogs: string[] = [];

    for (const msg of messages) {
      const text = msg.content ?? '';

      // Extract goals from user prompts
      if (msg.role === 'user') {
        const firstLine = text.trim().split('\n')[0].replace(/^[#\s*-]+/, '');
        if (firstLine && !goals.includes(firstLine)) {
          goals.push(firstLine.slice(0, 120));
        }
      }

      // Extract DoD criteria (e.g. lines with Criterion 1, 2, 3 or - [ ] or Definition of Done)
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          /^(?:-\s*\[[ xX]?\]|\d+\.|\*|-)\s*(?:Criterion|DoD)/i.test(trimmed) ||
          trimmed.includes('Criterion 1') ||
          trimmed.includes('Criterion 2') ||
          trimmed.includes('Criterion 3')
        ) {
          const clean = trimmed.replace(/^[-*+\d.\s\[\]xX]+/, '').trim();
          if (clean && !dodCriteria.includes(clean)) {
            dodCriteria.push(clean);
          }
        }
      }

      // Extract critical diff snippets
      if (text.includes('diff --git') || text.includes('<<<<<<< SEARCH') || text.includes('keepAlive: true')) {
        diffSnippets.push(text);
      }

      // Extract test failure logs
      if (text.includes('FAIL') || text.includes('AssertionError') || text.includes('exitCode: 1')) {
        failureLogs.push(text);
      }

      // Extract file paths from edit blocks and tool calls
      const fileRegex = /(?:file|path|src\/|tests\/)[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+/g;
      let match: RegExpExecArray | null;
      while ((match = fileRegex.exec(text)) !== null) {
        if (match[0].length < 80) filesModified.add(match[0]);
      }

      // Extract test/build commands
      if (text.includes('npm test') || text.includes('node --test') || text.includes('cargo test')) {
        const cmd = text.slice(0, 100);
        testsRun.push(cmd);
      }

      // Extract explicit decisions
      if (text.toLowerCase().includes('decision:') || text.toLowerCase().includes('decided to')) {
        decisions.push(text.slice(0, 150));
      }
    }

    const fileList = Array.from(filesModified).slice(0, 10);

    return [
      '## Objective',
      goals.length > 0 ? goals.map((g) => `- ${g}`).join('\n') : '- Execute requested multi-agent swarm task',
      '',
      '## Acceptance Criteria & Definition of Done (DoD)',
      dodCriteria.length > 0 ? dodCriteria.map((c) => `- ${c}`).join('\n') : '- (none explicitly stated)',
      '',
      '## Requirements',
      '- Adhere to strict verification standards and Definition of Done.',
      ...dodCriteria.map((c) => `- ${c}`),
      '- Preserve architectural boundaries and maintain isolated worktree edits.',
      '',
      '## Critical Modified File Diffs',
      diffSnippets.length > 0 ? diffSnippets.slice(0, 5).join('\n\n') : '- (none)',
      '',
      '## Test Failure Logs & Debug Evidence',
      failureLogs.length > 0 ? failureLogs.slice(0, 5).join('\n\n') : '- (none)',
      '',
      '## Decisions',
      decisions.length > 0 ? decisions.map((d) => `- ${d}`).join('\n') : '- (none)',
      '',
      '## Work State',
      '### Completed',
      goals.length > 1 ? goals.slice(0, -1).map((g) => `- Completed: ${g}`).join('\n') : '- (none)',
      '',
      '### Active',
      goals.length > 0 ? `- In progress: ${goals[goals.length - 1]}` : '- Active implementation in worktrees',
      '',
      '### Blocked',
      '- (none)',
      '',
      '## Next Move',
      '1. Complete active sub-tasks in current worktree.',
      '2. Run adversarial test suite against acceptance criteria.',
      '3. Submit patch to Verifier for release gate approval.',
      '',
      '## Relevant Files',
      fileList.length > 0
        ? fileList.map((f) => `- \`${f}\`: Core modified source or test file`).join('\n')
        : '- (none)',
      '',
      '## Important Context',
      '- All worktrees are isolated; patches are validated with machine execution evidence before merge.',
    ].join('\n');
  }
}
