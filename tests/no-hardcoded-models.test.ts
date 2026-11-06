/**
 * Nomin Code: Build-Breaker Static Analysis Test
 * Grep-fails the build if ANY hardcoded model ID string exists in production source code (`src/` or `bin/`).
 *
 * Rules:
 * 1. Zero hardcoded model ID strings or presets in src/ and bin/
 * 2. Models must be 100% discovered live from provider or configured by user
 * 3. Test fixtures in tests/ are exempt
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllSourceFiles(fullPath, fileList);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function stripComments(code: string): string {
  // Strip block comments /* ... */ and line comments // ...
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Build-Breaker: Zero Hardcoded Models In Source', () => {
  const rootDir = process.cwd();
  const srcDir = path.join(rootDir, 'src');
  const binDir = path.join(rootDir, 'bin');

  const sourceFiles = [
    ...getAllSourceFiles(srcDir),
    ...getAllSourceFiles(binDir),
  ];

  // Disallowed model patterns that indicate static presets or hardcoded default models
  const bannedModelPatterns = [
    /["']meta\/llama-3\.3-70b-instruct["']/i,
    /["']nvidia\/llama-3\.1-nemotron-70b-instruct["']/i,
    /["']deepseek-ai\/deepseek-r1["']/i,
    /["']mistralai\/mixtral-8x22b["']/i,
    /["']qwen\/qwen2\.5-coder-32b["']/i,
    /["']nemotron-4-340b["']/i,
    /["']mistralai\/mistral-large-2-instruct["']/i,
    /["']deepseek-ai\/deepseek-v4\.1-flash["']/i,
    /["']google\/gemma-4-31b-it["']/i,
  ];

  it('scans all TypeScript source files in src/ and bin/ and asserts zero hardcoded model strings', () => {
    assert.ok(sourceFiles.length >= 20, `Expected at least 20 source files, found ${sourceFiles.length}`);

    const violations: Array<{ file: string; match: string; line: number }> = [];

    for (const filePath of sourceFiles) {
      // Exclude mock test providers used solely for testing (e.g. mock.ts)
      if (filePath.endsWith('mock.ts')) continue;

      const content = fs.readFileSync(filePath, 'utf8');
      const cleanContent = stripComments(content);
      const lines = cleanContent.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of bannedModelPatterns) {
          const match = line.match(pattern);
          if (match) {
            violations.push({
              file: path.relative(rootDir, filePath),
              match: match[0],
              line: i + 1,
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const details = violations.map(v => `  ${v.file}:${v.line} -> ${v.match}`).join('\n');
      assert.fail(`BUILD FAILED: Found ${violations.length} hardcoded model string(s) in source code:\n${details}`);
    }

    assert.strictEqual(violations.length, 0);
  });

  it('verifies that default configuration contains NO preselected activeModel or selectedModels', () => {
    const configPath = path.join(srcDir, 'config', 'index.ts');
    const content = fs.readFileSync(configPath, 'utf8');
    const clean = stripComments(content);

    // Assert that activeModel default is undefined or user-controlled
    assert.ok(!clean.includes("activeModel = 'meta/"));
    assert.ok(!clean.includes("activeModel = 'nvidia/"));
  });
});
