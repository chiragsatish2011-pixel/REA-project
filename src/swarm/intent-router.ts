/**
 * @file intent-router.ts
 * @description Fast, lightweight Intent Router for Nomin Code.
 * Classifies user input into:
 *   - CHAT/QUESTION: Natural conversation, questions, capability inquiries, status checks.
 *   - CODE-EXPLAIN: Questions asking to explain, inspect, or locate code without modifying it.
 *   - SMALL-TASK: Targeted edits, single file changes, bug fixes, or quick additions.
 *   - LARGE-TASK: Multi-step, architectural, multi-file refactoring or new subsystem creations.
 *   - SLASH-COMMAND: Explicit CLI commands starting with '/'.
 *   - UNCLEAR/NOISE: Typos, punctuation-only, gibberish, or ambiguous expressions (e.g. 'wtf', 'wt', '?').
 */

import { NominHttpClient } from '../provider/client.js';

export type UserIntent =
  | 'CHAT/QUESTION'
  | 'CODE-EXPLAIN'
  | 'SMALL-TASK'
  | 'LARGE-TASK'
  | 'SLASH-COMMAND'
  | 'UNCLEAR/NOISE';

export interface IntentClassificationResult {
  intent: UserIntent;
  confidence: number;
  reason: string;
  suggestedAction: 'respond_directly' | 'ask_clarification' | 'execute_inline' | 'spawn_swarm' | 'run_command';
}

export class IntentRouter {
  private static readonly NOISE_PATTERNS = [
    /^(?:wt|wtf|wth|idk|huh|what\??|why\??|\?+|\!+|\.+|asdf\w*|qwerty\w*|test|yo|lol|lmao)$/i,
    /^[^\w\s]+$/, // only punctuation / symbols
    /^[bcdfghjklmnpqrstvwxyz]{4,}$/i, // consonant gibberish with no vowels
  ];

  private static readonly GREETING_PATTERNS = [
    /^(?:hi|hello|hey|yo|sup|greetings|howdy|good\s+(?:morning|afternoon|evening|day)|bye|goodbye|cya|thanks|thank\s+you)[\s!.,?]*$/i,
    /^(?:who|what)\s+are\s+you[\s?!.]*$/i,
    /^(?:what\s+can\s+you\s+do|how\s+do\s+you\s+work|what\s+is\s+(?:nomin|nomincode|opencode|claude|this))[\s?!.]*$/i,
  ];

  private static readonly STATUS_QUESTION_PATTERNS = [
    /^(?:wt|what)\s+are\s+(?:u|you)\s+doing[\s?!.]*$/i,
    /^(?:what|where)\s+is\s+(?:the\s+)?(?:state|status|progress)[\s?!.]*$/i,
    /^(?:what\s+are\s+we\s+working\s+on|show\s+status)[\s?!.]*$/i,
  ];

  private static readonly CODE_EXPLAIN_PATTERNS = [
    /^(?:how\s+does\s+|explain\s+|where\s+is\s+|find\s+|show\s+me\s+|walk\s+me\s+through\s+|what\s+does\s+)/i,
    /\b(?:mean|do|defined|located|implemented)\s*\?$/i,
  ];

  private static readonly READ_INSPECTION_PATTERNS = [
    /^(?:check|inspect|tell\s+me|just\s+tell\s+me|show|list|view|read|browse|peek|look(?:\s+at)?|what\s+is\s+in|what'?s\s+in|see)\b/i,
    /\b(?:in\s+this\s+directory|in\s+this\s+folder|in\s+this\s+file|in\s+that\s+directory|in\s+that\s+folder|inside\s+this\s+directory|inside\s+that\s+directory|see\s+in\s+that\s+directory|what\s+do\s+you\s+see)\b/i,
    /^(?:t\s+si|wt\s+is)\b/i,
  ];

  private static readonly LARGE_TASK_PATTERNS = [
    /\b(?:architecture|refactor\s+(?:the\s+entire|all|whole)|build\s+(?:a\s+full|complete|new\s+system)|multi-agent|swarm|redesign|overhaul|migrate\s+the\s+database|pipeline)\b/i,
    /\b(?:microservices?|full\s+stack|end-to-end|e2e\s+test\s+suite)\b/i,
  ];

  private static readonly CODE_MUTATION_VERBS = [
    /\b(?:implement|create|build|make|code|develop|design|program|construct|craft|produce|fix|refactor|add|delete|remove|edit|modify|write|generate|update|test|debug|run|exec|install|patch|replace|setup|set up)\b/i,
  ];

  /**
   * Fast rule-based heuristic classification (0ms latency, zero API calls).
   */
  public static classifyHeuristic(input: string): IntentClassificationResult {
    const trimmed = input.trim();

    if (!trimmed) {
      return {
        intent: 'UNCLEAR/NOISE',
        confidence: 1.0,
        reason: 'Empty prompt',
        suggestedAction: 'ask_clarification',
      };
    }

    // 1. Explicit Slash Commands and Direct Overrides
    if (trimmed.startsWith('/plan ') || trimmed === '/plan') {
      return {
        intent: 'LARGE-TASK',
        confidence: 1.0,
        reason: 'Explicit /plan command override',
        suggestedAction: 'spawn_swarm',
      };
    }

    if (trimmed.startsWith('/chat ') || trimmed === '/chat') {
      return {
        intent: 'CHAT/QUESTION',
        confidence: 1.0,
        reason: 'Explicit /chat command override',
        suggestedAction: 'respond_directly',
      };
    }

    if (trimmed.startsWith('/')) {
      return {
        intent: 'SLASH-COMMAND',
        confidence: 1.0,
        reason: 'Explicit slash command prefix',
        suggestedAction: 'run_command',
      };
    }

    // 2. Unclear / Noise (e.g. "wtf", "wt", "?", punctuation, gibberish)
    for (const pat of IntentRouter.NOISE_PATTERNS) {
      if (pat.test(trimmed)) {
        return {
          intent: 'UNCLEAR/NOISE',
          confidence: 0.95,
          reason: `Input matched noise/ambiguity pattern: "${trimmed}"`,
          suggestedAction: 'ask_clarification',
        };
      }
    }

    if (trimmed.length <= 3 && !/^(?:hi|ok|no|go|cd)$/i.test(trimmed)) {
      return {
        intent: 'UNCLEAR/NOISE',
        confidence: 0.9,
        reason: 'Very short uninformative input',
        suggestedAction: 'ask_clarification',
      };
    }

    // 3. Status Questions ("what are you doing?", "what are u doing?")
    for (const pat of IntentRouter.STATUS_QUESTION_PATTERNS) {
      if (pat.test(trimmed)) {
        return {
          intent: 'CHAT/QUESTION',
          confidence: 0.98,
          reason: 'Session state / activity inquiry',
          suggestedAction: 'respond_directly',
        };
      }
    }

    // 4. Greetings and Conversational Inquiries
    for (const pat of IntentRouter.GREETING_PATTERNS) {
      if (pat.test(trimmed)) {
        return {
          intent: 'CHAT/QUESTION',
          confidence: 0.98,
          reason: 'Standard greeting or capability question',
          suggestedAction: 'respond_directly',
        };
      }
    }

    // 5. Code Explanation / Read-Only code questions
    const hasMutationVerb = IntentRouter.CODE_MUTATION_VERBS.some(v => v.test(trimmed));

    for (const pat of IntentRouter.CODE_EXPLAIN_PATTERNS) {
      if (pat.test(trimmed) && !hasMutationVerb) {
        return {
          intent: 'CODE-EXPLAIN',
          confidence: 0.92,
          reason: 'Read-only code explanation or navigation request',
          suggestedAction: 'respond_directly',
        };
      }
    }

    for (const pat of IntentRouter.READ_INSPECTION_PATTERNS) {
      if (pat.test(trimmed) && !hasMutationVerb) {
        return {
          intent: 'CHAT/QUESTION',
          confidence: 0.93,
          reason: 'Read-only workspace inspection inquiry',
          suggestedAction: 'respond_directly',
        };
      }
    }

    const hasQuestionMark = trimmed.endsWith('?');
    const isQuestionWord = /^(?:how|why|what|where|who|when|which)\s+/i.test(trimmed);

    if ((hasQuestionMark || isQuestionWord) && !hasMutationVerb) {
      return {
        intent: 'CHAT/QUESTION',
        confidence: 0.9,
        reason: 'Conceptual question or explanation query without code mutation intent',
        suggestedAction: 'respond_directly',
      };
    }

    // 6. Large-Task Detection (Broad architectural changes, multi-agent swarms)
    for (const pat of IntentRouter.LARGE_TASK_PATTERNS) {
      if (pat.test(trimmed)) {
        return {
          intent: 'LARGE-TASK',
          confidence: 0.85,
          reason: 'Broad scope architectural task matching large system pattern',
          suggestedAction: 'spawn_swarm',
        };
      }
    }

    // Explicit multi-file or multi-step cues
    if (/\b(?:and\s+also|then\s+create|across\s+all\s+files|for\s+every\s+component)\b/i.test(trimmed)) {
      return {
        intent: 'LARGE-TASK',
        confidence: 0.8,
        reason: 'Multi-stage instructions requiring task graph decomposition',
        suggestedAction: 'spawn_swarm',
      };
    }

    // 7. Small-Task Detection (Default for actionable coding inputs)
    if (hasMutationVerb || /\b(?:file|function|class|method|test|bug|error|typo|fix|add|route)\b/i.test(trimmed)) {
      return {
        intent: 'SMALL-TASK',
        confidence: 0.85,
        reason: 'Actionable code modification request',
        suggestedAction: 'execute_inline',
      };
    }

    // Default: treat ambiguous normal sentences as CHAT/QUESTION
    return {
      intent: 'CHAT/QUESTION',
      confidence: 0.7,
      reason: 'General inquiry or discussion topic',
      suggestedAction: 'respond_directly',
    };
  }

  /**
   * Fast hybrid router: Heuristic first, optional fast model check if confidence < threshold.
   */
  public static async classify(
    input: string,
    options?: {
      client?: NominHttpClient;
      model?: string;
    }
  ): Promise<IntentClassificationResult> {
    const heuristic = IntentRouter.classifyHeuristic(input);

    // If heuristic is high confidence or no client provided, return immediately (sub-millisecond)
    if (heuristic.confidence >= 0.85 || !options?.client || !options?.model) {
      return heuristic;
    }

    // Lightweight single-token classification fallback if needed
    try {
      const prompt = `Classify this user input into exactly one category:
- CHAT (greetings, conversation, casual queries)
- QUESTION (asking about code or how things work)
- SMALL_TASK (editing 1 file, fixing a bug, adding a small function)
- LARGE_TASK (architecting a new feature, multi-file refactoring)
- NOISE (unclear, typo, gibberish)

Input: "${input.slice(0, 200)}"
Category:`;

      const res = await options.client.chat({
        model: options.model,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 10,
        temperature: 0,
        purpose: 'router',
      });

      const cat = (res.choices[0]?.message?.content || '').trim().toUpperCase();
      if (cat.includes('CHAT') || cat.includes('QUESTION')) {
        return { intent: 'CHAT/QUESTION', confidence: 0.9, reason: 'LLM classification: Chat/Question', suggestedAction: 'respond_directly' };
      } else if (cat.includes('SMALL')) {
        return { intent: 'SMALL-TASK', confidence: 0.9, reason: 'LLM classification: Small Task', suggestedAction: 'execute_inline' };
      } else if (cat.includes('LARGE')) {
        return { intent: 'LARGE-TASK', confidence: 0.9, reason: 'LLM classification: Large Task', suggestedAction: 'spawn_swarm' };
      } else if (cat.includes('NOISE')) {
        return { intent: 'UNCLEAR/NOISE', confidence: 0.9, reason: 'LLM classification: Noise', suggestedAction: 'ask_clarification' };
      }
    } catch {
      // Fallback to heuristic
    }

    return heuristic;
  }
}
