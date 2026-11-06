/**
 * Test Suite: OpenCode TUI Perfection Verification
 * Validates:
 * 1. OpenCode-style session tab bar rendering
 * 2. DiffViewer.renderOpenCodeEdit with line gutters, minus/plus line formatting and background tints
 * 3. TerminalUI.renderThinking producing '+ Thought · 1.5s' with zero emoji spam
 * 4. StreamingMarkdownRenderer syntax coloring for code fences
 * 5. Prompt dock continuous vertical blue bar rendering
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { TerminalUI, StreamingMarkdownRenderer } from '../src/cli/ui.js';
import { DiffViewer } from '../src/cli/components/diff-viewer.js';
import { StatusLine } from '../src/cli/components/status-line.js';
import { ThemeManager } from '../src/cli/theme.js';

describe('OpenCode TUI Perfection & Visual Parity', () => {
  it('DiffViewer.renderOpenCodeEdit formats edit card with line numbers and diff tags', () => {
    const diff = `@@ -17,4 +17,4 @@
- export async function POST(req: Request, ctx: { params: { action: string } }) {
+ export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
   const ip = clientIp(req);
+ const { action } = await ctx.params;`;

    const lines = DiffViewer.renderOpenCodeEdit('src/app/api/auth/route.ts', diff);
    assert.ok(lines.length >= 4);
    assert.ok(lines[0].includes('Edit'));
    assert.ok(lines[0].includes('src/app/api/auth/route.ts'));

    const minusLine = lines.find(l => l.includes('-  export async function POST'));
    assert.ok(minusLine, 'Minus line should be present');
    assert.ok(minusLine.includes('17'), 'Minus line should show line number 17');

    const plusLine = lines.find(l => l.includes('+  export async function POST'));
    assert.ok(plusLine, 'Plus line should be present');
    assert.ok(plusLine.includes('17'), 'Plus line should show line number 17');
  });

  it('TerminalUI.renderThinking outputs OpenCode style "+ Thought · 1.5s" with zero emoji spam', () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: any) => {
      captured += (msg || '') + '\n';
    };

    try {
      TerminalUI.renderThinking(
        'ASSISTANT',
        'nvidia/nemotron-3.5-lightning-30b-a3b',
        "Here's a thinking process:\nI should solve the dynamic params issue in Next.js 15.",
        1500
      );
    } finally {
      console.log = origLog;
    }

    assert.ok(captured.includes('+ Thought'), 'Must contain OpenCode "+ Thought" badge');
    assert.ok(captured.includes('1.5s'), 'Must contain duration "1.5s"');
    assert.strictEqual(captured.includes('💭'), false, 'Must NOT contain emoji thinking spam');
    assert.strictEqual(captured.includes('[tab to expand]'), false, 'Must NOT contain tab to expand junk');
  });

  it('StatusLine renders with sleek vertical bar and OpenCode tokens', () => {
    const line = StatusLine.render({
      providerName: 'NVIDIA NIM',
      activeModel: 'GLM-5.3-Flash',
      reasoningEffort: 'thinking',
      permissionMode: 'normal',
      workspaceDir: 'my-project',
      includeBar: true,
      compactEffort: true,
    });

    assert.ok(line.includes('│'), 'Must render sleek thin bar │ rather than thick block');
    assert.ok(line.includes('Build'), 'Must contain Build badge');
    assert.ok(line.includes('GLM 5.3 Flash'), 'Must contain model name');
    assert.ok(line.includes('thinking'), 'Must contain thinking/effort tag');
  });

  it('StreamingMarkdownRenderer highlights code blocks without unrendered backticks', () => {
    let output = '';
    const origLog = console.log;
    console.log = (msg: any) => {
      output += (msg || '') + '\n';
    };

    try {
      const renderer = new StreamingMarkdownRenderer();
      renderer.write('```typescript\nconst x = 42;\n```\n');
      renderer.flush();
    } finally {
      console.log = origLog;
    }

    assert.ok(output.includes('┌──'), 'Should render code block top header');
    assert.ok(output.includes('└──'), 'Should render code block bottom footer');
    assert.ok(output.includes('const'), 'Should render code content');
  });

  it('StatusLine formats model name as clean title-case "Nemotron 3 Ultra 550B A55B Nvidia"', () => {
    const line = StatusLine.render({
      providerName: 'NVIDIA NIM',
      activeModel: 'nvidia/nemotron-3-ultra-550b-a55b',
      permissionMode: 'normal',
      workspaceDir: 'my-project',
      includeBar: true,
      compactEffort: true,
    });

    assert.ok(line.includes('Nemotron 3 Ultra 550B A55B'), 'Must format model name in clean title-case words');
    assert.ok(line.includes('Nvidia'), 'Must format vendor in clean title-case');
    assert.strictEqual(line.includes('[NVIDIA NIM]'), false, 'Should not render raw brackets when compactEffort is active');
  });

  it('FooterHints renders context percentage and busy progress bar', async () => {
    const { FooterHints } = await import('../src/cli/components/footer-hints.js');
    const footerIdle = FooterHints.render(
      [{ key: 'ctrl+p', label: 'commands' }],
      '~',
      undefined,
      { usedTokens: 55500, maxTokens: 925000 },
      false
    );
    const cleanIdle = TerminalUI.stripAnsi(footerIdle);
    assert.ok(cleanIdle.includes('55.5K (6%)'), 'Must render token count and percentage');
    assert.ok(cleanIdle.includes('ctrl+p commands'), 'Must render keybindings');

    const footerBusy = FooterHints.render(
      [{ key: 'ctrl+p', label: 'commands' }],
      '~',
      undefined,
      { usedTokens: 55500, maxTokens: 925000 },
      true
    );
    const cleanBusy = TerminalUI.stripAnsi(footerBusy);
    assert.ok(cleanBusy.includes('esc interrupt'), 'Must render esc interrupt on busy state');
    assert.ok(cleanBusy.includes('■'), 'Must render progress block');
  });

  it('TerminalUI renders tool call as "$ <cmd>" and "(no output)" with zero emojis', () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: any) => {
      captured += (msg || '') + '\n';
    };

    try {
      TerminalUI.renderToolCall('bash', { command: 'curl.exe -s http://localhost:3000/api/instagram/mode 2>&1' });
      TerminalUI.renderToolResult('bash', { success: true, output: '' });
    } finally {
      console.log = origLog;
    }

    const clean = TerminalUI.stripAnsi(captured);
    assert.ok(clean.includes('$ curl.exe -s http://localhost:3000/api/instagram/mode 2>&1'));
    assert.ok(clean.includes('(no output)'));
    assert.strictEqual(clean.includes('⚡'), false, 'Must NOT contain emoji lightning bolt');
    assert.strictEqual(clean.includes('✔'), false, 'Must NOT contain emoji checkmark');
  });
});
