/**
 * @file tools.test.ts
 * @description Comprehensive unit and integration tests for Nomin Code Tools execution engine.
 */

import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  ToolRegistry,
  defaultToolRegistry,
  EditFileTool,
  ReadFileTool,
  SearchGrepTool,
  SearchGlobTool,
  SearchTool,
  BashTool,
  GitWorktreeManager,
  runGit,
  RepoMapTool,
  RepoMapEngine,
  calculateLevenshteinDistance,
  calculateSimilarityRatio,
  parseSearchReplaceBlocks,
  SearchReplaceEngine,
  globToRegex,
  crawlDirectory,
  grepInDirectory,
  executeCommand,
  truncateOutput,
  extractSymbolsFromSource,
  computePageRank,
  generateRepoMap,
  type ToolExecutionContext,
} from '../src/tools/index.js';

describe('Nomin Code: Tools Execution Engine', () => {
  let tempDir: string;
  let mockContext: ToolExecutionContext;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-tools-test-'));
    mockContext = {
      sessionID: 'test-session-1',
      agentID: 'test-agent-1',
      worktreePath: tempDir,
      callID: 'call-1',
    };
  });

  after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows
    }
  });

  // =========================================================================
  // 1. Tool Registry & Schemas
  // =========================================================================
  describe('ToolRegistry', () => {
    test('default registry contains all 6 core tools', () => {
      const names = defaultToolRegistry.getToolNames();
      assert.ok(names.includes('edit_file'));
      assert.ok(names.includes('read_file'));
      assert.ok(names.includes('search_grep'));
      assert.ok(names.includes('search_glob'));
      assert.ok(names.includes('execute_command'));
      assert.ok(names.includes('repomap'));
    });

    test('generates valid OpenAI / NIM function schemas', () => {
      const schemas = defaultToolRegistry.getSchemas();
      assert.strictEqual(schemas.length >= 6, true);
      for (const s of schemas) {
        assert.strictEqual(s.type, 'function');
        assert.ok(s.function.name);
        assert.ok(s.function.description);
        assert.strictEqual(s.function.parameters.type, 'object');
      }
    });

    test('validates required parameters and fails gracefully', async () => {
      const res = await defaultToolRegistry.executeTool('read_file', {}, mockContext);
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Missing required parameter 'path'/);
    });

    test('returns descriptive error for unregistered tool', async () => {
      const res = await defaultToolRegistry.executeTool('non_existent_tool', {}, mockContext);
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Tool 'non_existent_tool' not found/);
    });
  });

  // =========================================================================
  // 2. EditFileTool & Multi-Tier Fuzzy Matching
  // =========================================================================
  describe('EditFileTool & 4-Tier Matching', () => {
    const engine = new SearchReplaceEngine();

    test('Tier 1: Exact string match', () => {
      const original = `function add(a, b) {\n  return a + b;\n}`;
      const search = `return a + b;`;
      const replace = `return Number(a) + Number(b);`;

      const res = engine.matchAndReplace(original, search, replace);
      assert.strictEqual(res.stats.tierUsed, 1);
      assert.strictEqual(res.stats.linesAdded, 1);
      assert.strictEqual(res.stats.linesDeleted, 1);
      assert.ok(res.updatedContent.includes('Number(a) + Number(b)'));
    });

    test('Tier 2: Whitespace and indentation normalization', () => {
      const original = `class MathOps {\n    compute() {\n        const x = 10;\n        return x;\n    }\n}`;
      // Search with 2 spaces instead of 4 spaces
      const search = `compute() {\n  const x = 10;\n  return x;\n}`;
      const replace = `compute() {\n  const x = 20;\n  return x * 2;\n}`;

      const res = engine.matchAndReplace(original, search, replace);
      assert.strictEqual(res.stats.tierUsed, 2);
      assert.ok(res.updatedContent.includes('const x = 20;'));
    });

    test('Tier 3: Blank line insensitivity', () => {
      const original = `function hello() {\n\n  const msg = "hi";\n\n\n  return msg;\n}`;
      // Search with no blank lines
      const search = `function hello() {\n  const msg = "hi";\n  return msg;\n}`;
      const replace = `function hello() {\n  const msg = "hello world";\n  return msg;\n}`;

      const res = engine.matchAndReplace(original, search, replace);
      assert.strictEqual(res.stats.tierUsed, 3);
      assert.ok(res.updatedContent.includes('hello world'));
    });

    test('Tier 4: Sliding window Levenshtein ratio (>0.85 similarity)', () => {
      const original = `function calcDiscount(price, userRole) {\n  // Calculate the user discount percentage\n  if (userRole === "VIP") return price * 0.8;\n  return price;\n}`;
      // Search has minor typo in comment and spacing
      const search = `function calcDiscount(price, userRole) {\n  // Calc the user discount percentage\n  if (userRole === "VIP") return price * 0.8;\n  return price;\n}`;
      const replace = `function calcDiscount(price, userRole) {\n  if (userRole === "VIP") return price * 0.75;\n  return price;\n}`;

      const sim = calculateSimilarityRatio(original, search);
      assert.ok(sim >= 0.85, `Similarity ratio ${sim} should be >= 0.85`);

      const res = engine.matchAndReplace(original, search, replace);
      assert.strictEqual(res.stats.tierUsed, 4);
      assert.ok(res.updatedContent.includes('0.75'));
    });

    test('Aider format: parses multiple SEARCH/REPLACE blocks', () => {
      const aiderContent = `
<<<<<<< SEARCH
function first() {
  return 1;
}
=======
function first() {
  return 10;
}
>>>>>>> REPLACE

<<<<<<< SEARCH
function second() {
  return 2;
}
=======
function second() {
  return 20;
}
>>>>>>> REPLACE
`;
      const blocks = parseSearchReplaceBlocks(aiderContent);
      assert.strictEqual(blocks.length, 2);
      assert.ok(blocks[0].search.includes('return 1;'));
      assert.ok(blocks[0].replace.includes('return 10;'));
      assert.ok(blocks[1].search.includes('return 2;'));
      assert.ok(blocks[1].replace.includes('return 20;'));
    });

    test('EditFileTool executes file creation when file does not exist', async () => {
      const tool = new EditFileTool();
      const newFilePath = 'new-file.txt';
      const res = await tool.execute(
        {
          path: newFilePath,
          replace_block: 'Line 1\nLine 2\nLine 3',
        },
        mockContext
      );

      assert.strictEqual(res.success, true);
      const absPath = path.join(tempDir, newFilePath);
      assert.strictEqual(fs.existsSync(absPath), true);
      assert.strictEqual(fs.readFileSync(absPath, 'utf-8'), 'Line 1\nLine 2\nLine 3');
    });

    test('EditFileTool applies sequential edits and returns diff', async () => {
      const tool = new EditFileTool();
      const testFile = 'editable.ts';
      fs.writeFileSync(path.join(tempDir, testFile), 'export const a = 1;\nexport const b = 2;\n', 'utf-8');

      const res = await tool.execute(
        {
          path: testFile,
          search_block: 'export const a = 1;',
          replace_block: 'export const a = 100;',
        },
        mockContext
      );

      assert.strictEqual(res.success, true);
      assert.ok(res.output.includes('Unified Diff:'));
      const updated = fs.readFileSync(path.join(tempDir, testFile), 'utf-8');
      assert.ok(updated.includes('export const a = 100;'));
    });
  });

  // =========================================================================
  // 3. ReadFileTool & Safety Guards
  // =========================================================================
  describe('ReadFileTool', () => {
    const readTool = new ReadFileTool();

    test('reads lines with windowing (start_line, end_line) and numbering', async () => {
      const filePath = 'multi-line.txt';
      const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
      fs.writeFileSync(path.join(tempDir, filePath), lines.join('\n'), 'utf-8');

      const res = await readTool.execute(
        {
          path: filePath,
          start_line: 10,
          end_line: 15,
          include_line_numbers: true,
        },
        mockContext
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.linesRead, 6);
      assert.strictEqual(res.data.startLine, 10);
      assert.strictEqual(res.data.endLine, 15);
      assert.strictEqual(res.data.truncated, true);
      assert.ok(res.output.includes('10: Line 10'));
      assert.ok(res.output.includes('15: Line 15'));
      assert.ok(!res.output.includes('16: Line 16'));
    });

    test('rejects binary files safely', async () => {
      const binaryPath = 'sample.bin';
      const buf = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x12]);
      fs.writeFileSync(path.join(tempDir, binaryPath), buf);

      const res = await readTool.execute({ path: binaryPath }, mockContext);
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /Cannot read binary file/);
    });

    test('rejects out-of-range line bounds', async () => {
      const filePath = 'short.txt';
      fs.writeFileSync(path.join(tempDir, filePath), 'A\nB\nC\n', 'utf-8');

      const res = await readTool.execute(
        {
          path: filePath,
          start_line: 10,
        },
        mockContext
      );
      assert.strictEqual(res.success, false);
      assert.match(res.error || '', /beyond the total lines/);
    });
  });

  // =========================================================================
  // 4. Search Tools (Grep & Glob)
  // =========================================================================
  describe('Search Tools', () => {
    before(() => {
      fs.mkdirSync(path.join(tempDir, 'src', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'src', 'a.ts'), 'export const Alpha = "target_token";\n', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'src', 'b.js'), 'console.log("hello world");\n', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'src', 'nested', 'c.ts'), 'const target_token = 42;\n', 'utf-8');
    });

    test('globToRegex matches standard wildcards and recursive **', () => {
      const re = globToRegex('src/**/*.ts');
      assert.strictEqual(re.test('src/a.ts'), true);
      assert.strictEqual(re.test('src/nested/c.ts'), true);
      assert.strictEqual(re.test('src/b.js'), false);
    });

    test('SearchGlobTool finds matching files', async () => {
      const globTool = new SearchGlobTool();
      const res = await globTool.execute({ pattern: '**/*.ts' }, mockContext);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.files.length >= 2, true);
      assert.ok(res.data.files.includes('src/a.ts'));
      assert.ok(res.data.files.includes('src/nested/c.ts'));
    });

    test('SearchGrepTool finds occurrences with line and column', async () => {
      const grepTool = new SearchGrepTool();
      const res = await grepTool.execute({ query: 'target_token' }, mockContext);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.totalMatches, 2);
      assert.strictEqual(res.data.matches[0].line, 1);
      assert.ok(res.data.matches.some((m: any) => m.file === 'src/a.ts'));
      assert.ok(res.data.matches.some((m: any) => m.file === 'src/nested/c.ts'));
    });

    test('SearchTool static helper works identically', () => {
      const matches = SearchTool.grep(tempDir, { query: 'target_token' });
      assert.strictEqual(matches.length, 2);

      const files = SearchTool.glob(tempDir, '**/*.ts');
      assert.strictEqual(files.length >= 2, true);
    });
  });

  // =========================================================================
  // 5. BashTool & Sandboxed Command Execution
  // =========================================================================
  describe('BashTool', () => {
    test('executes command and captures stdout and exit code 0', async () => {
      const tool = new BashTool();
      const res = await tool.execute({ command: 'node -e "console.log(\'SWARM_READY\')"' }, mockContext);

      assert.strictEqual(res.success, true);
      assert.ok(res.output.includes('SWARM_READY'));
      assert.strictEqual(res.data.exitCode, 0);
    });

    test('captures nonzero exit codes and stderr', async () => {
      const tool = new BashTool();
      const res = await tool.execute({ command: 'node -e "console.error(\'CUSTOM_ERROR\'); process.exit(42)"' }, mockContext);

      assert.strictEqual(res.success, false);
      assert.ok(res.output.includes('CUSTOM_ERROR'));
      assert.strictEqual(res.data.exitCode, 42);
    });

    test('enforces strict timeout limits', async () => {
      const res = await executeCommand({
        command: 'node -e "setTimeout(() => {}, 10000)"',
        timeoutSeconds: 1,
      });

      assert.strictEqual(res.timedOut, true);
      assert.strictEqual(res.exitCode, 124);
    });

    test('truncates oversized output preserving head and tail', () => {
      const bigText = 'HEAD_START_' + 'x'.repeat(40000) + '_TAIL_END';
      const trunc = truncateOutput(bigText, 1000);

      assert.strictEqual(trunc.truncated, true);
      assert.ok(trunc.text.includes('HEAD_START_'));
      assert.ok(trunc.text.includes('_TAIL_END'));
      assert.ok(trunc.text.includes('OUTPUT TRUNCATED'));
      assert.ok(trunc.text.length < bigText.length);
    });
  });

  // =========================================================================
  // 6. RepoMap & PageRank Ranking
  // =========================================================================
  describe('RepoMap & PageRank Ranking', () => {
    test('extracts AST definitions from TypeScript / JavaScript', () => {
      const code = `
export class SwarmCoordinator {
  public startWorker() {}
}

export interface TaskConfig {
  id: string;
}

export function dispatchTask(config: TaskConfig) {
  return new SwarmCoordinator();
}
`;
      const symbols = extractSymbolsFromSource('src/swarm.ts', code);
      assert.strictEqual(symbols.definitions.length >= 3, true);

      const kinds = symbols.definitions.map((d) => d.kind);
      assert.ok(kinds.includes('class'));
      assert.ok(kinds.includes('interface'));
      assert.ok(kinds.includes('function'));
      assert.ok(symbols.references.has('TaskConfig'));
      assert.ok(symbols.references.has('SwarmCoordinator'));
    });

    test('computes PageRank giving higher weight to referenced files', () => {
      const fileMap = new Map();
      fileMap.set('types.ts', {
        definitions: [{ name: 'ConfigType', kind: 'type', file: 'types.ts', line: 1 }],
        references: new Set(),
      });
      fileMap.set('main.ts', {
        definitions: [{ name: 'runApp', kind: 'function', file: 'main.ts', line: 1 }],
        references: new Set(['ConfigType']),
      });
      fileMap.set('worker.ts', {
        definitions: [{ name: 'runWorker', kind: 'function', file: 'worker.ts', line: 1 }],
        references: new Set(['ConfigType']),
      });

      const scores = computePageRank(['types.ts', 'main.ts', 'worker.ts'], fileMap);
      const typesScore = scores.get('types.ts') || 0;
      const mainScore = scores.get('main.ts') || 0;

      // types.ts is referenced by both main.ts and worker.ts, so its PageRank must be strictly higher
      assert.ok(typesScore > mainScore, `Expected types.ts score (${typesScore}) > main.ts score (${mainScore})`);
    });

    test('generates budget-constrained repository skeleton', () => {
      const res = generateRepoMap({ repoPath: tempDir, maxTokens: 512 });
      assert.ok(res.tokenEstimate <= 512);
      assert.ok(typeof res.mapText === 'string');
    });
  });

  // =========================================================================
  // 7. Git Worktree Manager
  // =========================================================================
  describe('GitWorktreeManager', () => {
    let gitDir: string;
    let gitManager: GitWorktreeManager;

    before(async () => {
      gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-git-test-'));
      // Initialize a real git repo using runGit directly
      await runGit(['init', '-b', 'main'], gitDir);
      await runGit(['config', 'user.name', 'Nomin Swarm'], gitDir);
      await runGit(['config', 'user.email', 'swarm@nomin.ai'], gitDir);
      fs.writeFileSync(path.join(gitDir, 'README.md'), '# Nomin Git Test\n', 'utf-8');
      await runGit(['add', '-A'], gitDir);
      await runGit(['commit', '-m', 'initial commit'], gitDir);

      gitManager = new GitWorktreeManager(gitDir);
    });

    after(async () => {
      try {
        fs.rmSync(gitDir, { recursive: true, force: true });
      } catch {
        // Cleanup
      }
    });

    test('detects active git repository', async () => {
      const isRepo = await gitManager.isGitRepo();
      assert.strictEqual(isRepo, true);
    });

    test('creates isolated agent worktree and branches', async () => {
      const agentId = 'coder_test_99';
      const wtInfo = await gitManager.createWorktree(agentId);

      assert.strictEqual(wtInfo.branch, `agent/${agentId}`);
      assert.strictEqual(fs.existsSync(wtInfo.worktreePath), true);

      // Verify worktree list includes it
      const list = await gitManager.listWorktrees();
      assert.ok(list.some((w) => w.branch === `agent/${agentId}`));
    });

    test('creates micro-commit for file changes in worktree', async () => {
      const agentId = 'coder_test_99';
      const wtPath = path.join(gitDir, '.nomin', 'worktrees', agentId);
      fs.writeFileSync(path.join(wtPath, 'feat.txt'), 'Feature implementation\n', 'utf-8');

      const commitRes = await gitManager.createMicroCommit(wtPath, 'feat(coder): implement micro feature');
      assert.strictEqual(commitRes.success, true);
      assert.ok(commitRes.commitHash);
      assert.strictEqual(commitRes.changedFiles.includes('feat.txt'), true);
    });

    test('cleans up worktree safely', async () => {
      const agentId = 'coder_test_99';
      const cleanup = await gitManager.cleanupWorktree(agentId, true);
      assert.strictEqual(cleanup.success, true);

      const list = await gitManager.listWorktrees();
      assert.ok(!list.some((w) => w.branch === `agent/${agentId}`));
    });
  });
});
