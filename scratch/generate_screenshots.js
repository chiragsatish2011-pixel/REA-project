/**
 * Script to generate high-fidelity Claude Code & OpenCode style terminal captures
 * and take screenshots using headless Chrome.
 * Generates all 6 screens:
 *   - Screen 1: Boot Telemetry & Clean Claude Code Prompt Box
 *   - Screen 2: Interactive Swarm Session (Thinking, Edit, Bash, DoD Verdict)
 *   - Screen 3: Swarm Activity Dashboard & Cost Telemetry Palette
 *   - Screen 4: Interactive Slash Command Popup
 *   - Screen 5: Interactive /provider Switcher Card
 *   - Screen 6: Interactive /models Manager Card (Swarm Mode: TEAM)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const callerDir = 'C:\\Users\\A2_B2_Chirag\\.gemini\\antigravity\\brain\\742c7aff-dd38-4e75-8936-3e4e3ed6f7d2';
const targetDir = path.join(callerDir, 'screenshots');
const workspaceScreenshotsDir = 'C:\\Users\\A2_B2_Chirag\\Documents\\Opencode Reverse Engineering\\screenshots';
const scratchDir = path.join(callerDir, 'scratch');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
if (!fs.existsSync(workspaceScreenshotsDir)) fs.mkdirSync(workspaceScreenshotsDir, { recursive: true });
if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

function wrapTerminal(title, contentHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #090a0f;
    font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', 'Cascadia Code', 'Consolas', monospace;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 24px;
    min-height: 100vh;
  }
  .window {
    width: 1180px;
    background: #121318;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05);
    overflow: hidden;
  }
  .titlebar {
    background: #181920;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .traffic-lights {
    display: flex;
    gap: 8px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .dot.red { background: #ff5f56; border: 1px solid #e0443e; }
  .dot.yellow { background: #ffbd2e; border: 1px solid #dea123; }
  .dot.green { background: #27c93f; border: 1px solid #1aab29; }
  .window-title {
    flex: 1;
    text-align: center;
    color: #8b8e99;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: -0.2px;
    padding-right: 48px;
  }
  .terminal-body {
    padding: 22px 28px;
    color: #e4e6eb;
    font-size: 13.5px;
    line-height: 1.5;
    background: #101116;
  }
  .amber { color: #fba857; font-weight: 600; }
  .mint { color: #56d364; font-weight: 600; }
  .coral { color: #ff6b6b; font-weight: 600; }
  .sky { color: #58a6ff; font-weight: 600; }
  .lavender { color: #d2a8ff; font-weight: 600; }
  .gold { color: #f2cc60; font-weight: 600; }
  .slate { color: #8b949e; }
  .dim { color: #6e7681; }
  .bold { font-weight: 700; color: #ffffff; }
  .card {
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #161820;
    padding: 14px 20px;
    margin: 12px 0;
  }
  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 13.5px;
    border-bottom: 1px solid #21262d;
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  .card.thinking { border-color: #554477; background: #181524; }
  .card.thinking .card-header { color: #d2a8ff; border-color: #2e2645; }
  .card.bash { border-color: #264a7f; background: #121824; }
  .card.bash .card-header { color: #58a6ff; border-color: #1e3355; }
  .card.edit { border-color: #634320; background: #1c1813; }
  .card.edit .card-header { color: #fba857; border-color: #3b2b16; }
  .card.success { border-color: #235532; background: #121c15; }
  .card.success .card-header { color: #56d364; border-color: #1a3822; }
  .card.dashboard { border-color: #30363d; background: #14161e; }
  .card.dashboard .card-header { color: #58a6ff; border-color: #21262d; }
  .code-line { display: flex; font-family: inherit; }
  .line-num { width: 44px; color: #484f58; user-select: none; text-align: right; padding-right: 14px; }
  .diff-add { color: #56d364; background: rgba(46, 160, 67, 0.15); display: block; border-left: 3px solid #56d364; padding-left: 8px; }
  .diff-del { color: #ff7b72; background: rgba(248, 81, 73, 0.15); display: block; border-left: 3px solid #ff7b72; padding-left: 8px; }
  .diff-hunk { color: #58a6ff; background: rgba(56, 139, 253, 0.1); display: block; padding-left: 8px; }
  .prompt-box {
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #14161d;
    padding: 12px 18px;
    margin-top: 14px;
  }
  .prompt-header {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #8b949e;
    margin-bottom: 8px;
  }
  .prompt-input {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14.5px;
    color: #ffffff;
  }
  .prompt-cursor {
    display: inline-block;
    width: 9px;
    height: 18px;
    background: #fba857;
    vertical-align: middle;
  }
  .prompt-footer {
    display: flex;
    gap: 16px;
    font-size: 11.5px;
    color: #6e7681;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #21262d;
  }
  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
  }
  .pill-green { background: rgba(46, 160, 67, 0.2); color: #56d364; border: 1px solid rgba(46, 160, 67, 0.4); }
  .pill-blue { background: rgba(56, 139, 253, 0.2); color: #58a6ff; border: 1px solid rgba(56, 139, 253, 0.4); }
  .pill-amber { background: rgba(251, 168, 87, 0.2); color: #fba857; border: 1px solid rgba(251, 168, 87, 0.4); }
  .pill-lavender { background: rgba(210, 168, 255, 0.2); color: #d2a8ff; border: 1px solid rgba(210, 168, 255, 0.4); }
  .status-bar {
    display: flex;
    gap: 18px;
    padding: 8px 14px;
    background: #14161f;
    border: 1px solid #21262d;
    border-radius: 6px;
    font-size: 12px;
    color: #8b949e;
    margin-bottom: 14px;
  }
  .status-item { display: flex; align-items: center; gap: 6px; }

  /* Popup Specific CSS */
  .popup-container {
    background: #151822;
    border: 1px solid #384252;
    border-bottom: 1px solid #21262d;
    border-radius: 8px 8px 0 0;
    padding: 10px 14px;
    box-shadow: 0 -12px 30px rgba(0, 0, 0, 0.6), 0 0 1px rgba(251, 168, 87, 0.3);
  }
  .popup-header-row {
    font-size: 12px;
    color: #fba857;
    font-weight: 600;
    padding-bottom: 6px;
    margin-bottom: 6px;
    border-bottom: 1px solid #21262d;
    display: flex;
    justify-content: space-between;
  }
  .popup-row {
    display: flex;
    align-items: center;
    padding: 5px 8px;
    border-radius: 4px;
    font-size: 12.5px;
    line-height: 1.4;
    gap: 12px;
  }
  .popup-row.active {
    background: rgba(251, 168, 87, 0.16);
    border-left: 3px solid #fba857;
    padding-left: 6px;
  }
  .popup-col-name {
    width: 140px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .popup-col-desc {
    flex: 1;
    color: #8b949e;
  }
  .popup-row.active .popup-col-desc {
    color: #ffffff;
    font-weight: 500;
  }
  .popup-col-badge {
    text-align: right;
  }
  .prompt-box-attached {
    border: 1px solid #384252;
    border-top: none;
    border-radius: 0 0 8px 8px;
    background: #12141c;
    padding: 12px 18px;
  }
</style>
</head>
<body>
<div class="window">
  <div class="titlebar">
    <div class="traffic-lights">
      <div class="dot red"></div>
      <div class="dot yellow"></div>
      <div class="dot green"></div>
    </div>
    <div class="window-title">${title}</div>
  </div>
  <div class="terminal-body">
    ${contentHtml}
  </div>
</div>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// Screen 1: Boot Telemetry & Clean Claude Code Prompt Box
// -----------------------------------------------------------------------------
const screen1Content = `
  <div style="margin-bottom: 16px;">
    <div style="font-size: 18px; font-weight: 700; color: #fba857; display: flex; align-items: center; gap: 10px;">
      <span>◈ NOMIN CODE</span>
      <span style="font-size: 13px; color: #8b949e; font-weight: 400;">v1.0.0</span>
      <span style="font-size: 12px; color: #6e7681; font-weight: 400;">— Model-Agnostic Autonomous Coding Swarm</span>
    </div>
    <div style="color: #6e7681; font-size: 12.5px; margin-top: 4px;">
      NVIDIA NIM & OpenAI Compatible Endpoints · 100% User-Controlled Models
    </div>
  </div>

  <div class="card" style="border-color: #384252;">
    <div class="card-header" style="justify-content: space-between;">
      <span style="color: #58a6ff;">╭─ System Telemetry ─────────────────────────────────────────────────────────────</span>
      <span class="pill pill-blue">NVIDIA NIM LIVE</span>
    </div>
    <div style="display: grid; grid-template-columns: 140px 1fr; row-gap: 8px; font-size: 13px;">
      <div class="sky">● Provider:</div>
      <div>NVIDIA NIM <span class="dim">(https://integrate.api.nvidia.com/v1)</span></div>
      <div class="sky">● Workspace:</div>
      <div>C:\\projects\\cloud-backend <span class="dim">[branch: </span><span class="mint">main</span><span class="dim"> · git clean]</span></div>
      <div class="sky">● Mode:</div>
      <div><span class="bold">SOLO</span> <span class="dim">[1 Active Model · Fresh-Context Verifier Release Gate]</span></div>
      <div class="sky">● Active Model:</div>
      <div><span class="amber bold">meta/llama-3.3-70b-instruct</span> <span class="pill pill-green">Ready</span></div>
      <div class="sky">● Swarm Gates:</div>
      <div>
        <span class="pill pill-green">DoD Evidence Gate</span>
        <span class="pill pill-amber">Grok TodoGate</span>
        <span class="pill pill-blue">PageRank RepoMap</span>
      </div>
      <div class="sky">● Quota Limits:</div>
      <div>120 RPM <span class="dim">·</span> 300,000 TPM <span class="dim">·</span> Concurrency Cap: 4 parallel sockets</div>
    </div>
    <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #21262d; font-size: 12px; color: #8b949e;">
      💡 <span class="amber">Tip:</span> Type <span class="sky">/help</span> for commands, <span class="sky">/models</span> to switch LLMs, or <span class="sky">/cd &lt;path&gt;</span> to dynamically change repositories.
    </div>
  </div>

  <div class="prompt-box">
    <div class="prompt-header">
      <span class="amber">╭─ Prompt (main) ──────────────────────────────────────────────</span>
      <span class="dim">[Session Tokens: 0 · $0.0000]</span>
    </div>
    <div class="prompt-input">
      <span class="amber">❯</span>
      <span>Add Redis distributed mutex to rate-limiter and verify zero race collisions</span>
      <span class="prompt-cursor"></span>
    </div>
    <div class="prompt-footer">
      <span><span class="bold">[Enter]</span> Submit Goal</span>
      <span><span class="bold">[Tab]</span> Autocomplete</span>
      <span><span class="bold">[/models]</span> Switch Model</span>
      <span><span class="bold">[/status]</span> Swarm DAG</span>
      <span><span class="bold">[Ctrl+C]</span> Exit</span>
    </div>
  </div>
`;

// -----------------------------------------------------------------------------
// Screen 2: Interactive Swarm Session (Thinking, Tool Cards, Unified Diff, DoD Verdict)
// -----------------------------------------------------------------------------
const screen2Content = `
  <div class="status-bar">
    <div class="status-item"><span class="amber">◈ NOMIN</span></div>
    <div class="status-item">Mode: <span class="bold">SOLO</span></div>
    <div class="status-item">Model: <span class="sky">llama-3.3-70b</span></div>
    <div class="status-item">Branch: <span class="mint">⎇ feature/mutex</span></div>
    <div class="status-item">Tokens: <span class="slate">4.8k ($0.0024)</span></div>
    <div class="status-item">Status: <span class="mint">● Executing</span></div>
  </div>

  <div style="margin: 8px 0; font-size: 14px;">
    <span class="bold">Objective:</span> <span style="color: #ffffff;">"Implement mutual exclusion in TokenBucket evictExpired() and add concurrent stress test"</span>
  </div>

  <!-- Thinking Card -->
  <div class="card thinking">
    <div class="card-header">
      <span>💭 Thinking (Architect · deepseek-r1 · 1.4s)</span>
      <span class="pill pill-lavender">412 reasoning tokens</span>
    </div>
    <div style="font-size: 13px; color: #c9d1d9; line-height: 1.6;">
      <div>1. Decomposing objective: The TokenBucket.evictExpired() method performs map iteration while async refresh() runs concurrently.</div>
      <div>2. In high concurrency, Map.delete() during iteration causes dangling promises and inconsistent token budgets.</div>
      <div>3. Strategy: Wrap evictExpired() inside AsyncMutex.runExclusive() from utils/mutex.ts.</div>
      <div>4. Verification: Extract 2 DoD criteria: (a) npm run build exit 0, (b) 500-iteration race test in tests/rate-limiter.test.ts with exit 0.</div>
    </div>
  </div>

  <!-- Dedicated Tool Call: Edit File -->
  <div class="card edit">
    <div class="card-header" style="justify-content: space-between;">
      <span>✏️  Edit File: src/provider/rate-limiter.ts <span class="mint">+5</span> <span class="coral">-2</span></span>
      <span class="pill pill-amber">Fuzzy Tier 1 Match</span>
    </div>
    <div style="font-size: 12.5px; font-family: inherit;">
      <div class="diff-hunk">@@ -42,6 +42,9 @@ export class TokenBucket {</div>
      <div style="color: #8b949e; padding-left: 8px;">   public async evictExpired(): Promise&lt;number&gt; {</div>
      <div class="diff-del">-    for (const [key, token] of this.tokens.entries()) {</div>
      <div class="diff-del">-      if (Date.now() > token.expiresAt) this.tokens.delete(key);</div>
      <div class="diff-add">+    return await this.mutex.runExclusive(async () =&gt; {</div>
      <div class="diff-add">+      let evicted = 0;</div>
      <div class="diff-add">+      for (const [k, tok] of Array.from(this.tokens.entries())) {</div>
      <div class="diff-add">+        if (Date.now() &gt; tok.expiresAt) { this.tokens.delete(k); evicted++; }</div>
      <div class="diff-add">+      }</div>
      <div class="diff-add">+      return evicted;</div>
      <div class="diff-add">+    });</div>
      <div style="color: #8b949e; padding-left: 8px;">   }</div>
    </div>
  </div>

  <!-- Tool Call: Bash Execution -->
  <div class="card bash">
    <div class="card-header" style="justify-content: space-between;">
      <span>⚡ Tool: bash ❯ npm test -- tests/rate-limiter.test.ts</span>
      <span class="pill pill-green">✔ Exit 0 · 1.18s</span>
    </div>
    <div style="font-size: 12.5px; color: #8b949e; line-height: 1.5;">
      <div>&gt; @nomincode/cli@1.0.0 test</div>
      <div style="color: #c9d1d9;">✔ TokenBucket: concurrent evictions do not invalidate active iterators (142ms)</div>
      <div style="color: #c9d1d9;">✔ TokenBucket: 500-thread race condition verified with 0 dropped tokens (388ms)</div>
      <div class="mint">ℹ 14 passed · 0 failed · 0 skipped (1.18s)</div>
    </div>
  </div>

  <!-- Two-Phase Definition-of-Done (DoD) Verdict Card -->
  <div class="card success">
    <div class="card-header" style="justify-content: space-between;">
      <span>✔ [VERIFIED & RELEASED] — Definition-of-Done Evidence Gate</span>
      <span class="pill pill-green">RELEASE PASSED</span>
    </div>
    <div style="font-size: 13px; color: #c9d1d9; line-height: 1.6;">
      <div class="mint bold">✔ All 4 acceptance criteria satisfied with physical machine proof.</div>
      <div class="dim">Evidence Logs: 2 test outputs archived · AST Integrity Violations: 0 (No placeholder stubs).</div>
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(46, 160, 67, 0.2);">
        <div><span class="mint">✔</span> [AC-101] Syntactic Validation: <span class="dim">npm run build exited with code 0 (0 errors)</span></div>
        <div><span class="mint">✔</span> [AC-102] Concurrency Suite: <span class="dim">500-thread race test exited with code 0 in 1.18s</span></div>
        <div><span class="mint">✔</span> [AST-001] AST Integrity Gate: <span class="dim">Adversarial inspector detected zero ellipsis or stub bypasses</span></div>
      </div>
    </div>
  </div>
`;

// -----------------------------------------------------------------------------
// Screen 3: Swarm Dashboard & Telemetry Palette (/cost, /help, /board)
// -----------------------------------------------------------------------------
const screen3Content = `
  <div class="status-bar">
    <div class="status-item"><span class="amber">◈ NOMIN SWARM</span></div>
    <div class="status-item">Mode: <span class="bold">TEAM (4 AGENTS)</span></div>
    <div class="status-item">Provider: <span class="sky">NVIDIA NIM</span></div>
    <div class="status-item">RPM: <span class="mint">64/120</span></div>
    <div class="status-item">TPM: <span class="mint">142k/300k</span></div>
    <div class="status-item">Session Spend: <span class="amber">$0.0084</span></div>
  </div>

  <!-- Swarm Activity Dashboard -->
  <div class="card dashboard">
    <div class="card-header" style="justify-content: space-between;">
      <span>◈ SWARM ACTIVITY DASHBOARD (4 Autonomous Agents · Shared Blackboard)</span>
      <span class="pill pill-blue">Active Epoch: 03</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; font-size: 13px;">
      <div>
        <div class="bold" style="margin-bottom: 8px; color: #58a6ff;">Blackboard Task DAG:</div>
        <div style="margin-bottom: 6px;"><span class="pill pill-green">✔ VERIFIED</span> <span class="bold">T-01:</span> AsyncMutex Eviction Lock <span class="dim">(Coder)</span></div>
        <div style="margin-bottom: 6px;"><span class="pill pill-green">✔ VERIFIED</span> <span class="bold">T-02:</span> 500-Thread Race Test Suite <span class="dim">(Tester)</span></div>
        <div style="margin-bottom: 6px;"><span class="pill pill-amber">⏳ RUNNING</span> <span class="bold">T-03:</span> AIMD Adaptive Backoff Gate <span class="dim">(Coder-B)</span></div>
        <div><span class="pill pill-blue">REVIEW</span> <span class="bold">T-04:</span> Final DoD Gate Sign-off <span class="dim">(Verifier)</span></div>
      </div>
      <div>
        <div class="bold" style="margin-bottom: 8px; color: #58a6ff;">Agent Resource Meters:</div>
        <div style="margin-bottom: 4px;"><span class="amber">Architect:</span> <span class="dim">[deepseek-r1]</span> 14 RPM · 38K TPM · <span class="slate">Idle</span></div>
        <div style="margin-bottom: 4px;"><span class="mint">Coder-A:</span> <span class="dim">[qwen-2.5-coder]</span> 38 RPM · 74K TPM · <span class="mint">Task T-01 Done</span></div>
        <div style="margin-bottom: 4px;"><span class="mint">Coder-B:</span> <span class="dim">[qwen-2.5-coder]</span> 32 RPM · 68K TPM · <span class="gold">Streaming edit_file</span></div>
        <div style="margin-bottom: 4px;"><span class="gold">Tester:</span> <span class="dim">[llama-3.1-8b]</span> 12 RPM · 22K TPM · <span class="mint">14/14 Passed</span></div>
        <div><span class="lavender">Verifier:</span> <span class="dim">[deepseek-r1]</span> 06 RPM · 18K TPM · <span class="lavender">Reviewing AST Diff</span></div>
      </div>
    </div>
  </div>

  <!-- /cost Telemetry Card -->
  <div class="card" style="border-color: #384252;">
    <div class="card-header" style="justify-content: space-between;">
      <span style="color: #58a6ff;">╭─ Usage & Cost Telemetry (/cost) ──────────────────────────────────────────────</span>
      <span class="pill pill-amber">$0.0084 USD</span>
    </div>
    <div style="display: grid; grid-template-columns: 180px 1fr 180px 1fr; gap: 8px; font-size: 13px;">
      <div class="sky">Prompt Tokens:</div><div>14,250 tokens</div>
      <div class="sky">Completion Tokens:</div><div>2,410 tokens</div>
      <div class="sky">Cached Tokens:</div><div>8,900 tokens <span class="mint">(38% cache hit)</span></div>
      <div class="sky">Total Session:</div><div><span class="bold">16,660 tokens</span></div>
    </div>
    <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #21262d; font-size: 12px; color: #8b949e;">
      Total Swarm Turns: <span class="bold">3 turns</span> executed · Zero rate-limit 429 throttling encountered.
    </div>
  </div>

  <!-- Command Palette Preview -->
  <div class="card" style="border-color: #30363d; margin-top: 14px;">
    <div class="card-header">
      <span style="color: #fba857;">╭─ Command Catalog (/help) ─────────────────────────────────────────────────────</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; font-size: 12.5px;">
      <div>
        <div class="amber bold" style="margin-bottom: 4px;">Core Commands:</div>
        <div><span class="sky">/help</span> — Display command catalog</div>
        <div><span class="sky">/cd &lt;path&gt;</span> — Switch workspace & git branch</div>
        <div><span class="sky">/clear</span> — Clear terminal screen</div>
        <div><span class="sky">/exit</span> — Exit Nomin Code</div>
        <div class="amber bold" style="margin-top: 8px; margin-bottom: 4px;">Swarm & Multi-Agent:</div>
        <div><span class="sky">/status</span> — View active DAG tasks</div>
        <div><span class="sky">/mode &lt;solo|team&gt;</span> — Switch swarm mode</div>
        <div><span class="sky">/board</span> — Full-screen Blackboard</div>
      </div>
      <div>
        <div class="amber bold" style="margin-bottom: 4px;">Tools & Inspection:</div>
        <div><span class="sky">/repomap</span> — PageRank symbol outline</div>
        <div><span class="sky">/diff</span> — Inspect worktree git diffs</div>
        <div><span class="sky">/doctor</span> — Run health diagnostics</div>
        <div class="amber bold" style="margin-top: 8px; margin-bottom: 4px;">Models & Telemetry:</div>
        <div><span class="sky">/models</span> — Manage selected LLMs</div>
        <div><span class="sky">/cost</span> — View token usage & spend</div>
        <div><span class="sky">/config</span> — View provider rate quotas</div>
      </div>
    </div>
  </div>
`;

// -----------------------------------------------------------------------------
// Screen 4: Interactive Slash Command Popup
// -----------------------------------------------------------------------------
const screen4Content = `
  <div class="status-bar">
    <div class="status-item"><span class="amber">◈ NOMIN</span></div>
    <div class="status-item">Mode: <span class="bold">SOLO</span></div>
    <div class="status-item">Provider: <span class="sky">NVIDIA NIM</span></div>
    <div class="status-item">Model: <span class="amber">llama-3.3-70b</span></div>
    <div class="status-item">Branch: <span class="mint">⎇ main</span></div>
    <div class="status-item">Status: <span class="mint">● Ready</span></div>
  </div>

  <div class="card" style="border-color: #384252; margin-bottom: 16px;">
    <div class="card-header" style="justify-content: space-between;">
      <span style="color: #58a6ff;">╭─ Session Telemetry ─────────────────────────────────────────────────────────────</span>
      <span class="pill pill-green">NVIDIA NIM LIVE</span>
    </div>
    <div style="display: grid; grid-template-columns: 140px 1fr 140px 1fr; row-gap: 6px; font-size: 12.5px;">
      <div class="sky">● Endpoint:</div>
      <div>https://integrate.api.nvidia.com/v1</div>
      <div class="sky">● Quotas:</div>
      <div>120 RPM · 300,000 TPM</div>
      <div class="sky">● Workspace:</div>
      <div>C:\\projects\\cloud-backend <span class="dim">[git clean]</span></div>
      <div class="sky">● Concurrency:</div>
      <div>4 parallel sockets armed</div>
    </div>
  </div>

  <div class="popup-container">
    <div class="popup-header-row">
      <span>╭─ Slash Commands (↑/↓ navigate · ↵ select · esc dismiss)</span>
      <span class="dim">8 of 15 commands</span>
    </div>

    <div class="popup-row">
      <div class="popup-col-name"><span class="dim">&nbsp;</span> <span class="sky">/help</span></div>
      <div class="popup-col-desc">Display all available slash commands &amp; comprehensive guide</div>
      <div class="popup-col-badge"><span class="pill" style="color: #8b949e; border: 1px solid #30363d;">[Core]</span></div>
    </div>

    <div class="popup-row active">
      <div class="popup-col-name"><span class="amber bold">❯</span> <span class="amber bold">/provider</span></div>
      <div class="popup-col-desc">Switch or configure LLM Provider (NIM, OpenAI, Anthropic, DeepSeek, Groq...)</div>
      <div class="popup-col-badge"><span class="pill pill-amber">[Provider &amp; Models]</span></div>
    </div>

    <div class="popup-row">
      <div class="popup-col-name"><span class="dim">&nbsp;</span> <span class="sky">/models</span></div>
      <div class="popup-col-desc">Select, switch, or assign models for Solo &amp; Swarm Team roles</div>
      <div class="popup-col-badge"><span class="pill pill-amber">[Provider &amp; Models]</span></div>
    </div>

    <div class="popup-row">
      <div class="popup-col-name"><span class="dim">&nbsp;</span> <span class="sky">/mode</span></div>
      <div class="popup-col-desc">Switch between SOLO (1 agent) and TEAM (multi-agent) execution mode</div>
      <div class="popup-col-badge"><span class="pill pill-lavender">[Swarm]</span></div>
    </div>

    <div class="popup-row">
      <div class="popup-col-name"><span class="dim">&nbsp;</span> <span class="sky">/team</span></div>
      <div class="popup-col-desc">Assign models to swarm roles (architect, coder, tester, verifier)</div>
      <div class="popup-col-badge"><span class="pill pill-lavender">[Swarm]</span></div>
    </div>

    <div class="popup-row">
      <div class="popup-col-name"><span class="dim">&nbsp;</span> <span class="sky">/status</span></div>
      <div class="popup-col-desc">View active Swarm Task DAG and agent execution statuses</div>
      <div class="popup-col-badge"><span class="pill pill-lavender">[Swarm]</span></div>
    </div>

    <div class="popup-row">
      <div class="popup-col-name"><span class="dim">&nbsp;</span> <span class="sky">/board</span></div>
      <div class="popup-col-desc">Full-screen Blackboard state &amp; DoD acceptance criteria</div>
      <div class="popup-col-badge"><span class="pill pill-lavender">[Swarm]</span></div>
    </div>

    <div class="popup-row">
      <div class="popup-col-name"><span class="dim">&nbsp;</span> <span class="sky">/compact</span></div>
      <div class="popup-col-desc">Proactively compact context window (OpenCode engine compaction)</div>
      <div class="popup-col-badge"><span class="pill pill-lavender">[Swarm]</span></div>
    </div>

    <div style="text-align: center; color: #6e7681; font-size: 11.5px; padding: 6px 0 2px 0; border-top: 1px solid #21262d; margin-top: 4px;">
      ... (7 more commands: /cost, /config, /cd, /repomap, /diff, /doctor, /clear — keep typing to filter) ...
    </div>
  </div>

  <div class="prompt-box-attached">
    <div class="prompt-header">
      <span class="amber">╭─ Prompt (main) ──────────────────────────────────────────────────────────────</span>
      <span class="dim">[Session Tokens: 0 · $0.0000]</span>
    </div>
    <div class="prompt-input">
      <span class="amber bold">❯</span>
      <span style="font-size: 15px; color: #fba857; font-weight: 600;">/</span><span class="prompt-cursor"></span>
    </div>
    <div class="prompt-footer">
      <span><span class="bold">[Enter]</span> Select Command</span>
      <span><span class="bold">[↑/↓]</span> Navigate Popup</span>
      <span><span class="bold">[Tab]</span> Autocomplete</span>
      <span><span class="bold">[Esc]</span> Dismiss</span>
      <span><span class="bold">[/help]</span> Catalog</span>
    </div>
  </div>
`;

// -----------------------------------------------------------------------------
// Screen 5: Interactive /provider Switcher Card
// -----------------------------------------------------------------------------
const screen5Content = `
  <div class="status-bar">
    <div class="status-item"><span class="amber">◈ NOMIN CODE</span></div>
    <div class="status-item">Provider: <span class="mint bold">NVIDIA NIM</span></div>
    <div class="status-item">Mode: <span class="bold">SOLO</span></div>
    <div class="status-item">Branch: <span class="mint">⎇ main</span></div>
    <div class="status-item">Ping: <span class="mint">42ms</span></div>
    <div class="status-item">Status: <span class="mint">● Active</span></div>
  </div>

  <div class="card" style="border-color: #384252;">
    <div class="card-header" style="justify-content: space-between;">
      <span style="color: #58a6ff;">╭─ LLM Provider Switcher ────────────────────────────────────────────────────────</span>
      <span class="pill pill-green">NVIDIA NIM ACTIVE</span>
    </div>

    <div style="display: grid; grid-template-columns: 140px 1fr; row-gap: 7px; font-size: 13px;">
      <div class="amber bold">Active Provider:</div>
      <div><span class="mint bold">NVIDIA NIM</span> <span class="dim">(id: nim)</span></div>

      <div class="sky">● Base URL:</div>
      <div>https://integrate.api.nvidia.com/v1</div>

      <div class="sky">● API Key:</div>
      <div><span style="font-family: inherit; color: #8b949e;">nvapi-••••••••••••••••••••••••••••4f2a</span> <span class="pill pill-green" style="margin-left: 8px;">VALIDATED</span></div>

      <div class="sky">● Rate Quotas:</div>
      <div>120 RPM <span class="dim">·</span> 300,000 TPM <span class="dim">·</span> Concurrency: 4 parallel sockets</div>
    </div>

    <div style="color: #56d364; background: rgba(46, 160, 67, 0.12); border: 1px solid rgba(46, 160, 67, 0.25); border-left: 3px solid #56d364; padding: 7px 12px; border-radius: 4px; margin: 12px 0; font-size: 12.5px;">
      ✔ Connected successfully to NVIDIA NIM catalog · 42ms ping · Adaptive AIMD rate limiter armed
    </div>

    <div class="amber bold" style="margin-top: 10px; margin-bottom: 8px; font-size: 13px;">
      Supported Provider Presets:
    </div>

    <div style="display: grid; grid-template-columns: 32px 190px 1fr 100px; row-gap: 5px; font-size: 12.5px; align-items: center;">
      <div class="sky bold">[1]</div>
      <div class="bold" style="color: #56d364;">NVIDIA NIM</div>
      <div class="dim">https://integrate.api.nvidia.com/v1</div>
      <div><span class="pill pill-green">ACTIVE</span></div>

      <div class="sky bold">[2]</div>
      <div class="bold" style="color: #ffffff;">OpenAI API</div>
      <div class="dim">https://api.openai.com/v1</div>
      <div><span class="dim">Preset</span></div>

      <div class="sky bold">[3]</div>
      <div class="bold" style="color: #ffffff;">Anthropic Claude</div>
      <div class="dim">https://api.anthropic.com/v1</div>
      <div><span class="dim">Preset</span></div>

      <div class="sky bold">[4]</div>
      <div class="bold" style="color: #ffffff;">DeepSeek Official</div>
      <div class="dim">https://api.deepseek.com/v1</div>
      <div><span class="dim">Preset</span></div>

      <div class="sky bold">[5]</div>
      <div class="bold" style="color: #ffffff;">OpenRouter Gateway</div>
      <div class="dim">https://openrouter.ai/api/v1</div>
      <div><span class="dim">Preset</span></div>

      <div class="sky bold">[6]</div>
      <div class="bold" style="color: #ffffff;">Groq Cloud LPU</div>
      <div class="dim">https://api.groq.com/openai/v1</div>
      <div><span class="dim">Preset</span></div>

      <div class="sky bold">[7]</div>
      <div class="bold" style="color: #ffffff;">Ollama Local Host</div>
      <div class="dim">http://127.0.0.1:11434/v1</div>
      <div><span class="dim">Preset</span></div>

      <div class="sky bold">[8]</div>
      <div class="bold" style="color: #ffffff;">vLLM Local / Cluster</div>
      <div class="dim">http://127.0.0.1:8000/v1</div>
      <div><span class="dim">Preset</span></div>

      <div class="sky bold">[9]</div>
      <div class="bold" style="color: #ffffff;">Custom Endpoint</div>
      <div class="dim">(user-defined OpenAI-compatible URL)</div>
      <div><span class="dim">User Config</span></div>
    </div>

    <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #21262d; font-size: 11.5px; color: #8b949e;">
      Commands: <span class="sky">/provider switch &lt;id&gt;</span> · <span class="sky">/provider key &lt;key&gt;</span> · <span class="sky">/provider url &lt;url&gt;</span> · <span class="sky">/provider quota &lt;rpm&gt; &lt;tpm&gt;</span>
    </div>
  </div>

  <div class="prompt-box">
    <div class="prompt-header">
      <span class="amber">╭─ Prompt (main) ──────────────────────────────────────────────────────────────</span>
      <span class="dim">[Session Tokens: 0 · $0.0000]</span>
    </div>
    <div class="prompt-input">
      <span class="amber">❯</span>
      <span>/provider switch nim</span>
      <span class="prompt-cursor"></span>
    </div>
    <div class="prompt-footer">
      <span><span class="bold">[Enter]</span> Switch Provider</span>
      <span><span class="bold">[1-9]</span> Quick Select Preset</span>
      <span><span class="bold">[/models]</span> Model Catalog</span>
      <span><span class="bold">[Esc]</span> Cancel</span>
    </div>
  </div>
`;

// -----------------------------------------------------------------------------
// Screen 6: Interactive /models Manager Card (Swarm Mode: TEAM)
// -----------------------------------------------------------------------------
const screen6Content = `
  <div class="status-bar">
    <div class="status-item"><span class="amber">◈ NOMIN SWARM</span></div>
    <div class="status-item">Mode: <span class="lavender bold">TEAM (4 AGENTS)</span></div>
    <div class="status-item">Provider: <span class="sky">NVIDIA NIM</span></div>
    <div class="status-item">Blackboard DAG: <span class="mint">4 Tasks</span></div>
    <div class="status-item">Session Spend: <span class="amber">$0.0084</span></div>
    <div class="status-item">Status: <span class="mint">● Synchronized</span></div>
  </div>

  <div class="card" style="border-color: #384252;">
    <div class="card-header" style="justify-content: space-between;">
      <span style="color: #58a6ff;">╭─ Model Management ──────────────────────────────────────────────────────────</span>
      <span class="pill pill-lavender">TEAM MODE ACTIVE</span>
    </div>

    <div style="font-size: 13px; margin-bottom: 10px;">
      <span class="amber bold">Swarm Mode:</span>
      <span class="lavender bold" style="font-size: 13.5px; margin-left: 12px;">TEAM</span>
      <span class="dim" style="margin-left: 8px;">(4 Autonomous Swarm Agents · Shared Blackboard DAG · Fresh-Context Verifier)</span>
    </div>

    <div class="sky bold" style="font-size: 13px; margin-bottom: 6px;">● Swarm Role Mappings:</div>
    <div style="display: grid; grid-template-columns: 120px 24px 280px 1fr; row-gap: 5px; font-size: 12.5px; align-items: center; margin-left: 12px; margin-bottom: 12px;">
      <div class="bold" style="color: #d2a8ff;">architect</div>
      <div class="dim">➔</div>
      <div class="bold" style="color: #ffffff;">deepseek-ai/deepseek-r1</div>
      <div><span class="pill pill-lavender">Reasoning &amp; Architecture</span></div>

      <div class="bold" style="color: #58a6ff;">coder</div>
      <div class="dim">➔</div>
      <div class="bold" style="color: #ffffff;">qwen/qwen2.5-coder-32b-instruct</div>
      <div><span class="pill pill-blue">AST &amp; Code Synthesis</span></div>

      <div class="bold" style="color: #56d364;">tester</div>
      <div class="dim">➔</div>
      <div class="bold" style="color: #ffffff;">meta/llama-3.3-70b-instruct</div>
      <div><span class="pill pill-green">Stress &amp; Race Suite</span></div>

      <div class="bold" style="color: #fba857;">verifier</div>
      <div class="dim">➔</div>
      <div class="bold" style="color: #ffffff;">meta/llama-3.3-70b-instruct</div>
      <div><span class="pill pill-amber">DoD Release Gatekeeper</span></div>
    </div>

    <div class="amber bold" style="font-size: 13px; margin-bottom: 6px;">Your Selected Models Pool:</div>
    <div style="margin-left: 12px; font-size: 12.5px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;">
      <div>• <span class="sky">meta/llama-3.3-70b-instruct</span> <span class="pill pill-green" style="margin-left: 8px;">[CURRENT SOLO]</span></div>
      <div>• <span class="sky">deepseek-ai/deepseek-r1</span> <span class="dim" style="margin-left: 8px;">(High-reasoning math &amp; architecture)</span></div>
      <div>• <span class="sky">qwen/qwen2.5-coder-32b-instruct</span> <span class="dim" style="margin-left: 8px;">(Specialized code generation &amp; refactor)</span></div>
      <div>• <span class="sky">meta/llama-3.1-8b-instruct</span> <span class="dim" style="margin-left: 8px;">(Lightweight fast auxiliary tasks)</span></div>
    </div>

    <div class="amber bold" style="font-size: 13px; margin-bottom: 6px;">Recommended Presets for NVIDIA NIM:</div>
    <div style="margin-left: 12px; font-size: 12.5px; display: grid; grid-template-columns: 30px 280px 1fr; row-gap: 4px;">
      <div class="sky bold">[1]</div>
      <div class="bold">meta/llama-3.3-70b-instruct</div>
      <div class="dim">(General instruction, test generation, DoD verification)</div>

      <div class="sky bold">[2]</div>
      <div class="bold">deepseek-ai/deepseek-r1</div>
      <div class="dim">(Chain-of-thought architectural reasoning &amp; planning)</div>

      <div class="sky bold">[3]</div>
      <div class="bold">qwen/qwen2.5-coder-32b-instruct</div>
      <div class="dim">(High precision diff patch generation &amp; language syntax)</div>

      <div class="sky bold">[4]</div>
      <div class="bold">mistralai/mistral-large-2-instruct</div>
      <div class="dim">(Broad tool orchestration &amp; large payload analysis)</div>
    </div>

    <div style="color: #56d364; background: rgba(46, 160, 67, 0.12); border: 1px solid rgba(46, 160, 67, 0.25); border-left: 3px solid #56d364; padding: 6px 12px; border-radius: 4px; margin: 10px 0 8px 0; font-size: 12.5px;">
      ✔ Swarm role assignments synchronized across Blackboard · 4 models verified ready
    </div>

    <div style="padding-top: 8px; border-top: 1px solid #21262d; font-size: 11.5px; color: #8b949e;">
      Actions: <span class="bold">[1]</span> Set Solo Model · <span class="bold">[2]</span> Assign Roles · <span class="bold">[3]</span> Add Model · <span class="bold">[4]</span> Toggle Mode · <span class="bold">[5]</span> Fetch Live NIM Catalog
    </div>
  </div>

  <div class="prompt-box">
    <div class="prompt-header">
      <span class="amber">╭─ Prompt (main) ──────────────────────────────────────────────────────────────</span>
      <span class="dim">[Session Tokens: 16,660 · $0.0084]</span>
    </div>
    <div class="prompt-input">
      <span class="amber">❯</span>
      <span>/models assign coder=qwen/qwen2.5-coder-32b-instruct</span>
      <span class="prompt-cursor"></span>
    </div>
    <div class="prompt-footer">
      <span><span class="bold">[Enter]</span> Apply Assignment</span>
      <span><span class="bold">[1-5]</span> Quick Action</span>
      <span><span class="bold">[/mode team]</span> Toggle Swarm</span>
      <span><span class="bold">[/board]</span> Swarm DAG</span>
    </div>
  </div>
`;

// Write HTML mockups
const html1Path = path.join(scratchDir, 'screen1_boot_telemetry.html');
const html2Path = path.join(scratchDir, 'screen2_interactive_swarm.html');
const html3Path = path.join(scratchDir, 'screen3_dashboard_commands.html');
const html4Path = path.join(scratchDir, 'screen4_slash_popup.html');
const html5Path = path.join(scratchDir, 'screen5_provider_switcher.html');
const html6Path = path.join(scratchDir, 'screen6_models_manager.html');

fs.writeFileSync(html1Path, wrapTerminal('nomin — boot telemetry & prompt — 120x40', screen1Content));
fs.writeFileSync(html2Path, wrapTerminal('nomin — interactive swarm session & DoD gate — 120x40', screen2Content));
fs.writeFileSync(html3Path, wrapTerminal('nomin — swarm dashboard & telemetry — 120x40', screen3Content));
fs.writeFileSync(html4Path, wrapTerminal('nomin — slash command popup & prompt — 120x40', screen4Content));
fs.writeFileSync(html5Path, wrapTerminal('nomin — interactive /provider switcher — 120x40', screen5Content));
fs.writeFileSync(html6Path, wrapTerminal('nomin — interactive /models manager (swarm team) — 120x40', screen6Content));

console.log('HTML mockups written successfully.');

// Screenshots list
const screens = [
  { html: html1Path, filename: 'screen1_boot_telemetry.png', name: 'Screen 1: Boot Telemetry' },
  { html: html2Path, filename: 'screen2_interactive_swarm.png', name: 'Screen 2: Interactive Swarm Session' },
  { html: html3Path, filename: 'screen3_dashboard_commands.png', name: 'Screen 3: Swarm Dashboard & Commands' },
  { html: html4Path, filename: 'screen4_slash_popup.png', name: 'Screen 4: Slash Command Popup' },
  { html: html5Path, filename: 'screen5_provider_switcher.png', name: 'Screen 5: Provider Switcher Card' },
  { html: html6Path, filename: 'screen6_models_manager.png', name: 'Screen 6: Models Manager Card' },
];

for (const s of screens) {
  const rootPng = path.join(callerDir, s.filename);
  const targetPng = path.join(targetDir, s.filename);
  const workspacePng = path.join(workspaceScreenshotsDir, s.filename);

  console.log(`Rendering ${s.name}...`);
  const fileUrl = 'file:///' + s.html.replace(/\\/g, '/');
  const cmd = `"${chromePath}" --headless --disable-gpu --screenshot="${rootPng}" --window-size=1280,920 --hide-scrollbars "${fileUrl}"`;
  execSync(cmd, { stdio: 'inherit' });

  // Sync to subdirectories
  fs.copyFileSync(rootPng, targetPng);
  fs.copyFileSync(rootPng, workspacePng);

  const stat = fs.statSync(rootPng);
  console.log(`Saved ${s.filename} (${Math.round(stat.size / 1024)} KB)`);
}

console.log('All 6 screenshots generated, synchronized, and verified successfully.');
