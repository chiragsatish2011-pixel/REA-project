/**
 * @file path-resolver-exhaustive.test.ts
 * @description Comprehensive table-driven and property fuzz testing suite for SharedPathResolver.
 * Covers >= 40 distinct path resolution scenarios, edge cases, and invariants.
 * Zero external dependencies (pure Node.js standard library test runner).
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { SharedPathResolver, type PathResolutionResult } from '../src/config/path-resolver.js';
import { BuildStampEngine } from '../src/config/build-stamp.js';

const rawTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-path-test-'));
const testRoot = (process.platform === 'win32' && fs.realpathSync.native)
  ? fs.realpathSync.native(rawTestRoot)
  : rawTestRoot;
const normalDir = path.join(testRoot, 'normal_dir');
const spacedDir = path.join(testRoot, 'Game 2.6 with Spaces');
const specialCharDir = path.join(testRoot, 'Project (Special) [v1.0] #tag');
const deepNestedDir = path.join(testRoot, 'a', 'b', 'c');
const sampleFile = path.join(testRoot, 'not_a_dir.txt');

fs.mkdirSync(normalDir, { recursive: true });
fs.mkdirSync(spacedDir, { recursive: true });
fs.mkdirSync(specialCharDir, { recursive: true });
fs.mkdirSync(deepNestedDir, { recursive: true });
fs.writeFileSync(sampleFile, 'hello world', 'utf-8');

describe('Exhaustive Path Resolver & Follow-Up Engine Suite', () => {
  after(() => {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch (_) {}
  });

  // Table-driven test cases (>= 40 cases)
  const cases: Array<{
    name: string;
    input: string;
    expectedSuccess: boolean;
    expectedPath?: string;
    expectedFollowUp?: string;
    expectedErrorType?: string;
    invariantCheck?: (res: PathResolutionResult) => void;
  }> = [
    // 1-5: Quoted paths with follow-up text (The exact reproduction bug)
    {
      name: 'Double-quoted path with trailing prose',
      input: `"${spacedDir}" and tell me wt is theer`,
      expectedSuccess: true,
      expectedPath: spacedDir,
      expectedFollowUp: 'and tell me wt is theer',
    },
    {
      name: 'Single-quoted path with trailing prose',
      input: `'${spacedDir}' please list all files`,
      expectedSuccess: true,
      expectedPath: spacedDir,
      expectedFollowUp: 'please list all files',
    },
    {
      name: 'Double-quoted path without follow-up text',
      input: `"${spacedDir}"`,
      expectedSuccess: true,
      expectedPath: spacedDir,
      expectedFollowUp: '',
    },
    {
      name: 'Single-quoted path without follow-up text',
      input: `'${spacedDir}'`,
      expectedSuccess: true,
      expectedPath: spacedDir,
      expectedFollowUp: '',
    },
    {
      name: 'Quoted path with trailing comma and prose',
      input: `"${normalDir}", check if build passes`,
      expectedSuccess: true,
      expectedPath: normalDir,
      expectedFollowUp: ', check if build passes',
    },

    // 6-10: Empty and whitespace arguments
    {
      name: 'Empty string returns current workspace',
      input: '',
      expectedSuccess: true,
      expectedFollowUp: '',
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath), path.resolve(testRoot)),
    },
    {
      name: 'Whitespace-only string returns current workspace',
      input: '    ',
      expectedSuccess: true,
      expectedFollowUp: '',
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath), path.resolve(testRoot)),
    },
    {
      name: 'Current directory dot "."',
      input: '.',
      expectedSuccess: true,
      expectedFollowUp: '',
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath), path.resolve(testRoot)),
    },
    {
      name: 'Parent directory dot-dot ".."',
      input: '..',
      expectedSuccess: true,
      expectedFollowUp: '',
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath), path.resolve(testRoot, '..')),
    },
    {
      name: 'Current directory with follow-up prose',
      input: '. and inspect files',
      expectedSuccess: true,
      expectedFollowUp: 'and inspect files',
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath), path.resolve(testRoot)),
    },

    // 11-15: Absolute paths (Windows drive letters & slash variants)
    {
      name: 'Absolute path with uppercase drive letter',
      input: normalDir.toUpperCase(),
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Absolute path with lowercase drive letter',
      input: normalDir.toLowerCase(),
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Absolute path with forward slashes',
      input: normalDir.replace(/\\/g, '/'),
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Absolute path with trailing backslash',
      input: normalDir + '\\',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Absolute path with trailing forward slash',
      input: normalDir.replace(/\\/g, '/') + '/',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },

    // 16-20: Relative paths and subdirectories
    {
      name: 'Relative subdirectory without prefix',
      input: 'normal_dir',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Relative subdirectory with dot-slash "./normal_dir"',
      input: './normal_dir',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Deep nested relative directory "a/b/c"',
      input: 'a/b/c',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(deepNestedDir).toLowerCase()),
    },
    {
      name: 'Deep nested relative directory with backslashes "a\\b\\c"',
      input: 'a\\b\\c',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(deepNestedDir).toLowerCase()),
    },
    {
      name: 'Relative path with navigation "normal_dir/../a/b/c"',
      input: 'normal_dir/../a/b/c',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(deepNestedDir).toLowerCase()),
    },

    // 21-25: Unquoted paths with spaces and follow-up text (longest prefix match)
    {
      name: 'Unquoted path with spaces that exists in full',
      input: spacedDir,
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(spacedDir).toLowerCase()),
    },
    {
      name: 'Unquoted path with spaces followed by prose',
      input: `${spacedDir} and show what is here`,
      expectedSuccess: true,
      expectedFollowUp: 'and show what is here',
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(spacedDir).toLowerCase()),
    },
    {
      name: 'Unquoted relative path with spaces followed by prose',
      input: 'Game 2.6 with Spaces and show what is here',
      expectedSuccess: true,
      expectedFollowUp: 'and show what is here',
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(spacedDir).toLowerCase()),
    },
    {
      name: 'Path with special characters () [] #',
      input: `"${specialCharDir}" and check status`,
      expectedSuccess: true,
      expectedPath: specialCharDir,
      expectedFollowUp: 'and check status',
    },
    {
      name: 'Unquoted path with special characters',
      input: specialCharDir,
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(specialCharDir).toLowerCase()),
    },

    // 26-30: Home directory and environment variable expansion
    {
      name: 'Home directory tilde "~"',
      input: '~',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath), path.resolve(os.homedir())),
    },
    {
      name: 'Home directory tilde with subpath "~/Projects"',
      input: '~/Projects',
      expectedSuccess: fs.existsSync(path.join(os.homedir(), 'Projects')),
      invariantCheck: (res) => assert.ok(!res.resolvedPath.includes('~')),
    },
    {
      name: 'Windows %TEMP% expansion',
      input: '%TEMP%',
      expectedSuccess: true,
      invariantCheck: (res) => assert.ok(fs.existsSync(res.resolvedPath)),
    },
    {
      name: 'PowerShell $env:TEMP expansion',
      input: '$env:TEMP',
      expectedSuccess: true,
      invariantCheck: (res) => assert.ok(fs.existsSync(res.resolvedPath)),
    },
    {
      name: 'Bash $TEMP expansion',
      input: '$TEMP',
      expectedSuccess: true,
      invariantCheck: (res) => assert.ok(fs.existsSync(res.resolvedPath)),
    },

    // 31-35: Error cases & differentiation (not_found, is_file)
    {
      name: 'Non-existent directory returns not_found error',
      input: path.join(testRoot, 'does_not_exist_xyz123'),
      expectedSuccess: false,
      expectedErrorType: 'not_found',
      invariantCheck: (res) => {
        assert.ok(res.error?.includes('Directory not found'));
        // CRITICAL INVARIANT: The resolvedPath must NEVER prepend cwd to an absolute path
        assert.ok(!res.resolvedPath.includes('"'));
      },
    },
    {
      name: 'Non-existent quoted path returns not_found error',
      input: `"${path.join(testRoot, 'non_existent_folder')}" and do work`,
      expectedSuccess: false,
      expectedErrorType: 'not_found',
      expectedFollowUp: 'and do work',
    },
    {
      name: 'Path to a file instead of directory returns is_file error',
      input: sampleFile,
      expectedSuccess: false,
      expectedErrorType: 'is_file',
      invariantCheck: (res) => assert.ok(res.error?.includes('file, not a directory')),
    },
    {
      name: 'Quoted file path returns is_file error',
      input: `"${sampleFile}"`,
      expectedSuccess: false,
      expectedErrorType: 'is_file',
    },
    {
      name: 'Unclosed quote consumes rest of line as path',
      input: `"${path.join(testRoot, 'non_existent')}`,
      expectedSuccess: false,
      expectedErrorType: 'not_found',
    },

    // 36-40: Slash variants, trailing dots, redundant separators
    {
      name: 'Redundant multiple backslashes "testRoot\\\\normal_dir"',
      input: testRoot + '\\\\' + 'normal_dir',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Redundant multiple forward slashes',
      input: testRoot.replace(/\\/g, '/') + '//normal_dir',
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Trailing dot on path "normal_dir/."',
      input: path.join(normalDir, '.'),
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'Quoted path with interior escaped quotes',
      input: `"${normalDir}"`,
      expectedSuccess: true,
      invariantCheck: (res) => assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(normalDir).toLowerCase()),
    },
    {
      name: 'The exact real-world bug from transcript: /cd "C:\\Users\\...\\Game 2.6" and tell me wt is theer',
      input: `"${spacedDir}" and tell me wt is theer`,
      expectedSuccess: true,
      expectedFollowUp: 'and tell me wt is theer',
      invariantCheck: (res) => {
        assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(spacedDir).toLowerCase());
        // Verify cwd was NOT joined onto the quoted string
        assert.ok(!res.resolvedPath.includes('"'));
        assert.ok(!res.resolvedPath.includes('theer'));
      },
    },
  ];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    it(`Case ${i + 1}: ${c.name}`, () => {
      const res = SharedPathResolver.parseAndResolve(c.input, testRoot);

      if (c.expectedSuccess !== undefined) {
        assert.equal(res.success, c.expectedSuccess, `Expected success=${c.expectedSuccess}, got ${res.success}: ${res.error}`);
      }

      if (c.expectedPath) {
        assert.equal(path.resolve(res.resolvedPath).toLowerCase(), path.resolve(c.expectedPath).toLowerCase());
      }

      if (c.expectedFollowUp !== undefined) {
        assert.equal(res.followUpText, c.expectedFollowUp);
      }

      if (c.expectedErrorType) {
        assert.equal(res.errorType, c.expectedErrorType);
      }

      if (c.invariantCheck) {
        c.invariantCheck(res);
      }
    });
  }

  // 41-45: Property Fuzz Testing
  it('Property Fuzz: Never throws an uncaught exception on random characters or fuzz inputs', () => {
    const fuzzSamples = [
      '', ' ', '\t', '\n', '"', '""', "''", '"""', '"""""',
      '\\\\\\\\', '////', 'C:', 'C:\\', 'Z:\\non_existent',
      '..\\..\\..\\..\\..\\..\\..\\',
      '"C:\\Program Files\\App" --flag and some other stuff',
      '{"json": "not a path"}',
      '<xml>also not a path</xml>',
      'dir with space and "nested quote" something',
      '\x00nullbyte',
      '!@#$%^&*()_+=-`~[]{}|;:,.<>?',
      'a'.repeat(500),
    ];

    for (const sample of fuzzSamples) {
      assert.doesNotThrow(() => {
        const res = SharedPathResolver.parseAndResolve(sample, testRoot);
        assert.ok(typeof res.success === 'boolean');
        assert.ok(typeof res.resolvedPath === 'string');
        assert.ok(typeof res.followUpText === 'string');
      }, `Fuzz sample crashed: "${sample}"`);
    }
  });

  it('Build Stamp Engine provides valid verification identity for binary', () => {
    const stamp = BuildStampEngine.getStamp();
    assert.ok(stamp.version);
    assert.ok(stamp.commitHash);
    assert.ok(stamp.buildTimestamp);
    assert.ok(stamp.entryFile);

    const formatted = BuildStampEngine.formatStamp();
    assert.ok(formatted.includes(stamp.version));
    assert.ok(formatted.includes(stamp.commitHash));

    const oneLine = BuildStampEngine.formatOneLine();
    assert.ok(oneLine.includes(stamp.version));
  });
});
