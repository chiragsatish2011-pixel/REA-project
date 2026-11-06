/**
 * @file agent-loop.ts
 * @description Autonomous ReAct Agent Loop for Nomin Code.
 * Executes multi-turn tool loops with native tool-calling, embedded JSON fallback,
 * markdown fenced JSON parsing, and anti-hallucination stalling guards.
 * Zero external dependencies (pure Node.js).
 */

import { ThemeManager } from '../cli/theme.js';
import { TerminalUI, StreamingMarkdownRenderer } from '../cli/ui.js';
import { defaultToolRegistry } from '../tools/index.js';
import { DebugLogger } from '../config/debug-logger.js';
import { EnvironmentContextEngine } from '../config/environment-context.js';
import type { NominHttpClient } from '../provider/client.js';
import type { ChatMessage, ToolCall } from '../provider/types.js';

export interface AgentLoopOptions {
  client: NominHttpClient;
  model: string;
  workdir: string;
  history: ChatMessage[];
  prompt: string;
  reasoningEffort?: string;
  verboseMode?: boolean;
  maxTurns?: number;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  finalText: string;
  totalDurationMs: number;
  toolCallsExecuted: number;
  turnsUsed: number;
}

export class AgentLoop {
  /**
   * Executes a conversational / agentic turn with an autonomous ReAct loop.
   */
  public static async executeTurn(options: AgentLoopOptions): Promise<AgentLoopResult> {
    const {
      client,
      model,
      workdir,
      history,
      prompt,
      reasoningEffort = 'medium',
      verboseMode = false,
      maxTurns = 25,
      signal,
    } = options;

    const startTime = Date.now();
    let toolCallsExecuted = 0;
    let turnsUsed = 0;
    const c = ThemeManager.getColors();

    // 1. Gather dynamic environment context
    const envCtx = await EnvironmentContextEngine.generate(workdir);
    const envBlock = EnvironmentContextEngine.formatPromptBlock(envCtx);

    const baseSystemPrompt = `You are Nomin Code, an elite autonomous AI coding assistant.
You are concise, direct, helpful, and deeply skilled in software engineering, full-stack architecture, and game development.
${envBlock}

### BIAS TO ACTION & SENSIBLE DEFAULTS:
- When a user request is under-specified or broad (e.g. "write me something", "a script", "make a small game"), NEVER interrogate the user with multiple menu questions or ask what they want.
- Always assume a sensible, high-utility default (e.g., an interactive HTML5/Canvas game prototype, a practical automation script, or a TypeScript/Node.js utility).
- State your assumed default in exactly ONE concise sentence (e.g. "Building a fast, self-contained interactive breakout game prototype:"), then IMMEDIATELY proceed to provide or write the complete implementation.
- When the user asks you to create, code, or make an app, game, component, or script, provide the complete, fully functional, production-ready code with no placeholders, no omissions, and no "TODO" comments. Never say you cannot generate files or games—always provide the full runnable implementation or use write_file / edit_file to save it.
- When the user asks what is in a directory or file, ALWAYS invoke list_dir or read_file immediately. Never claim you checked something without running a tool.`;

    // History Integrity: ensure user prompt is recorded in history before any model call is dispatched
    const lastHistoryItem = history[history.length - 1];
    const isPromptAlreadyInHistory =
      lastHistoryItem &&
      lastHistoryItem.role === 'user' &&
      lastHistoryItem.content === prompt;

    if (!isPromptAlreadyInHistory) {
      history.push({ role: 'user', content: prompt });
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: baseSystemPrompt },
      ...history.slice(-10).map((m) => ({
        role: m.role as any,
        content: m.content,
        tool_calls: (m as any).tool_calls,
        toolCallId: (m as any).toolCallId,
        name: (m as any).name,
      })),
    ];

    let finalAssistantText = '';
    let guardRepromptCount = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      turnsUsed++;
      if (signal?.aborted) {
        throw new Error('Agent execution cancelled by user');
      }

      const turnStartTime = Date.now();
      TerminalUI.startSpinner(`Thinking...`);

      // Log request for debug mode
      DebugLogger.logRequest(`${client.getBaseURL()}/chat/completions`, {
        model,
        turn,
        messagesCount: messages.length,
        messages,
        toolsCount: defaultToolRegistry.getSchemas().length,
      });

      let streamedText = '';
      let streamedReasoning = '';
      const toolCallsMap = new Map<number, ToolCall>();

      try {
        const stream = client.chatStream({
          model,
          messages,
          purpose: turn === 0 ? 'chat' : 'tool-continuation',
          reasoningEffort: (reasoningEffort as any) || 'medium',
          tools: defaultToolRegistry.getSchemas() as any,
          maxTokens: 4096,
          temperature: 0.7,
          signal,
        });

        for await (const chunk of stream) {
          if (chunk.type === 'reasoning-delta') {
            streamedReasoning += chunk.text;
          } else if (chunk.type === 'text-delta') {
            streamedText += chunk.text;
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
          }
        }
      } catch (err: any) {
        TerminalUI.stopSpinner();
        DebugLogger.logResponse(`${client.getBaseURL()}/chat/completions`, { error: err.message, stack: err.stack });
        throw err;
      }

      TerminalUI.stopSpinner();
      const turnDuration = Date.now() - turnStartTime;

      // Log response
      DebugLogger.logResponse(`${client.getBaseURL()}/chat/completions`, {
        turn,
        streamedReasoningLength: streamedReasoning.length,
        streamedTextLength: streamedText.length,
        nativeToolCalls: Array.from(toolCallsMap.values()),
        streamedTextSample: streamedText.slice(0, 500),
      });

      // Render OpenCode style reasoning card if reasoning was present
      if (streamedReasoning.trim()) {
        const durationSec = (turnDuration / 1000).toFixed(1);
        console.log(`\n  \x1b[33m+ Thought · ${durationSec}s\x1b[0m`);
        if (verboseMode) {
          const reasoningLines = streamedReasoning.trim().split('\n').slice(0, 10);
          for (const rl of reasoningLines) {
            console.log(`  \x1b[90m│  ${rl}\x1b[0m`);
          }
          if (streamedReasoning.trim().split('\n').length > 10) {
            console.log(`  \x1b[90m│  ... (expanded thought)\x1b[0m`);
          }
        }
      }

      // Check for tool calls (Native OR Text Fallbacks)
      let parsedToolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];

      // 1. Native tool calls
      if (toolCallsMap.size > 0) {
        for (const tc of toolCallsMap.values()) {
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }
          parsedToolCalls.push({
            id: tc.id,
            name: tc.function.name,
            args: parsedArgs,
          });
        }
      }

      // 2. Embedded JSON or XML tool calls in text delta if no native calls
      if (parsedToolCalls.length === 0 && streamedText.trim()) {
        parsedToolCalls = AgentLoop.parseEmbeddedToolCalls(streamedText);
      }

      // Case A: Model invoked tools
      if (parsedToolCalls.length > 0) {
        toolCallsExecuted += parsedToolCalls.length;

        // Record assistant turn in messages
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: streamedText.trim() || null,
          tool_calls: parsedToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        };
        messages.push(assistantMsg);
        // History Integrity: store assistant tool call before next continuation call
        history.push({
          role: 'assistant',
          content: streamedText.trim() || '',
          tool_calls: assistantMsg.tool_calls,
        } as any);

        // Execute each tool and feed result back
        for (const tc of parsedToolCalls) {
          const canonicalName = defaultToolRegistry.resolveToolName(tc.name);

          // OpenCode style tool execution card in terminal
          AgentLoop.renderToolInvocation(canonicalName, tc.args);

          const toolRes = await defaultToolRegistry.executeTool(canonicalName, tc.args, {
            workdir,
            worktreePath: workdir,
          });

          const outputText = toolRes.success
            ? (toolRes.output || '(no output)')
            : (toolRes.error || 'Tool execution failed');

          // Render output preview cleanly
          AgentLoop.renderToolResult(canonicalName, toolRes.success, outputText);

          // Push tool result message to messages and history immediately
          const toolMsg = {
            role: 'tool' as const,
            toolCallId: tc.id,
            name: canonicalName,
            content: outputText,
          };
          messages.push(toolMsg as any);
          history.push(toolMsg as any);
        }

        // Continue loop so model can process tool results
        continue;
      }

      // Case B: No tool call executed - check Anti-Hallucinated-Action Guard
      const isStallingClaim = AgentLoop.detectStallingClaim(streamedText);
      if (isStallingClaim && guardRepromptCount < 2) {
        guardRepromptCount++;
        // Do NOT show stalling text to the user
        DebugLogger.logResponse('anti-hallucination-guard', {
          action: 'reprompt',
          stallingText: streamedText,
        });

        messages.push({
          role: 'assistant',
          content: streamedText,
        });
        messages.push({
          role: 'user',
          content: `[System Action Required]: You stated you are checking or inspecting the workspace, but you did not execute any tool call. You must invoke the appropriate tool now (e.g. list_dir, read_file, execute_command), or provide your direct final answer.`,
        });
        continue;
      }

      // Case C: Final natural language response
      finalAssistantText = streamedText;

      // Stream clean markdown to terminal
      const renderer = new StreamingMarkdownRenderer();
      process.stdout.write('\n');
      renderer.write(streamedText);
      renderer.flush();
      process.stdout.write('\n');

      break;
    }

    const totalDurationMs = Date.now() - startTime;
    console.log(`  ${c.accent}Build${c.reset} ${c.secondary}·${c.reset} ${c.bold}${c.text}${model}${c.reset} ${c.secondary}· ${totalDurationMs}ms${c.reset}\n`);

    // Append final assistant response to session history
    history.push({ role: 'assistant', content: finalAssistantText });

    return {
      finalText: finalAssistantText,
      totalDurationMs,
      toolCallsExecuted,
      turnsUsed,
    };
  }

  /**
   * Parses embedded tool calls from raw text (JSON blocks, markdown fences, XML).
   */
  public static parseEmbeddedToolCalls(
    text: string
  ): Array<{ id: string; name: string; args: Record<string, any> }> {
    const results: Array<{ id: string; name: string; args: Record<string, any> }> = [];

    // Pattern 1: Markdown fenced JSON ```json { "tool": ... } ```
    const fenceRegex = /```(?:json)?\s*[\r\n]+([\s\S]*?)[\r\n]+```/g;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(text)) !== null) {
      const block = match[1].trim();
      const parsed = AgentLoop.tryParseToolJson(block);
      if (parsed) {
        results.push(parsed);
      }
    }
    if (results.length > 0) return results;

    // Pattern 2: Standalone or inline JSON object containing tool/name/action
    const jsonObjRegex = /\{[\s\S]*?"(?:tool|name|action)"[\s\S]*?\}/g;
    while ((match = jsonObjRegex.exec(text)) !== null) {
      const block = match[0].trim();
      const parsed = AgentLoop.tryParseToolJson(block);
      if (parsed) {
        results.push(parsed);
      }
    }
    if (results.length > 0) return results;

    // Pattern 3: XML <tool_call>{"name": ...}</tool_call>
    const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    while ((match = xmlRegex.exec(text)) !== null) {
      const block = match[1].trim();
      const parsed = AgentLoop.tryParseToolJson(block);
      if (parsed) {
        results.push(parsed);
      }
    }

    return results;
  }

  /**
   * Helper to safely extract tool name and parameters from candidate JSON.
   */
  private static tryParseToolJson(
    candidate: string
  ): { id: string; name: string; args: Record<string, any> } | null {
    try {
      const obj = JSON.parse(candidate);
      if (!obj || typeof obj !== 'object') return null;

      const toolName = obj.tool || obj.name || obj.action;
      if (typeof toolName !== 'string' || !toolName.trim()) return null;

      // Extract args
      let args: Record<string, any> = {};
      if (obj.arguments && typeof obj.arguments === 'object') {
        args = obj.arguments;
      } else if (obj.parameters && typeof obj.parameters === 'object') {
        args = obj.parameters;
      } else if (obj.args && typeof obj.args === 'object') {
        args = obj.args;
      } else {
        // Flat properties: {"tool": "list_dir", "path": "..."}
        args = { ...obj };
        delete args.tool;
        delete args.name;
        delete args.action;
      }

      return {
        id: `call_${Math.random().toString(36).slice(2, 9)}`,
        name: toolName.trim(),
        args,
      };
    } catch {
      return null;
    }
  }

  /**
   * Detects whether an assistant reply claims an action without actually having performed one.
   */
  public static detectStallingClaim(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Short phrase claiming inspection/checking
    const stallingPatterns = [
      /^(?:I(?:'m| am| will)?\s+)?(?:checking|looking into|inspecting|reading|searching|examining|investigating|running|gathering|verifying)\s+(?:the\s+)?(?:directory|folder|files?|workspace|codebase)/i,
      /^(?:one moment|hang tight|just a second|let me check)(?:[\s\w,.-]*)$/i,
      /I'm checking the directory for you right now/i,
      /one moment while I check/i,
      /let me take a look at the directory/i,
    ];

    const isStall = stallingPatterns.some((pat) => pat.test(trimmed));
    if (!isStall) return false;

    // If it also contains actual content (like 5+ lines of code or listings), it's not a pure stall
    const lines = trimmed.split('\n').filter(Boolean);
    return lines.length <= 4;
  }

  /**
   * Renders OpenCode style tool invocation card in terminal.
   */
  public static renderToolInvocation(toolName: string, args: Record<string, any>): void {
    const c = ThemeManager.getColors();
    if (toolName === 'bash' || toolName === 'execute_command' || toolName === 'run_command') {
      const cmd = args.command || args.cmd || '';
      console.log(`\n  ${c.accent}$ ${cmd}${c.reset}`);
    } else if (toolName === 'list_dir') {
      const p = args.path || '.';
      console.log(`\n  ${c.accent}$ list_dir ${p}${c.reset}`);
    } else if (toolName === 'read_file') {
      const p = args.path || '';
      console.log(`\n  ${c.accent}⇥ Read ${p}${c.reset}`);
    } else if (toolName === 'edit_file') {
      const p = args.path || '';
      console.log(`\n  ${c.accent}← Edit ${p}${c.reset}`);
    } else if (toolName === 'write_file') {
      const p = args.path || '';
      console.log(`\n  ${c.accent}+ Write ${p}${c.reset}`);
    } else {
      console.log(`\n  ${c.accent}$ ${toolName} ${JSON.stringify(args)}${c.reset}`);
    }
  }

  /**
   * Renders tool result output in terminal cleanly.
   */
  public static renderToolResult(toolName: string, success: boolean, output: string): void {
    const c = ThemeManager.getColors();
    if (!success) {
      console.log(`  ${c.warning}✖ ${output}${c.reset}`);
      return;
    }

    if (!output || output === '(no output)') {
      console.log(`  ${c.secondary}(no output)${c.reset}`);
      return;
    }

    const lines = output.trim().split('\n');
    if (lines.length <= 15) {
      for (const line of lines) {
        console.log(`  ${c.secondary}${line}${c.reset}`);
      }
    } else {
      for (const line of lines.slice(0, 8)) {
        console.log(`  ${c.secondary}${line}${c.reset}`);
      }
      console.log(`  ${c.secondary}... (${lines.length - 8} more lines)${c.reset}`);
    }
  }
}
