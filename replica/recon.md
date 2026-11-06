# Recon Map: Claude Code (CLI / Terminal Native)

- **Target App:** Claude Code (`https://github.com/anthropics/claude-code` / `@anthropic-ai/claude-code`)
- **Platform:** CLI / TUI Terminal (Node.js / TypeScript, Cross-Platform: Windows, macOS, Linux, WSL)
- **Scope:** Complete agentic coding CLI, interactive REPL, slash commands overlay, model switcher, diff engine, multi-agent swarm/teams, permission security tiers, context compaction, and Aurora theme aesthetic.
- **For:** Developers, AI engineers, and autonomous swarm builders needing a model-agnostic, high-performance terminal agent.
- **Date:** 2026-11-05

---

## 1. Sources

| # | Source | URL / Location | What It Gives You |
| - | ------ | -------------- | ----------------- |
| 1 | Official Claude Code Documentation | `https://code.claude.com/docs` / `research/docs/claude/` | Exhaustive specs on agent loop, built-in tools, slash commands, permissions, hooks, subagents, and memory (`CLAUDE.md`). |
| 2 | Anthropic NPM Registry & CLI Artifacts | `npm: @anthropic-ai/claude-code` | Binary distribution structure, CLI flags (`-p`, `--resume`, `--dangerously-skip-permissions`), dependencies, entrypoints. |
| 3 | Architectural Teardowns & Comparative Matrices | `research/deliverables/02_PER_SYSTEM_TEARDOWNS.md` & `03_COMPARISON_MATRIX.md` | Deep teardown of multi-agent teams, worktrees, token rate limits, and verification loops. |
| 4 | Terminal & TUI Studies | `research/deliverables/13_CLI_TUI_ARCHITECTURE_AND_MOCKUPS.md` & `docs/ui-study.md` | Layout metrics, ANSI/VT100 escape handling, raw-mode keybindings, and cursor positioning. |
| 5 | Public Walkthroughs & Keynote Demos | Anthropic Research & Product Releases | Real user interaction flows, interrupt (`Esc`), message queueing while streaming, and compact footer status. |

---

## 2. Core Loop

**The Core Loop:**
> An engineer enters an intent in a calm terminal REPL $\to$ the agent gathers context via repo search/repomap $\to$ emits structured tool calls (bash/file-edit) $\to$ pauses for user permission or runs auto-approved checks $\to$ verifies tests in isolated worktrees $\to$ commits checkpoints with zero context bloat.

---

## 3. Screen Inventory

| ID | Screen / View | Route / Invocation | Purpose | Key Components | States Seen |
| -- | ------------- | ------------------ | ------- | -------------- | ----------- |
| **S01** | **Boot & Welcome Banner** | `nomin` / startup | Displays session header, workspace path, git branch, telemetry notice, and hint line. | ASCII logo, metadata pill, tip text. | Clean boot, first run, update notice. |
| **S02** | **Interactive REPL Shell** | Default prompt | Primary input interface with multiline input, token counter, and live raw keystroke handler. | Prompt input box, dynamic footer, typing cursor. | Idle, typing, streaming response, paused. |
| **S03** | **Slash Command Palette** | Type `/` in prompt | Fast overlay popup to trigger commands without typing arguments manually. | Popup card, category tag, highlighted match. | Open, typing query, cycling selection, empty match. |
| **S04** | **Model Switcher Modal** | `/model` or `/models` | Interactive arrow-key live catalog to change active LLM or swarm team roles. | Model list, reasoning pill, context badge, effort cycler. | Active browsing, filtering, selecting, effort cycle. |
| **S05** | **Tool Execution & Diff Card** | Auto on tool run | Renders command executions, file searches, syntax-highlighted edits, and unified diffs. | Diff header, hunk view (`+`/`-`), spinner, fold toggle. | Running (spinner), success (`PASS`), failure (`FAIL`), collapsed summary. |
| **S06** | **Security & Permission Prompt** | Triggered on risky tool | Asks for human verification before modifying filesystem, executing bash, or hitting external APIs. | Warning border, command preview, action pills (`[y]es`, `[n]o`, `[a]lways`). | Waiting for keystroke, auto-approved, denied. |
| **S07** | **Swarm Team Dashboard** | `/status` or `/agents` | Observability view of multi-agent swarm hierarchy (Architect, Coder, Tester, Verifier). | Swarm DAG, worktree badge, mailbox counter, token meter. | Idle, running parallel worktrees, DoD verification pass. |
| **S08** | **Cost & Token Telemetry Bar** | `/cost` or turn footer | Real-time breakdown of prompt tokens, completion tokens, prompt cache hits, and financial spend. | Telemetry card, cache efficiency meter, spend gauge. | Zero turns, cached, non-cached, threshold warning. |
| **S09** | **System Diagnostics (Doctor)** | `/doctor` | Pre-flight connectivity check for Node.js, git, API endpoints, permissions, and tools. | Diagnostic list, pass/fail indicators, fix recommendations. | Checking, all pass, degraded warnings, error block. |
| **S10** | **Settings & Memory Manager** | `/config`, `/memory` | Configuration interface for rate limits, guidelines (`GUIDELINES.md`), and theme switcher. | Key-value settings table, markdown viewer, theme picker. | Reading, editing, saved. |

---

## 4. User Flows

### `F01: Interactive Code Edit & Verification (The Happy Path)`
```
S02 REPL Prompt (User enters task: "Add JWT token validation")
    -> S05 Tool Call (Agent executes repomap & file read on src/auth.ts)
    -> S05 Diff Card (Agent applies unified search-replace patch)
    -> S06 Permission Prompt (User presses Enter / [y]es to approve modification)
    -> S05 Tool Call (Agent executes `npm test` via bash runner)
    -> S02 REPL Prompt (Agent reports DoD completion with verified proof)
Happy path keystrokes: 1 prompt + 1 Enter = 2 interactions.
Edge cases: Test fails $\to$ agent auto-reverts diff and inspects stack trace.
```

### `F02: Instant Slash Command Navigation`
```
S02 REPL Prompt (User types `/`)
    -> S03 Slash Menu Popup appears instantly above prompt
    -> User types `m` (popup filters to `/model`, `/models`, `/mode`, `/memory`)
    -> User presses Down Arrow $\to$ Enter
    -> S04 Model Switcher opens without shell redraw
Happy path keystrokes: 3 (`/`, `m`, `Enter`).
```

### `F03: Arrow-Key Model Selection & Thinking Effort Cycling`
```
S04 Model Switcher
    -> Up/Down arrows scroll through 120+ live models with virtualized viewport
    -> Left/Right arrows cycle reasoning effort budget: [off] -> [low] -> [medium] -> [high]
    -> Enter confirms selection
    -> REPL updates active model in footer without session loss
Happy path keystrokes: 2 arrows + 1 Enter.
```

### `F04: Context Window Compaction & Checkpoint Rewind`
```
S02 REPL Prompt (Context reaches 80% threshold or user triggers `/compact`)
    -> Agent runs Context Compaction Engine
    -> Turns compressed down to <= 20% token footprint while preserving file diffs and DoD
    -> User triggers `/rewind`
    -> Checkpoint timeline displays micro-commits
    -> User selects turn $N-1 \to$ git rollback executes cleanly
```

### `F05: Swarm Team Autonomous Handoff`
```
S02 REPL Prompt (User enables `/mode team`)
    -> S07 Swarm Coordinator dispatches Architect $\to$ writes criteria to Blackboard
    -> Coder A & Coder B claim subtasks in isolated git worktrees
    -> Tester agent writes reproduction test
    -> Verifier Gate runs fresh-context DoD inspection
    -> Auto-merge into main branch upon 100% green proof
```

---

## 5. Components

| Component | Variants | States | Used On |
| --------- | -------- | ------ | ------- |
| **InputBox** | single-line, multiline, password/masked | idle, typing, streaming, disabled | S02, S10 |
| **SlashOverlay** | full catalog, filtered query | open, scrolling, empty, selected | S03 |
| **ModelPicker** | solo switcher, team assignment | browsing, filtering, effort-cycling | S04 |
| **DiffCard** | unified hunk, file tree diff, stat pill | collapsed, expanded, added, removed | S05 |
| **PermissionGate** | safe, bash warning, destructive red | waiting, approved, denied, remembered | S06 |
| **SwarmDashboard** | compact bar, full DAG view | active, waiting, compiling, verified | S07 |
| **TelemetryMeter** | inline footer, summary card | normal, high-cache (>80%), rate-limited | S02, S08 |
| **DiagnosticBadge** | pass, fail, warning, info | checking, verified, flagged | S09 |

---

## 6. Inferred Data Model

```
Session         id (uuid), workspace_root (path), created_at (timestamptz), branch (text),
                provider (text), model (text), total_tokens (int), total_cost (cents)
                evidence: CLI state, transcript exports, /cost command
                confidence: high

Turn            id (uuid), session_id (uuid), sequence_num (int), user_prompt (text),
                assistant_response (text), thinking_tokens (text), created_at (timestamptz)
                evidence: transcript.jsonl, compaction engine
                confidence: high

ToolCall        id (uuid), turn_id (uuid), tool_name (text), arguments (jsonb),
                result (text), exit_code (int), duration_ms (int), status (pending|approved|rejected|done)
                evidence: ToolRegistry, permission prompt
                confidence: high

PermissionRule  id (uuid), pattern (text), action (allow|prompt|deny), scope (session|global)
                evidence: /permissions command, .nomin/config.json
                confidence: high

Checkpoint      id (uuid), session_id (uuid), turn_id (uuid), git_sha (text),
                files_changed (jsonb), restored (bool)
                evidence: /rewind command, git checkpoints
                confidence: high

SwarmAgent      id (uuid), role (architect|coder|tester|verifier), model (text),
                worktree_path (path), task_status (idle|running|blocked|completed)
                evidence: /team command, Blackboard DAG
                confidence: high
```

---

## 7. Feature Matrix Summary

See complete breakdown in `replica/features.csv`.
- **Must Have:** 14 features (REPL prompt, tool loop, diff viewer, bash execution, slash menu, model switching, permissions, git rewind, etc.) $\to$ **100% Implemented**.
- **Should Have:** 8 features (Reasoning effort cycler, auto-compaction, doctor diagnostics, Aurora theme, token caching, live model catalog) $\to$ **100% Implemented**.
- **Could Have:** 4 features (Multi-agent swarm teams, worktrees, Blackboard DoD engine) $\to$ **100% Implemented**.
- **Skip:** Anthropic proprietary server weights, internal Claude subscription checkout (client-side model-agnostic harness connects to standard APIs).

---

## 8. Out of Scope

- **Anthropic proprietary model weights & server infrastructure:** Clean-room architecture connects to official model providers (NVIDIA NIM, OpenAI, Anthropic, Ollama, vLLM) via standard API keys.
- **Closed telemetry backdoors:** Clean local privacy architecture; no undisclosed exfiltration.

---

## 9. Sizing & Conclusion

- **Screens:** 10 Distinct Terminal / TUI Screens (S01–S10)
- **Flows:** 6 Core End-to-End User Flows (F01–F06)
- **Complexity:** Size **L** (Full production CLI coding harness).
- **Theme Directive:** Fully aligned to **Aurora** design system with polar night midnight backgrounds, electric cyan accents, and AA/AAA WCAG contrast.
- **Next Step:** `/replica-architect` and `/replica-build`.
