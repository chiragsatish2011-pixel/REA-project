/**
 * Screen Snapshot Generator for Nomin Code UI Redesign
 * Renders the 12 required UI states and saves them to docs/screens/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ThemeManager } from '../src/cli/theme.js';
import { TerminalUI, ANSI } from '../src/cli/ui.js';
import { StatusLine } from '../src/cli/components/status-line.js';
import { FooterHints } from '../src/cli/components/footer-hints.js';
import { InlineSlider } from '../src/cli/components/slider.js';
import { ModelPicker } from '../src/cli/model-picker.js';
import { SlashMenu } from '../src/cli/slash-menu.js';
import { ConfirmDialog } from '../src/cli/components/confirm-dialog.js';
import { TimelineViewer } from '../src/cli/components/timeline-viewer.js';
import { DiffViewer } from '../src/cli/components/diff-viewer.js';
import { TeamView } from '../src/cli/team-view.js';
import type { DiscoveredModel } from '../src/provider/types.js';

const screensDir = path.resolve('docs/screens');
if (!fs.existsSync(screensDir)) {
  fs.mkdirSync(screensDir, { recursive: true });
}

function saveScreen(filename: string, lines: string[]) {
  const content = lines.join('\n');
  const txtPath = path.join(screensDir, filename);
  fs.writeFileSync(txtPath, content, 'utf-8');
  console.log(`Saved snapshot: ${filename}`);
}

// 1. First Run
{
  const lines: string[] = [
    '',
    `  ${ANSI.bold}${ANSI.amber}◈ NOMIN CODE${ANSI.reset}  ${ANSI.slate}v1.0.0${ANSI.reset}  ${ANSI.dim}— Model-Agnostic Autonomous Swarm${ANSI.reset}`,
    `  ${ANSI.slate}Workspace:${ANSI.reset} C:\\projects\\my-app (main)  ${ANSI.darkSlate}·${ANSI.reset}  ${ANSI.slate}Provider:${ANSI.reset} NVIDIA NIM`,
    `  ${ANSI.slate}Model:${ANSI.reset} ${ANSI.sky}meta/llama-3.3-70b-instruct${ANSI.reset}  ${ANSI.darkSlate}·${ANSI.reset}  ${ANSI.slate}Effort:${ANSI.reset} ${ANSI.mint}MEDIUM${ANSI.reset}  ${ANSI.darkSlate}·${ANSI.reset}  ${ANSI.slate}Mode:${ANSI.reset} SOLO`,
    '',
    StatusLine.render({
      providerName: 'NIM',
      activeModel: 'meta/llama-3.3-70b-instruct',
      reasoningEffort: 'medium',
      permissionMode: 'normal',
      workspaceDir: 'C:\\projects\\my-app',
      gitBranch: 'main',
      rpmLimit: 120,
    }),
    FooterHints.render([
      { key: '/', label: 'commands' },
      { key: '@', label: 'mention file' },
      { key: '!', label: 'shell' },
      { key: '^R', label: 'history' },
      { key: 'shift+tab', label: 'normal mode' },
      { key: 'esc', label: 'interrupt' },
    ]),
    `  ${ANSI.amber}❯${ANSI.reset} `,
  ];
  saveScreen('01-first-run.txt', lines);
}

// 2. Model Picker
{
  const models: DiscoveredModel[] = [
    { id: 'meta/llama-3.3-70b-instruct', publisher: 'meta', modelType: 'chat', contextLength: 128000, supportsTools: true, supportsReasoning: false, isAlive: true },
    { id: 'deepseek-ai/deepseek-r1', publisher: 'deepseek-ai', modelType: 'chat', contextLength: 128000, supportsTools: true, supportsReasoning: true, isAlive: true },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', publisher: 'nvidia', modelType: 'chat', contextLength: 128000, supportsTools: true, supportsReasoning: true, isAlive: true },
    { id: 'qwen/qwen2.5-coder-32b-instruct', publisher: 'qwen', modelType: 'chat', contextLength: 32768, supportsTools: true, supportsReasoning: false, isAlive: true },
    { id: 'mistralai/codestral-22b-instruct-v0.1', publisher: 'mistralai', modelType: 'chat', contextLength: 32768, supportsTools: true, supportsReasoning: false, isAlive: true },
    { id: 'google/gemma-4-31b-it', publisher: 'google', modelType: 'chat', contextLength: 128000, supportsTools: true, supportsReasoning: true, isAlive: true },
    { id: 'meta/llama-3.2-90b-vision-instruct', publisher: 'meta', modelType: 'chat', contextLength: 128000, supportsTools: true, supportsReasoning: false, supportsVision: true, isAlive: true },
    { id: 'nvidia/cosmos-reason2-8b', publisher: 'nvidia', modelType: 'chat', contextLength: 32768, supportsTools: true, supportsReasoning: true, isAlive: true },
  ];

  const picker = new ModelPicker({
    models,
    providerName: 'NVIDIA NIM',
    activeModel: 'meta/llama-3.3-70b-instruct',
    favorites: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1'],
  });

  saveScreen('02-model-picker.txt', picker.render());
}

// 3. Effort Step
{
  const slider = new InlineSlider({
    title: 'Configure Reasoning Effort & Thinking Budget (meta/llama-3.3-70b-instruct):',
    options: [
      { label: 'off', value: 'off', description: 'Zero reasoning tokens (minimal latency/cost)' },
      { label: 'low', value: 'low', description: 'Budget: 1,024 tokens for quick fixes' },
      { label: 'medium', value: 'medium', description: 'Budget: 2,048 tokens (balanced, recommended)' },
      { label: 'high', value: 'high', description: 'Budget: 4,096 tokens (deep reasoning)' },
      { label: 'max', value: 'max', description: 'Budget: 8,192 tokens (maximum depth for complex DoD)' },
    ],
    initialIndex: 2,
  });
  saveScreen('03-effort-step.txt', slider.render());
}

// 4. Slash Menu
{
  const menu = new SlashMenu('m');
  saveScreen('04-slash-menu.txt', menu.render());
}

// 5. Main Chat Streaming
{
  const lines: string[] = [
    StatusLine.render({
      providerName: 'NIM',
      activeModel: 'meta/llama-3.3-70b-instruct',
      reasoningEffort: 'medium',
      permissionMode: 'normal',
      workspaceDir: 'C:\\projects\\my-app',
      gitBranch: 'main',
      totalTokens: 14200,
      estimatedCostUsd: 0.0071,
    }),
    '',
    `  ${ANSI.amber}❯${ANSI.reset} Explain how the verifier gate prevents AST regression`,
    '',
    `  ${ANSI.lavender}💭 Thinking (ASSISTANT · meta/llama-3.3-70b-instruct · 1.4s)${ANSI.reset}  ${ANSI.dim}[tab to expand]${ANSI.reset}`,
    `    ${ANSI.dim}${ANSI.slate}The DoD Verifier Gate runs in an isolated fresh context without historical turn pollution...${ANSI.reset}`,
    '',
    `  ${ANSI.bold}${ANSI.brightCyan}Nomin${ANSI.reset} The fresh-context Verifier Gate operates as an adversarial sanity inspector:`,
    '',
    `  1. It inspects unified diffs generated by the Coder agent in the worktree.`,
    `  2. It executes real compiler/linter commands (e.g. \`tsc --noEmit\`, \`npm test\`).`,
    `  3. If AST integrity violations or unverified stubs exist, the gate issues a hard block.`,
    `  4. Only physical evidence logs unlock the release gate${ANSI.amber}▋${ANSI.reset}`,
  ];
  saveScreen('05-main-chat-streaming.txt', lines);
}

// 6. Tool Call Collapsed
{
  const lines: string[] = [
    `  ${ANSI.amber}⚡ bash${ANSI.reset} ${ANSI.sky}npm test${ANSI.reset}  ${ANSI.dim}(Running test suite)${ANSI.reset}`,
    `    ${ANSI.mint}✔${ANSI.reset} ${ANSI.slate}bash${ANSI.reset}  ${ANSI.dim}(14.20s)${ANSI.reset}  279 tests passed (14.2s)`,
    '',
    `  ${ANSI.amber}⚡ edit_file${ANSI.reset} ${ANSI.sky}src/auth/vault.ts${ANSI.reset}`,
    `    ${ANSI.mint}✔${ANSI.reset} ${ANSI.slate}edit_file${ANSI.reset}  ${ANSI.dim}(0.04s)${ANSI.reset}  +14 -2 lines replaced`,
  ];
  saveScreen('06-tool-call-collapsed.txt', lines);
}

// 7. Tool Call Expanded
{
  const lines: string[] = [
    `  ${ANSI.amber}⚡ Bash Execution (Expanded)${ANSI.reset}  ${ANSI.dim}[tab to collapse]${ANSI.reset}`,
    `    ${ANSI.slate}Command:${ANSI.reset}   npm test -- tests/auth-keychain.test.ts`,
    `    ${ANSI.slate}Workdir:${ANSI.reset}   C:\\projects\\my-app`,
    `    ${ANSI.slate}Duration:${ANSI.reset}  1.42s · Exit Code: 0`,
    `    ${ANSI.darkSlate}┌── Output ────────────────────────────────────────┐${ANSI.reset}`,
    `    ${ANSI.darkSlate}│${ANSI.reset}  ✔ encrypts and decrypts credentials losslessly   ${ANSI.darkSlate}│${ANSI.reset}`,
    `    ${ANSI.darkSlate}│${ANSI.reset}  ✔ rejects tampered or corrupted ciphertext       ${ANSI.darkSlate}│${ANSI.reset}`,
    `    ${ANSI.darkSlate}│${ANSI.reset}  ✔ stores, retrieves, and persists multiple keys  ${ANSI.darkSlate}│${ANSI.reset}`,
    `    ${ANSI.darkSlate}│${ANSI.reset}  ℹ tests 18 · pass 18 · fail 0                    ${ANSI.darkSlate}│${ANSI.reset}`,
    `    ${ANSI.darkSlate}└─── All test assertions passed ───────────────────┘${ANSI.reset}`,
  ];
  saveScreen('07-tool-call-expanded.txt', lines);
}

// 8. Diff Review
{
  const sampleDiff = `@@ -12,6 +12,8 @@
 export class AuthVault {
+  private cipherKey: Buffer;
+  private rotationCounter: number = 0;
   
   public async encrypt(secret: string): Promise<string> {
-    return Buffer.from(secret).toString('base64');
+    return VaultCipher.encryptAES256GCM(secret, this.cipherKey);
   }`;
  const lines = DiffViewer.renderUnified('src/auth/vault.ts', sampleDiff);
  saveScreen('08-diff-review.txt', lines);
}

// 9. Permission Prompt
{
  const dialog = new ConfirmDialog({
    promptText: 'Allow bash: git push origin feature/auth ?',
    detail: 'Destructive remote repository network operation requested by Coder agent',
  });
  saveScreen('09-permission-prompt.txt', dialog.render());
}

// 10. Undo Timeline
{
  const viewer = new TimelineViewer([
    { id: 'b3cd54a', title: 'Implement AES-256-GCM vault encryption', time: '1 min ago', isCurrent: true, filesChanged: 3 },
    { id: '7e12f0c', title: 'Refactor arrow-key model picker component', time: '12 mins ago', filesChanged: 5 },
    { id: '1a45d8b', title: 'Add PageRank symbol outlines to repomap', time: '45 mins ago', filesChanged: 2 },
    { id: '0f99e3a', title: 'Initial harness architecture and swarm coordinator', time: '2 hours ago', filesChanged: 8 },
  ]);
  saveScreen('10-undo-timeline.txt', viewer.render());
}

// 11. 5-Agent Team View
{
  const lines: string[] = [
    `  ${ANSI.bold}◈ SWARM TEAM COLLABORATION${ANSI.reset}  ${ANSI.dim}(5 Autonomous Agents · Shared Blackboard & Mailbox)${ANSI.reset}`,
    '',
    ...TeamView.renderRoleBar([
      { role: 'architect', model: 'deepseek-r1', state: 'idle' },
      { role: 'coder', model: 'qwen2.5-coder', state: 'running', currentTask: 'Implement AES-256 keychain rotation in isolated worktree' },
      { role: 'tester', model: 'llama-3.3-70b', state: 'waiting' },
      { role: 'reviewer', model: 'mistral-large', state: 'idle' },
      { role: 'verifier', model: 'llama-3.3-70b', state: 'waiting' },
    ], 1),
    '',
    `  ${ANSI.darkSlate}┌── Shared Swarm Feed ────────────────────────────────────────────────────────┐${ANSI.reset}`,
    `  ${ANSI.darkSlate}│${ANSI.reset}  [ARCHITECT] Task DAG published: 4 tasks with topological dependencies.    ${ANSI.darkSlate}│${ANSI.reset}`,
    `  ${ANSI.darkSlate}│${ANSI.reset}  [CODER] Worktree ⎇ wt-task-02 checked out; applying multi-tier hunk edits. ${ANSI.darkSlate}│${ANSI.reset}`,
    `  ${ANSI.darkSlate}│${ANSI.reset}  [TESTER] Preparing adversarial edge-case test suite for vault cipher.      ${ANSI.darkSlate}│${ANSI.reset}`,
    `  ${ANSI.darkSlate}│${ANSI.reset}  [VERIFIER] DoD gates initialized: tsc --noEmit, npm test, zero stubs.      ${ANSI.darkSlate}│${ANSI.reset}`,
    `  ${ANSI.darkSlate}└─────────────────────────────────────────────────────────────────────────────┘${ANSI.reset}`,
    FooterHints.render([
      { key: '1-5', label: 'focus agent' },
      { key: 'tab', label: 'cycle agents' },
      { key: 'esc', label: 'return' },
    ]),
  ];
  saveScreen('11-5-agent-team-view.txt', lines);
}

// 12. Error State
{
  const lines: string[] = [
    '',
    `  ${ANSI.coral}${ANSI.bold}✖ Model Validation Failed: meta/llama2-70b${ANSI.reset}`,
    `  ${ANSI.slate}Reason:${ANSI.reset} Upstream returned HTTP 410 Gone (Model deprecated by provider on 2026-08-26)`,
    '',
    `  ${ANSI.sky}Recommended Next Actions:${ANSI.reset}`,
    `    • Type ${ANSI.amber}/models${ANSI.reset} to choose from 85+ verified live models`,
    `    • Or select active replacement: ${ANSI.mint}meta/llama-3.3-70b-instruct${ANSI.reset}`,
    '',
    `  ${ANSI.dim}(Press Enter to open /models or Esc to dismiss)${ANSI.reset}`,
  ];
  saveScreen('12-error-state.txt', lines);
}

console.log('All 12 screen snapshots generated successfully in docs/screens/');
