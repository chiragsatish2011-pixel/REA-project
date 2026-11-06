# Nomin Code CLI: Comprehensive UI/UX Study & Architecture Specification

**Document Version:** 2.0.0  
**Target:** Redesign of Nomin Code CLI to match Claude Code & OpenCode ergonomics, controls, and comfort.  
**Platform Scope:** Windows Terminal (PowerShell 5.1/7+, cmd.exe), WSL, Linux, macOS.

---

## 1. Executive Summary & Problem Analysis

### 1.1 The Current Problems in Nomin Code CLI
1. **Model Picker Usability Wall:** Choosing a model required typing numbers (`[1-20]`, `[1-108]`), paging with `n`/`p`, or manual subcommands (`f <query>`). This creates cognitive friction, is prone to typos, and feels outdated compared to modern tools.
2. **Visual Clutter & Border Heaviness:** A heavy, multi-line boxed "System Telemetry" card rendered repeatedly on screen, with nested borders, emoji clutter, and repetitive branding.
3. **Modal Input Disconnect:** Asking questions used blocking standard readline `askQuestion()`, preventing real-time arrow-key cursor movement, live fuzzy-filtered scrolling, mouse interaction, or interactive slider controls.
4. **Tool & Diff Visibility:** Diffs and tool outputs were dumped linearly without interactive hunk folding or concise single-line collapsed states.
5. **Team Swarm Representation:** Multi-agent swarm (5 agents: architect, coder, tester, reviewer, verifier) lacked a calm, unified tabbed/split view.

### 1.2 Target Experience: The Claude Code & OpenCode Aesthetic
Modern AI developer tools (Claude Code, OpenCode, Aider, Codex, Gemini CLI) share core principles that make them feel like comfortable text editors or high-end IDEs rather than brittle chat scripts:
- **Calm, quiet layout:** Borders only where strictly functional (the bottom input box and overlay popups). Conversation flows like natural text with generous vertical rhythm.
- **Instant arrow-key navigation:** Up/Down/j/k for lists, Left/Right for cycling options, Enter to select, Esc to cancel. Zero typed index numbers.
- **Live fuzzy filtering:** Typing immediately filters 100+ items without having to switch into a search mode.
- **Dynamic Context-Aware Footer:** A single dim line at the bottom continuously communicates available key bindings (`↑/↓ move · enter select · esc back · type to filter`).
- **Smooth, flicker-free rendering:** Streaming tokens update incrementally in place without redrawing the entire screen.

---

## 2. Control & Interaction Parity Matrix

The following table comprehensively maps every interaction control across Claude Code, OpenCode, Codex CLI, Aider, and Nomin Code.

| Control / Input | What It Does | Claude Code Behavior | OpenCode Behavior | Codex / Aider / Gemini | Nomin Code Equivalent | Parity Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`/`** | Open Slash Command Menu | Typing `/` instantly triggers an overlay popup with arrow selection & fuzzy filter | Typing `/` opens command palette with instant search | Aider lists on `/help`; Codex shows menu | Instant overlay popup on `/` with Up/Down/Enter/Esc | DONE (`SlashMenu Popup`) |
| **`/help`** | Command catalog & docs | Categorized list of all commands and options | Command palette with all actions | `/help` command | Categorized interactive command browser | DONE (`renderCommandCatalog`) |
| **`/clear`** | Hard reset context & screen | Clears terminal screen and starts fresh context | Clears session view / restarts session | `/clear` in Aider/Gemini | Clears screen & resets turn context | DONE (`interactive-ui-keystroke`) |
| **`/compact`** | Context compaction | Proactively compacts conversation history to save tokens | Background context compaction with summary | `/compact` or `/tokens` | Runs OpenCode-grade context compaction engine | DONE (`Context Compaction Engine`) |
| **`/model` / `/models`**| Model selection & catalog | Interactive arrow-key model switcher | `DialogModel` modal with fuzzy filter, favorites, and variant | Aider `/model <name>` | Interactive arrow-key live catalog picker with live fuzzy filter | DONE (`ModelPicker 120+ Models Virtualized`) |
| **`/effort`** | Reasoning effort & thinking | Cycles or sets thinking budget tokens (off, low, medium, high) | Model variant / reasoning dialog | Codex reasoning slider | Inline Left/Right arrow slider with live budget display | DONE (`InlineSlider Effort Cycler`) |
| **`/config` / `/settings`**| Settings configuration | Interactive menu to toggle permissions, telemetry, output | `DialogConfig` settings browser | Settings file or flags | Interactive arrow-key settings menu with JSON sync | DONE (`SelectList Navigation`) |
| **`/permissions`** | Security rules & mode | Interactive permission rule editor | Auto-approve toggle & permission policies | Approval prompts (`y/n/always`) | Arrow-key permission policy editor & auto-accept toggle | DONE (`ConfirmDialog Permission Prompt`) |
| **`/resume`** | Resume or fork session | Resumes session by ID or list | `DialogSessionList` with arrow selection | Session resume flags | Interactive arrow-key session history picker | DONE (`SelectList Navigation`) |
| **`/rewind`** | Rewind session context & code | Rewinds turns and rolls back file diffs | Stash / undo history | `/undo` in Aider | Rewind menu with turn selection & git rollback | DONE (`TimelineViewer Git Checkpoints`) |
| **`/undo` / `/redo`** | Undo / redo code changes | Reverts last tool/agent modifications | Git stash pop / patch rollback | Aider `/undo` | Interactive timeline viewer with one-click git revert | DONE (`TimelineViewer Git Checkpoints`) |
| **`/status`** | Swarm / agent execution state | Shows current agent tasks, progress, and DAG | DevTools / status pane | Goose task status | Multi-agent DAG & task state card with active status | DONE (`renderSwarmDashboard`) |
| **`/cost`** | Token & spend telemetry | Displays session prompt/completion tokens, cache, and cost | Usage & limit dialog | Aider `/tokens` | Session token tracker with breakdown and spend estimate | DONE (`renderCostSummary`) |
| **`/board`** | DoD criteria & Blackboard | Shows DoD acceptance criteria and task status | Session tabs / todo list | Agent plan review | Real-time Blackboard & fresh-context verifier gates | DONE (`DoDEngine Criteria Extraction`) |
| **`/init`** | Repo guidelines creation | Analyzes repository and writes guidelines file | Scans project structure | Aider repo scan | Scans workspace and initializes `.nomin/GUIDELINES.md` | DONE (`interactive-ui-keystroke`) |
| **`/memory`** | View/edit guidelines memory | Opens or updates project guidelines | Project config / system instructions | Aider `/read` memory | Interactive guidelines viewer and editor | DONE (`interactive-ui-keystroke`) |
| **`/agents`** | Manage background / swarm agents| Lists running subagents and status | Agent switcher (`dialog-agent`) | Multi-agent runtime | Swarm agent manager (architect, coder, tester, etc.) | DONE (`SwarmCoordinator`) |
| **`/mcp`** | Model Context Protocol servers | Interactive MCP server manager | `DialogMcp` tool server manager | Goose tool manager | MCP server list and status toggles | DONE (`SelectList Navigation`) |
| **`/hooks`** | Pre/post turn hooks | Configures event hooks (e.g. formatters, linters) | Plugin runtime support | Git pre-commit hooks | Lifecycle hooks editor (pre-tool, post-tool, DoD) | DONE (`SelectList Navigation`) |
| **`/review`** | Ultrareview / DoD validation | Multi-agent code review of worktree diffs | PR / diff verification | Codex code review | Triggers Verifier Agent fresh-context DoD check | DONE (`DoD Verifier Gate`) |
| **`/doctor`** | System & provider diagnostics | Runs environment, tool, and connectivity checks | Debug & diagnostic dialog | `/doctor` check | Full environment, API key, git, and path health check | DONE (`renderDoctor`) |
| **`/auth` / `/login`**| Provider keys & credentials | Interactive provider key entry with AES-256 vault | Integration dialog (`dialog-integration`) | API key prompts | Arrow-key provider switcher with masked key entry | DONE (`NominAuthManager & provider-paste`) |
| **`/export`** | Export session transcript | Exports markdown / JSONL transcript | Session export | Aider `/save` | Exports clean Markdown or JSONL transcript | DONE (`interactive-ui-keystroke`) |
| **`/diff`** | Inspect active worktree diff | Unified colorized diff viewer | `PatchDiff` viewer | Aider `/diff` | Interactive unified/side-by-side diff with hunk collapse | DONE (`renderDiff`) |
| **`/cd` / `/add-dir`** | Switch / add working directory | Switches workspace with safety checks | Workspace directory picker | Aider `/add` | Dynamic directory switcher with system root guard | DONE (`handleDirectorySwitch`) |
| **`/vim`** | Vim modal navigation | Toggles vim-style NORMAL/INSERT modes | Vim navigation keymap | Readline vi-mode | Toggleable vim mode with modal status indicator | DONE (`RawInputReader Parser`) |
| **`Esc`** | Interrupt action | Interrupts streaming or active tool immediately | Cancels active generation / closes dialog | Standard SIGINT | Immediately aborts active HTTP stream or tool execution | DONE (`cancels on Escape`) |
| **`Esc Esc`** | Clear line / Rewind menu | Clears current input if filled; opens rewind if empty | Clears input or closes active view | Aider ESC | Double-Esc clears prompt or opens undo/rewind timeline | DONE (`RawInputReader double-escape`) |
| **`Shift+Tab`** | Cycle permission modes | Cycles Normal ➔ Auto-Accept ➔ Plan Mode | Cycles active agent mode | Codex toggle | Instant cycling: Normal ➔ Auto-Accept ➔ Plan Mode | DONE (`RawInputReader shift-tab`) |
| **`Ctrl+R`** | Prompt history search | Reverse incremental search through prompt history | History search | Standard bash `^R` | Interactive reverse history search with live match | DONE (`RawInputReader ctrl-r`) |
| **`Ctrl+O`** | Toggle verbose transcript | Toggles thinking details and full tool outputs | DevTools bar toggle | Debug toggle | Toggles verbose tool output & reasoning blocks | DONE (`RawInputReader ctrl-o`) |
| **`@`** | File mention autocomplete | Typing `@` lists repository files with fuzzy match | `@` file mention dialog | Aider file mention | Interactive fuzzy file picker inserting relative path | DONE (`FilterableList Live Fuzzy Filtering`) |
| **`!`** | Inline shell command | Runs shell command directly in workspace (e.g. `!git status`) | Terminal pane execution | Aider `!<cmd>` | Executes shell command inline and renders output | DONE (`interactive execution`) |
| **`#`** | Add note to memory | Appends instruction directly to project memory | Note to session | Instruction prompt | Appends note directly to `.nomin/GUIDELINES.md` | DONE (`appendMemoryNote`) |
| **`Tab`** | Toggle thinking / complete | Expands or collapses thinking block | Cycles fields or focus | Autocomplete | Toggles active thinking fold or accepts completion | DONE (`FilterableList cycle categories`) |
| **`Up` / `Down`** | Move cursor / history | Navigates menus or cycles command history | Navigates lists / history | History navigation | Arrow-key list selection & input history recall | DONE (`SelectList Up/Down`) |
| **`PageUp` / `PageDown`**| Windowed scroll | Jumps by page (10-15 items) in long lists | Page scroll in dialogs | Terminal scroll | Jumps 10 items in virtualized lists | DONE (`SelectList PageUp/PageDown`) |
| **`Home` / `End`** | List boundary jump | Jumps to start or end of list | Boundary jump | Terminal jump | Jumps to index 0 or length - 1 | DONE (`SelectList Home/End`) |
| **`Space`** | Toggle checkbox | Multi-select toggle in pool/file lists | Checkbox toggle | Multi-select | Toggles selection checkbox in MultiSelect component | DONE (`MultiSelect Checkbox Navigation`) |
| **`Left` / `Right`** | Slider / cyclic controls | Changes slider value (e.g. reasoning effort) | Adjusts options | Option cycling | Adjusts sliders inline with immediate visual update | DONE (`InlineSlider Effort Cycler`) |
| **Mouse Support** | Click to select, wheel to scroll | Click selection and wheel scrolling where supported | Full SGR mouse reporting | Terminal mouse mode | SGR mouse click & wheel tracking in terminal | DONE (`SGR mouse clicks & wheel`) |

---

## 3. Visual Design Specification

### 3.1 Design Principles
1. **Zero Nested Boxes:** Remove the box-in-a-box telemetry card. Use clean whitespace, subtle hairline dividers, and consistent horizontal margins (2 spaces indent).
2. **Minimalist Launch Header:** On startup, print a single 3-line subtle branding header:
   ```
   ◈ NOMIN CODE v1.0.0 — Model-Agnostic Swarm Runtime
   Workspace: C:\projects\my-app (main) · Provider: NVIDIA NIM (integrate.api.nvidia.com)
   Active Model: meta/llama-3.3-70b-instruct · Reasoning: MEDIUM · Mode: SOLO
   ```
   No heavy borders around launch info.
3. **Slim Dynamic Status Line:** Fixed above the prompt or rendered at bottom:
   ```
   [NIM] meta/llama-3.3-70b · effort:med · normal mode · 12.4k tok ($0.002) · 120 rpm
   ```
4. **Adaptive Contextual Footer Hint:** Single dim line below input or dialog:
   ```
   ↑/↓ move · enter select · esc back · type to filter · f favorite
   ```
5. **Tight Color Palette with Semantic Roles:**
   - **Accent / Brand:** Amber (`#f59e0b` / `\x1b[38;5;215m`) — warm, calm, signature tone.
   - **Success / Validated:** Mint green (`#10b981` / `\x1b[38;5;114m`) — DoD pass, verified model, active selection.
   - **Warning / Attention:** Soft gold (`#f5d76e` / `\x1b[38;5;221m`) — rate limit notice, retry, unverified.
   - **Error / Failure:** Coral red (`#f87171` / `\x1b[38;5;203m`) — validation error, retired model, tool exit != 0.
   - **Info / Metadata:** Soft sky blue (`#38bdf8` / `\x1b[38;5;111m`) — model tags, role badges, file paths.
   - **Muted / Secondary:** Slate gray (`#94a3b8` / `\x1b[38;5;244m`) — line numbers, timestamps, dims.
   - **Borders / Separators:** Dark hairline slate (`\x1b[38;5;238m` or `\x1b[90m`).
   - **High-Contrast & Colorblind Themes:** Full support for `NO_COLOR` (disables all escape codes), High-Contrast (pure white/yellow/cyan on black), and Colorblind-Safe (blue/orange instead of green/red).

### 3.2 State Visuals
- **Idle State:** Slim status bar, subtle prompt indicator `❯ `, cursor ready.
- **Thinking State:** Dim collapsible block:
  ```
  ╭─ Thinking (deepseek-r1 · 1.4s) ──────────────────────────[tab to expand]─╮
  │ Analyzing dependency DAG and validating acceptance criteria...            │
  ╰───────────────────────────────────────────────────────────────────────────╯
  ```
- **Streaming State:** Real-time token streaming with live cursor `▋` and word wrapping that never flickers.
- **Tool Call (Collapsed):**
  ```
  ⚡ bash npm test → ✔ 279 tests passed (14.2s)                [tab to expand]
  ```
- **Tool Call (Expanded):** Clean indented hairline box showing command, working directory, and stdout.
- **Diff State:** Colorized unified view with line numbers (`+` green, `-` red, gutter line numbers), accept/reject hunk controls.
- **Permission Prompt:**
  ```
  ⚠️  Allow bash command: git push origin feature/auth ?
  ❯ [a] Always allow  ·  [y] Allow once  ·  [n] Deny  ·  [p] Switch to Plan Mode
  ```
- **Team Swarm (2-5 Agents):** Calm horizontal role bar:
  ```
  [1] Architect (idle)  [2] Coder (running: tools.ts)  [3] Tester (waiting)  [4] Verifier (gated)
  ```
  Pressing `1-4` focuses the specific agent transcript without overwhelming the terminal.

---

## 4. TUI Foundation Architectural Comparison

We evaluated five candidate architectures for the Nomin Code TUI foundation:

| Criterion | Ink (React CLI) | Bubble Tea (Go) | Textual (Python) | Ratatui (Rust) | **Native Node.js VT Engine (Chosen)** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Language & Runtime** | JavaScript / React | Go | Python | Rust | **TypeScript / Node.js standard runtime** |
| **Startup Overhead** | ~350-500ms (React reconciler + yoga) | ~20ms (native binary) | ~400ms (Python VM + rich) | ~10ms (native binary) | **<15ms (direct V8 execution, zero tree reconciliation)** |
| **IPC / Integration** | Native in Node | Requires IPC bridge or full rewrite in Go | Requires Python subprocess bridge | Requires NAPI-rs C bindings | **Zero IPC: directly accesses in-memory coordinator & state** |
| **Token Streaming Latency** | High (triggers React rerender per chunk) | Low (Elm message loop) | Medium (event loop updates) | Zero (immediate frame diffing) | **Zero (direct ANSI incremental line flush without full redraw)** |
| **Windows Support** | ConEmu / conhost issues with yoga flexbox | Good with termenv | Good with Windows Terminal | Good with crossterm | **Direct Win32 VT input mode + Windows Terminal support** |
| **Raw Mode & Keys** | Node readline / ink input | Go raw term | Python curses / asyncio | crossterm raw mode | **`process.stdin.setRawMode(true)` + VT sequence parser** |
| **Dependencies** | ~40 npm packages (react, yoga, etc.) | Separate Go toolchain | Python 3.10+ & virtualenv | Rust cargo build toolchain | **Zero external dependencies — pure Node.js stdlib** |

### Decision & Justification:
We choose the **High-Performance Native Node.js VT Raw-Mode Terminal Engine**.  
- It requires **zero external npm packages**, preserving Nomin Code's zero-bloat architecture.
- It eliminates the React/Yoga redraw lag that plagues Ink during high-frequency LLM streaming.
- It supports full raw-mode keyboard tracking (arrow keys, Shift+Tab, Ctrl+R, PageUp/PageDown, Home/End, mouse SGR reporting).
- It runs seamlessly on Windows PowerShell, Windows Terminal, cmd.exe, macOS, and Linux.

---

## 5. UI Component Hierarchy & Architecture

The redesigned UI layer is strictly separated from agent coordinator logic through a reusable component library:

```
src/cli/
├── ansi.ts             # Semantic colors, theme manager, ANSI sequences
├── theme.ts            # Dark, Light, High-Contrast, Colorblind, NO_COLOR themes
├── raw-input.ts        # Raw terminal input parser (VT sequences, Shift+Tab, mouse)
├── components/
│   ├── select-list.ts      # Arrow-navigated single select with scrolling
│   ├── filterable-list.ts  # Fuzzy-filtered scrollable list (models, files, commands)
│   ├── multi-select.ts     # Checkbox multi-select for swarm model pools
│   ├── slider.ts           # Left/Right arrow inline slider (effort, temperature)
│   ├── confirm-dialog.ts   # Interactive confirmation prompt (permissions, git revert)
│   ├── diff-viewer.ts      # Unified & side-by-side diff with hunk collapse
│   ├── status-line.ts      # Slim session telemetry bar
│   ├── footer-hints.ts     # Context-aware dynamic shortcut hints
│   └── timeline-viewer.ts  # Visual undo/redo git commit timeline
├── model-picker.ts     # Virtualized live model catalog with detail pane & filters
├── slash-menu.ts       # Instant popup command palette on '/'
├── team-view.ts        # Multi-agent calm tabbed swarm dashboard
├── ui.ts               # Backwards-compatible facade implementing TerminalUI
└── repl.ts             # Clean event-driven interactive REPL loop
```

---

## 6. Model Picker Overhaul Specification

1. **Overlay / Clean Viewport:** Rendered inside a virtualized 12-row window.
2. **Item Format:**
   `❯ [publisher/model-name]        [128k] [tools] [reasoning] ★`
3. **Instant Fuzzy Filtering:** Typing immediately filters without pressing Enter.
4. **Key Commands in Picker:**
   - `↑` / `↓` or `k` / `j`: Move selection highlight
   - `PageUp` / `PageDown`: Jump 10 items
   - `Home` / `End`: Jump to first / last item
   - `Tab`: Cycle filter tags (`all` ➔ `chat` ➔ `reasoning` ➔ `tools` ➔ `favorites` ➔ `recent`)
   - `f`: Toggle favorite on highlighted model
   - `Enter`: Select highlighted model and proceed to effort slider step
   - `Esc`: Close picker without changes
5. **Inline Effort Slider Step:**
   Upon selecting a model, an inline slider appears:
   `Reasoning Effort:  off  |  low  | [ MEDIUM ] |  high  |  max  (←/→ to adjust, Enter to confirm)`
   *If the model does not support reasoning, this step is automatically bypassed.*
6. **Verification Spinner:**
   Short 1-line braille spinner: `⠋ Verifying meta/llama-3.3-70b-instruct with NVIDIA NIM...`  
   Followed by `✔ Active model set to meta/llama-3.3-70b-instruct` or error detail.
7. **Team Mode Integration:**
   In Team mode, role assignment displays roles (`architect`, `coder`, `tester`, `verifier`), and pressing `Enter` on any role opens the same model picker.

---

## 7. Verification & Proof Strategy

Before concluding the implementation, the following verifications are mandatory:
1. **Automated End-to-End PTY Keystroke Tests:**
   A test runner that creates a mock raw stdin stream, emits arrow keys (`\x1b[A`, `\x1b[B`), Enter (`\r`), Esc (`\x1b`), printable filter characters, and asserts on the exact terminal buffer output.
2. **100+ Model Virtualization Benchmark:**
   Verify scrolling and filtering remain responsive (<5ms per keystroke) on a synthetic catalog of 150+ models.
3. **Screen Snapshots in `/docs/screens/`:**
   Generate visual mock snapshots of all required states:
   - First run / launch
   - Model picker with fuzzy filter
   - Inline effort slider
   - Slash command popup
   - Chat streaming with token cursor
   - Collapsed and expanded tool calls
   - Diff review
   - Permission prompt
   - Undo/redo timeline
   - 5-agent team swarm view
   - Error state
4. **Side-by-Side Comparison against Claude Code & OpenCode.**
