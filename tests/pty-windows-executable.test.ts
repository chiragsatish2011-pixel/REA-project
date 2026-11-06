/**
 * @file pty-windows-executable.test.ts
 * @description Phase G.c Windows CLI Executable PTY Test.
 * 
 * Spawns the real bin/nomin.ts binary via child_process on Windows.
 * Interacts via stdin/stdout:
 *  - Tests /version (outputs build stamp)
 *  - Tests /stats (outputs gateway telemetry, calls in 60s, queue depths)
 *  - Tests /rpm (views and sets RPM limit)
 *  - Tests clean exit
 */

import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { BuildStampEngine } from '../src/config/build-stamp.js';

test('Phase G.c: Windows CLI Executable PTY Interaction Test', async (t) => {
  const buildStamp = BuildStampEngine.formatOneLine();
  console.log(`\n[Build Stamp: ${buildStamp}] Starting Phase G.c Windows CLI PTY Test...\n`);

  await t.test('1. bin/nomin.ts responds interactively to /version, /stats, /rpm, and exits cleanly', async () => {
    const entryPath = path.resolve(process.cwd(), 'bin', 'nomin.ts');

    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;

    const proc = spawn(
      process.execPath,
      ['--import', 'tsx', entryPath],
      {
        cwd: process.cwd(),
        env: {
          ...childEnv,
          NODE_ENV: 'test',
          TERM: 'xterm-256color',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    // Wait for REPL banner and initial prompt
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Send /version
    proc.stdin.write('/version\n');
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Send /stats
    proc.stdin.write('/stats\n');
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Send /rpm
    proc.stdin.write('/rpm\n');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send /rpm 45
    proc.stdin.write('/rpm 45\n');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send /exit
    proc.stdin.write('/exit\n');

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('close', (code) => resolve(code));
    });

    assert.strictEqual(exitCode, 0, `Process must exit with 0, got ${exitCode}. Stderr: ${stderr}`);

    // Assert stdout received outputs
    assert.ok(stdout.includes('Nomin Code') || stdout.includes('Build Stamp') || stdout.includes('v1.0.0'), 'Banner or version must be present');
    assert.ok(stdout.includes('Gateway & Rate Limit Telemetry') || stdout.includes('Rate Limit'), '/stats must output telemetry');
    assert.ok(stdout.includes('RPM limit') || stdout.includes('req/min'), '/rpm must output RPM details');
    assert.ok(stdout.includes('45 req/min') || stdout.includes('updated to 45'), '/rpm 45 must update limit');
  });
});
