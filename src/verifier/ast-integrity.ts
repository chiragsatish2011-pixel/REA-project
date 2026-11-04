/**
 * Nomin Code: Adversarial AST Diff & Content Integrity Inspector
 * Rejects silent scope reduction, softened assertions, deleted tests, commented-out assertions,
 * and placeholder stubs across TypeScript/JavaScript, Python, Go, Rust, and shell.
 */

import type { AstAudit } from './types.js';

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
  astAudit?: AstAudit;
}

export class AstIntegrityInspector {
  /**
   * Stubs & incomplete code patterns across TypeScript/JS, Python, Go, and Rust.
   */
  public static readonly STUB_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    // Multi-language comments
    { regex: /\/\/\s*TODO[:\s]/i, name: 'TODO comment' },
    { regex: /\/\*\s*TODO[:\s]/i, name: 'Block TODO comment' },
    { regex: /#\s*TODO[:\s]/i, name: 'Python/Shell TODO comment' },
    { regex: /\/\/\s*FIXME[:\s]/i, name: 'FIXME comment' },
    { regex: /\/\*\s*FIXME[:\s]/i, name: 'Block FIXME comment' },
    { regex: /#\s*FIXME[:\s]/i, name: 'Python/Shell FIXME comment' },
    { regex: /\/\/\s*implement(?:ation)?\s+here/i, name: 'implementation placeholder' },
    { regex: /\/\*\s*implement(?:ation)?\s+here/i, name: 'implementation block placeholder' },
    { regex: /#\s*implement(?:ation)?\s+here/i, name: 'python implementation placeholder' },
    { regex: /\/\/\s*your\s+code\s+here/i, name: 'your code here placeholder' },
    { regex: /#\s*your\s+code\s+here/i, name: 'python your code here placeholder' },

    // TS/JS & Universal stubs
    { regex: /^\s*\.\.\.\s*$/m, name: 'ellipsis stub' },
    { regex: /throw\s+new\s+Error\(['"](?:Not implemented|TODO|unimplemented)['"]\)/i, name: 'Error("Not implemented") stub' },

    // Python stubs
    { regex: /raise\s+NotImplementedError\b/i, name: 'Python NotImplementedError stub' },
    { regex: /\bpass\s*#\s*(?:TODO|implement|placeholder|stub)/i, name: 'Python pass TODO stub' },
    { regex: /^\s*(?:async\s+)?def\s+[\w_]+.*:\s*pass\b/m, name: 'Python inline def pass stub' },
    { regex: /^\s*pass\s*$/m, name: 'Python pass placeholder stub' },

    // Rust stubs
    { regex: /\btodo!\s*\(/, name: 'Rust todo!() stub' },
    { regex: /\bunimplemented!\s*\(/, name: 'Rust unimplemented!() stub' },

    // Go stubs
    { regex: /panic\(['"](?:not implemented|TODO|unimplemented)['"]\)/i, name: 'Go panic("not implemented") stub' },
  ];

  /**
   * Test skip patterns across TypeScript/JS, Python, Go, and Rust.
   */
  public static readonly TEST_SKIP_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    // TypeScript / JavaScript
    { regex: /(?:it|test|describe|context)\.skip\s*\(/, name: 'TS/JS test.skip() or describe.skip()' },
    { regex: /\b(?:xit|xtest)\s*\(/, name: 'TS/JS xit() or xtest() skipped test' },

    // Python
    { regex: /@pytest\.mark\.skip(?:if)?\b/, name: 'Python @pytest.mark.skip' },
    { regex: /(?:@\s*)?unittest\.skip(?:If|Unless)?\b/, name: 'Python @unittest.skip' },
    { regex: /\bpytest\.skip\s*\(/, name: 'Python pytest.skip()' },

    // Go
    { regex: /\b(?:t|b)\.Skip(?:Now|f)?\s*\(/, name: 'Go t.Skip/Skipf/SkipNow' },

    // Rust
    { regex: /#\[\s*ignore\b[^\]]*\]/, name: 'Rust #[ignore] attribute' },
  ];

  /**
   * Commented-out test assertions across languages.
   */
  public static readonly COMMENTED_ASSERTION_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    // JS / TS commented assertions
    { regex: /^\s*\/\/\s*(?:assert|expect|should)\b/i, name: 'commented-out JS/TS assertion' },
    { regex: /^\s*\/\*\s*(?:assert|expect|should)\b/i, name: 'block-commented JS/TS assertion' },
    { regex: /^\s*\/\/\s*(?:it|test|describe)\s*\(/i, name: 'commented-out test case' },

    // Python commented assertions
    { regex: /^\s*#\s*(?:assert\b|self\.assert)/i, name: 'commented-out Python assertion' },
    { regex: /^\s*#\s*def\s+test_[a-zA-Z0-9_]+/i, name: 'commented-out Python test method' },

    // Go / Rust commented assertions
    { regex: /^\s*\/\/\s*func\s+Test[A-Z0-9_]+/i, name: 'commented-out Go test function' },
    { regex: /^\s*\/\/\s*#\[\s*test\s*\]/i, name: 'commented-out Rust test attribute' },
    { regex: /^\s*\/\/\s*assert(?:_eq|_ne)?!\s*\(/i, name: 'commented-out Rust assertion' },
  ];

  /**
   * Deleted test declarations & assertions in removed lines (-).
   */
  public static readonly DELETED_TEST_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    { regex: /^\s*(?:it|test)\s*\(/, name: 'test case declaration (it/test)' },
    { regex: /^\s*def\s+test_[a-zA-Z0-9_]+/, name: 'python test method (test_*)' },
    { regex: /^\s*(?:assert|assert\.|self\.assert)/, name: 'assertion statement' },
    { regex: /^\s*expect\s*\(/, name: 'test expectation (expect)' },
    { regex: /^\s*@Test/, name: 'test annotation (@Test)' },
    { regex: /^\s*func\s+Test[A-Z0-9_]+/, name: 'Go test function (func Test*)' },
    { regex: /^\s*#\[\s*test\s*\]/, name: 'Rust test attribute (#[test])' },
    { regex: /^\s*assert(?:_eq|_ne)?!\s*\(/, name: 'Rust assertion macro (assert!)' },
  ];

  /**
   * Weakened / tautological assertions that simulate passing tests without testing logic.
   */
  public static readonly WEAKENED_ASSERTION_PATTERNS: Array<{ regex: RegExp; name: string }> = [
    { regex: /expect\(true\)\.toBe\(true\)/, name: 'trivial tautological assertion expect(true).toBe(true)' },
    { regex: /assert\s+(?:True|1\s*==\s*1)\b/, name: 'trivial tautological assertion assert True' },
    { regex: /assert\.strictEqual\((?:true,\s*true|1,\s*1)\)/, name: 'trivial strictEqual tautology' },
    { regex: /assert!\(\s*true\s*\)/, name: 'Rust trivial assert!(true)' },
  ];

  /**
   * Evaluates a git diff for adversarial anti-patterns across multiple languages.
   */
  public static inspectDiff(diffContent: string): IntegrityCheckResult {
    const violations: string[] = [];
    const detailedViolations: IntegrityViolation[] = [];
    const stubsFound: string[] = [];
    const testsSkipped: string[] = [];

    const lines = diffContent.split('\n');
    let currentLineNum = 0;
    let previousAddedLine = '';

    for (const rawLine of lines) {
      currentLineNum++;

      // 1-4. Checks for newly added lines (+)
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        const addedContent = rawLine.substring(1);
        const trimmedAdded = addedContent.trim();

        // 1. Placeholder stubs across languages
        for (const { regex, name } of AstIntegrityInspector.STUB_PATTERNS) {
          // Special context check for bare Python 'pass':
          // If the line is 'pass', check if it's inside an exception block (e.g., 'except ...: pass').
          // If preceded by 'def ...:', docstring, or standalone, it is an incomplete stub.
          if (name === 'Python pass placeholder stub') {
            if (trimmedAdded === 'pass') {
              const isExceptHandler =
                previousAddedLine.includes('except') || previousAddedLine.includes('finally');
              if (isExceptHandler) {
                continue; // Allowed exception suppression
              }
            } else {
              continue;
            }
          }

          if (regex.test(addedContent)) {
            const msg = `INTEGRITY_VIOLATION: Incomplete placeholder stub detected (${name}): "${trimmedAdded}"`;
            violations.push(`INCOMPLETE_CODE: Placeholder stub detected in added line: "${trimmedAdded}"`);
            stubsFound.push(`${name}: "${trimmedAdded}"`);
            detailedViolations.push({
              type: 'INCOMPLETE_STUB',
              rule: name,
              message: msg,
              line: trimmedAdded,
              lineNumber: currentLineNum,
            });
            break;
          }
        }

        // 2. Commented-out assertions in added lines (+)
        for (const { regex, name } of AstIntegrityInspector.COMMENTED_ASSERTION_PATTERNS) {
          if (regex.test(addedContent)) {
            const msg = `INTEGRITY_VIOLATION: Commented-out test assertion detected (${name}): "${trimmedAdded}"`;
            violations.push(msg);
            testsSkipped.push(`${name}: "${trimmedAdded}"`);
            detailedViolations.push({
              type: 'COMMENTED_OUT_ASSERTION',
              rule: name,
              message: msg,
              line: trimmedAdded,
              lineNumber: currentLineNum,
            });
            break;
          }
        }

        // 3. Newly introduced test skips across languages (+)
        for (const { regex, name } of AstIntegrityInspector.TEST_SKIP_PATTERNS) {
          if (regex.test(addedContent)) {
            const msg = `INTEGRITY_VIOLATION: Test skip detected (${name}). Artificially skipping failing tests is prohibited.`;
            violations.push(msg);
            testsSkipped.push(`${name}: "${trimmedAdded}"`);
            detailedViolations.push({
              type: 'TEST_SKIP',
              rule: name,
              message: msg,
              line: trimmedAdded,
              lineNumber: currentLineNum,
            });
            break;
          }
        }

        // 4. Weakened / tautological assertions
        for (const { regex, name } of AstIntegrityInspector.WEAKENED_ASSERTION_PATTERNS) {
          if (regex.test(addedContent)) {
            const msg = `INTEGRITY_VIOLATION: Weakened / trivial assertion detected (${name}).`;
            violations.push(msg);
            testsSkipped.push(`${name}: "${trimmedAdded}"`);
            detailedViolations.push({
              type: 'WEAKENED_ASSERTION',
              rule: name,
              message: msg,
              line: trimmedAdded,
              lineNumber: currentLineNum,
            });
            break;
          }
        }

        if (trimmedAdded.length > 0) {
          previousAddedLine = trimmedAdded;
        }
      }

      // 5. Deleted test assertions in removed lines (-)
      if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
        const deletedContent = rawLine.substring(1);
        const trimmedDeleted = deletedContent.trim();

        for (const { regex, name } of AstIntegrityInspector.DELETED_TEST_PATTERNS) {
          if (regex.test(deletedContent)) {
            const msg = `INTEGRITY_VIOLATION: Deleted test assertions detected in diff (${name}: "${trimmedDeleted}"). Removing test assertions to pass DoD is strictly prohibited.`;
            violations.push(
              `INTEGRITY_VIOLATION: Deleted test assertions detected in diff. Removing test assertions to pass DoD is strictly prohibited.`
            );
            testsSkipped.push(`Deleted test: ${name} ("${trimmedDeleted}")`);
            detailedViolations.push({
              type: 'DELETED_TEST_ASSERTION',
              rule: name,
              message: msg,
              line: trimmedDeleted,
              lineNumber: currentLineNum,
            });
            break;
          }
        }
      }
    }

    const uniqueViolations = Array.from(new Set(violations));
    const passed = uniqueViolations.length === 0;

    const astAudit: AstAudit = {
      clean: passed,
      stubsFound: Array.from(new Set(stubsFound)),
      testsSkipped: Array.from(new Set(testsSkipped)),
    };

    return {
      passed,
      violations: uniqueViolations,
      detailedViolations,
      warningCount: uniqueViolations.length,
      astAudit,
    };
  }

  /**
   * Evaluates raw source code content for incomplete stubs, skipped tests, or commented assertions.
   */
  public static inspectContent(content: string, filePath?: string): IntegrityCheckResult {
    const violations: string[] = [];
    const detailedViolations: IntegrityViolation[] = [];
    const stubsFound: string[] = [];
    const testsSkipped: string[] = [];

    const lines = content.split('\n');
    let previousLine = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const location = filePath ? `${filePath}:${i + 1}` : `line ${i + 1}`;

      // 1. Check Stubs
      for (const { regex, name } of AstIntegrityInspector.STUB_PATTERNS) {
        if (name === 'Python pass placeholder stub') {
          if (trimmed === 'pass') {
            const isExceptHandler =
              previousLine.includes('except') || previousLine.includes('finally');
            if (isExceptHandler) {
              continue;
            }
          } else {
            continue;
          }
        }

        if (regex.test(line)) {
          const msg = `INCOMPLETE_CODE: Placeholder stub detected at ${location} (${name}): "${trimmed}"`;
          violations.push(msg);
          stubsFound.push(`${name} at ${location}: "${trimmed}"`);
          detailedViolations.push({
            type: 'INCOMPLETE_STUB',
            rule: name,
            message: msg,
            line: trimmed,
            lineNumber: i + 1,
          });
          break;
        }
      }

      // 2. Check Test Skips
      for (const { regex, name } of AstIntegrityInspector.TEST_SKIP_PATTERNS) {
        if (regex.test(line)) {
          const msg = `INTEGRITY_VIOLATION: Test skip detected at ${location} (${name}): "${trimmed}"`;
          violations.push(msg);
          testsSkipped.push(`${name} at ${location}: "${trimmed}"`);
          detailedViolations.push({
            type: 'TEST_SKIP',
            rule: name,
            message: msg,
            line: trimmed,
            lineNumber: i + 1,
          });
          break;
        }
      }

      // 3. Check Commented-out Assertions
      for (const { regex, name } of AstIntegrityInspector.COMMENTED_ASSERTION_PATTERNS) {
        if (regex.test(line)) {
          const msg = `INTEGRITY_VIOLATION: Commented assertion at ${location} (${name}): "${trimmed}"`;
          violations.push(msg);
          testsSkipped.push(`${name} at ${location}: "${trimmed}"`);
          detailedViolations.push({
            type: 'COMMENTED_OUT_ASSERTION',
            rule: name,
            message: msg,
            line: trimmed,
            lineNumber: i + 1,
          });
          break;
        }
      }

      if (trimmed.length > 0) {
        previousLine = trimmed;
      }
    }

    const uniqueViolations = Array.from(new Set(violations));
    const passed = uniqueViolations.length === 0;

    const astAudit: AstAudit = {
      clean: passed,
      stubsFound: Array.from(new Set(stubsFound)),
      testsSkipped: Array.from(new Set(testsSkipped)),
    };

    return {
      passed,
      violations: uniqueViolations,
      detailedViolations,
      warningCount: uniqueViolations.length,
      astAudit,
    };
  }

  /**
   * Helper to perform a high-level AST integrity audit returning an AstAudit structure.
   */
  public static audit(diffOrContent: string, isDiff: boolean = true): AstAudit {
    const result = isDiff
      ? AstIntegrityInspector.inspectDiff(diffOrContent)
      : AstIntegrityInspector.inspectContent(diffOrContent);

    return (
      result.astAudit || {
        clean: result.passed,
        stubsFound: result.detailedViolations
          .filter((v) => v.type === 'INCOMPLETE_STUB')
          .map((v) => `${v.rule}: "${v.line || v.message}"`),
        testsSkipped: result.detailedViolations
          .filter((v) => v.type !== 'INCOMPLETE_STUB')
          .map((v) => `${v.rule}: "${v.line || v.message}"`),
      }
    );
  }
}
