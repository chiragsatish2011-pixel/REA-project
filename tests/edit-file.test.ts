/**
 * Unit tests for Nomin Code Edit File Tool: Multi-tier Fuzzy Matching & Levenshtein Recovery
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  SearchReplaceEngine,
  calculateLevenshteinDistance,
  calculateSimilarityRatio,
  parseSearchReplaceBlocks,
  EditFileTool,
} from '../src/tools/edit-file.js';

describe('Levenshtein Distance & Similarity Ratio', () => {
  it('computes exact distance for identical and completely different strings', () => {
    assert.strictEqual(calculateLevenshteinDistance('hello', 'hello'), 0);
    assert.strictEqual(calculateLevenshteinDistance('kitten', 'sitting'), 3);
    assert.strictEqual(calculateSimilarityRatio('identical', 'identical'), 1.0);
  });

  it('computes similarity ratio between 0 and 1', () => {
    const ratio = calculateSimilarityRatio('function calculateSum(a, b)', 'function calculateTotal(a, b)');
    assert.ok(ratio > 0.7 && ratio < 1.0, `Ratio ${ratio} should be > 0.7`);
  });
});

describe('SearchReplaceEngine Multi-Tier Matching', () => {
  const engine = new SearchReplaceEngine();

  it('Tier 1: Performs exact search and replace', () => {
    const original = 'const x = 10;\nconst y = 20;\nconst z = x + y;\n';
    const search = 'const y = 20;';
    const replace = 'const y = 50;';

    const result = engine.matchAndReplace(original, search, replace);
    assert.strictEqual(result.stats.tierUsed, 1);
    assert.ok(result.updatedContent.includes('const y = 50;'));
    assert.ok(!result.updatedContent.includes('const y = 20;'));
  });

  it('Tier 2: Matches and preserves indentation when whitespace differs', () => {
    const original = 'function test() {\n    const a = 1;\n    const b = 2;\n    return a + b;\n}';
    // Search block with tabs or different indentation
    const search = '  const a = 1;\n  const b = 2;';
    const replace = '  const a = 100;\n  const b = 200;';

    const result = engine.matchAndReplace(original, search, replace);
    assert.strictEqual(result.stats.tierUsed, 2);
    assert.ok(result.updatedContent.includes('const a = 100;'));
    assert.ok(result.updatedContent.includes('const b = 200;'));
  });

  it('Tier 3: Matches when blank lines are absent or inserted in target', () => {
    const original = 'const alpha = 1;\n\n\nconst beta = 2;\nconst gamma = 3;';
    const search = 'const alpha = 1;\nconst beta = 2;';
    const replace = 'const alpha = 10;\nconst beta = 20;';

    const result = engine.matchAndReplace(original, search, replace);
    assert.strictEqual(result.stats.tierUsed, 3);
    assert.ok(result.updatedContent.includes('const alpha = 10;'));
    assert.ok(result.updatedContent.includes('const beta = 20;'));
  });

  it('Tier 4: Recovers via Levenshtein sliding window when minor typos occur', () => {
    const original = 'function authenticateUser(username, passHash) {\n  if (!username) return false;\n  return verify(passHash);\n}';
    // Search block with slightly different variable name or typo
    const search = 'function authenticateUser(userName, passHash) {\n  if (!userName) return false;\n  return verify(passHash);\n}';
    const replace = 'function authenticateUser(username, passHash) {\n  if (!username || !passHash) return false;\n  return verify(passHash);\n}';

    const result = engine.matchAndReplace(original, search, replace);
    assert.strictEqual(result.stats.tierUsed, 4);
    assert.ok(result.updatedContent.includes('!username || !passHash'));
  });

  it('Throws descriptive error when search block cannot be matched across any tier', () => {
    const original = 'console.log("hello world");';
    const search = 'completely nonexistent block of code';
    const replace = 'replacement';

    assert.throws(() => {
      engine.matchAndReplace(original, search, replace);
    }, /Failed to match search block in file across all 4 tiers/);
  });
});

describe('Aider Search/Replace Block Parsing', () => {
  it('parses <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks', () => {
    const patch = `
Some intro text
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
Some outro text
`;
    const blocks = parseSearchReplaceBlocks(patch);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].search.trim(), 'const a = 1;');
    assert.strictEqual(blocks[0].replace.trim(), 'const a = 2;');
  });
});
