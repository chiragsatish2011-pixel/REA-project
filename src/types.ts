/**
 * Nomin Code: Global Type Definitions & Domain Contracts
 */

import type { TaskCompletionCertificate } from './verifier/types.js';

export type AgentRole = 'architect' | 'coder' | 'tester' | 'verifier' | 'system' | 'user';

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'CODE_SUBMITTED' | 'TESTS_PASSED' | 'VERIFIED' | 'REJECTED';

export interface AcceptanceCriterion {
  id: string;
  name: string;
  command: string;
  timeoutSeconds: number;
  expectedExitCode: number;
  description: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  assignedRole: AgentRole;
  dependencies: string[]; // Task IDs that must be VERIFIED before this starts
  status: TaskStatus;
  worktreePath?: string;
  branchName?: string;
  commitHash?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  createdAt: number;
  updatedAt: number;
}

export interface TaskDAG {
  id: string;
  tasks: Record<string, TaskItem>;
  topologicalOrder: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: string | null;
  reasoningContent?: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolResult {
  callId: string;
  toolName: string;
  output: string;
  isError: boolean;
  metadata?: Record<string, unknown>;
}

export interface ReviewVerdict {
  approved: boolean;
  taskId: string;
  reason: string;
  feedback?: string;
  integrityViolation?: boolean;
  certificate?: TaskCompletionCertificate;
  verifiedCriteria: string[];
  failedCriteria: string[];
  evidenceLogs: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export interface NominAgentMessage {
  messageId: string;
  conversationId: string;
  senderRole: AgentRole;
  recipientRole: AgentRole | 'broadcast';
  timestamp: number;
  messageType: 
    | 'TASK_DISPATCH'
    | 'TASK_PROGRESS'
    | 'CODE_SUBMISSION'
    | 'TEST_RESULTS'
    | 'REVIEW_VERDICT'
    | 'NUDGE_REMINDER'
    | 'ERROR_ESCALATION';
  payload: {
    taskId: string;
    status?: TaskStatus;
    worktreePath?: string;
    commitHash?: string;
    evidence?: {
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      diffSummary?: string;
    };
    feedback?: string;
    data?: unknown;
  };
}
