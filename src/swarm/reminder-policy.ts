/**
 * @file reminder-policy.ts
 * @description System Reminder Engine for Nomin Code.
 * Reverse-engineered directly from Grok Build `crates/codegen/xai-grok-agent/src/system_reminder.rs`
 * and `crates/codegen/xai-grok-shell/src/session/acp_session_impl/reminders.rs`.
 *
 * Implements:
 * 1. `TodoNudgeConfig`: Automatically injects a reminder if `turns_since_todo_write >= 3`, throttled to once every 5 turns.
 * 2. `TodoGateConfig`: Turn-end gate capped at 2 fires per user prompt, injecting `<system-reminder>` if
 *    unbacked in-progress todos or pending acceptance criteria remain after a content-only assistant message.
 *
 * Pure Node.js standard library implementation.
 */

/**
 * Default per-prompt fire cap for the runtime turn-end TodoGate.
 * Direct port of `pub const DEFAULT_TODO_GATE_MAX_FIRES: u32 = 2;`
 */
export const DEFAULT_TODO_GATE_MAX_FIRES = 2;

/**
 * Default turns threshold before triggering a TodoWrite nudge.
 */
export const DEFAULT_TURNS_SINCE_TODO_WRITE = 3;

/**
 * Default minimum interval between consecutive nudges.
 */
export const DEFAULT_TURNS_BETWEEN_REMINDERS = 5;

/**
 * Configuration for the periodic TodoWrite nudge reminder.
 */
export interface TodoNudgeConfig {
  /** Whether the TodoNudge reminder is enabled. */
  enabled: boolean;
  /** Number of turns since last `todo_write` call before nudging. Default: 3. */
  turns_since_todo_write: number;
  /** Minimum turns between nudge reminders. Default: 5. */
  turns_between_reminders: number;
}

/**
 * Configuration for the runtime turn-end TodoGate.
 */
export interface TodoGateConfig {
  /** Whether the gate runs at all. Default: false (or opt-in via swarm runtime). */
  enabled: boolean;
  /** Hard cap on how many times the gate may fire per user prompt before turn ends. Default: 2. */
  max_fires_per_prompt: number;
}

/**
 * Session-level system reminder policy matching `xai-grok-agent::ReminderPolicy`.
 */
export interface ReminderPolicy {
  /** Whether system reminders are enabled at all. */
  enabled: boolean;
  /** Configuration for the periodic TodoWrite nudge reminder. */
  todo_nudge: TodoNudgeConfig;
  /** Configuration for the runtime turn-end TodoGate. */
  todo_gate: TodoGateConfig;
}

/**
 * Factory creating default ReminderPolicy instance matching Grok Build defaults.
 */
export function createDefaultReminderPolicy(): ReminderPolicy {
  return {
    enabled: true,
    todo_nudge: {
      enabled: true,
      turns_since_todo_write: DEFAULT_TURNS_SINCE_TODO_WRITE,
      turns_between_reminders: DEFAULT_TURNS_BETWEEN_REMINDERS,
    },
    todo_gate: {
      enabled: false, // Default is opt-in, activated by CLI flag or swarm coordinator
      max_fires_per_prompt: DEFAULT_TODO_GATE_MAX_FIRES,
    },
  };
}

/**
 * Input structure for TodoGate evaluation matching `CollectedTodoGateInput`.
 */
export interface TodoGateInput {
  pending: string[];
  inProgressUnbacked: string[];
  inProgressBacked: string[];
  backingTaskCount: number;
}

/**
 * Outcome decision of TodoGate evaluation.
 */
export type TodoGateDecision =
  | { type: 'continue' }
  | {
      type: 'nudge';
      reminder: string;
      reason: 'in_flight' | 'pending_criteria';
      fireCount: number;
    };

/**
 * Helper to escape `<system-reminder>` tags within content to prevent prompt-injection escapes.
 */
export function escapeReminderCloseTag(content: string, tag: string = 'system-reminder'): string {
  return content.replace(new RegExp(`</${tag}>`, 'g'), `<\\/${tag}>`);
}

/**
 * Wraps arbitrary content in `<system-reminder>` tag with escaping.
 */
export function wrapInReminderTag(content: string, tag: string = 'system-reminder'): string {
  const escaped = escapeReminderCloseTag(content, tag);
  return `<${tag}>\n${escaped}\n</${tag}>`;
}

/**
 * Builds the exact in-flight TodoGate reminder text matching Grok Build's `build_todo_gate_reminder`.
 */
export function buildTodoGateReminder(pending: string[], unbackedInProgress: string[]): string {
  const lines: string[] = [
    'You have outstanding todos but ended your turn without a tool call.',
    '',
  ];

  if (unbackedInProgress.length > 0) {
    lines.push('In-progress (no backing background task):');
    for (const item of unbackedInProgress) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (pending.length > 0) {
    lines.push('Pending:');
    for (const item of pending) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  lines.push(
    'Per <task_completion_discipline>, advance the next pending todo with the appropriate tool call NOW. ' +
      'If you have a genuine external blocker (missing credential, denied permission, network unreachable), ' +
      'state it explicitly AND mark the affected todos `cancelled` via todo_write with a reason in the same turn.'
  );

  return lines.join('\n');
}

/**
 * Stateful reminder tracker managing turn metrics, nudge intervals, and gate fire caps.
 */
export class ReminderTracker {
  private policy: ReminderPolicy;
  private turnsSinceTodoWrite: number = 0;
  private turnsSinceLastNudge: number = DEFAULT_TURNS_BETWEEN_REMINDERS;
  private todoGateFiresThisPrompt: number = 0;
  private promptTurnCount: number = 0;

  constructor(policy?: Partial<ReminderPolicy>) {
    this.policy = {
      ...createDefaultReminderPolicy(),
      ...policy,
      todo_nudge: {
        ...createDefaultReminderPolicy().todo_nudge,
        ...policy?.todo_nudge,
      },
      todo_gate: {
        ...createDefaultReminderPolicy().todo_gate,
        ...policy?.todo_gate,
      },
    };
  }

  public getPolicy(): Readonly<ReminderPolicy> {
    return this.policy;
  }

  public updatePolicy(updates: Partial<ReminderPolicy>): void {
    if (updates.enabled !== undefined) this.policy.enabled = updates.enabled;
    if (updates.todo_nudge) Object.assign(this.policy.todo_nudge, updates.todo_nudge);
    if (updates.todo_gate) Object.assign(this.policy.todo_gate, updates.todo_gate);
  }

  /**
   * Resets per-prompt state (called when a new user request or top-level task begins).
   */
  public resetPrompt(): void {
    this.todoGateFiresThisPrompt = 0;
    this.promptTurnCount = 0;
  }

  /**
   * Called whenever the agent invokes `todo_write` or equivalent task update tool.
   */
  public onTodoWriteCalled(): void {
    this.turnsSinceTodoWrite = 0;
  }

  /**
   * Called at the start of every model turn.
   */
  public onTurnStart(): void {
    this.promptTurnCount++;
    this.turnsSinceTodoWrite++;
    this.turnsSinceLastNudge++;
  }

  /**
   * Evaluates whether a periodic `TodoNudge` reminder should be injected.
   */
  public evaluateNudge(): { shouldNudge: boolean; reminderText?: string } {
    if (!this.policy.enabled || !this.policy.todo_nudge.enabled) {
      return { shouldNudge: false };
    }

    const { turns_since_todo_write, turns_between_reminders } = this.policy.todo_nudge;

    if (
      this.turnsSinceTodoWrite >= turns_since_todo_write &&
      this.turnsSinceLastNudge >= turns_between_reminders
    ) {
      this.turnsSinceLastNudge = 0;
      const rawText =
        'The system reminds you to update your task list using todo_write to keep task progress synchronized.';
      return {
        shouldNudge: true,
        reminderText: wrapInReminderTag(rawText),
      };
    }

    return { shouldNudge: false };
  }

  /**
   * Evaluates the turn-end `TodoGate`.
   * Capped at `max_fires_per_prompt` (default 2).
   * Fires if:
   * 1. Gate is enabled.
   * 2. Fires this prompt < max_fires_per_prompt.
   * 3. Assistant message was content-only (hasNoToolCalls === true).
   * 4. Unbacked in-progress or pending todos / acceptance criteria exist.
   */
  public evaluateGate(
    hasNoToolCalls: boolean,
    input: {
      pending: string[];
      inProgress: string[];
      backingTaskCount?: number;
    }
  ): TodoGateDecision {
    if (!this.policy.enabled || !this.policy.todo_gate.enabled) {
      return { type: 'continue' };
    }

    // Cap check: Bounded worst-case inference cost
    if (this.todoGateFiresThisPrompt >= this.policy.todo_gate.max_fires_per_prompt) {
      return { type: 'continue' };
    }

    // Gate only intercepts if the model finished speaking without issuing a tool call
    if (!hasNoToolCalls) {
      return { type: 'continue' };
    }

    const backingCount = input.backingTaskCount ?? 0;
    const backedCount = Math.min(input.inProgress.length, backingCount);
    const unbackedInProgress = input.inProgress.slice(backedCount);
    const pending = input.pending;

    if (pending.length === 0 && unbackedInProgress.length === 0) {
      return { type: 'continue' };
    }

    this.todoGateFiresThisPrompt++;
    const reminderRaw = buildTodoGateReminder(pending, unbackedInProgress);
    const taggedReminder = wrapInReminderTag(reminderRaw);

    return {
      type: 'nudge',
      reminder: taggedReminder,
      reason: 'in_flight',
      fireCount: this.todoGateFiresThisPrompt,
    };
  }

  /**
   * Returns current internal counters.
   */
  public getMetrics() {
    return {
      turnsSinceTodoWrite: this.turnsSinceTodoWrite,
      turnsSinceLastNudge: this.turnsSinceLastNudge,
      todoGateFiresThisPrompt: this.todoGateFiresThisPrompt,
      promptTurnCount: this.promptTurnCount,
    };
  }
}
