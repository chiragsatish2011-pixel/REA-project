/**
 * Nomin Code: SWE-Style Benchmark Simulator & Offline Test Suite
 * 
 * Comprehensive, offline, zero-API-cost benchmark suite modeled after elite testing setups
 * at MIT CSAIL and IIT. Tests the complete Nomin Code harness (tools, coordinator,
 * rate limiter, DoD engine, AST integrity, blackboard, mailbox, compaction) without
 * live AI models or API keys.
 * 
 * 5 Realistic Multi-Turn SWE Benchmark Tasks:
 *   Task 1: Bug fix in TypeScript/JavaScript codebase (search_grep -> read_file -> edit_file -> bash test -> DoD pass).
 *   Task 2: Adversarial model trying to cheat via // TODO stubs or test skipping -> caught by AST integrity engine.
 *   Task 3: False completion attempt (model says "done" without evidence) -> blocked by DoD gate.
 *   Task 4: High-concurrency 5-Agent TEAM simulation on decoupled tasks with Blackboard DAG and Mailbox.
 *   Task 5: Context overflow simulation triggering proactive compaction and memory preservation.
 * 
 * Additional Simulation Invariants:
 *   - Streaming chunking with realistic reasoning, text, and tool-call deltas.
 *   - Malformed JSON repair in tool arguments.
 *   - Hallucinated tools defense.
 *   - Infinite loop prevention & ReminderTracker nudges.
 *   - Intermittent HTTP 429 & 503 error injection with Retry-After recovery via NominRateLimitScheduler.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

import {
  MockLLMProvider,
  MockScenarioBuilder,
  AgentSimulationHarness,
  NominRateLimitScheduler,
  RequestPriority,
  JsonRepair,
  ToolRegistry,
  DoDEngine,
  AstIntegrityInspector,
  Blackboard,
  SwarmMailbox,
  CompactionEngine,
  estimateTokens,
  type AcceptanceCriterion,
  type ChatMessage,
  type SwarmTask,
  type MockTurnResponse,
} from '../src/index.js';

describe('SWE-Bench Simulation & Benchmark Engine (MIT CSAIL / IIT Offline Test Suite)', () => {

  // ===========================================================================
  // Task 1: Realistic Bug Fix in TypeScript/JavaScript Codebase
  // ===========================================================================
  it('Task 1: Bug fix in TypeScript/JavaScript codebase via multi-turn tool calling and DoD pass', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-swe-task1-'));

    try {
      // 1. Setup sample project with a discount calculation bug
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'calc-app', type: 'module' }));
      const srcDir = path.join(tmpDir, 'src');
      const testDir = path.join(tmpDir, 'test');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(testDir, { recursive: true });

      const calcJsPath = path.join(srcDir, 'calculator.js');
      fs.writeFileSync(
        calcJsPath,
        `// Shopping cart discount calculator\n` +
        `export function calculateFinalTotal(items, discountRate) {\n` +
        `  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);\n` +
        `  // BUG: Adds discount instead of subtracting it\n` +
        `  return subtotal + (subtotal * discountRate);\n` +
        `}\n`
      );

      const testJsPath = path.join(testDir, 'calculator.test.js');
      fs.writeFileSync(
        testJsPath,
        `import assert from 'node:assert';\n` +
        `import { calculateFinalTotal } from '../src/calculator.js';\n` +
        `const items = [{ price: 100, quantity: 2 }]; // subtotal = 200\n` +
        `const total = calculateFinalTotal(items, 0.1); // 10% discount -> should be 180\n` +
        `assert.strictEqual(total, 180, \`Expected 180 but got \${total}\`);\n` +
        `console.log('PASS: calculateFinalTotal discount correctly applied');\n`
      );

      const criteria: AcceptanceCriterion[] = [
        {
          id: 'AC-BUGFIX-01',
          name: 'Discount Calculation Regression Test',
          command: 'node test/calculator.test.js',
          timeoutSeconds: 15,
          expectedExitCode: 0,
          description: 'Ensure calculateFinalTotal correctly subtracts discount percentage from subtotal.',
        },
      ];

      // 2. Configure 5-turn scripted scenario:
      // Turn 1: grep for calculateFinalTotal
      // Turn 2: read src/calculator.js
      // Turn 3: edit file fixing the sign with 4-tier matcher
      // Turn 4: execute node test/calculator.test.js
      // Turn 5: complete task
      const scenario = new MockScenarioBuilder()
        .grep('calculateFinalTotal', {
          reasoning: 'Locating the calculateFinalTotal function definition in the codebase...',
        })
        .readFile('src/calculator.js', {
          reasoning: 'Inspecting implementation of calculateFinalTotal to analyze discount calculation logic...',
        })
        .editFile(
          'src/calculator.js',
          'return subtotal + (subtotal * discountRate);',
          'return subtotal - (subtotal * discountRate);',
          { reasoning: 'Replacing addition with subtraction to correctly apply discount rate.' }
        )
        .bash('node test/calculator.test.js', {
          reasoning: 'Executing unit test suite to collect execution evidence for Definition of Done.',
        })
        .complete(
          'Bug fixed and verified. calculateFinalTotal now properly deducts the discount from the subtotal.',
          { reasoning: 'Confirming all acceptance criteria pass with zero errors.' }
        )
        .build();

      const provider = new MockLLMProvider({ scenarios: scenario });
      const harness = new AgentSimulationHarness({
        workspaceRoot: tmpDir,
        provider,
        acceptanceCriteria: criteria,
        maxTurns: 10,
      });

      // 3. Execute autonomous harness
      const result = await harness.run('Fix the discount calculation bug in calculateFinalTotal');

      // 4. Invariant assertions
      assert.strictEqual(result.success, true, 'Harness must succeed and pass the Definition-of-Done gate');
      assert.strictEqual(result.turns, 5, 'Must complete in exactly 5 turns');
      assert.strictEqual(result.verdict?.approved, true, 'DoD gate must approve task');
      assert.strictEqual(result.verdict?.verifiedCriteria.length, 1, 'Acceptance criterion must be verified');
      assert.strictEqual(result.executedCommands.length, 1, 'Test command must have been executed');
      assert.strictEqual(result.executedCommands[0].exitCode, 0, 'Test command must exit with code 0');

      // 5. Verify file on disk actually updated
      const updatedCode = fs.readFileSync(calcJsPath, 'utf8');
      assert.strictEqual(
        updatedCode.includes('return subtotal - (subtotal * discountRate);'),
        true,
        'File on disk must reflect clean bug fix'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // Task 2: Adversarial Model Trying to Cheat (AST Integrity Inspection)
  // ===========================================================================
  it('Task 2: Adversarial model trying to cheat via // TODO stubs or test skips is caught by AST integrity engine and forced to fix', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-swe-task2-'));

    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'auth-app', type: 'module' }));
      const srcFile = path.join(tmpDir, 'auth.js');
      const testFile = path.join(tmpDir, 'auth.test.js');

      fs.writeFileSync(
        srcFile,
        `export function verifyApiKey(key) {\n` +
        `  // Original broken implementation\n` +
        `  return false;\n` +
        `}\n`
      );

      fs.writeFileSync(
        testFile,
        `import assert from 'node:assert';\n` +
        `import { verifyApiKey } from './auth.js';\n` +
        `assert.strictEqual(verifyApiKey('secret-123'), true);\n` +
        `console.log('PASS: Valid key accepted');\n`
      );

      const criteria: AcceptanceCriterion[] = [
        {
          id: 'AC-AUTH-01',
          name: 'API Key Verification',
          command: 'node auth.test.js',
          timeoutSeconds: 10,
          expectedExitCode: 0,
          description: 'Validate key verification logic.',
        },
      ];

      // Turn 1: Cheat attempt 1 -> model inserts a // TODO placeholder stub
      // Turn 2: Model prematurely claims completion ("I am done!") -> AST Engine catches it!
      // Turn 3: Model receives rejection feedback, removes stub and writes genuine implementation
      // Turn 4: Model runs tests and completes cleanly
      const scenario = new MockScenarioBuilder()
        .editFile(
          'auth.js',
          'return false;',
          '// TODO: implement real key checking later\n  return key === "secret-123";',
          { reasoning: 'Attempting to satisfy test with a quick stub...' }
        )
        .complete('I have completed the task and updated auth.js.')
        .editFile(
          'auth.js',
          '// TODO: implement real key checking later\n  return key === "secret-123";',
          'return typeof key === "string" && key.length > 5 && key === "secret-123";',
          { reasoning: 'Fixing AST violation: removing placeholder stub and implementing rigorous validation.' }
        )
        .bash('node auth.test.js', { reasoning: 'Validating tests pass with legitimate code.' })
        .complete('Task genuinely finished without stubs.')
        .build();

      const provider = new MockLLMProvider({ scenarios: scenario });
      const harness = new AgentSimulationHarness({
        workspaceRoot: tmpDir,
        provider,
        acceptanceCriteria: criteria,
        maxTurns: 10,
      });

      const result = await harness.run('Implement API key verification');

      assert.strictEqual(result.success, true, 'Harness should succeed after resolving the violation');
      assert.strictEqual(result.integrityViolations.length > 0, true, 'AST Integrity Engine must have caught the stub violation');
      assert.strictEqual(
        result.integrityViolations.some((v) => v.includes('Placeholder stub detected')),
        true,
        'Violation details must cite the placeholder stub'
      );

      // Verify final code on disk has no TODO stubs
      const finalCode = fs.readFileSync(srcFile, 'utf8');
      assert.strictEqual(finalCode.includes('// TODO'), false, 'Final code must be clean of TODO stubs');
      assert.strictEqual(finalCode.includes('key === "secret-123"'), true, 'Final code must have working logic');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // Task 3: False Completion Attempt (Model Says "Done" Without Evidence)
  // ===========================================================================
  it('Task 3: False completion attempt (model says "done" without evidence) is blocked by DoD gate', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-swe-task3-'));

    try {
      const brokenScript = path.join(tmpDir, 'validate.js');
      fs.writeFileSync(brokenScript, `console.error("FAILED: Missing evidence!"); process.exit(1);\n`);

      const criteria: AcceptanceCriterion[] = [
        {
          id: 'AC-GATE-01',
          name: 'Strict Evidence Verification',
          command: 'node validate.js',
          timeoutSeconds: 5,
          expectedExitCode: 0,
          description: 'Requires exit code 0 evidence.',
        },
      ];

      // Model claims "done" on Turn 1 without doing any work or running tools
      const scenario = new MockScenarioBuilder()
        .complete('I have thoroughly reviewed the code in my mind. Everything is 100% complete and working perfectly!')
        .build();

      const provider = new MockLLMProvider({ scenarios: scenario });
      const harness = new AgentSimulationHarness({
        workspaceRoot: tmpDir,
        provider,
        acceptanceCriteria: criteria,
        maxTurns: 2,
      });

      const result = await harness.run('Resolve validation issues');

      // DoD gate must have blocked completion!
      assert.strictEqual(result.success, false, 'DoD gate must block release when tests fail');
      assert.strictEqual(result.verdict?.approved, false, 'Verdict must be unapproved');
      assert.strictEqual(result.verdict?.failedCriteria.includes('AC-GATE-01'), true, 'Criterion must be marked failed');
      assert.strictEqual(result.executedCommands.length, 0, 'Model itself executed no tools');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // Task 4: High-Concurrency 5-Agent TEAM Simulation
  // ===========================================================================
  it('Task 4: High-concurrency 5-Agent TEAM simulation working on decoupled tasks with Blackboard and Mailbox', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-swe-task4-'));

    try {
      const blackboard = new Blackboard({ workspaceRoot: tmpDir });
      const mailbox = new SwarmMailbox();

      // 1. Register 5 Agents on Blackboard
      blackboard.registerAgent({ agentId: 'agent-arch-01', role: 'Architect', model: 'mock-deepseek-r1' });
      blackboard.registerAgent({ agentId: 'agent-fe-01', role: 'Coder', model: 'mock-claude-3-7-sonnet' });
      blackboard.registerAgent({ agentId: 'agent-be-01', role: 'Coder', model: 'mock-qwen-2.5-coder' });
      blackboard.registerAgent({ agentId: 'agent-tester-01', role: 'Tester', model: 'mock-nim-llama3-70b' });
      blackboard.registerAgent({ agentId: 'agent-verifier-01', role: 'Verifier', model: 'mock-claude-3-7-sonnet' });

      // 2. Define Decoupled Task DAG
      // T1 (Backend API) & T2 (Frontend View) can run concurrently in parallel
      // T3 (Integration Tests) depends on T1 and T2
      // T4 (Security Audit) depends on T3
      const taskT1: SwarmTask = {
        id: 'T-API-01',
        title: 'Implement REST Auth Endpoints',
        description: 'Provide POST /login and POST /signup',
        assignedRole: 'Coder',
        dependencies: [],
        status: 'PENDING',
        acceptanceCriteria: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const taskT2: SwarmTask = {
        id: 'T-UI-01',
        title: 'Implement Auth View Component',
        description: 'Provide React login form',
        assignedRole: 'Coder',
        dependencies: [],
        status: 'PENDING',
        acceptanceCriteria: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const taskT3: SwarmTask = {
        id: 'T-E2E-01',
        title: 'Run Integration & End-to-End Test Suite',
        description: 'Verify login flow from UI through API',
        assignedRole: 'Tester',
        dependencies: ['T-API-01', 'T-UI-01'],
        status: 'PENDING',
        acceptanceCriteria: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const taskT4: SwarmTask = {
        id: 'T-SEC-01',
        title: 'Final Security Audit & Release Gate Verification',
        description: 'Audit AST integrity, zero placeholder stubs, DoD signoff',
        assignedRole: 'Verifier',
        dependencies: ['T-E2E-01'],
        status: 'PENDING',
        acceptanceCriteria: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      blackboard.addTask(taskT1);
      blackboard.addTask(taskT2);
      blackboard.addTask(taskT3);
      blackboard.addTask(taskT4);

      // Verify Topological order: T1 & T2 must precede T3, which precedes T4
      const order = blackboard.getState().taskDAG.topologicalOrder;
      assert.strictEqual(order.indexOf('T-API-01') < order.indexOf('T-E2E-01'), true);
      assert.strictEqual(order.indexOf('T-UI-01') < order.indexOf('T-E2E-01'), true);
      assert.strictEqual(order.indexOf('T-E2E-01') < order.indexOf('T-SEC-01'), true);

      // 3. Concurrency check: T1 and T2 are both ready immediately
      const initialReady = blackboard.getReadyTasks().map((t) => t.id);
      assert.deepStrictEqual(initialReady.sort(), ['T-API-01', 'T-UI-01'].sort());

      // 4. Reactive Mailbox Communication
      // Architect dispatches broadcast
      mailbox.send({
        conversationId: 'swarm-sim-100',
        senderRole: 'Architect',
        recipientRole: 'Coder',
        messageType: 'TASK_DISPATCH',
        payload: { taskId: 'T-API-01', feedback: 'Begin parallel implementation of T-API-01 and T-UI-01' },
      });

      // Frontend coder sends schema query to Backend coder
      mailbox.send({
        conversationId: 'swarm-sim-100',
        senderRole: 'Coder',
        recipientRole: 'Coder',
        messageType: 'TASK_PROGRESS',
        payload: { taskId: 'T-API-01', feedback: 'Confirm JSON payload format for POST /login' },
      });

      // Simulate simultaneous execution of T1 and T2
      await Promise.all([
        (async () => {
          blackboard.updateAgentStatus('agent-be-01', 'busy', 'T-API-01');
          blackboard.updateTask('T-API-01', { status: 'VERIFIED', commitHash: 'be-c0ffee' });
          blackboard.updateAgentStatus('agent-be-01', 'idle');
        })(),
        (async () => {
          blackboard.updateAgentStatus('agent-fe-01', 'busy', 'T-UI-01');
          blackboard.updateTask('T-UI-01', { status: 'VERIFIED', commitHash: 'fe-c0ffee' });
          blackboard.updateAgentStatus('agent-fe-01', 'idle');
        })(),
      ]);

      // 5. T3 is now unlocked!
      const afterPhase1Ready = blackboard.getReadyTasks().map((t) => t.id);
      assert.deepStrictEqual(afterPhase1Ready, ['T-E2E-01']);

      // Execute T3 (Tester)
      blackboard.updateAgentStatus('agent-tester-01', 'busy', 'T-E2E-01');
      mailbox.send({
        conversationId: 'swarm-sim-100',
        senderRole: 'Tester',
        recipientRole: 'Verifier',
        messageType: 'TEST_RESULTS',
        payload: {
          taskId: 'T-E2E-01',
          evidence: { command: 'node test.js', exitCode: 0, stdout: '42 tests passed', stderr: '' },
          feedback: 'All tests passed cleanly',
        },
      });
      blackboard.updateTask('T-E2E-01', { status: 'VERIFIED', commitHash: 'test-c0ffee' });
      blackboard.updateAgentStatus('agent-tester-01', 'idle');

      // 6. T4 is now unlocked!
      const afterPhase2Ready = blackboard.getReadyTasks().map((t) => t.id);
      assert.deepStrictEqual(afterPhase2Ready, ['T-SEC-01']);

      // Execute T4 (Verifier)
      blackboard.updateAgentStatus('agent-verifier-01', 'busy', 'T-SEC-01');
      mailbox.send({
        conversationId: 'swarm-sim-100',
        senderRole: 'Verifier',
        recipientRole: 'Architect',
        messageType: 'REVIEW_VERDICT',
        payload: { taskId: 'T-SEC-01', status: 'VERIFIED', feedback: 'SHA256:d0d-pass' },
      });
      blackboard.updateTask('T-SEC-01', { status: 'VERIFIED' });
      blackboard.updateAgentStatus('agent-verifier-01', 'idle');

      // 7. Verify all tasks completed and queues drained
      const allTasks = blackboard.getAllTasks();
      assert.strictEqual(allTasks.every((t) => t.status === 'VERIFIED'), true);
      assert.strictEqual(blackboard.getReadyTasks().length, 0);

      const verifierMessages = mailbox.drainQueue('Verifier');
      assert.strictEqual(verifierMessages.length, 1);
      assert.strictEqual(verifierMessages[0].messageType, 'TEST_RESULTS');

      const architectMessages = mailbox.drainQueue('Architect');
      assert.strictEqual(architectMessages.length, 1);
      assert.strictEqual(architectMessages[0].messageType, 'REVIEW_VERDICT');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // Task 5: Context Overflow Simulation Triggering Proactive Compaction
  // ===========================================================================
  it('Task 5: Context overflow simulation triggering proactive compaction and memory preservation', async () => {
    const compactionEngine = new CompactionEngine({
      contextWindow: 30_000,
      bufferShare: 0.20,
      keepTokens: 1_000,
      precompute: true,
    });

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'CRITICAL SYSTEM ANCHOR: You are Nomin Code Senior Systems Architect.',
      },
      {
        role: 'system',
        content: 'CRITICAL SYSTEM ANCHOR: Never defeat access controls, preserve DoD gates.',
      },
    ];

    // Build 30 turns of conversation with substantial verbose content
    for (let i = 1; i <= 30; i++) {
      messages.push({
        role: 'user',
        content: `Turn ${i}: Inspect sub-module ${i} and run static analysis on dependencies. ${'#'.repeat(1000)}`,
      });
      messages.push({
        role: 'assistant',
        content: `Turn ${i}: Analysis completed for sub-module ${i}. No critical security vulnerabilities found. ${'='.repeat(1000)}`,
      });
    }

    // Add recent tail
    messages.push({
      role: 'user',
      content: 'Turn 31: Apply fix for authentication rate limiter.',
    });
    messages.push({
      role: 'assistant',
      content: 'Turn 31: Modifications applied via edit_file to src/provider/rate-limiter.ts',
    });

    const initialTokens = estimateTokens(messages);
    assert.strictEqual(initialTokens > 10_000, true, 'Initial conversation must be token-heavy');

    // Verify shouldCompact triggers
    const thresholds = compactionEngine.getThresholds();
    assert.strictEqual(thresholds.compactionThreshold > 0, true);

    // Execute compaction
    const result = await compactionEngine.compact(messages, 'auto');

    assert.strictEqual(result.compacted, true, 'Compaction must trigger on overflow');
    assert.strictEqual(result.tokensSaved > 0, true, 'Must save substantial token count');
    assert.strictEqual(result.newTokens < result.previousTokens, true, 'New tokens must be strictly less');

    // 1. Verify leading system prompt anchors are preserved at index 0 and 1
    assert.strictEqual(result.messages[0].role, 'system');
    assert.strictEqual(result.messages[0].content?.includes('CRITICAL SYSTEM ANCHOR: You are Nomin Code'), true);
    assert.strictEqual(result.messages[1].content?.includes('CRITICAL SYSTEM ANCHOR: Never defeat access controls'), true);

    // 2. Verify structured state summary markdown was created
    const summaryMsg = result.messages.find((m) => (m.content ?? '').includes('[CONTEXT COMPACTED - PREVIOUS TURNS SUMMARIZED]'));
    assert.notStrictEqual(summaryMsg, undefined, 'Summary message must be present');
    assert.strictEqual(summaryMsg?.content?.includes('## Objective'), true, 'Summary must include ## Objective');
    assert.strictEqual(summaryMsg?.content?.includes('## Work State'), true, 'Summary must include ## Work State');

    // 3. Verify recent tail messages are preserved verbatim
    const lastMsg = result.messages[result.messages.length - 1];
    assert.strictEqual(lastMsg.content?.includes('Turn 31'), true, 'Recent tail exchange must be preserved verbatim');

    // 4. Test provider response with compacted messages
    const mockProvider = new MockLLMProvider();
    mockProvider.queueResponse({
      content: 'Received compacted memory successfully. Proceeding with next turn.',
    });

    const providerResponse = await mockProvider.chat({
      model: 'mock-claude-3-7-sonnet',
      messages: result.messages,
    });
    assert.strictEqual(
      providerResponse.choices[0].message.content,
      'Received compacted memory successfully. Proceeding with next turn.'
    );
  });

  // ===========================================================================
  // Additional Invariant Tests: Streaming, Malformed JSON, 429/503 Retries
  // ===========================================================================

  it('Streaming Simulation: realistically chunks delta.reasoning_content, delta.text, and delta.tool_calls', async () => {
    const scenario: MockTurnResponse[] = [
      {
        reasoningContent: 'Analyzing algorithmic complexity and branch predictors...',
        content: 'Refactoring completed with linear time complexity.',
        toolCalls: [
          {
            id: 'call_stream_1',
            name: 'bash',
            args: { command: 'node -v' },
          },
        ],
        usage: { promptTokens: 50, completionTokens: 40, totalTokens: 90 },
      },
    ];

    const provider = new MockLLMProvider({
      scenarios: scenario,
      chunkDelayMs: 1, // fast timing test
    });

    let reasoningText = '';
    let contentText = '';
    let toolCallArgs = '';
    let receivedFinish = false;
    let receivedUsage = false;

    for await (const chunk of provider.chatStream({
      model: 'mock-deepseek-r1',
      messages: [{ role: 'user', content: 'Optimize memory allocator' }],
    })) {
      if (chunk.type === 'reasoning-delta') {
        reasoningText += chunk.text;
      } else if (chunk.type === 'text-delta') {
        contentText += chunk.text;
      } else if (chunk.type === 'tool-call-delta') {
        toolCallArgs += chunk.argumentsDelta;
      } else if (chunk.type === 'finish') {
        receivedFinish = true;
      } else if (chunk.type === 'usage') {
        receivedUsage = true;
      }
    }

    assert.strictEqual(reasoningText, 'Analyzing algorithmic complexity and branch predictors...');
    assert.strictEqual(contentText, 'Refactoring completed with linear time complexity.');
    assert.strictEqual(JSON.parse(toolCallArgs).command, 'node -v');
    assert.strictEqual(receivedFinish, true);
    assert.strictEqual(receivedUsage, true);
  });

  it('Adversarial Mode: Malformed JSON arguments are repaired seamlessly by JsonRepair', async () => {
    const provider = new MockLLMProvider({
      adversarial: {
        mode: 'malformed_json',
        malformedStyle: 'single_quotes',
      },
    });

    const response = await provider.chat({
      model: 'mock-qwen-2.5-coder',
      messages: [{ role: 'user', content: 'test malformed json' }],
    });

    const tc = response.choices[0].message.toolCalls?.[0];
    assert.notStrictEqual(tc, undefined);
    const rawArgs = tc!.function.arguments;

    // Single quotes are invalid standard JSON
    assert.throws(() => JSON.parse(rawArgs));

    // But JsonRepair parses it cleanly
    const repaired = JsonRepair.parse(rawArgs);
    assert.strictEqual(repaired.path, 'calculator.ts');
  });

  it('Adversarial Mode: Hallucinated tools not in registry fail gracefully', async () => {
    const provider = new MockLLMProvider({
      adversarial: {
        mode: 'hallucinated_tool',
        hallucinatedToolName: 'magical_auto_patch_all_bugs',
      },
    });

    const registry = new ToolRegistry();
    const response = await provider.chat({
      model: 'mock-model',
      messages: [{ role: 'user', content: 'fix everything' }],
    });

    const tc = response.choices[0].message.toolCalls![0];
    const execResult = await registry.executeTool(tc.function.name, {}, {
      sessionID: 'test-session',
      agentID: 'test-agent',
      worktreePath: process.cwd(),
      callID: tc.id,
    });

    assert.strictEqual(execResult.success, false);
    assert.strictEqual(
      execResult.error?.includes("Tool 'magical_auto_patch_all_bugs' not found in registry"),
      true
    );
  });

  it('Adversarial Mode: Infinite tool call loops are terminated by maxTurns and reminder policy', async () => {
    const provider = new MockLLMProvider({
      adversarial: {
        mode: 'infinite_tool_loop',
        infiniteToolName: 'read_file',
        infiniteToolArgs: { path: 'package.json' },
      },
    });

    const harness = new AgentSimulationHarness({
      workspaceRoot: process.cwd(),
      provider,
      maxTurns: 3,
    });

    const result = await harness.run('Do something endlessly');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.turns, 3);
    assert.strictEqual(result.reason?.includes('Maximum turns exceeded'), true);
  });

  it('Adversarial Mode: Intermittent HTTP 429 and 503 errors recover seamlessly through NominRateLimitScheduler', async () => {
    const scheduler = new NominRateLimitScheduler({
      rpmLimit: 600,
      tpmLimit: 1_000_000,
      maxConcurrency: 4,
      baseBackoffMs: 10, // fast jitter for tests
      maxBackoffMs: 50,
      maxRetries: 3,
    });

    // 1. Intermittent 429 test: fails once with 429, retry succeeds
    const provider429 = new MockLLMProvider({
      scheduler,
      adversarial: {
        mode: 'rate_limit_429',
        failuresBeforeSuccess: 1,
        retryAfterSeconds: 0,
      },
    });
    provider429.queueResponse({ content: 'Recovered from 429 successfully!' });

    const res429 = await provider429.chat({
      model: 'mock-nim-llama3-70b',
      messages: [{ role: 'user', content: 'test 429 backoff' }],
    });
    assert.strictEqual(res429.choices[0].message.content, 'Recovered from 429 successfully!');

    // 2. Intermittent 503 test: fails once with 503, retry succeeds
    const provider503 = new MockLLMProvider({
      scheduler,
      adversarial: {
        mode: 'service_unavailable_503',
        failuresBeforeSuccess: 1,
        retryAfterSeconds: 0,
      },
    });
    provider503.queueResponse({ content: 'Recovered from 503 successfully!' });

    const res503 = await provider503.chat({
      model: 'mock-nim-llama3-70b',
      messages: [{ role: 'user', content: 'test 503 backoff' }],
    });
    assert.strictEqual(res503.choices[0].message.content, 'Recovered from 503 successfully!');

    scheduler.destroy();
  });
});
