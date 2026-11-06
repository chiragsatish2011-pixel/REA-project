/**
 * Script to generate high-fidelity screenshots for:
 * - screen4_slash_popup.png
 * - screen5_provider_switcher.png
 * - screen6_models_manager.png
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const callerDir = 'C:\\Users\\A2_B2_Chirag\\.gemini\\antigravity\\brain\\742c7aff-dd38-4e75-8936-3e4e3ed6f7d2';
const callerScreenshotsDir = path.join(callerDir, 'screenshots');
const workspaceScreenshotsDir = 'C:\\Users\\A2_B2_Chirag\\Documents\\Opencode Reverse Engineering\\screenshots';
const scratchDir = path.join(callerDir, 'scratch');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!fs.existsSync(callerScreenshotsDir)) fs.mkdirSync(callerScreenshotsDir, { recursive: true });
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

// =============================================================================
// SCREEN 4: Interactive Slash Command Popup
// =============================================================================
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

  <!-- Popup Box Popping Up Directly Above Prompt Message Bar -->
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

  <!-- Connected Prompt Bar with live typing indicator ❯ /_ -->
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

// =============================================================================
// SCREEN 5: Interactive /provider Switcher Card
// =============================================================================
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

    <!-- Active Provider Details -->
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

    <!-- Live Status Banner -->
    <div style="color: #56d364; background: rgba(46, 160, 67, 0.12); border: 1px solid rgba(46, 160, 67, 0.25); border-left: 3px solid #56d364; padding: 7px 12px; border-radius: 4px; margin: 12px 0; font-size: 12.5px;">
      ✔ Connected successfully to NVIDIA NIM catalog · 42ms ping · Adaptive AIMD rate limiter armed
    </div>

    <!-- 9 Supported Presets -->
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

// =============================================================================
// SCREEN 6: Interactive /models Manager Card (Swarm Mode: TEAM)
// =============================================================================
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

    <!-- Swarm Mode Header -->
    <div style="font-size: 13px; margin-bottom: 10px;">
      <span class="amber bold">Swarm Mode:</span>
      <span class="lavender bold" style="font-size: 13.5px; margin-left: 12px;">TEAM</span>
      <span class="dim" style="margin-left: 8px;">(4 Autonomous Swarm Agents · Shared Blackboard DAG · Fresh-Context Verifier)</span>
    </div>

    <!-- Role Mappings -->
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

    <!-- Selected Models Pool -->
    <div class="amber bold" style="font-size: 13px; margin-bottom: 6px;">Your Selected Models Pool:</div>
    <div style="margin-left: 12px; font-size: 12.5px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;">
      <div>• <span class="sky">meta/llama-3.3-70b-instruct</span> <span class="pill pill-green" style="margin-left: 8px;">[CURRENT SOLO]</span></div>
      <div>• <span class="sky">deepseek-ai/deepseek-r1</span> <span class="dim" style="margin-left: 8px;">(High-reasoning math &amp; architecture)</span></div>
      <div>• <span class="sky">qwen/qwen2.5-coder-32b-instruct</span> <span class="dim" style="margin-left: 8px;">(Specialized code generation &amp; refactor)</span></div>
      <div>• <span class="sky">meta/llama-3.1-8b-instruct</span> <span class="dim" style="margin-left: 8px;">(Lightweight fast auxiliary tasks)</span></div>
    </div>

    <!-- Recommended Presets for NVIDIA NIM -->
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

    <!-- Status Message -->
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

// Write HTML mockups to scratchDir
const html4Path = path.join(scratchDir, 'screen4_slash_popup.html');
const html5Path = path.join(scratchDir, 'screen5_provider_switcher.html');
const html6Path = path.join(scratchDir, 'screen6_models_manager.html');

fs.writeFileSync(html4Path, wrapTerminal('nomin — slash command popup & prompt — 120x40', screen4Content));
fs.writeFileSync(html5Path, wrapTerminal('nomin — interactive /provider switcher — 120x40', screen5Content));
fs.writeFileSync(html6Path, wrapTerminal('nomin — interactive /models manager (swarm team) — 120x40', screen6Content));

console.log('HTML files created:');
console.log(' -', html4Path);
console.log(' -', html5Path);
console.log(' -', html6Path);

// Target PNG destinations:
// 1. In caller brain root
// 2. In caller screenshots dir
// 3. In workspace screenshots dir

const screens = [
  {
    html: html4Path,
    filename: 'screen4_slash_popup.png',
    name: 'Screen 4: Slash Command Popup'
  },
  {
    html: html5Path,
    filename: 'screen5_provider_switcher.png',
    name: 'Screen 5: Provider Switcher Card'
  },
  {
    html: html6Path,
    filename: 'screen6_models_manager.png',
    name: 'Screen 6: Models Manager Card'
  }
];

const results = [];

for (const s of screens) {
  const rootPng = path.join(callerDir, s.filename);
  const callerScreenshotsPng = path.join(callerScreenshotsDir, s.filename);
  const workspaceScreenshotsPng = path.join(workspaceScreenshotsDir, s.filename);

  console.log(`\nRendering ${s.name}...`);
  const fileUrl = 'file:///' + s.html.replace(/\\/g, '/');
  const cmd = `"${chromePath}" --headless --disable-gpu --screenshot="${rootPng}" --window-size=1280,920 --hide-scrollbars "${fileUrl}"`;
  
  execSync(cmd, { stdio: 'inherit' });
  
  // Copy to screenshots subdirectories
  fs.copyFileSync(rootPng, callerScreenshotsPng);
  fs.copyFileSync(rootPng, workspaceScreenshotsPng);

  const stat = fs.statSync(rootPng);
  const sizeKb = Math.round(stat.size / 1024);
  console.log(`Saved ${s.filename} (${sizeKb} KB)`);
  
  results.push({
    filename: s.filename,
    sizeBytes: stat.size,
    sizeKb,
    passed: stat.size > 50 * 1024
  });
}

console.log('\n================ VERIFICATION SUMMARY ================');
for (const r of results) {
  const status = r.passed ? 'PASSED (> 50KB)' : 'FAILED (< 50KB)';
  console.log(`${r.filename}: ${r.sizeKb} KB — ${status}`);
}
