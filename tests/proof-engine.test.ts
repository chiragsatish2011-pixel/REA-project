/**
 * Comprehensive Proof Engine & Multi-Language Anti-Cheat Test Suite
 *
 * Validates:
 * 1. Multi-language skipped test detection (TypeScript/JS, Python, Go, Rust).
 * 2. Multi-language placeholder stub detection and rejection.
 * 3. Tamper-evident TaskCompletionCertificate generation, SHA-256 signing, and tamper rejection.
 * 4. SwarmCoordinator release gate enforcement blocking completion without valid certificates.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

import { DoDEngine } from '../src/verifier/dod-engine.js';
import { AstIntegrityInspector } from '../src/verifier/ast-integrity.js';
import { SwarmCoordinator } from '../src/swarm/coordinator.js';
import type { TaskCompletionCertificate } from '../src/verifier/types.js';

describe('Nomin Proof Engine: Multi-Language Anti-Cheat Detection', () => {
  describe('TypeScript / JavaScript Anti-Cheat', () => {
    it('detects it.skip, test.skip, and describe.skip in diff', () => {
      const diff = `
diff --git a/tests/auth.test.ts b/tests/auth.test.ts
--- a/tests/auth.test.ts
+++ b/tests/auth.test.ts
@@ -10,3 +10,5 @@
+  it.skip('bypasses authentication for test', () => {
+  test.skip('skips rate limiting check', () => {
+  describe.skip('skipped billing suite', () => {
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.ok(result.violations.some((v) => v.includes('Test skip detected')));
      assert.ok(result.astAudit?.testsSkipped.some((t) => t.includes('test.skip() or describe.skip()')));
    });

    it('detects xit and xtest skipped tests', () => {
      const diff = `
+++ b/tests/worker.test.js
+  xit('temporarily disabled flaky worker test', () => {
+  xtest('disabled second test', () => {
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.ok(result.detailedViolations.some((v) => v.rule.includes('xit() or xtest()')));
    });

    it('detects commented-out assertions (// expect, // assert, /* expect */)', () => {
      const diff = `
+++ b/tests/calc.test.ts
+  // expect(result.total).toBe(100);
+  // assert.strictEqual(status, 'SUCCESS');
+  /* expect(token).toBeDefined(); */
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.strictEqual(result.detailedViolations.length, 3);
      assert.ok(result.detailedViolations.every((v) => v.type === 'COMMENTED_OUT_ASSERTION'));
    });
  });

  describe('Python Anti-Cheat', () => {
    it('detects @pytest.mark.skip and @pytest.mark.skipif', () => {
      const diff = `
diff --git a/tests/test_api.py b/tests/test_api.py
--- a/tests/test_api.py
+++ b/tests/test_api.py
@@ -1,4 +1,6 @@
+@pytest.mark.skip(reason="Fails in CI")
+def test_critical_endpoint():
+@pytest.mark.skipif(True, reason="Skip always")
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.ok(result.astAudit?.testsSkipped.some((s) => s.includes('@pytest.mark.skip')));
    });

    it('detects @unittest.skip and unittest.skipIf', () => {
      const diff = `
+++ b/tests/test_crypto.py
+@unittest.skip("Do not run in production")
+def test_aes_cipher(self):
+    pass
+@unittest.skipIf(sys.platform == 'win32', "broken on windows")
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.ok(result.astAudit?.testsSkipped.some((s) => s.includes('@unittest.skip')));
    });

    it('detects commented-out python assertions (# assert, # self.assert)', () => {
      const diff = `
+++ b/tests/test_service.py
+    # assert response.status_code == 200
+    # self.assertEqual(user.is_active, True)
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.ok(result.detailedViolations.some((v) => v.type === 'COMMENTED_OUT_ASSERTION'));
    });
  });

  describe('Go Anti-Cheat', () => {
    it('detects t.Skip, t.Skipf, and t.SkipNow', () => {
      const diff = `
diff --git a/pkg/auth/auth_test.go b/pkg/auth/auth_test.go
--- a/pkg/auth/auth_test.go
+++ b/pkg/auth/auth_test.go
@@ -20,2 +20,4 @@
+func TestTokenVerification(t *testing.T) {
+    t.Skip("skipping failing auth test to pass DoD")
+    t.Skipf("skipping test: %s", "error")
+    t.SkipNow()
+    assert.Equal(t, true, true)
+}
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.ok(result.astAudit?.testsSkipped.some((s) => s.includes('Go t.Skip')));
    });
  });

  describe('Rust Anti-Cheat', () => {
    it('detects #[ignore] test attributes', () => {
      const diff = `
diff --git a/src/lib_test.rs b/src/lib_test.rs
--- a/src/lib_test.rs
+++ b/src/lib_test.rs
@@ -5,3 +5,6 @@
+#[test]
+#[ignore]
+fn test_distributed_consensus() {
+#[test]
+#[ignore = "not implemented yet"]
+fn test_raft_heartbeat() {
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.ok(result.astAudit?.testsSkipped.some((s) => s.includes('Rust #[ignore]')));
    });

    it('detects commented-out Rust assertions', () => {
      const diff = `
+++ b/src/state_test.rs
+    // assert!(result.is_ok());
+    // assert_eq!(val, 42);
`;
      const result = AstIntegrityInspector.inspectDiff(diff);
      assert.strictEqual(result.passed, false);
      assert.ok(result.detailedViolations.some((v) => v.type === 'COMMENTED_OUT_ASSERTION'));
    });
  });
});

describe('Nomin Proof Engine: Multi-Language Placeholder Stub Rejection', () => {
  it('rejects Python pass placeholder stubs in functions', () => {
    const diff = `
diff --git a/service/calculator.py b/service/calculator.py
--- a/service/calculator.py
+++ b/service/calculator.py
@@ -1,2 +1,4 @@
+def compute_compound_interest(principal, rate, years):
+    pass
`;
    const result = AstIntegrityInspector.inspectDiff(diff);
    assert.strictEqual(result.passed, false);
    assert.ok(result.astAudit?.stubsFound.some((s) => s.includes('pass placeholder stub')));
  });

  it('rejects Python inline pass stubs and pass TODO comments', () => {
    const diff = `
+++ b/service/handler.py
+def handle_refund(transaction_id): pass
+def notify_admin():
+    pass # TODO: implement SNS notification
`;
    const result = AstIntegrityInspector.inspectDiff(diff);
    assert.strictEqual(result.passed, false);
    assert.ok(result.detailedViolations.some((v) => v.type === 'INCOMPLETE_STUB'));
  });

  it('allows Python pass in legitimate exception suppression handlers', () => {
    const diff = `
+++ b/service/safe_cleanup.py
+try:
+    os.unlink(temp_file)
+except FileNotFoundError:
+    pass
`;
    const result = AstIntegrityInspector.inspectDiff(diff);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.violations.length, 0);
  });

  it('rejects Python raise NotImplementedError stubs', () => {
    const diff = `
+++ b/service/auth.py
+def verify_mfa_token(token):
+    raise NotImplementedError("MFA provider integration pending")
`;
    const result = AstIntegrityInspector.inspectDiff(diff);
    assert.strictEqual(result.passed, false);
    assert.ok(result.astAudit?.stubsFound.some((s) => s.includes('NotImplementedError')));
  });

  it('rejects Rust todo!() and unimplemented!() macros', () => {
    const diff = `
diff --git a/src/network.rs b/src/network.rs
--- a/src/network.rs
+++ b/src/network.rs
@@ -10,3 +10,6 @@
+pub fn broadcast_message(msg: &str) {
+    todo!("implement socket broadcast");
+}
+pub fn receive_packet() -> Vec<u8> {
+    unimplemented!()
+}
`;
    const result = AstIntegrityInspector.inspectDiff(diff);
    assert.strictEqual(result.passed, false);
    assert.ok(result.astAudit?.stubsFound.some((s) => s.includes('Rust todo!()')));
    assert.ok(result.astAudit?.stubsFound.some((s) => s.includes('Rust unimplemented!()')));
  });

  it('rejects Go panic("not implemented") stubs', () => {
    const diff = `
+++ b/pkg/store/store.go
+func (s *Store) Save(key string, val []byte) error {
+    panic("not implemented")
+}
`;
    const result = AstIntegrityInspector.inspectDiff(diff);
    assert.strictEqual(result.passed, false);
    assert.ok(result.astAudit?.stubsFound.some((s) => s.includes('panic("not implemented")')));
  });

  it('rejects TypeScript Error("Not implemented") and TODO stubs', () => {
    const diff = `
+++ b/src/billing.ts
+export function chargeCard(token: string): boolean {
+  throw new Error("Not implemented");
+}
`;
    const result = AstIntegrityInspector.inspectDiff(diff);
    assert.strictEqual(result.passed, false);
    assert.ok(result.astAudit?.stubsFound.some((s) => s.includes('Error("Not implemented")')));
  });
});

describe('Nomin Proof Engine: TaskCompletionCertificate & Cryptographic Verification', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-cert-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('generates a valid, SHA-256 signed TaskCompletionCertificate for clean passing work', async () => {
    const cleanDiff = `
diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,2 +1,6 @@
 export function multiply(a: number, b: number): number {
+  return a * b;
 }
`;
    const task = {
      id: 'task-cert-01',
      acceptanceCriteria: [
        {
          id: 'ac-1',
          name: 'Echo Test',
          command: 'node -e "console.log(\'Multiplication verified\'); process.exit(0)"',
          timeoutSeconds: 5,
          expectedExitCode: 0,
          description: 'Verify multiply operation',
        },
      ],
    };

    const gateResult = await DoDEngine.verifyFinalGate(task, {
      worktreePath: tmpDir,
      diffText: cleanDiff,
      baseSha: 'a1b2c3d4e5f60000000000000000000000000001',
      headSha: 'b2c3d4e5f6a10000000000000000000000000002',
    });

    assert.strictEqual(gateResult.approved, true);
    assert.ok(gateResult.certificate, 'Certificate must be generated');

    const cert: TaskCompletionCertificate = gateResult.certificate;
    assert.strictEqual(cert.taskId, 'task-cert-01');
    assert.strictEqual(cert.verified, true);
    assert.strictEqual(cert.verifierRole, 'Verifier');
    assert.strictEqual(cert.diffSummary.filesChanged, 1);
    assert.strictEqual(cert.diffSummary.insertions, 1);
    assert.strictEqual(cert.diffSummary.deletions, 0);
    assert.strictEqual(cert.criteriaResults.length, 1);
    assert.strictEqual(cert.criteriaResults[0].exitCode, 0);
    assert.strictEqual(typeof cert.criteriaResults[0].stdoutHash, 'string');
    assert.strictEqual(cert.criteriaResults[0].stdoutHash.length, 64);
    assert.strictEqual(cert.astAudit.clean, true);
    assert.strictEqual(cert.astAudit.stubsFound.length, 0);
    assert.strictEqual(cert.astAudit.testsSkipped.length, 0);
    assert.strictEqual(typeof cert.signature, 'string');
    assert.strictEqual(cert.signature.length, 64);

    // Cryptographic signature verification
    const verification = DoDEngine.verifyCertificateIntegrity(cert);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.expectedSignature, cert.signature);
  });

  it('rejects tampered verified flag or altered payload', async () => {
    const task = {
      id: 'task-tamper-01',
      acceptanceCriteria: [],
    };

    const cleanDiff = `+++ b/src/code.ts\n+const x = 1;\n`;
    const gateResult = await DoDEngine.verifyFinalGate(task, {
      worktreePath: tmpDir,
      diffText: cleanDiff,
    });

    const cert = gateResult.certificate;
    assert.strictEqual(DoDEngine.verifyCertificateIntegrity(cert).valid, true);

    // Tamper 1: Alter verified boolean
    const tamperedCert1 = { ...cert, verified: false };
    const check1 = DoDEngine.verifyCertificateIntegrity(tamperedCert1);
    assert.strictEqual(check1.valid, false);
    assert.ok(check1.reason?.includes('Tamper detected'));

    // Tamper 2: Alter headSha
    const tamperedCert2 = { ...cert, headSha: 'forged_sha_value_99999' };
    const check2 = DoDEngine.verifyCertificateIntegrity(tamperedCert2);
    assert.strictEqual(check2.valid, false);

    // Tamper 3: Alter diffSummary insertions
    const tamperedCert3 = {
      ...cert,
      diffSummary: { ...cert.diffSummary, insertions: 99999 },
    };
    const check3 = DoDEngine.verifyCertificateIntegrity(tamperedCert3);
    assert.strictEqual(check3.valid, false);

    // Tamper 4: Corrupt signature hex string
    const tamperedCert4 = {
      ...cert,
      signature: '0000000000000000000000000000000000000000000000000000000000000000',
    };
    const check4 = DoDEngine.verifyCertificateIntegrity(tamperedCert4);
    assert.strictEqual(check4.valid, false);
  });

  it('persists certificate to disk and reloads cleanly', async () => {
    const task = {
      id: 'task-persist-01',
      acceptanceCriteria: [],
    };

    const cleanDiff = `+++ b/src/code.ts\n+const y = 2;\n`;
    const gateResult = await DoDEngine.verifyFinalGate(task, {
      worktreePath: tmpDir,
      diffText: cleanDiff,
    });

    assert.ok(gateResult.certificatePath);
    assert.ok(fs.existsSync(gateResult.certificatePath));

    const reloaded = DoDEngine.loadCertificate('task-persist-01', tmpDir);
    assert.ok(reloaded);
    assert.strictEqual(reloaded.taskId, 'task-persist-01');
    assert.strictEqual(reloaded.signature, gateResult.certificate.signature);

    const check = DoDEngine.verifyCertificateIntegrity(reloaded);
    assert.strictEqual(check.valid, true);
  });

  it('generates an unverified certificate when code contains integrity violations', async () => {
    const task = {
      id: 'task-violation-01',
      acceptanceCriteria: [],
    };

    const diffWithRustStub = `+++ b/src/core.rs\n+todo!("finish this");\n`;
    const gateResult = await DoDEngine.verifyFinalGate(task, {
      worktreePath: tmpDir,
      diffText: diffWithRustStub,
    });

    assert.strictEqual(gateResult.approved, false);
    assert.strictEqual(gateResult.integrityViolation, true);
    assert.ok(gateResult.certificate);
    assert.strictEqual(gateResult.certificate.verified, false);
    assert.strictEqual(gateResult.certificate.astAudit.clean, false);

    // The rejection certificate is still cryptographically signed and verifiable as a proof of rejection
    const check = DoDEngine.verifyCertificateIntegrity(gateResult.certificate);
    assert.strictEqual(check.valid, true);
  });
});

describe('Nomin SwarmCoordinator: Release Gate & Certificate Enforcement', () => {
  let tmpDir: string;
  let coordinator: SwarmCoordinator;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-swarm-proof-test-'));
    coordinator = new SwarmCoordinator({
      workspaceRoot: tmpDir,
      stateDir: path.join(tmpDir, 'state'),
      useGitWorktrees: false, // directory-based isolation for unit test speed
      maxRetriesPerTask: 1,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('blocks task completion if Coder introduces multi-language stubs', async () => {
    // Custom architect returning a single task
    coordinator.setArchitectHook(async () => [
      {
        id: 'T-STUB-TEST',
        title: 'Stub injection attempt',
        description: 'Attempts to cheat DoD using Rust todo!()',
        assignedRole: 'Coder',
        dependencies: [],
        status: 'PENDING',
        acceptanceCriteria: [
          {
            id: 'AC-1',
            name: 'Pass check',
            command: 'node -e "process.exit(0)"',
            timeoutSeconds: 5,
            expectedExitCode: 0,
            description: 'Trivial command pass',
          },
        ],
      },
    ]);

    // Coder tries to cheat by returning code with a Python pass stub
    coordinator.setCoderHook(async () => ({
      success: true,
      commitHash: 'deadbeef1',
      diffSummary: 'def compute():\n    pass',
      feedback: 'Code modified',
    }));

    // Inject a diff with a stub into dodEngine when coordinator verifies
    const origVerify = coordinator.dodEngine.verifyFinalGate.bind(coordinator.dodEngine);
    coordinator.dodEngine.verifyFinalGate = async (t, opts) => {
      return origVerify(t, {
        ...opts,
        diffText: `+++ b/src/handler.py\n+def compute():\n+    pass\n`,
      });
    };

    const runResult = await coordinator.orchestrate('Implement compute');

    // Must fail because of integrity violation!
    assert.strictEqual(runResult.success, false);
    assert.strictEqual(runResult.failedTasks, 1);
    const finalTask = coordinator.blackboard.getTask('T-STUB-TEST');
    assert.strictEqual(finalTask?.status, 'REJECTED');
  });

  it('blocks task completion if certificate integrity is corrupted', async () => {
    coordinator.setArchitectHook(async () => [
      {
        id: 'T-CERT-CORRUPT',
        title: 'Corrupted certificate test',
        description: 'Tests response when certificate is tampered with',
        assignedRole: 'Coder',
        dependencies: [],
        status: 'PENDING',
        acceptanceCriteria: [],
      },
    ]);

    // Mock verifyFinalGate returning a forged signature
    coordinator.dodEngine.verifyFinalGate = async (t, opts) => {
      const genuine = await DoDEngine.verifyFinalGate(t, opts);
      // Forge signature
      genuine.certificate.signature = 'badbeef' + '0'.repeat(57);
      return genuine;
    };

    const runResult = await coordinator.orchestrate('Test signature check');

    assert.strictEqual(runResult.success, false);
    assert.strictEqual(runResult.failedTasks, 1);
    const task = coordinator.blackboard.getTask('T-CERT-CORRUPT');
    assert.strictEqual(task?.status, 'REJECTED');
  });

  it('successfully transitions to VERIFIED with valid certificate when all criteria and AST pass', async () => {
    coordinator.setArchitectHook(async () => [
      {
        id: 'T-CLEAN-SUCCESS',
        title: 'Legitimate work completion',
        description: 'Clean implementation with passing tests',
        assignedRole: 'Coder',
        dependencies: [],
        status: 'PENDING',
        acceptanceCriteria: [
          {
            id: 'AC-SUCCESS-1',
            name: 'Quick success test',
            command: 'node -e "process.exit(0)"',
            timeoutSeconds: 5,
            expectedExitCode: 0,
            description: 'Checks exit 0',
          },
        ],
      },
    ]);

    let verifiedEventFired = false;
    let receivedCertificate: TaskCompletionCertificate | undefined;

    coordinator.on('task:verified', (evt) => {
      verifiedEventFired = true;
      receivedCertificate = evt.certificate;
    });

    // Provide clean diff
    const origVerify = coordinator.dodEngine.verifyFinalGate.bind(coordinator.dodEngine);
    coordinator.dodEngine.verifyFinalGate = async (t, opts) => {
      return origVerify(t, {
        ...opts,
        diffText: `+++ b/src/legit.ts\n+export const answer = 42;\n`,
      });
    };

    const runResult = await coordinator.orchestrate('Clean feature implementation');

    assert.strictEqual(runResult.success, true);
    assert.strictEqual(runResult.completedTasks, 1);
    assert.strictEqual(runResult.failedTasks, 0);
    assert.strictEqual(verifiedEventFired, true);
    assert.ok(receivedCertificate);
    assert.strictEqual(receivedCertificate.verified, true);
    assert.strictEqual(receivedCertificate.astAudit.clean, true);

    const check = DoDEngine.verifyCertificateIntegrity(receivedCertificate);
    assert.strictEqual(check.valid, true);

    const blackboardTask = coordinator.blackboard.getTask('T-CLEAN-SUCCESS');
    assert.strictEqual(blackboardTask?.status, 'VERIFIED');
  });
});
