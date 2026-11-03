/**
 * @file types.ts
 * @description Swarm coordination, agent roles, blackboard schemas, and inter-agent message definitions.
 * Production-ready, pure Node.js compatible.
 */

import type { AgentRole as CoreAgentRole, TaskStatus as CoreTaskStatus } from '../types.js';

/**
 * The 4 core specialized agent roles in the Nomin Code swarm, plus supervisory roles.
 */
export type SwarmRole = 'Architect' | 'Coder' | 'Tester' | 'Verifier' | 'System';

/**
 * Normalization helper between lowercase and capitalized role strings.
 */
export function normalizeRole(role: string): SwarmRole {
  const lower = role.toLowerCase();
  switch (lower) {
    case 'architect':
      return 'Architect';
    case 'coder':
      return 'Coder';
    case 'tester':
      return 'Tester';
    case 'verifier':
    case 'reviewer':
      return 'Verifier';
    default:
      return 'System';
  }
}

/**
 * Task lifecycle states within the Blackboard Task Dependency DAG.
 */
export type SwarmTaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'CODE_SUBMITTED'
  | 'TESTS_PASSED'
  | 'VERIFIED'
  | 'REJECTED';

/**
 * Machine-verifiable acceptance criteria linked to a task.
 */
export interface AcceptanceCriterion {
  id: string;
  name: string;
  command: string;
  timeoutSeconds: number;
  expectedExitCode: number;
  description: string;
  verified?: boolean;
  evidence?: {
    exitCode: number;
    stdout: string;
    stderr: string;
    timestamp: number;
    durationMs?: number;
  };
}

/**
 * A discrete unit of work in the Swarm Task Dependency DAG.
 */
export interface SwarmTask {
  id: string;
  title: string;
  description: string;
  assignedRole: SwarmRole;
  dependencies: string[]; // Parent task IDs that must be in 'VERIFIED' status
  dependents?: string[]; // Child task IDs waiting on this task
  status: SwarmTaskStatus;
  worktreePath?: string;
  branchName?: string;
  commitHash?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  assignedAgentId?: string;
  createdAt: number;
  updatedAt: number;
  retryCount?: number;
  errorFeedback?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The Directed Acyclic Graph (DAG) of swarm tasks.
 */
export interface SwarmTaskDAG {
  sessionId: string;
  tasks: Record<string, SwarmTask>;
  topologicalOrder: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Tree-sitter / AST symbol entry cached on the blackboard.
 */
export interface SymbolEntry {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant' | 'module';
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
  pagerankScore?: number;
  lastIndexedAt: number;
}

/**
 * Status of an active agent worker in the swarm.
 */
export type AgentActivityStatus = 'idle' | 'busy' | 'waiting' | 'stopped' | 'failed';

/**
 * Registered agent worker details on the blackboard.
 */
export interface RegisteredAgent {
  agentId: string;
  role: SwarmRole;
  model: string;
  status: AgentActivityStatus;
  currentTaskId?: string;
  worktreePath?: string;
  lastHeartbeatAt: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    turnCount: number;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Worktree and file merge locks to prevent concurrent race conditions.
 */
export interface MergeLock {
  resourceId: string; // e.g. file path, worktree path, or branch
  holderAgentId: string;
  holderRole: SwarmRole;
  taskId: string;
  acquiredAt: number;
  expiresAt: number;
  reason?: string;
}

/**
 * The complete shared Blackboard state persisted to `.nomin/state/blackboard.json`.
 */
export interface BlackboardState {
  version: number;
  sessionId: string;
  taskDAG: SwarmTaskDAG;
  symbolCache: Record<string, SymbolEntry[]>; // key: filePath
  agentRegistry: Record<string, RegisteredAgent>;
  mergeLocks: Record<string, MergeLock>;
  metadata: {
    createdAt: number;
    updatedAt: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
  };
}

/**
 * Valid inter-agent message types across the swarm.
 */
export type NominMessageType =
  | 'TASK_DISPATCH'
  | 'TASK_PROGRESS'
  | 'CODE_SUBMISSION'
  | 'TEST_RESULTS'
  | 'REVIEW_VERDICT'
  | 'NUDGE_REMINDER'
  | 'ERROR_ESCALATION'
  | 'HEARTBEAT'
  | 'PEER_QUERY'
  | 'PEER_RESPONSE';

/**
 * Strictly typed inter-agent communication envelope.
 */
export interface NominAgentMessage {
  messageId: string;
  conversationId: string;
  senderRole: SwarmRole | 'System';
  senderAgentId?: string;
  recipientRole: SwarmRole | 'System' | 'broadcast';
  recipientAgentId?: string;
  timestamp: number;
  messageType: NominMessageType;
  payload: {
    taskId: string;
    status?: SwarmTaskStatus;
    worktreePath?: string;
    commitHash?: string;
    evidence?: {
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      diffSummary?: string;
      durationMs?: number;
    };
    feedback?: string;
    data?: unknown;
  };
}

/**
 * Filter options when reading or subscribing to the mailbox.
 */
export interface MessageFilter {
  senderRole?: SwarmRole | 'System';
  recipientRole?: SwarmRole | 'System' | 'broadcast';
  senderAgentId?: string;
  recipientAgentId?: string;
  taskId?: string;
  messageType?: NominMessageType | NominMessageType[];
}

/**
 * Swarm orchestration execution summary.
 */
export interface SwarmRunResult {
  success: boolean;
  sessionId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  durationMs: number;
  finalCommitHash?: string;
  taskOutcomes: Array<{
    taskId: string;
    title: string;
    status: SwarmTaskStatus;
    assignedRole: SwarmRole;
    criteriaPassed: number;
    criteriaTotal: number;
    error?: string;
  }>;
  errors: string[];
}
