/**
 * @file blackboard.ts
 * @description Durable central Blackboard state manager for Nomin Code.
 * Stores Task Dependency DAG, Symbol Cache, Agent Registry, and Merge Locks in `.nomin/state/blackboard.json`.
 * Pure Node.js standard library implementation.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { isSystemDir, isWritableDir } from '../config/index.js';
import type {
  AcceptanceCriterion,
  AgentActivityStatus,
  BlackboardState,
  MergeLock,
  RegisteredAgent,
  SwarmRole,
  SwarmTask,
  SwarmTaskDAG,
  SwarmTaskStatus,
  SymbolEntry,
} from './types.js';

export interface BlackboardOptions {
  workspaceRoot?: string;
  stateDir?: string;
  autoSave?: boolean;
  sessionId?: string;
}

export class Blackboard extends EventEmitter {
  private stateFilePath: string;
  private stateDir: string;
  private autoSave: boolean;
  private state: BlackboardState;
  private isInMemory: boolean = false;
  private saveLock: Promise<void> = Promise.resolve();

  constructor(options: BlackboardOptions = {}) {
    super();
    const root = options.workspaceRoot || process.cwd();

    // Respect options.stateDir if explicitly supplied
    if (options.stateDir) {
      this.stateDir = options.stateDir;
    } else {
      const isSys = isSystemDir(root);
      const isWritable = isWritableDir(root);
      this.stateDir = (isSys || !isWritable)
        ? path.join(os.homedir(), '.nomin', 'fallback-state')
        : path.join(root, '.nomin', 'state');
    }

    this.stateFilePath = path.join(this.stateDir, 'blackboard.json');
    this.autoSave = options.autoSave ?? true;

    const initialSessionId = options.sessionId || crypto.randomUUID();
    this.state = this.loadOrCreateState(initialSessionId);
  }

  /**
   * Returns the current state directory being used for persistence.
   */
  public getStateDir(): string {
    return this.stateDir;
  }

  /**
   * Returns true if blackboard is running in-memory (e.g., when disk is entirely inaccessible).
   */
  public isInMemoryMode(): boolean {
    return this.isInMemory;
  }

  /**
   * Switches the active workspace and re-points blackboard persistence to the new location.
   */
  public switchWorkspace(newWorkspaceRoot: string): void {
    const isSys = isSystemDir(newWorkspaceRoot);
    const isWritable = isWritableDir(newWorkspaceRoot);
    this.stateDir = (isSys || !isWritable)
      ? path.join(os.homedir(), '.nomin', 'fallback-state')
      : path.join(newWorkspaceRoot, '.nomin', 'state');
    this.stateFilePath = path.join(this.stateDir, 'blackboard.json');

    if (!fs.existsSync(this.stateDir)) {
      try {
        fs.mkdirSync(this.stateDir, { recursive: true });
      } catch (_) {}
    }

    this.state = this.loadOrCreateState(this.state.sessionId);
  }

  /**
   * Initializes or reloads state from disk.
   */
  private loadOrCreateState(sessionId: string): BlackboardState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as BlackboardState;
        if (parsed && parsed.taskDAG && parsed.agentRegistry) {
          return parsed;
        }
      }
    } catch {
      // If reading corrupted file, fallback to clean slate
    }

    const defaultState: BlackboardState = {
      version: 1,
      sessionId,
      taskDAG: {
        sessionId,
        tasks: {},
        topologicalOrder: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      symbolCache: {},
      agentRegistry: {},
      mergeLocks: {},
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
      },
    };

    if (this.autoSave) {
      this.saveStateSync(defaultState);
    }

    return defaultState;
  }

  /**
   * Returns read-only snapshot of current blackboard state.
   */
  public getState(): Readonly<BlackboardState> {
    return this.state;
  }

  /**
   * Gets session ID.
   */
  public getSessionId(): string {
    return this.state.sessionId;
  }

  // ---------------------------------------------------------------------------
  // Persistence (Atomic File Writes)
  // ---------------------------------------------------------------------------

  /**
   * Writes the blackboard state atomically to the specified directory and file.
   */
  private writeStateAtomic(dir: string, filePath: string, stateToSave: BlackboardState): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const serialized = JSON.stringify(stateToSave, null, 2);
    const tempPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;

    fs.writeFileSync(tempPath, serialized, 'utf-8');

    // On Windows, rename fails if destination exists in some versions, so unlink if present
    if (process.platform === 'win32' && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore unlink error, let rename attempt override
      }
    }
    fs.renameSync(tempPath, filePath);
  }

  /**
   * Synchronously saves the blackboard state atomically to disk.
   * Catches EPERM/EACCES errors and gracefully falls back to ~/.nomin/fallback-state or in-memory state.
   */
  private saveStateSync(stateToSave: BlackboardState): void {
    if (this.isInMemory) {
      this.emit('blackboard:saved', stateToSave);
      return;
    }

    try {
      this.writeStateAtomic(this.stateDir, this.stateFilePath, stateToSave);
      this.emit('blackboard:saved', stateToSave);
      return;
    } catch (err) {
      // Disk write or mkdir failed (EPERM, EACCES, read-only filesystem, etc.)
      const fallbackDir = path.join(os.homedir(), '.nomin', 'fallback-state');

      // Attempt 1: ~/.nomin/fallback-state
      if (this.stateDir !== fallbackDir) {
        try {
          this.stateDir = fallbackDir;
          this.stateFilePath = path.join(this.stateDir, 'blackboard.json');
          this.writeStateAtomic(this.stateDir, this.stateFilePath, stateToSave);
          this.emit('blackboard:saved', stateToSave);
          return;
        } catch {
          // Continue to temporary directory fallback
        }
      }

      // Attempt 2: os.tmpdir()/.nomin/fallback-state
      const tmpFallbackDir = path.join(os.tmpdir(), '.nomin', 'fallback-state');
      if (this.stateDir !== tmpFallbackDir) {
        try {
          this.stateDir = tmpFallbackDir;
          this.stateFilePath = path.join(this.stateDir, 'blackboard.json');
          this.writeStateAtomic(this.stateDir, this.stateFilePath, stateToSave);
          this.emit('blackboard:saved', stateToSave);
          return;
        } catch {
          // Continue to in-memory fallback
        }
      }

      // Attempt 3: In-memory fallback (prevent application crash)
      this.isInMemory = true;
      this.emit('blackboard:saved', stateToSave);
    }
  }

  /**
   * Asynchronously schedules atomic state persistence.
   */
  public async persist(): Promise<void> {
    this.saveLock = this.saveLock.then(async () => {
      this.state.metadata.updatedAt = Date.now();
      this.state.taskDAG.updatedAt = Date.now();
      this.saveStateSync(this.state);
    });
    return this.saveLock;
  }

  // ---------------------------------------------------------------------------
  // Task Dependency DAG Operations
  // ---------------------------------------------------------------------------

  /**
   * Adds a new task to the DAG and re-indexes dependencies.
   */
  public addTask(taskData: Omit<SwarmTask, 'createdAt' | 'updatedAt'>): SwarmTask {
    const now = Date.now();
    const task: SwarmTask = {
      ...taskData,
      dependencies: [...taskData.dependencies],
      dependents: taskData.dependents ? [...taskData.dependents] : [],
      acceptanceCriteria: taskData.acceptanceCriteria.map((c) => ({ ...c })),
      createdAt: now,
      updatedAt: now,
    };

    this.state.taskDAG.tasks[task.id] = task;

    // Update parent dependencies to record this task as a dependent
    for (const parentId of task.dependencies) {
      const parent = this.state.taskDAG.tasks[parentId];
      if (parent) {
        if (!parent.dependents) {
          parent.dependents = [];
        }
        if (!parent.dependents.includes(task.id)) {
          parent.dependents.push(task.id);
        }
      }
    }

    this.state.metadata.totalTasks = Object.keys(this.state.taskDAG.tasks).length;
    this.recomputeTopologicalSort();

    this.emit('task:added', task);
    if (this.autoSave) {
      void this.persist();
    }
    return task;
  }

  /**
   * Updates an existing task with partial properties.
   */
  public updateTask(taskId: string, patch: Partial<SwarmTask>): SwarmTask {
    const existing = this.state.taskDAG.tasks[taskId];
    if (!existing) {
      throw new Error(`Task with id '${taskId}' does not exist on Blackboard.`);
    }

    const previousStatus = existing.status;
    const dependenciesChanged = patch.dependencies && JSON.stringify(patch.dependencies) !== JSON.stringify(existing.dependencies);

    const updated: SwarmTask = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };

    this.state.taskDAG.tasks[taskId] = updated;

    if (dependenciesChanged) {
      this.recomputeDependentsGraph();
      this.recomputeTopologicalSort();
    }

    // Update status counters
    if (patch.status && patch.status !== previousStatus) {
      this.recomputeStatusCounters();
      this.emit('task:status_changed', { taskId, previousStatus, newStatus: patch.status, task: updated });
    }

    this.emit('task:updated', updated);
    if (this.autoSave) {
      void this.persist();
    }
    return updated;
  }

  /**
   * Retrieves a task by ID.
   */
  public getTask(taskId: string): SwarmTask | undefined {
    return this.state.taskDAG.tasks[taskId];
  }

  /**
   * Retrieves all tasks currently on the blackboard.
   */
  public getAllTasks(): SwarmTask[] {
    return Object.values(this.state.taskDAG.tasks);
  }

  /**
   * Computes the list of tasks whose dependencies are ALL satisfied (status === 'VERIFIED')
   * and which are currently in 'PENDING' status, making them ready to be executed.
   */
  public getReadyTasks(): SwarmTask[] {
    const tasks = Object.values(this.state.taskDAG.tasks);
    return tasks.filter((task) => {
      if (task.status !== 'PENDING') {
        return false;
      }
      return task.dependencies.every((depId) => {
        const dep = this.state.taskDAG.tasks[depId];
        return dep && dep.status === 'VERIFIED';
      });
    });
  }

  /**
   * Returns all parent tasks that this task depends on.
   */
  public getDependencies(taskId: string): SwarmTask[] {
    const task = this.getTask(taskId);
    if (!task) return [];
    return task.dependencies.map((id) => this.state.taskDAG.tasks[id]).filter(Boolean);
  }

  /**
   * Returns all child tasks that depend on this task.
   */
  public getDependents(taskId: string): SwarmTask[] {
    const task = this.getTask(taskId);
    if (!task) return [];
    const dependents = task.dependents || [];
    return dependents.map((id) => this.state.taskDAG.tasks[id]).filter(Boolean);
  }

  /**
   * Updates an acceptance criterion outcome and evidence on a task.
   */
  public updateCriterion(
    taskId: string,
    criterionId: string,
    verified: boolean,
    evidence?: AcceptanceCriterion['evidence']
  ): AcceptanceCriterion {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found.`);
    }

    const criterion = task.acceptanceCriteria.find((c) => c.id === criterionId);
    if (!criterion) {
      throw new Error(`Criterion '${criterionId}' not found on task '${taskId}'.`);
    }

    criterion.verified = verified;
    if (evidence) {
      criterion.evidence = { ...evidence };
    }
    task.updatedAt = Date.now();

    this.emit('criterion:updated', { taskId, criterionId, verified, evidence });
    if (this.autoSave) {
      void this.persist();
    }
    return criterion;
  }

  /**
   * Recomputes dependents array for each task in the DAG.
   */
  private recomputeDependentsGraph(): void {
    const tasks = this.state.taskDAG.tasks;
    for (const t of Object.values(tasks)) {
      t.dependents = [];
    }
    for (const t of Object.values(tasks)) {
      for (const parentId of t.dependencies) {
        if (tasks[parentId]) {
          if (!tasks[parentId].dependents) {
            tasks[parentId].dependents = [];
          }
          if (!tasks[parentId].dependents!.includes(t.id)) {
            tasks[parentId].dependents!.push(t.id);
          }
        }
      }
    }
  }

  /**
   * Performs topological sort using Kahn's algorithm with cycle detection.
   */
  public recomputeTopologicalSort(): string[] {
    const tasks = this.state.taskDAG.tasks;
    const inDegree: Record<string, number> = {};
    const taskIds = Object.keys(tasks);

    for (const id of taskIds) {
      inDegree[id] = 0;
    }

    for (const task of Object.values(tasks)) {
      for (const depId of task.dependencies) {
        if (tasks[depId]) {
          inDegree[task.id] = (inDegree[task.id] || 0) + 1;
        }
      }
    }

    const queue: string[] = [];
    for (const id of taskIds) {
      if (inDegree[id] === 0) {
        queue.push(id);
      }
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      const dependents = tasks[current]?.dependents || [];
      for (const childId of dependents) {
        if (inDegree[childId] !== undefined) {
          inDegree[childId]--;
          if (inDegree[childId] === 0) {
            queue.push(childId);
          }
        }
      }
    }

    if (sorted.length !== taskIds.length) {
      const unvisited = taskIds.filter((id) => !sorted.includes(id));
      throw new Error(`Cycle detected in Task Dependency DAG. Cyclic tasks: ${unvisited.join(', ')}`);
    }

    this.state.taskDAG.topologicalOrder = sorted;
    return sorted;
  }

  private recomputeStatusCounters(): void {
    const tasks = Object.values(this.state.taskDAG.tasks);
    let completed = 0;
    let failed = 0;
    for (const t of tasks) {
      if (t.status === 'VERIFIED') completed++;
      if (t.status === 'REJECTED') failed++;
    }
    this.state.metadata.completedTasks = completed;
    this.state.metadata.failedTasks = failed;
  }

  // ---------------------------------------------------------------------------
  // Symbol Cache
  // ---------------------------------------------------------------------------

  /**
   * Sets symbols for a specific file path.
   */
  public setSymbols(filePath: string, symbols: SymbolEntry[]): void {
    const normalized = path.normalize(filePath);
    this.state.symbolCache[normalized] = symbols.map((s) => ({ ...s }));
    if (this.autoSave) {
      void this.persist();
    }
  }

  /**
   * Gets cached symbols for a file path.
   */
  public getSymbols(filePath: string): SymbolEntry[] {
    const normalized = path.normalize(filePath);
    return this.state.symbolCache[normalized] || [];
  }

  /**
   * Searches for a symbol across the entire cache by name.
   */
  public findSymbol(symbolName: string): Array<{ filePath: string; symbol: SymbolEntry }> {
    const results: Array<{ filePath: string; symbol: SymbolEntry }> = [];
    for (const [filePath, symbols] of Object.entries(this.state.symbolCache)) {
      for (const symbol of symbols) {
        if (symbol.name === symbolName) {
          results.push({ filePath, symbol });
        }
      }
    }
    return results;
  }

  /**
   * Invalidates symbol cache for a specific file or all files.
   */
  public invalidateSymbols(filePath?: string): void {
    if (filePath) {
      delete this.state.symbolCache[path.normalize(filePath)];
    } else {
      this.state.symbolCache = {};
    }
    if (this.autoSave) {
      void this.persist();
    }
  }

  // ---------------------------------------------------------------------------
  // Agent Registry
  // ---------------------------------------------------------------------------

  /**
   * Registers an agent worker in the swarm.
   */
  public registerAgent(agent: {
    agentId: string;
    role: SwarmRole;
    model: string;
    worktreePath?: string;
  }): RegisteredAgent {
    const registered: RegisteredAgent = {
      agentId: agent.agentId,
      role: agent.role,
      model: agent.model,
      status: 'idle',
      worktreePath: agent.worktreePath,
      lastHeartbeatAt: Date.now(),
      tokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        turnCount: 0,
      },
    };
    this.state.agentRegistry[agent.agentId] = registered;
    this.emit('agent:registered', registered);
    if (this.autoSave) {
      void this.persist();
    }
    return registered;
  }

  /**
   * Updates agent heartbeat timestamp and optional status updates.
   */
  public heartbeat(agentId: string, updates?: Partial<RegisteredAgent>): void {
    const agent = this.state.agentRegistry[agentId];
    if (agent) {
      agent.lastHeartbeatAt = Date.now();
      if (updates) {
        Object.assign(agent, updates);
      }
    }
  }

  /**
   * Updates an agent's operational status and current task.
   */
  public updateAgentStatus(agentId: string, status: AgentActivityStatus, currentTaskId?: string): void {
    const agent = this.state.agentRegistry[agentId];
    if (agent) {
      agent.status = status;
      agent.currentTaskId = currentTaskId;
      agent.lastHeartbeatAt = Date.now();
      this.emit('agent:status_changed', { agentId, status, currentTaskId });
      if (this.autoSave) {
        void this.persist();
      }
    }
  }

  /**
   * Records token usage and turn count for an agent.
   */
  public recordAgentUsage(agentId: string, promptTokens: number, completionTokens: number): void {
    const agent = this.state.agentRegistry[agentId];
    if (agent) {
      agent.tokenUsage.promptTokens += promptTokens;
      agent.tokenUsage.completionTokens += completionTokens;
      agent.tokenUsage.totalTokens += promptTokens + completionTokens;
      agent.tokenUsage.turnCount += 1;
      agent.lastHeartbeatAt = Date.now();
      if (this.autoSave) {
        void this.persist();
      }
    }
  }

  /**
   * Retrieves registered agent by ID.
   */
  public getAgent(agentId: string): RegisteredAgent | undefined {
    return this.state.agentRegistry[agentId];
  }

  /**
   * Retrieves all registered agents.
   */
  public getAllAgents(): RegisteredAgent[] {
    return Object.values(this.state.agentRegistry);
  }

  // ---------------------------------------------------------------------------
  // Merge Locks
  // ---------------------------------------------------------------------------

  /**
   * Attempts to acquire an exclusive lock on a resource (worktree, file, branch).
   */
  public acquireLock(
    resourceId: string,
    holderAgentId: string,
    holderRole: SwarmRole,
    taskId: string,
    ttlMs: number = 300_000
  ): boolean {
    const existing = this.state.mergeLocks[resourceId];
    const now = Date.now();

    if (existing) {
      if (existing.expiresAt > now && existing.holderAgentId !== holderAgentId) {
        return false; // Lock is actively held by someone else
      }
    }

    const lock: MergeLock = {
      resourceId,
      holderAgentId,
      holderRole,
      taskId,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };

    this.state.mergeLocks[resourceId] = lock;
    this.emit('lock:acquired', lock);
    if (this.autoSave) {
      void this.persist();
    }
    return true;
  }

  /**
   * Releases a held lock if the caller is the holder.
   */
  public releaseLock(resourceId: string, holderAgentId: string): boolean {
    const existing = this.state.mergeLocks[resourceId];
    if (!existing) return true;

    if (existing.holderAgentId === holderAgentId || existing.expiresAt <= Date.now()) {
      delete this.state.mergeLocks[resourceId];
      this.emit('lock:released', { resourceId, holderAgentId });
      if (this.autoSave) {
        void this.persist();
      }
      return true;
    }
    return false;
  }

  /**
   * Checks whether a resource is currently locked by an active lease.
   */
  public isLocked(resourceId: string): boolean {
    const existing = this.state.mergeLocks[resourceId];
    if (!existing) return false;
    if (existing.expiresAt <= Date.now()) {
      delete this.state.mergeLocks[resourceId];
      return false;
    }
    return true;
  }

  /**
   * Gets details of current lock holder.
   */
  public getLockHolder(resourceId: string): MergeLock | undefined {
    const existing = this.state.mergeLocks[resourceId];
    if (!existing) return undefined;
    if (existing.expiresAt <= Date.now()) {
      delete this.state.mergeLocks[resourceId];
      return undefined;
    }
    return existing;
  }
}
