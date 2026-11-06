/**
 * Test Suite: Claude Code & OpenCode TUI Engine Verification
 * Verifies that all TUI components render cleanly without exceptions,
 * strip ANSI codes accurately, format markdown tokens, and produce expected output.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { TerminalUI, ANSI } from '../src/cli/ui.js';

describe('Claude Code & OpenCode TUI Engine', () => {
  it('stripAnsi removes ANSI escape codes accurately', () => {
    const raw = `${ANSI.bold}${ANSI.amber}◈ NOMIN CODE${ANSI.reset} ${ANSI.slate}v1.0.0${ANSI.reset}`;
    const clean = TerminalUI.stripAnsi(raw);
    assert.strictEqual(clean, '◈ NOMIN CODE v1.0.0');
  });

  it('wrapText wraps text respecting maxWidth without breaking ANSI or words', () => {
    const text = 'Decomposing user objective into topological dependency DAG with acceptance criteria.';
    const wrapped = TerminalUI.wrapText(text, 30);
    assert.ok(wrapped.length > 1);
    for (const line of wrapped) {
      assert.ok(TerminalUI.stripAnsi(line).length <= 30);
    }
  });

  it('truncate adds trailing ellipsis when text exceeds length', () => {
    const shortText = 'short text';
    assert.strictEqual(TerminalUI.truncate(shortText, 20), shortText);

    const longText = 'A very long string that will definitely exceed the limit';
    const truncated = TerminalUI.truncate(longText, 15);
    assert.strictEqual(truncated.endsWith('…'), true);
  });

  it('printBootSequence runs cleanly without throwing', () => {
    assert.doesNotThrow(() => {
      TerminalUI.printBootSequence({
        version: '1.0.0',
        providerName: 'NVIDIA NIM',
        providerUrl: 'https://integrate.api.nvidia.com/v1',
        workdir: 'C:\\projects\\my-app',
        gitBranch: 'main',
        mode: 'solo',
        activeModel: 'meta/llama-3.3-70b-instruct',
        rpmLimit: 120,
        tpmLimit: 300000,
        concurrency: 4,
      });
    });
  });

  it('renderThinking formats reasoning blocks cleanly', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderThinking(
        'ARCHITECT',
        'deepseek-r1',
        '1. Analyze requirements\n2. Extract criteria\n3. Verify DAG',
        1200
      );
    });
  });

  it('renderToolCall and renderToolResult format tool actions', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderToolCall('bash', { command: 'npm test' }, 'Running test suite');
      TerminalUI.renderToolResult('bash', {
        success: true,
        output: '168 tests passed (12.4s)',
        durationMs: 12400,
        exitCode: 0,
      });
    });
  });

  it('renderFileRead and renderFileEdit render syntax cards', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderFileRead('src/cli/ui.ts', { start: 1, end: 10, total: 200 }, 'import * as os from "node:os";\nconst x = 1;');
      TerminalUI.renderFileEdit('src/cli/ui.ts', '@@ -1,2 +1,3 @@\n- old\n+ new\n  context', { added: 1, removed: 1 });
    });
  });

  it('renderSearch formats search matches cleanly', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderSearch('TerminalUI', 14, 4, [
        'src/cli/ui.ts:65: export class TerminalUI',
        'src/cli/repl.ts:10: import { TerminalUI } from "./ui.js"',
      ]);
    });
  });

  it('renderDiff formats unified diff with colors and header', () => {
    const sampleDiff = `--- a/src/index.ts
+++ b/src/index.ts
@@ -10,3 +10,4 @@
 export * from './types.js';
+export * from './cli/ui.js';
 export * from './tools/index.js';`;

    assert.doesNotThrow(() => {
      TerminalUI.renderDiff(sampleDiff, 'src/index.ts');
    });
  });

  it('renderMarkdown parses headers, lists, code fences, and inline formatting', () => {
    const md = `# Title
## Subtitle
### Section
> This is a blockquote

- List item 1 with \`code\`
- List item 2 with **bold** text
1. Step one
2. Step two

\`\`\`typescript
const a = 1;
\`\`\`
---`;

    assert.doesNotThrow(() => {
      TerminalUI.renderMarkdown(md);
    });
  });

  it('renderCostSummary displays session token metrics and spend', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderCostSummary({
        promptTokens: 14200,
        completionTokens: 2450,
        cachedTokens: 8900,
        totalTokens: 16650,
        estimatedCostUsd: 0.0092,
        turnsCount: 3,
      });
    });
  });

  it('renderSwarmDashboard renders task DAG and isolated worktrees', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderSwarmDashboard({
        tasks: [
          { id: 'T-01', title: 'Core Implementation', status: 'VERIFIED', assignedRole: 'Coder' },
          { id: 'T-02', title: 'Adversarial Test Suite', status: 'IN_PROGRESS', assignedRole: 'Tester' },
        ],
        activeWorktrees: ['.nomin/worktrees/wt-T-01-coder', '.nomin/worktrees/wt-T-02-tester'],
      });
    });
  });

  it('renderCommandCatalog displays all slash commands categorized', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderCommandCatalog();
    });
  });

  it('renderDoctor renders system checks with status indicators', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderDoctor([
        { name: 'Node.js Runtime', status: 'ok', detail: 'v24.21.0' },
        { name: 'Git Version Control', status: 'ok', detail: 'git version 2.54.0' },
        { name: 'Workspace Filesystem', status: 'ok', detail: 'Read-Write Permitted' },
      ]);
    });
  });

  it('renderVerdictCard renders passing and failing DoD gates with details', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderVerdictCard(true, 'All criteria verified.', 4, 4, [
        'npm run build exit code 0',
        'npm test passed 168 tests',
      ]);

      TerminalUI.renderVerdictCard(false, 'AST violation: placeholder found.', 0, 0, [
        'Found TODO in src/auth.ts:42',
      ]);
    });
  });

  it('renderCommandPopup returns full list on "/" and formats items with category and cursor', () => {
    const res = TerminalUI.renderCommandPopup({ query: '/', print: false });
    assert.ok(res.filtered.length >= 15);
    assert.strictEqual(res.selected?.name, '/help');
    assert.ok(res.lines.some(l => l.includes('Slash Commands')));
    assert.ok(res.lines.some(l => l.includes('❯')));
    assert.ok(res.lines.some(l => l.includes('[Core]')));
    assert.ok(res.lines.some(l => l.includes('[Provider & Models]')));
  });

  it('renderCommandPopup filters correctly on "/p" and "/m"', () => {
    const resP = TerminalUI.renderCommandPopup({ query: '/p', print: false });
    assert.ok(resP.filtered.length > 0);
    assert.ok(resP.filtered.every(c => c.name.includes('p') || c.description.toLowerCase().includes('p')));
    assert.ok(resP.selected?.name === '/plan' || resP.selected?.name === '/provider');

    const resM = TerminalUI.renderCommandPopup({ query: '/m', print: false });
    assert.ok(resM.filtered.length >= 2);
    assert.ok(resM.filtered.some(c => c.name === '/models'));
    assert.ok(resM.filtered.some(c => c.name === '/mode'));
  });

  it('renderCommandPopup handles non-matching queries gracefully', () => {
    const res = TerminalUI.renderCommandPopup({ query: '/nonexistentxyz', print: false });
    assert.strictEqual(res.filtered.length, 0);
    assert.strictEqual(res.selected, undefined);
    assert.ok(res.lines.some(l => l.includes('No matching commands')));
  });

  it('renderProviderManagerCard displays active provider, masked key, and presets', () => {
    assert.doesNotThrow(() => {
      TerminalUI.renderProviderManagerCard({
        activeProvider: {
          id: 'nim',
          name: 'NVIDIA NIM',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          apiKey: 'nvapi-secret-key-12345678',
          defaultRpm: 30,
          defaultTpm: 60000,
          defaultConcurrency: 4,
        },
        providers: {},
        statusMessage: '✔ Connected to provider',
      });
    });
  });

  it('renderModelManagerCard renders solo and team swarm role mappings', () => {
    assert.doesNotThrow(() => {
      // Solo mode
      TerminalUI.renderModelManagerCard({
        mode: 'solo',
        activeModel: 'meta/llama-3.3-70b-instruct',
        roles: {},
        selectedModels: ['meta/llama-3.3-70b-instruct'],
        popularPresets: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1'],
        providerName: 'NVIDIA NIM',
      });

      // Team mode
      TerminalUI.renderModelManagerCard({
        mode: 'team',
        activeModel: 'meta/llama-3.3-70b-instruct',
        roles: {
          architect: 'deepseek-ai/deepseek-r1',
          coder: 'qwen/qwen2.5-coder-32b-instruct',
          tester: 'meta/llama-3.3-70b-instruct',
          verifier: 'meta/llama-3.3-70b-instruct',
        },
        selectedModels: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1'],
        popularPresets: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1'],
        providerName: 'NVIDIA NIM',
      });
    });
  });

  it('ThemeManager defaults to Aurora theme and supports switching', async () => {
    const { ThemeManager } = await import('../src/cli/theme.js');
    assert.strictEqual(ThemeManager.getThemeName(), 'aurora');
    const colors = ThemeManager.getColors();
    assert.strictEqual(colors.accent, '\x1b[38;5;45m'); // Electric polar cyan
    assert.strictEqual(colors.success, '\x1b[38;5;49m'); // Mint emerald

    ThemeManager.setTheme('dark');
    assert.strictEqual(ThemeManager.getThemeName(), 'dark');

    ThemeManager.setTheme('aurora');
    assert.strictEqual(ThemeManager.getThemeName(), 'aurora');
  });

  it('RawInputReader parses word-deletion and navigation keystrokes', async () => {
    const { RawInputReader } = await import('../src/cli/raw-input.js');
    const ctrlW = RawInputReader.parse(Buffer.from('\x17'));
    assert.strictEqual(ctrlW[0].name, 'ctrl-w');

    const ctrlU = RawInputReader.parse(Buffer.from('\x15'));
    assert.strictEqual(ctrlU[0].name, 'ctrl-u');

    const ctrlK = RawInputReader.parse(Buffer.from('\x0b'));
    assert.strictEqual(ctrlK[0].name, 'ctrl-k');

    const home = RawInputReader.parse(Buffer.from('\x1b[H'));
    assert.strictEqual(home[0].name, 'home');

    const end = RawInputReader.parse(Buffer.from('\x1b[F'));
    assert.strictEqual(end[0].name, 'end');

    const del = RawInputReader.parse(Buffer.from('\x1b[3~'));
    assert.strictEqual(del[0].name, 'delete');
  });
});
