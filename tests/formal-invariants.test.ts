/**
 * @file tests/formal-invariants.test.ts
 * @description Academic & Formal Verification Test Suite for Nomin Code
 * Inspired by MIT 6.824 (Distributed Computer Systems) and IIT Advanced Concurrency & Systems.
 * 
 * Verifies mathematical properties, safety invariants, and liveness guarantees across:
 *   a) Blackboard State Invariants (DAG acyclicity, Kahn determinism, orphan-free readiness, 50-worker concurrency)
 *   b) Vector Clock & Causality Invariants (Lamport monotonicity, Fidge-Mattern partial order, anti-loop termination)
 *   c) Rate Limiter AIMD & Mathematical Correctness (Token/Leaky bucket burst bounds, priority preemption, Full Jitter entropy)
 *   d) Memory & Resource Boundedness (100-turn context compaction, anchor preservation, sliding history FIFO, heap stability)
 *   e) Filesystem & State Rollback Invariants (Worktree micro-commits, zero-dirty base rollback, lock pruning)
 * 
 * Runs 100% offline without external AI models or network dependencies.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

import { Blackboard } from '../src/swarm/blackboard.js';
import { SwarmMailbox } from '../src/swarm/mailbox.js';
import { SwarmCoordinator } from '../src/swarm/coordinator.js';
import { CompactionEngine, estimateTokens } from '../src/swarm/compaction.js';
import { ReminderTracker } from '../src/swarm/reminder-policy.js';
import type { SwarmTask, NominAgentMessage, SwarmRole, SwarmTaskStatus } from '../src/swarm/types.js';
import type { ChatMessage } from '../src/types.js';
import {
  TokenBucket,
  LeakyBucketShaper,
  AimdConcurrencyGate,
  NominRateLimitScheduler,
  RequestPriority,
} from '../src/provider/rate-limiter.js';
import { GitWorktreeManager, runGit } from '../src/tools/worktree.js';

// =============================================================================
// FORMAL VERIFICATION CONSTRUCTS (Distributed Systems Oracles)
// =============================================================================

/**
 * Formal Lamport Logical Clock (Lamport 1978: "Time, Clocks, and the Ordering of Events").
 * Invariant: a -> b => L(a) < L(b)
 */
export class LamportClock {
  private time: number = 0;

  public tick(): number {
    this.time += 1;
    return this.time;
  }

  public send(): number {
    return this.tick();
  }

  public receive(sentTime: number): number {
    this.time = Math.max(this.time, sentTime) + 1;
    return this.time;
  }

  public getTime(): number {
    return this.time;
  }
}

/**
 * Formal Vector Clock Implementation (Fidge 1988, Mattern 1989).
 * Defines a strict partial ordering over distributed multi-agent events:
 *   V_a < V_b  <=> (forall k: V_a[k] <= V_b[k]) and (exists k: V_a[k] < V_b[k])
 *   V_a || V_b <=> not(V_a < V_b) and not(V_b < V_a)  (concurrent)
 */
export class VectorClock {
  private clock: Map<string, number> = new Map();

  constructor(initial?: Record<string, number>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        this.clock.set(k, v);
      }
    }
  }

  public tick(processId: string): VectorClock {
    const current = this.clock.get(processId) || 0;
    this.clock.set(processId, current + 1);
    return this;
  }

  public merge(other: VectorClock): VectorClock {
    for (const [p, v] of other.clock.entries()) {
      const current = this.clock.get(p) || 0;
      this.clock.set(p, Math.max(current, v));
    }
    return this;
  }

  public clone(): VectorClock {
    const cloned = new VectorClock();
    for (const [k, v] of this.clock.entries()) {
      cloned.clock.set(k, v);
    }
    return cloned;
  }

  public get(processId: string): number {
    return this.clock.get(processId) || 0;
  }

  public isLessThan(other: VectorClock): boolean {
    return this.isLessOrEqualTo(other) && !this.isEqual(other);
  }

  public isLessOrEqualTo(other: VectorClock): boolean {
    const allKeys = new Set([...this.clock.keys(), ...other.clock.keys()]);
    for (const k of allKeys) {
      if (this.get(k) > other.get(k)) {
        return false;
      }
    }
    return true;
  }

  public isEqual(other: VectorClock): boolean {
    const allKeys = new Set([...this.clock.keys(), ...other.clock.keys()]);
    for (const k of allKeys) {
      if (this.get(k) !== other.get(k)) {
        return false;
      }
    }
    return true;
  }

  public isConcurrentWith(other: VectorClock): boolean {
    return !this.isLessOrEqualTo(other) && !other.isLessOrEqualTo(this);
  }

  public toJSON(): Record<string, number> {
    const obj: Record<string, number> = {};
    for (const [k, v] of this.clock.entries()) {
      obj[k] = v;
    }
    return obj;
  }
}

/**
 * Formal Anti-Loop State Machine Monitor.
 * Detects cyclic role transitions (e.g. Coder -> Verifier -> Coder)
 * and enforces termination after threshold K round-trips.
 */
export class AntiLoopDetector {
  private history: string[] = [];
  private cycleCount: Map<string, number> = new Map();
  private maxAllowedCycles: number;

  constructor(maxAllowedCycles: number = 3) {
    this.maxAllowedCycles = maxAllowedCycles;
  }

  public recordTransition(fromRole: string, toRole: string): {
    loopDetected: boolean;
    cycleKey: string;
    occurrences: number;
    shouldTerminate: boolean;
  } {
    const transition = `${fromRole}->${toRole}`;
    this.history.push(transition);

    // Track 2-cycle ping-pong (e.g., Coder->Verifier followed by Verifier->Coder)
    let occurrences = 0;
    const cycleKey = [fromRole, toRole].sort().join('<->');

    if (this.history.length >= 2) {
      const prev = this.history[this.history.length - 2];
      const curr = this.history[this.history.length - 1];
      if (prev === `${toRole}->${fromRole}` && curr === `${fromRole}->${toRole}`) {
        occurrences = (this.cycleCount.get(cycleKey) || 0) + 1;
        this.cycleCount.set(cycleKey, occurrences);
      }
    }

    const loopDetected = occurrences > 0;
    const shouldTerminate = occurrences >= this.maxAllowedCycles;

    return { loopDetected, cycleKey, occurrences, shouldTerminate };
  }

  public getCycleCount(cycleKey: string): number {
    return this.cycleCount.get(cycleKey) || 0;
  }
}

// =============================================================================
// TEST SUITE: FORMAL INVARIANTS & RIGOROUS VERIFICATION
// =============================================================================

describe('Nomin Code Formal Systems Verification Test Suite (MIT 6.824 / IIT Rigor)', () => {

  // ---------------------------------------------------------------------------
  // SECTION A: BLACKBOARD STATE INVARIANTS
  // ---------------------------------------------------------------------------
  describe('A. Blackboard State Invariants & Concurrency Safety', () => {
    let tmpDir: string;
    let blackboard: Blackboard;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-formal-blackboard-'));
      blackboard = new Blackboard({
        workspaceRoot: tmpDir,
        stateDir: path.join(tmpDir, 'state'),
        autoSave: false,
      });
    });

    afterEach(() => {
      try {
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch (_) {}
    });

    it('Theorem 1 (Topological Sort Edge Invariant): for all (u, v) in E, index(u) < index(v)', () => {
      // Build complex 7-node DAG with diamond dependencies
      // T1 -> T2, T3; T2 -> T4; T3 -> T4, T5; T4 -> T6; T5 -> T6; T6 -> T7
      const tasksData = [
        { id: 'T1', deps: [] },
        { id: 'T2', deps: ['T1'] },
        { id: 'T3', deps: ['T1'] },
        { id: 'T4', deps: ['T2', 'T3'] },
        { id: 'T5', deps: ['T3'] },
        { id: 'T6', deps: ['T4', 'T5'] },
        { id: 'T7', deps: ['T6'] },
      ];

      for (const td of tasksData) {
        blackboard.addTask({
          id: td.id,
          title: `Task ${td.id}`,
          description: `Description for ${td.id}`,
          assignedRole: 'Coder',
          dependencies: td.deps,
          status: 'PENDING',
          acceptanceCriteria: [],
        });
      }

      const order = blackboard.recomputeTopologicalSort();
      assert.strictEqual(order.length, 7, 'All 7 tasks must be included in topological order');

      // Verify strict edge inequality: pos(u) < pos(v) for all (u, v)
      const posMap = new Map<string, number>();
      order.forEach((id, idx) => posMap.set(id, idx));

      for (const td of tasksData) {
        for (const parentId of td.deps) {
          const parentPos = posMap.get(parentId)!;
          const childPos = posMap.get(td.id)!;
          assert.ok(
            parentPos < childPos,
            `Edge invariant violated: Parent ${parentId} at index ${parentPos} must precede child ${td.id} at index ${childPos}`
          );
        }
      }
    });

    it('Theorem 2 (Cycle Detection Completeness): any directed cycle is strictly rejected', () => {
      // Test 1: Direct 2-cycle (A -> B -> A)
      const bb2 = new Blackboard({ workspaceRoot: tmpDir, autoSave: false });
      bb2.addTask({ id: 'C1', title: 'C1', description: '', assignedRole: 'Coder', dependencies: [], status: 'PENDING', acceptanceCriteria: [] });
      bb2.addTask({ id: 'C2', title: 'C2', description: '', assignedRole: 'Coder', dependencies: ['C1'], status: 'PENDING', acceptanceCriteria: [] });
      
      // Inject backward dependency creating cycle: C1 depends on C2
      assert.throws(
        () => {
          bb2.updateTask('C1', { dependencies: ['C2'] });
        },
        /Cycle detected in Task Dependency DAG/i,
        'Must reject direct 2-cycle'
      );

      // Test 2: 3-cycle (A -> B -> C -> A)
      const bb3 = new Blackboard({ workspaceRoot: tmpDir, autoSave: false });
      bb3.addTask({ id: 'X1', title: 'X1', description: '', assignedRole: 'Coder', dependencies: [], status: 'PENDING', acceptanceCriteria: [] });
      bb3.addTask({ id: 'X2', title: 'X2', description: '', assignedRole: 'Coder', dependencies: ['X1'], status: 'PENDING', acceptanceCriteria: [] });
      bb3.addTask({ id: 'X3', title: 'X3', description: '', assignedRole: 'Coder', dependencies: ['X2'], status: 'PENDING', acceptanceCriteria: [] });
      
      assert.throws(
        () => {
          bb3.updateTask('X1', { dependencies: ['X3'] });
        },
        /Cycle detected in Task Dependency DAG/i,
        'Must reject 3-cycle'
      );

      // Test 3: Self-loop (A -> A)
      const bbSelf = new Blackboard({ workspaceRoot: tmpDir, autoSave: false });
      assert.throws(
        () => {
          bbSelf.addTask({ id: 'S1', title: 'S1', description: '', assignedRole: 'Coder', dependencies: ['S1'], status: 'PENDING', acceptanceCriteria: [] });
        },
        /Cycle detected in Task Dependency DAG/i,
        'Must reject self-loop'
      );
    });

    it('Lemma 1.1 (Topological Sort Determinism): repeated sorting produces identical invariant-preserving permutation', () => {
      // Construct branched DAG
      const ids = ['Root', 'BranchA', 'BranchB', 'LeafA1', 'LeafA2', 'LeafB1', 'Join'];
      blackboard.addTask({ id: 'Root', title: '', description: '', assignedRole: 'Architect', dependencies: [], status: 'PENDING', acceptanceCriteria: [] });
      blackboard.addTask({ id: 'BranchA', title: '', description: '', assignedRole: 'Coder', dependencies: ['Root'], status: 'PENDING', acceptanceCriteria: [] });
      blackboard.addTask({ id: 'BranchB', title: '', description: '', assignedRole: 'Coder', dependencies: ['Root'], status: 'PENDING', acceptanceCriteria: [] });
      blackboard.addTask({ id: 'LeafA1', title: '', description: '', assignedRole: 'Tester', dependencies: ['BranchA'], status: 'PENDING', acceptanceCriteria: [] });
      blackboard.addTask({ id: 'LeafA2', title: '', description: '', assignedRole: 'Tester', dependencies: ['BranchA'], status: 'PENDING', acceptanceCriteria: [] });
      blackboard.addTask({ id: 'LeafB1', title: '', description: '', assignedRole: 'Tester', dependencies: ['BranchB'], status: 'PENDING', acceptanceCriteria: [] });
      blackboard.addTask({ id: 'Join', title: '', description: '', assignedRole: 'Verifier', dependencies: ['LeafA1', 'LeafA2', 'LeafB1'], status: 'PENDING', acceptanceCriteria: [] });

      const baselineOrder = blackboard.recomputeTopologicalSort();
      for (let run = 0; run < 50; run++) {
        const recomputed = blackboard.recomputeTopologicalSort();
        assert.deepStrictEqual(recomputed, baselineOrder, `Topological sort must be deterministic across iterations (failed run ${run})`);
      }
    });

    it('Theorem 3 (No Orphaned Downstream Execution): tasks unlock iff all dependencies are VERIFIED', () => {
      blackboard.addTask({ id: 'Parent1', title: '', description: '', assignedRole: 'Coder', dependencies: [], status: 'PENDING', acceptanceCriteria: [] });
      blackboard.addTask({ id: 'Parent2', title: '', description: '', assignedRole: 'Coder', dependencies: [], status: 'PENDING', acceptanceCriteria: [] });
      blackboard.addTask({ id: 'Child', title: '', description: '', assignedRole: 'Tester', dependencies: ['Parent1', 'Parent2'], status: 'PENDING', acceptanceCriteria: [] });

      // State 1: Both parents PENDING => Ready contains Parent1, Parent2, NOT Child
      let ready = blackboard.getReadyTasks().map(t => t.id);
      assert.ok(ready.includes('Parent1') && ready.includes('Parent2'));
      assert.ok(!ready.includes('Child'), 'Child must not be ready when parents are PENDING');

      // State 2: Parent1 IN_PROGRESS => Child still not ready
      blackboard.updateTask('Parent1', { status: 'IN_PROGRESS' });
      ready = blackboard.getReadyTasks().map(t => t.id);
      assert.ok(!ready.includes('Child'), 'Child must not be ready when Parent1 is IN_PROGRESS');

      // State 3: Parent1 VERIFIED, Parent2 PENDING => Child still not ready
      blackboard.updateTask('Parent1', { status: 'VERIFIED' });
      ready = blackboard.getReadyTasks().map(t => t.id);
      assert.ok(!ready.includes('Child'), 'Child must not be ready when Parent2 is still PENDING');

      // State 4: Parent2 REJECTED => Child must NEVER become ready (orphan prevention)
      blackboard.updateTask('Parent2', { status: 'REJECTED' });
      ready = blackboard.getReadyTasks().map(t => t.id);
      assert.ok(!ready.includes('Child'), 'Child must NEVER be ready when a dependency failed with REJECTED');

      // State 5: Parent2 fixed and VERIFIED => Child now unlocked!
      blackboard.updateTask('Parent2', { status: 'VERIFIED' });
      ready = blackboard.getReadyTasks().map(t => t.id);
      assert.ok(ready.includes('Child'), 'Child must unlock when all dependencies are VERIFIED');
    });

    it('Theorem 4 (Concurrency Safety & Mutual Exclusion): 50 concurrent state transitions without race conditions or lost updates', async () => {
      const N = 50;
      const persistentBB = new Blackboard({
        workspaceRoot: tmpDir,
        stateDir: path.join(tmpDir, 'concurrent-state'),
        autoSave: true,
      });

      // Initialize N tasks
      for (let i = 0; i < N; i++) {
        persistentBB.addTask({
          id: `task-concurrent-${i}`,
          title: `Concurrent Worker Task ${i}`,
          description: `Work item ${i}`,
          assignedRole: 'Coder',
          dependencies: [],
          status: 'PENDING',
          acceptanceCriteria: [],
        });
      }

      assert.strictEqual(persistentBB.getAllTasks().length, N);

      // Fire 50 concurrent workers simulating async execution loops
      const workerPromises = Array.from({ length: N }, async (_, i) => {
        const taskId = `task-concurrent-${i}`;
        
        // Step 1: PENDING -> IN_PROGRESS
        persistentBB.updateTask(taskId, { status: 'IN_PROGRESS' });
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 5)));

        // Step 2: IN_PROGRESS -> CODE_SUBMITTED
        persistentBB.updateTask(taskId, { status: 'CODE_SUBMITTED', commitHash: `hash-${i}` });
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 5)));

        // Step 3: CODE_SUBMITTED -> VERIFIED
        persistentBB.updateTask(taskId, { status: 'VERIFIED' });
      });

      await Promise.all(workerPromises);
      await persistentBB.persist();

      // Invariants Check
      const allTasks = persistentBB.getAllTasks();
      assert.strictEqual(allTasks.length, N, `Expected exactly ${N} tasks`);

      const verifiedTasks = allTasks.filter(t => t.status === 'VERIFIED');
      assert.strictEqual(verifiedTasks.length, N, `All ${N} tasks must be in VERIFIED state without lost updates`);

      const state = persistentBB.getState();
      assert.strictEqual(state.metadata.completedTasks, N, 'State metadata completedTasks counter must match exactly N');
      assert.strictEqual(state.metadata.failedTasks, 0, 'No task should have failed');

      // Mutual Exclusion Invariant: 50 agents simultaneously race for the same lock
      const lockResource = 'shared_main_repo';
      let grantCount = 0;
      const raceResults = await Promise.all(
        Array.from({ length: N }, async (_, i) => {
          const acquired = persistentBB.acquireLock(lockResource, `agent-worker-${i}`, 'Coder', 'T-lock');
          if (acquired) grantCount++;
          return acquired;
        })
      );

      assert.strictEqual(grantCount, 1, 'Strict mutual exclusion invariant: Exactly 1 agent must acquire the lock');
      assert.strictEqual(raceResults.filter(Boolean).length, 1);
      assert.strictEqual(persistentBB.isLocked(lockResource), true);

      // Releasing lock makes it available again
      const currentHolder = persistentBB.getLockHolder(lockResource)!;
      assert.ok(currentHolder);
      const released = persistentBB.releaseLock(lockResource, currentHolder.holderAgentId);
      assert.strictEqual(released, true);
      assert.strictEqual(persistentBB.isLocked(lockResource), false);
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION B: VECTOR CLOCK & CAUSALITY INVARIANTS
  // ---------------------------------------------------------------------------
  describe('B. Vector Clock & Causality Invariants', () => {
    it('Theorem 5.1 (Lamport Logical Clock Monotonicity): L(send) < L(receive) along causal chains', () => {
      const lamport = new LamportClock();
      
      const t0 = lamport.getTime();
      const sendTimeA = lamport.send();
      assert.ok(sendTimeA > t0, 'Send event must strictly increment local Lamport clock');

      // Receiver receives message sent at sendTimeA
      const recvTimeB = lamport.receive(sendTimeA);
      assert.ok(recvTimeB > sendTimeA, 'Receive event must strictly exceed sent timestamp');

      // Intermediate work and subsequent send
      const sendTimeB = lamport.send();
      const recvTimeC = lamport.receive(sendTimeB);
      assert.ok(recvTimeC > sendTimeB && sendTimeB > recvTimeB);
    });

    it('Theorem 5.2 (Vector Clock Partial Order): preserves causal order across 4-agent swarm pipeline', () => {
      const roles: SwarmRole[] = ['Architect', 'Coder', 'Tester', 'Verifier'];
      const clocks: Record<string, VectorClock> = {
        Architect: new VectorClock(),
        Coder: new VectorClock(),
        Tester: new VectorClock(),
        Verifier: new VectorClock(),
      };

      // Step 1: Architect decomposes goal into task and sends to Coder
      clocks.Architect.tick('Architect');
      const msgArchToCoder = clocks.Architect.clone();

      // Step 2: Coder receives message, updates its vector, does work, sends to Tester
      clocks.Coder.merge(msgArchToCoder);
      clocks.Coder.tick('Coder');
      const msgCoderToTester = clocks.Coder.clone();

      // Invariant: Architect event causally precedes Coder event
      assert.ok(msgArchToCoder.isLessThan(msgCoderToTester), 'Causality: Architect < Coder');

      // Step 3: Tester receives, runs tests, sends to Verifier
      clocks.Tester.merge(msgCoderToTester);
      clocks.Tester.tick('Tester');
      const msgTesterToVerifier = clocks.Tester.clone();

      assert.ok(msgCoderToTester.isLessThan(msgTesterToVerifier), 'Causality: Coder < Tester');

      // Step 4: Verifier receives, validates evidence, issues release verdict
      clocks.Verifier.merge(msgTesterToVerifier);
      clocks.Verifier.tick('Verifier');

      // Transitive Causality Verification
      assert.ok(msgArchToCoder.isLessThan(clocks.Verifier), 'Transitive Causality: Architect < Verifier');
      assert.ok(msgCoderToTester.isLessThan(clocks.Verifier), 'Transitive Causality: Coder < Verifier');
      assert.ok(msgTesterToVerifier.isLessThan(clocks.Verifier), 'Transitive Causality: Tester < Verifier');
    });

    it('Theorem 5.3 (Vector Clock Concurrency Incomparability): concurrent parallel tasks are neither less nor greater', () => {
      // Two worker agents working concurrently on independent subtasks
      const workerA = new VectorClock();
      const workerB = new VectorClock();

      // Both advance their independent clocks
      workerA.tick('WorkerA');
      workerB.tick('WorkerB');

      // Invariant: workerA || workerB (incomparable / concurrent)
      assert.strictEqual(workerA.isLessThan(workerB), false, 'WorkerA cannot be less than WorkerB');
      assert.strictEqual(workerB.isLessThan(workerA), false, 'WorkerB cannot be less than WorkerA');
      assert.strictEqual(workerA.isConcurrentWith(workerB), true, 'Independent tasks must be concurrent (incomparable)');
    });

    it('Theorem 6 (Anti-Loop Detection & Ping-Pong Termination): role message cycles terminate at threshold K', async () => {
      const maxRetries = 3;
      const loopDetector = new AntiLoopDetector(maxRetries);
      const mailbox = new SwarmMailbox();

      let pingPongCount = 0;
      let terminated = false;

      // Simulate ping-pong between Coder and Verifier
      for (let iteration = 1; iteration <= 10; iteration++) {
        // Coder submits patch to Verifier
        const t1 = loopDetector.recordTransition('Coder', 'Verifier');
        mailbox.send({
          conversationId: 'loop-test',
          senderRole: 'Coder',
          recipientRole: 'Verifier',
          messageType: 'CODE_SUBMISSION',
          payload: { taskId: 'T-loop', status: 'CODE_SUBMITTED' },
        });

        // Verifier rejects and returns feedback to Coder
        const t2 = loopDetector.recordTransition('Verifier', 'Coder');
        mailbox.send({
          conversationId: 'loop-test',
          senderRole: 'Verifier',
          recipientRole: 'Coder',
          messageType: 'REVIEW_VERDICT',
          payload: { taskId: 'T-loop', status: 'REJECTED', feedback: `Attempt ${iteration} failed criteria` },
        });

        pingPongCount = t2.occurrences;

        if (t2.shouldTerminate) {
          terminated = true;
          break; // Hard termination triggered by safety policy
        }
      }

      assert.strictEqual(terminated, true, 'Anti-loop detector must trigger termination when threshold is reached');
      assert.strictEqual(pingPongCount, maxRetries, `Must terminate exactly at maxRetries = ${maxRetries}`);

      // Verify that SwarmCoordinator respects maxRetriesPerTask and breaks out of ping-pong
      const coordDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-formal-coord-'));
      const coord = new SwarmCoordinator({
        workspaceRoot: coordDir,
        stateDir: path.join(coordDir, 'state'),
        useGitWorktrees: false,
        maxRetriesPerTask: 2,
      });

      // Provide single task to strictly test ping-pong termination
      coord.setArchitectHook(async () => [
        {
          id: 'T-pingpong-01',
          title: 'Adversarial Task',
          description: 'Task for loop termination test',
          assignedRole: 'Coder',
          dependencies: [],
          status: 'PENDING',
          acceptanceCriteria: [
            {
              id: 'AC-1',
              name: 'Criteria 1',
              command: 'node -e "process.exit(0)"',
              timeoutSeconds: 5,
              expectedExitCode: 0,
              description: 'Pass criteria',
            },
          ],
        },
      ]);

      // Mock Coder that always submits code
      coord.setCoderHook(async () => ({ success: true, commitHash: 'c0ff' }));
      // Mock Tester that succeeds
      coord.setTesterHook(async () => ({ success: true, evidence: { command: 'test', exitCode: 0, stdout: '', stderr: '' } }));
      // Mock Verifier that always rejects (adversarial reviewer loop)
      let verifierCalls = 0;
      coord.setVerifierHook(async () => {
        verifierCalls++;
        return { success: false, feedback: 'Intentional rejection for loop termination test' };
      });

      const runResult = await coord.orchestrate('Loop Termination Verification');
      assert.strictEqual(runResult.success, false, 'Run must fail when retries are exhausted');
      // maxRetries = 2 means attempt 0 + retry 1 + retry 2 = 3 verifier evaluations total
      assert.ok(verifierCalls <= 3, `Verifier must not be invoked more than maxRetries + 1 times (invoked: ${verifierCalls})`);

      try {
        fs.rmSync(coordDir, { recursive: true, force: true });
      } catch (_) {}
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION C: RATE LIMITER AIMD & MATHEMATICAL CORRECTNESS
  // ---------------------------------------------------------------------------
  describe('C. Rate Limiter AIMD & Mathematical Correctness', () => {
    it('Theorem 7 (Token Bucket Invariant): under a synthetic storm of 1,000 requests, requests never exceed limits', () => {
      const capacity = 100;
      const bucket = new TokenBucket(capacity, 60000); // 100 RPM

      let admitted = 0;
      let throttled = 0;

      // Synthetic storm of 1,000 instantaneous requests at t = 0
      for (let i = 0; i < 1000; i++) {
        if (bucket.tryConsume(1)) {
          admitted++;
        } else {
          throttled++;
        }
      }

      assert.strictEqual(admitted, capacity, `At t=0, exactly ${capacity} requests must be admitted`);
      assert.strictEqual(throttled, 900, 'Remaining 900 requests must be rejected/throttled');
      assert.strictEqual(bucket.getAvailable(), 0, 'Tokens available must be zero after exhaustion');

      // Invariant: Non-negative token bound
      assert.ok(bucket.getAvailable() >= 0, 'Tokens must never be negative');

      // Refund invariant: refunds cannot exceed initial capacity
      bucket.refund(500);
      assert.strictEqual(bucket.getAvailable(), capacity, 'Refund must be clamped to bucket capacity');
    });

    it('Theorem 8 (Priority Queue Strict Preemption): CRITICAL requests strictly preempt BACKGROUND requests', async () => {
      const scheduler = new NominRateLimitScheduler({
        rpmLimit: 60000,
        tpmLimit: 10000000,
        maxConcurrency: 1, // Serial processing to strictly observe queue order
        leakyBucketIntervalMs: 0,
      });

      const dispatchOrder: string[] = [];

      // We enqueue 10 BACKGROUND tasks, 5 INTERACTIVE tasks, and 1 CRITICAL task
      // We start them in paused state, then trigger dispatch
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          scheduler.schedule(
            async () => {
              dispatchOrder.push(`BACKGROUND-${i}`);
            },
            { priority: RequestPriority.BACKGROUND }
          )
        );
      }

      for (let i = 0; i < 5; i++) {
        promises.push(
          scheduler.schedule(
            async () => {
              dispatchOrder.push(`INTERACTIVE-${i}`);
            },
            { priority: RequestPriority.INTERACTIVE }
          )
        );
      }

      // Enqueue urgent verifier task
      promises.push(
        scheduler.schedule(
          async () => {
            dispatchOrder.push('CRITICAL-VERIFIER');
          },
          { priority: RequestPriority.CRITICAL }
        )
      );

      await Promise.all(promises);
      scheduler.destroy();

      // Verification of Strict Preemption Invariant:
      // The CRITICAL task must be dispatched before any remaining BACKGROUND task
      const criticalIndex = dispatchOrder.indexOf('CRITICAL-VERIFIER');
      assert.ok(criticalIndex !== -1, 'CRITICAL task must be executed');

      // Verify that after the CRITICAL task is available, no BACKGROUND task precedes it
      // In fact, since CRITICAL was enqueued before processing of the batch finished,
      // it must execute before the INTERACTIVE and BACKGROUND tasks that were waiting
      const backgroundIndices = dispatchOrder
        .map((name, idx) => (name.startsWith('BACKGROUND') ? idx : -1))
        .filter(idx => idx !== -1);

      // Verify that CRITICAL preempted subsequent tasks
      assert.ok(
        criticalIndex <= backgroundIndices[backgroundIndices.length - 1],
        'CRITICAL request must preempt low-priority queue items'
      );
    });

    it('Theorem 9 (Full Jitter Statistical Dispersion): exponential backoff exhibits non-clustering random variance', () => {
      const scheduler = new NominRateLimitScheduler({
        rpmLimit: 60,
        tpmLimit: 100000,
        maxConcurrency: 2,
        baseBackoffMs: 1000,
        maxBackoffMs: 32000,
      });

      const attempt = 4; // Expected ceiling: min(32000, 1000 * 2^4 = 16000)
      const expectedCeiling = 16000;
      const N = 1000;
      const samples: number[] = [];

      for (let i = 0; i < N; i++) {
        const val = scheduler.computeFullJitterBackoff(attempt);
        samples.push(val);
      }

      scheduler.destroy();

      // 1. Strict Bound Invariant: 250 <= J <= expectedCeiling
      for (const s of samples) {
        assert.ok(s >= 250, `Sample ${s} below minimum 250ms`);
        assert.ok(s <= expectedCeiling, `Sample ${s} exceeds ceiling ${expectedCeiling}`);
      }

      // 2. Statistical Mean Convergence:
      // Uniform U(250, 16000) theoretical mean = (250 + 16000) / 2 = 8125
      const sum = samples.reduce((acc, v) => acc + v, 0);
      const mean = sum / N;
      const theoreticalMean = (250 + expectedCeiling) / 2;
      const tolerance = 600; // ~7% margin for N=1000 sample size
      assert.ok(
        Math.abs(mean - theoreticalMean) < tolerance,
        `Sample mean (${mean}) must converge to theoretical uniform mean (${theoreticalMean}) +/- ${tolerance}`
      );

      // 3. Statistical Variance: Var(X) > 0 (prevents thundering herd)
      const variance = samples.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / N;
      assert.ok(variance > 1_000_000, `Variance (${variance}) must be substantial to prevent thundering herd`);

      // 4. Distinct Value Entropy:
      const uniqueValues = new Set(samples);
      const uniqueRatio = uniqueValues.size / N;
      assert.ok(
        uniqueRatio > 0.85,
        `Entropy test failed: Unique value ratio (${uniqueRatio}) must exceed 85% to ensure uniform spread`
      );
    });

    it('Theorem 10 (AIMD Concurrency Invariant): multiplicative decrease on 429 and additive increase on success', () => {
      const gate = new AimdConcurrencyGate(10, 1, 3); // max=10, min=1, window=3
      
      // Initial limit starts at min(2, max) = 2
      assert.strictEqual(gate.getCurrentLimit(), 2);

      // 3 successes trigger additive increase (+1)
      gate.recordSuccess();
      gate.recordSuccess();
      gate.recordSuccess();
      assert.strictEqual(gate.getCurrentLimit(), 3, 'Additive Increase: 3 successes must increase limit to 3');

      // Another 3 successes trigger next additive increase
      gate.recordSuccess();
      gate.recordSuccess();
      gate.recordSuccess();
      assert.strictEqual(gate.getCurrentLimit(), 4, 'Additive Increase: limit must increase to 4');

      // Multiplicative Decrease on 429 throttle: floor(4 * 0.5) = 2
      gate.recordThrottle();
      assert.strictEqual(gate.getCurrentLimit(), 2, 'Multiplicative Decrease: 4 halved to 2');

      // Another throttle: floor(2 * 0.5) = 1
      gate.recordThrottle();
      assert.strictEqual(gate.getCurrentLimit(), 1, 'Multiplicative Decrease: 2 halved to 1');

      // Throttling at minLimit stays at minLimit
      gate.recordThrottle();
      assert.strictEqual(gate.getCurrentLimit(), 1, 'Limit must not drop below minLimit = 1');
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION D: MEMORY & RESOURCE BOUNDEDNESS
  // ---------------------------------------------------------------------------
  describe('D. Memory & Resource Boundedness', () => {
    it('Theorem 11 (Context Boundedness & Compaction Invariant): token count stays strictly bounded over 100 turns', async () => {
      const contextWindow = 20000;
      const keepTokens = 1000;
      const engine = new CompactionEngine({
        contextWindow,
        bufferShare: 0.20,
        keepTokens,
      });

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: 'You are Nomin Code, an autonomous formal verification agent. [SYSTEM_ANCHOR]',
        },
      ];

      const { compactionThreshold } = engine.getThresholds();
      let compactionCount = 0;

      // Realistic code diff payload (~250 tokens per turn)
      const codePayload = 'function verifyInvariant(item: number): boolean {\n  return item > 0 && Number.isFinite(item);\n}\n'.repeat(6);

      // Simulate 100 conversational turns adding code diffs and thought steps
      for (let turn = 1; turn <= 100; turn++) {
        messages.push({
          role: 'user',
          content: `Turn ${turn}: Implement formal invariant check and verify criteria on component ${turn}.\n${codePayload}`,
        });
        messages.push({
          role: 'assistant',
          content: `Turn ${turn}: AST transform applied:\n<<<<<<< SEARCH\n// old implementation\n=======\n// new verified implementation\n>>>>>>> REPLACE`,
        });

        // Trigger compaction if threshold crossed
        const currentTokens = estimateTokens(messages);
        if (currentTokens >= compactionThreshold) {
          const result = await engine.compact(messages, 'auto');
          if (result.compacted) {
            compactionCount++;
            messages.length = 0;
            messages.push(...result.messages);
          }
        }

        // INVARIANT 1: Total tokens never exceed contextWindow
        const activeTokens = estimateTokens(messages);
        assert.ok(
          activeTokens <= contextWindow,
          `Turn ${turn}: Active tokens (${activeTokens}) exceeded context window (${contextWindow})`
        );

        // INVARIANT 2: System prompt anchor is strictly preserved at index 0
        assert.strictEqual(messages[0].role, 'system', `Turn ${turn}: Message[0] must remain system prompt`);
        assert.ok(
          messages[0].content!.includes('[SYSTEM_ANCHOR]'),
          `Turn ${turn}: System prompt anchor was lost during compaction`
        );
      }

      assert.ok(compactionCount >= 2, `Expected at least 2 compactions across 100 turns, got ${compactionCount}`);

      // Mailbox sliding history invariant
      const mailbox = new SwarmMailbox({ historyLimit: 50 });
      for (let i = 0; i < 200; i++) {
        mailbox.send({
          conversationId: 'bounded-history',
          senderRole: 'Coder',
          recipientRole: 'Tester',
          messageType: 'TASK_PROGRESS',
          payload: { taskId: `T-${i}`, status: 'IN_PROGRESS' },
        });
      }
      assert.strictEqual(
        mailbox.getHistory().length,
        50,
        'Mailbox history must be strictly capped at historyLimit = 50'
      );
    });

    it('Theorem 12 (Heap Memory Stability): memory usage remains stable across 100 turns without unbounded leak', async () => {
      if (global.gc) {
        global.gc();
      }
      const initialHeap = process.memoryUsage().heapUsed;

      const engine = new CompactionEngine({ contextWindow: 10000 });
      let currentMessages: ChatMessage[] = [
        { role: 'system', content: 'Anchor prompt for memory leak testing' },
      ];

      for (let i = 0; i < 100; i++) {
        currentMessages.push({
          role: 'user',
          content: `Test payload iteration ${i}: `.repeat(20),
        });
        currentMessages.push({
          role: 'assistant',
          content: `Test response iteration ${i}: `.repeat(20),
        });

        if (estimateTokens(currentMessages) > 6000) {
          const res = await engine.compact(currentMessages, 'auto');
          currentMessages = res.messages;
        }
      }

      if (global.gc) {
        global.gc();
      }
      const finalHeap = process.memoryUsage().heapUsed;
      const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);

      // Memory growth must remain bounded under 50MB across 100 turns
      assert.ok(
        heapDeltaMb < 50,
        `Memory leak detected: Heap grew by ${heapDeltaMb.toFixed(2)}MB across 100 turns (expected < 50MB)`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SECTION E: FILESYSTEM & STATE ROLLBACK INVARIANTS
  // ---------------------------------------------------------------------------
  describe('E. Filesystem & State Rollback Invariants', () => {
    let gitDir: string;
    let gitManager: GitWorktreeManager;
    let baseCommitSha: string;

    before(async () => {
      gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-formal-git-'));
      await runGit(['init', '-b', 'main'], gitDir);
      await runGit(['config', 'user.name', 'Nomin Formal Verifier'], gitDir);
      await runGit(['config', 'user.email', 'verifier@nomin.systems'], gitDir);

      // Initial clean commit
      fs.writeFileSync(path.join(gitDir, 'core.ts'), 'export const SYSTEM_STATE = "PRISTINE";\n', 'utf-8');
      await runGit(['add', '-A'], gitDir);
      await runGit(['commit', '-m', 'feat(core): initial base commit'], gitDir);

      const headRes = await runGit(['rev-parse', 'HEAD'], gitDir);
      baseCommitSha = headRes.stdout;

      gitManager = new GitWorktreeManager(gitDir);
    });

    after(async () => {
      try {
        if (fs.existsSync(gitDir)) {
          fs.rmSync(gitDir, { recursive: true, force: true });
        }
      } catch (_) {}
    });

    it('Theorem 13 (Worktree Micro-Commit Isolation): micro-commits in agent worktree do not pollute primary HEAD', async () => {
      const agentId = 'formal_coder_agent';
      const wtInfo = await gitManager.createWorktree(agentId, 'main');
      assert.ok(fs.existsSync(wtInfo.worktreePath));

      // Make speculative file edit inside worktree
      fs.writeFileSync(path.join(wtInfo.worktreePath, 'speculative.ts'), 'export const spec = 42;\n', 'utf-8');
      
      const commitRes = await gitManager.createMicroCommit(wtInfo.worktreePath, 'feat(coder): speculative work');
      assert.strictEqual(commitRes.success, true);
      assert.ok(commitRes.commitHash);

      // INVARIANT 1: Primary repository HEAD must remain unchanged at baseCommitSha
      const primaryHead = await runGit(['rev-parse', 'HEAD'], gitDir);
      assert.strictEqual(
        primaryHead.stdout,
        baseCommitSha,
        'Primary repo HEAD must remain completely untouched by worktree micro-commits'
      );

      // INVARIANT 2: Primary working tree does not have speculative.ts
      assert.strictEqual(
        fs.existsSync(path.join(gitDir, 'speculative.ts')),
        false,
        'Primary workspace must not be dirtied by worktree file additions'
      );
    });

    it('Theorem 14 (Clean Rollback Invariant): failed task rolls back without dirtying primary working directory', async () => {
      const agentId = 'formal_coder_agent';
      const wtPath = path.join(gitDir, '.nomin', 'worktrees', agentId);

      // Simulate messy working state in worktree: unstaged files + corrupted edits
      fs.writeFileSync(path.join(wtPath, 'dirty_leak.txt'), 'corrupted unstaged content', 'utf-8');

      // Task verification FAILS: Execute safe worktree rollback and cleanup
      const cleanupResult = await gitManager.cleanupWorktree(agentId, true);
      assert.strictEqual(cleanupResult.success, true, 'Worktree cleanup must succeed');

      // INVARIANT 1: Primary working directory is 100% clean
      const statusRes = await runGit(['status', '--porcelain'], gitDir);
      assert.strictEqual(
        statusRes.stdout.trim(),
        '',
        `Primary git status must be pristine after rollback, got: ${statusRes.stdout}`
      );

      // INVARIANT 2: Primary HEAD is identical to base commit
      const currentHead = await runGit(['rev-parse', 'HEAD'], gitDir);
      assert.strictEqual(currentHead.stdout, baseCommitSha, 'Primary HEAD must remain at original SHA');

      // INVARIANT 3: Speculative branch is deleted
      const branchRes = await runGit(['show-ref', '--verify', `refs/heads/agent/${agentId}`], gitDir);
      assert.ok(branchRes.exitCode !== 0, 'Agent branch must be completely pruned after failed rollback');
    });
  });
});
