/**
 * Nomin Code: Adversarial AST Diff Integrity Inspector
 * Rejects silent scope reduction, softened assertions, deleted tests, commented-out assertions, and placeholder stubs.
 */

export type IntegrityViolationType =
  | 'DELETED_TEST_ASSERTION'
  | 'COMMENTED_OUT_ASSERTION'
  | 'INCOMPLETE_STUB'
  | 'TEST_SKIP'
  | 'WEAKENED_ASSERTION';

export interface IntegrityViolation {
  type: IntegrityViolationType;
  rule: string;
  message: string;
  line?: string;
  lineNumber?: number;
}

export interface IntegrityCheckResult {
  passed: boolean;
  violations: string[];
  detailedViolations: IntegrityViolation[];
  warningCount: number;
}

export class AstIntegrityInspector {
  private static readonly STUB_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    { regex: /\/\/\s*TODO[:\s]/i, name: 'TODO comment' },
    { regex: /\/\*\s*TODO[:\s]/i, name: 'Block TODO comment' },
    { regex: /#\s*TODO[:\s]/i, name: 'Python/Shell TODO comment' },
    { regex: /\/\/\s*FIXME[:\s]/i, name: 'FIXME comment' },
    { regex: /\/\*\s*FIXME[:\s]/i, name: 'Block FIXME comment' },
    { regex: /\/\/\s*implement(?:ation)?\s+here/i, name: 'implementation placeholder' },
    { regex: /\/\*\s*implement(?:ation)?\s+here/i, name: 'implementation block placeholder' },
    { regex: /#\s*implement(?:ation)?\s+here/i, name: 'python implementation placeholder' },
    { regex: /\/\/\s*your\s+code\s+here/i, name: 'your code here placeholder' },
    { regex: /^\s*\.\.\.\s*$/m, name: 'ellipsis stub' },
    { regex: /raise\s+NotImplementedError/i, name: 'NotImplementedError stub' },
    { regex: /throw\s+new\s+Error\(['"](?:Not implemented|TODO|unimplemented)['"]\)/i, name: 'Error("Not implemented") stub' },
    { regex: /pass\s*#\s*TODO/i, name: 'pass TODO stub' },
  ];

  private static readonly DELETED_TEST_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    { regex: /^\-\s*(?:it|test)\s*\(/m, name: 'test case declaration (it/test)' },
    { regex: /^\-\s*def\s+test_[a-zA-Z0-9_]+/m, name: 'python test method (test_*)' },
    { regex: /^\-\s*(?:assert|assert\.|self\.assert)/m, name: 'assertion statement' },
    { regex: /^\-\s*expect\s*\(/m, name: 'test expectation (expect)' },
    { regex: /^\-\s*@Test/m, name: 'test annotation (@Test)' },
  ];

  private static readonly COMMENTED_ASSERTION_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    { regex: /^\+\s*\/\/\s*(?:assert|expect|should)\b/i, name: 'commented-out JS/TS assertion' },
    { regex: /^\+\s*\/\*\s*(?:assert|expect|should)\b/i, name: 'block-commented JS/TS assertion' },
    { regex: /^\+\s*#\s*(?:assert|self\.assert)\b/i, name: 'commented-out Python assertion' },
    { regex: /^\+\s*\/\/\s*(?:it|test|describe)\s*\(/i, name: 'commented-out test case' },
  ];

  private static readonly TEST_SKIP_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    { regex: /^\+\s*(?:it|test|describe)\.skip\s*\(/m, name: 'test.skip() or describe.skip()' },
    { regex: /^\+\s*@pytest\.mark\.skip/m, name: '@pytest.mark.skip' },
    { regex: /^\+\s*@unittest\.skip/m, name: '@unittest.skip' },
    { regex: /^\+\s*xit\s*\(/m, name: 'xit() skipped test' },
    { regex: /^\+\s*xtest\s*\(/m, name: 'xtest() skipped test' },
  ];

  private static readonly WEAKENED_ASSERTION_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    { regex: /^\+\s*expect\(true\)\.toBe\(true\)/m, name: 'trivial tautological assertion expect(true).toBe(true)' },
    { regex: /^\+\s*assert\s+(?:True|1\s*==\s*1)\b/m, name: 'trivial tautological assertion assert True' },
  ];

  /**
   * Evaluates a git diff for adversarial anti-patterns.
   */
  public static inspectDiff(diffContent: string): IntegrityCheckResult {
    const violations: string[] = [];
    const detailedViolations: IntegrityViolation[] = [];

    const lines = diffContent.split('\n');
    let currentLineNum = 0;

    for (const rawLine of lines) {
      currentLineNum++;

      // 1. Placeholder stubs in newly added lines (+)
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        const addedContent = rawLine.substring(1);
        for (const { regex, name } of AstIntegrityInspector.STUB_PATTERNS) {
          if (regex.test(addedContent)) {
            const msg = `INTEGRITY_VIOLATION: Incomplete placeholder stub detected (${name}): "${addedContent.trim()}"`;
            violations.push(`INCOMPLETE_CODE: Placeholder stub detected in added line: "${addedContent.trim()}"`);
            detailedViolations.push({
              type: 'INCOMPLETE_STUB',
              rule: name,
              message: msg,
              line: addedContent.trim(),
              lineNumber: currentLineNum,
            });
            break;
          }
        }

        // 2. Commented-out assertions in added lines (+)
        for (const { regex, name } of AstIntegrityInspector.COMMENTED_ASSERTION_PATTERNS) {
          if (regex.test(rawLine)) {
            const msg = `INTEGRITY_VIOLATION: Commented-out test assertion detected (${name}): "${addedContent.trim()}"`;
            violations.push(msg);
            detailedViolations.push({
              type: 'COMMENTED_OUT_ASSERTION',
              rule: name,
              message: msg,
              line: addedContent.trim(),
              lineNumber: currentLineNum,
            });
            break;
          }
        }

        // 3. Newly introduced test skips in added lines (+)
        for (const { regex, name } of AstIntegrityInspector.TEST_SKIP_PATTERNS) {
          if (regex.test(rawLine)) {
            const msg = `INTEGRITY_VIOLATION: Test skip detected (${name}). Artificially skipping failing tests is prohibited.`;
            violations.push(msg);
            detailedViolations.push({
              type: 'TEST_SKIP',
              rule: name,
              message: msg,
              line: addedContent.trim(),
              lineNumber: currentLineNum,
            });
            break;
          }
        }

        // 4. Weakened / tautological assertions
        for (const { regex, name } of AstIntegrityInspector.WEAKENED_ASSERTION_PATTERNS) {
          if (regex.test(rawLine)) {
            const msg = `INTEGRITY_VIOLATION: Weakened / trivial assertion detected (${name}).`;
            violations.push(msg);
            detailedViolations.push({
              type: 'WEAKENED_ASSERTION',
              rule: name,
              message: msg,
              line: addedContent.trim(),
              lineNumber: currentLineNum,
            });
            break;
          }
        }
      }

      // 5. Deleted test assertions in removed lines (-)
      if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
        for (const { regex, name } of AstIntegrityInspector.DELETED_TEST_PATTERNS) {
          if (regex.test(rawLine)) {
            const deletedContent = rawLine.substring(1).trim();
            const msg = `INTEGRITY_VIOLATION: Deleted test assertions detected in diff (${name}: "${deletedContent}"). Removing test assertions to pass DoD is strictly prohibited.`;
            violations.push(
              `INTEGRITY_VIOLATION: Deleted test assertions detected in diff. Removing test assertions to pass DoD is strictly prohibited.`
            );
            detailedViolations.push({
              type: 'DELETED_TEST_ASSERTION',
              rule: name,
              message: msg,
              line: deletedContent,
              lineNumber: currentLineNum,
            });
            break;
          }
        }
      }
    }

    // Deduplicate simple violation strings
    const uniqueViolations = Array.from(new Set(violations));

    return {
      passed: uniqueViolations.length === 0,
      violations: uniqueViolations,
      detailedViolations,
      warningCount: uniqueViolations.length,
    };
  }

  /**
   * Evaluates raw source code content for incomplete stubs or skipped tests.
   */
  public static inspectContent(content: string, filePath?: string): IntegrityCheckResult {
    const violations: string[] = [];
    const detailedViolations: IntegrityViolation[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { regex, name } of AstIntegrityInspector.STUB_PATTERNS) {
        if (regex.test(line)) {
          const trimmed = line.trim();
          const location = filePath ? `${filePath}:${i + 1}` : `line ${i + 1}`;
          violations.push(`INCOMPLETE_CODE: Placeholder stub detected at ${location}: "${trimmed}"`);
          detailedViolations.push({
            type: 'INCOMPLETE_STUB',
            rule: name,
            message: `Incomplete stub found at ${location}`,
            line: trimmed,
            lineNumber: i + 1,
          });
          break;
        }
      }
    }

    const uniqueViolations = Array.from(new Set(violations));
    return {
      passed: uniqueViolations.length === 0,
      violations: uniqueViolations,
      detailedViolations,
      warningCount: uniqueViolations.length,
    };
  }
}
