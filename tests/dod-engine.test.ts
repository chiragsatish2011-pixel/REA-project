/**
 * Unit tests for Nomin Code Definition-of-Done (DoD) Verification Engine & AST Integrity Inspector
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { DoDEngine } from '../src/verifier/dod-engine.js';
import { AstIntegrityInspector } from '../src/verifier/ast-integrity.js';
import type { AcceptanceCriterion } from '../src/types.js';

describe('DoDEngine Criteria Extraction', () => {
  it('extracts criteria from markdown list with backticks', () => {
    const spec = `
# Architect Specification
Acceptance Criteria:
- [ ] \`npm test\`: Run the comprehensive test suite
- [ ] \`npx tsc --noEmit\`: Ensure TypeScript strict type safety
`;
    const criteria = DoDEngine.extractAcceptanceCriteria(spec);
    assert.strictEqual(criteria.length, 2);
    assert.strictEqual(criteria[0].command, 'npm test');
    assert.strictEqual(criteria[1].command, 'npx tsc --noEmit');
  });

  it('extracts criteria from JSON code block', () => {
    const spec = `
Here is the verification specification:
\`\`\`json
[
  { "id": "c1", "name": "Lint", "command": "npm run lint", "timeoutSeconds": 30 },
  { "id": "c2", "name": "Unit Tests", "command": "npm test", "timeoutSeconds": 60 }
]
\`\`\`
`;
    const criteria = DoDEngine.extractAcceptanceCriteria(spec);
    assert.strictEqual(criteria.length, 2);
    assert.strictEqual(criteria[0].command, 'npm run lint');
    assert.strictEqual(criteria[1].command, 'npm test');
    assert.strictEqual(criteria[0].timeoutSeconds, 30);
  });

  it('extracts criteria from fenced bash block', () => {
    const spec = `
Execute the following verification scripts:
\`\`\`bash
# Run unit tests
npm test
# Run linter
npm run lint
\`\`\`
`;
    const criteria = DoDEngine.extractAcceptanceCriteria(spec);
    assert.strictEqual(criteria.length, 2);
    assert.strictEqual(criteria[0].command, 'npm test');
    assert.strictEqual(criteria[1].command, 'npm run lint');
  });
});

describe('DoDEngine Command Execution', () => {
  it('executes a passing command and collects evidence', async () => {
    const criterion: AcceptanceCriterion = {
      id: 'crit-pass',
      name: 'Passing Check',
      command: 'node -e "console.log(\'PASS_OK\'); process.exit(0);"',
      timeoutSeconds: 5,
      expectedExitCode: 0,
      description: 'Test process exit 0',
    };

    const result = await DoDEngine.executeCriterion(criterion);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('PASS_OK'));
    assert.ok(result.durationMs >= 0);
  });

  it('executes a failing command and captures failure evidence', async () => {
    const criterion: AcceptanceCriterion = {
      id: 'crit-fail',
      name: 'Failing Check',
      command: 'node -e "console.error(\'FAIL_ERR\'); process.exit(2);"',
      timeoutSeconds: 5,
      expectedExitCode: 0,
      description: 'Test process exit non-zero',
    };

    const result = await DoDEngine.executeCriterion(criterion);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.exitCode, 2);
    assert.ok(result.stderr.includes('FAIL_ERR'));
  });

  it('handles command timeouts gracefully', async () => {
    const criterion: AcceptanceCriterion = {
      id: 'crit-timeout',
      name: 'Timeout Check',
      command: 'node -e "setTimeout(() => {}, 10000);"',
      timeoutSeconds: 1, // 1 second timeout
      expectedExitCode: 0,
      description: 'Test process timeout',
    };

    const result = await DoDEngine.executeCriterion(criterion);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.exitCode, 124);
    assert.ok(result.stderr.includes('timed out'));
  });
});

describe('AstIntegrityInspector Adversarial Diff Inspection', () => {
  it('detects incomplete placeholder stubs in added lines', () => {
    const diffWithTodo = `
diff --git a/src/service.ts b/src/service.ts
--- a/src/service.ts
+++ b/src/service.ts
@@ -10,3 +10,4 @@
+  // TODO: implement caching layer later
+  return null;
`;
    const result = AstIntegrityInspector.inspectDiff(diffWithTodo);
    assert.strictEqual(result.passed, false);
    assert.ok(result.violations.some((v) => v.includes('Placeholder stub detected')));
    assert.ok(result.detailedViolations.some((v) => v.type === 'INCOMPLETE_STUB'));
  });

  it('detects ellipsis stubs and NotImplementedError', () => {
    const diffWithEllipsis = `
diff --git a/src/handler.py b/src/handler.py
--- a/src/handler.py
+++ b/src/handler.py
@@ -1,3 +1,4 @@
+def process_request():
+    ...
`;
    const result = AstIntegrityInspector.inspectDiff(diffWithEllipsis);
    assert.strictEqual(result.passed, false);
    assert.ok(result.detailedViolations.some((v) => v.type === 'INCOMPLETE_STUB'));
  });

  it('detects deleted test assertions in diff', () => {
    const diffWithDeletedAssertion = `
diff --git a/tests/auth.test.ts b/tests/auth.test.ts
--- a/tests/auth.test.ts
+++ b/tests/auth.test.ts
@@ -15,4 +15,2 @@
-  it('verifies signature correctly', () => {
-    assert.strictEqual(verify(), true);
-  });
`;
    const result = AstIntegrityInspector.inspectDiff(diffWithDeletedAssertion);
    assert.strictEqual(result.passed, false);
    assert.ok(result.violations.some((v) => v.includes('Deleted test assertions detected')));
    assert.ok(result.detailedViolations.some((v) => v.type === 'DELETED_TEST_ASSERTION'));
  });

  it('detects commented-out test assertions in added lines', () => {
    const diffWithCommentedAssertion = `
diff --git a/tests/payment.test.ts b/tests/payment.test.ts
--- a/tests/payment.test.ts
+++ b/tests/payment.test.ts
@@ -20,2 +20,3 @@
+  // assert.strictEqual(charge.status, 'paid');
`;
    const result = AstIntegrityInspector.inspectDiff(diffWithCommentedAssertion);
    assert.strictEqual(result.passed, false);
    assert.ok(result.violations.some((v) => v.includes('Commented-out test assertion detected')));
    assert.ok(result.detailedViolations.some((v) => v.type === 'COMMENTED_OUT_ASSERTION'));
  });

  it('detects test skips (it.skip, test.skip, @pytest.mark.skip)', () => {
    const diffWithSkip = `
diff --git a/tests/order.test.ts b/tests/order.test.ts
--- a/tests/order.test.ts
+++ b/tests/order.test.ts
@@ -5,2 +5,3 @@
+  it.skip('flaky order processing test', () => {
`;
    const result = AstIntegrityInspector.inspectDiff(diffWithSkip);
    assert.strictEqual(result.passed, false);
    assert.ok(result.violations.some((v) => v.includes('Test skip detected')));
    assert.ok(result.detailedViolations.some((v) => v.type === 'TEST_SKIP'));
  });

  it('passes cleanly on legitimate code additions without stubs or test modifications', () => {
    const cleanDiff = `
diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,2 +1,6 @@
 export function add(a: number, b: number): number {
+  const sum = a + b;
+  return sum;
 }
`;
    const result = AstIntegrityInspector.inspectDiff(cleanDiff);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.violations.length, 0);
  });
});

describe('DoDEngine Final Gate Release Verification', () => {
  it('rejects task if AST integrity violation exists even if criteria succeed', async () => {
    const task = {
      id: 'task-101',
      acceptanceCriteria: [
        {
          id: 'c1',
          name: 'Quick Pass',
          command: 'node -e "process.exit(0)"',
          timeoutSeconds: 5,
          expectedExitCode: 0,
          description: 'Pass check',
        },
      ],
    };

    const maliciousDiff = `
+++ b/src/code.ts
+// TODO: implement this tomorrow
`;

    const verdict = await DoDEngine.verifyTask(task, { diffText: maliciousDiff });
    assert.strictEqual(verdict.approved, false);
    assert.strictEqual(verdict.integrityViolation, true);
    assert.ok(verdict.reason.includes('INTEGRITY_VIOLATION'));
  });

  it('approves task when all criteria succeed and diff is clean', async () => {
    const task = {
      id: 'task-202',
      acceptanceCriteria: [
        {
          id: 'c1',
          name: 'Echo Test',
          command: 'node -e "console.log(\'Release Verified\'); process.exit(0)"',
          timeoutSeconds: 5,
          expectedExitCode: 0,
          description: 'Verification',
        },
      ],
    };

    const cleanDiff = `
+++ b/src/code.ts
+const answer = 42;
`;

    const verdict = await DoDEngine.verifyTask(task, { diffText: cleanDiff });
    assert.strictEqual(verdict.approved, true);
    assert.strictEqual(verdict.integrityViolation, false);
    assert.strictEqual(verdict.verifiedCriteria.length, 1);
    assert.strictEqual(verdict.failedCriteria.length, 0);
  });
});
