# Nomin Code Subsystems Architecture & Code Map

**Document Version:** 2.5.0  
**Generated Date:** 2026-11-05  
**Harness:** Nomin Code (`@nomincode/cli`)  
**Scope:** Complete structural mapping of entry points, input handling, router, planner/DAG, swarm runtime, DoD verification gate, provider layer, auth & keychain, model picker, rate limiter scheduler, and terminal UI components.

---

## 1. Subsystem Architecture Overview

```
                                  +-------------------+
                                  |    bin/nomin.ts   | (CLI Entry / Arg Parser)
                                  +---------+---------+
                                            |
                         +------------------+------------------+
                         |                                     |
              +----------v----------+               +----------v----------+
              | Headless CI/CD Mode |               |   ReplServer TUI    | (Interactive)
              +----------+----------+               +----------+----------+
                         |                                     |
                         |        +----------------------------+
                         |        | (User keystrokes / raw terminal)
                         |        v
                         |  +--------------------+
                         |  |   RawInputReader   | (ANSI decoder, cursor, hotkeys)
                         |  +---------+----------+
                         |            |
                         |            v
                         |  +--------------------+
                         |  |    IntentRouter    | (CHAT, SMALL-TASK, LARGE-TASK, NOISE)
                         |  +---------+----------+
                         |            |
                         +-----+------+
                               |
                               v
                   +-----------------------+
                   |    SwarmCoordinator   | (Session Orchestration)
                   +-----------+-----------+
                               |
       +-----------------------+-----------------------+
       |                       |                       |
+------v-------+        +------v-------+        +------v-------+
|  Blackboard  |        | SwarmMailbox |        |  DoDEngine   |
| (Kahn DAG &  |        |  (Reactive   |        | (Acceptance  |
| Shared State)|        | Event Bus)   |        | Verification)|
+------+-------+        +--------------+        +------+-------+
       |                                               |
       +-----------------------+-----------------------+
                               |
                               v
                   +-----------------------+
                   |    NominHttpClient    | (Connection Pool, SSE Streaming)
                   +-----------+-----------+
                               |
       +-----------------------+-----------------------+
       |                       |                       |
+------v-------+        +------v-------+        +------v-------+
|  RateLimiter |        | LiveCatalog  |        | ErrorClassif |
| (AIMD tokens |        | (GET /models |        | (401/403/410 |
| & RPM queue) |        |  disk cache) |        | retry/backoff|
+--------------+        +--------------+        +--------------+
```

---

## 2. Directory & Module File Map

| Subsystem | Source Path | Primary Exported Symbols | Purpose |
| :--- | :--- | :--- | :--- |
| **Entry Point** | [`bin/nomin.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/bin/nomin.ts) | `main()`, `parseArgs()`, `CliArgs` | CLI bootstrapper, CLI argument parser, subcommands (`setup`, `doctor`, `status`, `model`, `mode`, `team`), flags. |
| **Public API** | [`src/index.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/index.ts) | `SwarmCoordinator`, `NominHttpClient`, `ConfigManager`, `DoDEngine` | Programmatic package exports for embedding harness. |
| **Input Handling** | [`src/cli/raw-input.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/cli/raw-input.ts) | `RawInputReader`, `KeyStroke` | Low-level ANSI escape sequence decoder (`process.stdin.setRawMode`), arrow keys, Shift+Tab, Ctrl+R, SGR mouse. |
| **Slash Menu** | [`src/cli/slash-menu.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/cli/slash-menu.ts) | `SlashMenu`, `ALL_SLASH_COMMANDS` | Pop-up overlay command menu rendered inline upon typing `/`. |
| **REPL Server** | [`src/cli/repl.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/cli/repl.ts) | `NominREPL`, `ReplServer`, `isConversationalPrompt` | Main interactive loop, line editor, history navigation, prompt execution handler. |
| **Doctor Diagnostics** | [`src/cli/doctor.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/cli/doctor.ts) | `NominDoctor`, `DoctorReport`, `DiagnosticCheck` | System and credential diagnostics, API connectivity test, workspace safety audit. |
| **Intent Router** | [`src/swarm/intent-router.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/swarm/intent-router.ts) | `IntentRouter`, `UserIntent`, `IntentClassificationResult` | High-speed heuristic regex rules + fallback model classification to route prompts. |
| **Planner & Repair** | [`src/swarm/plan-validator.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/swarm/plan-validator.ts) | `PlanValidator`, `PlanRepairReport` | Validates Architect plans against schema, removes self-deps, breaks cycles, enforces linear fallback. |
| **Blackboard & DAG**| [`src/swarm/blackboard.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/swarm/blackboard.ts) | `Blackboard`, `SwarmTask`, `TaskDAGState` | In-memory & persisted state board, Kahn topological sorting, task status transition manager. |
| **Swarm Coordinator**| [`src/swarm/coordinator.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/swarm/coordinator.ts) | `SwarmCoordinator`, `SwarmRunResult` | Multi-agent execution loop, parallel worker dispatch, Git worktree isolation, result aggregation. |
| **Event Bus / Mailbox**| [`src/swarm/mailbox.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/swarm/mailbox.ts) | `SwarmMailbox`, `SwarmMessage` | Reactive agent-to-agent typed message bus, async wakeup without polling. |
| **Reminder / Todo Gate**| [`src/swarm/reminder-policy.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/swarm/reminder-policy.ts) | `ReminderTracker`, `TurnReminderPolicy` | Turn-based policy enforcing task checklist updates (TodoGate). |
| **Context Compactor**| [`src/swarm/compaction.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/swarm/compaction.ts) | `ContextCompactor`, `CompactedContext` | Background conversation compressor pruning obsolete turns while preserving diffs and DoD criteria. |
| **DoD Engine** | [`src/verifier/dod-engine.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/verifier/dod-engine.ts) | `DoDEngine`, `TaskCompletionCertificate` | Definition-of-Done physical proof verifier, executes build/test scripts, verifies exit codes. |
| **AST Integrity** | [`src/verifier/ast-integrity.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/verifier/ast-integrity.ts) | `AstIntegrityInspector`, `AstAudit` | Static analysis gate detecting stubbed implementations (`TODO`, `pass`, deleted tests, hollow functions). |
| **Provider Client** | [`src/provider/client.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/provider/client.ts) | `NominHttpClient`, `NominHttpError`, `StreamChunk` | HTTP/HTTPS connection pooling (`keep-alive`), SSE stream parser, thinking token separator, prefix hashing. |
| **Live Catalog** | [`src/provider/live-catalog.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/provider/live-catalog.ts) | `LiveCatalogManager`, `DiscoveredModel` | Live GET `/v1/models` retrieval from user's provider account, disk caching, capability heuristics. |
| **Error Classifier** | [`src/provider/error-classifier.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/provider/error-classifier.ts) | `ErrorClassifier`, `ClassifiedError` | Categorizes HTTP 401/403/404/410/429/5xx, formats actionable diagnostic cards, extracts Retry-After. |
| **Model Settings** | [`src/provider/model-settings.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/provider/model-settings.ts) | `ModelSettingsManager`, `ModelSettings` | Manages per-model parameters (`reasoningEffort`, `temperature`, `maxTokens`, context windows). |
| **Model Validator** | [`src/provider/model-validator.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/provider/model-validator.ts) | `ModelValidator`, `ModelValidationResult` | Executes transactional live probes (`max_tokens: 5`) on candidate models before allowing selection. |
| **Rate Limiter** | [`src/provider/rate-limiter.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/provider/rate-limiter.ts) | `NominRateLimitScheduler`, `RequestPriority` | Sliding-window token/request scheduler, AIMD concurrency gate, priority queue with jittered backoff. |
| **Keychain & Vault** | [`src/config/keychain.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/config/keychain.ts) | `NominKeyStore`, `VaultCipher`, `RedactionEngine` | AES-256-GCM encrypted credential vault, secret key redaction, exfiltration prevention. |
| **Auth Manager** | [`src/config/auth-manager.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/config/auth-manager.ts) | `NominAuthManager`, `ProviderKeyEntry` | Provider-scoped key management, key resolution hierarchy, masked key storage. |
| **Config Core** | [`src/config/index.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/config/index.ts) | `ConfigManager`, `detectWorkspaceProject`, `isSystemDir` | Layered configuration manager, workspace safety detector, `.env` file loader. |
| **Model Picker UI** | [`src/cli/model-picker.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/cli/model-picker.ts) | `ModelPicker`, `ModelPickerResult` | Interactive virtualized list with type-to-filter, Tab category cycling, inline effort slider, and live probe verification. |
| **UI Components** | [`src/cli/components/`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/cli/components/) | `SelectList`, `FilterableList`, `InlineSlider`, `ConfirmDialog`, `StatusLine`, `FooterHints`, `TimelineViewer`, `DiffViewer` | Modular, zero-dependency ANSI interactive widgets matching Claude Code terminal ergonomics. |
| **Terminal UI Core**| [`src/cli/ui.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/cli/ui.ts) | `TerminalUI`, `ANSI` | Screen formatting, single-line boot banners, spinners, diff coloring, thinking folds. |
| **Theme System** | [`src/cli/theme.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/cli/theme.ts) | `ThemeManager`, `ThemePalette` | Color scheme definitions (Warm Amber/Claude Code, Midnight, High Contrast, Monochrome). |
| **Bash Tool** | [`src/tools/bash.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/tools/bash.ts) | `BashTool` | Workspace shell command execution with timeout, cwd isolation, and safety blocking in system roots. |
| **File Tools** | [`src/tools/edit-file.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/tools/edit-file.ts), [`file-ops.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/tools/file-ops.ts) | `EditFileTool`, `FileOpsTool` | Multi-tier fuzzy Levenshtein search-and-replace, atomic file writes. |
| **RepoMap Tool** | [`src/tools/repomap.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/src/tools/repomap.ts) | `RepoMapEngine`, `RepoMapTool` | PageRank-inspired symbol dependency graph extractor with file/token budgets. |

---

## 3. Subsystem Breakdown & Data Flow

### 3.1 Entry Points & Arg Parsing
- **Execution Paths**:
  1. `bin/nomin.ts`: Main process entry point. Evaluates flags (`--task`, `--headless`, `--model`, `--provider`, `--workdir`).
  2. If subcommands (`setup`, `doctor`, `status`, `model`, `mode`, `team`) are passed, executes targeted handler and terminates cleanly.
  3. If `--headless` is passed with `--task`, invokes `SwarmCoordinator.orchestrate()` directly without initializing interactive TUI or readline, exiting with status code 0 (success) or 1 (failure).
  4. If run without `--headless`, instantiates `ReplServer` (alias `NominREPL`) and launches interactive mode.

### 3.2 Input Handling & Key Dispatch
- **Low-Level Decoder (`RawInputReader`)**:
  - Puts `process.stdin` into raw mode (`setRawMode(true)`).
  - Translates VT100 / xterm ANSI escape sequences:
    - Arrow keys (`\x1b[A`, `\x1b[B`, `\x1b[C`, `\x1b[D`)
    - Shift+Tab (`\x1b[Z`)
    - PageUp/PageDown (`\x1b[5~`, `\x1b[6~`)
    - Home/End (`\x1b[H`, `\x1b[F`)
    - Double Escape (rapid escape sequence within 300ms)
    - SGR Mouse Reporting (`\x1b[<...M`, `\x1b[<...m`)
- **Slash Menu Popup (`SlashMenu`)**:
  - When the prompt starts with `/`, displays a live overlay above or below the input line.
  - Supports fuzzy matching on command names and descriptions.
  - Enter accepts selected command; Escape dismisses popup without clearing buffer.

### 3.3 Intent Router
- **Routing Stages (`IntentRouter`)**:
  1. **Direct Overrides**:
     - Input starting with `/plan` $\rightarrow$ `LARGE-TASK`
     - Input starting with `/chat` $\rightarrow$ `CHAT/QUESTION`
     - Input starting with `/` $\rightarrow$ `SLASH-COMMAND`
  2. **Rule-Based Heuristic (0ms)**:
     - Noise / ambiguity regex (`/^(?:wt|wtf|wth|idk|\?+|\.+)$/i`) $\rightarrow$ `UNCLEAR/NOISE`
     - Status questions (`/what are you doing/i`) $\rightarrow$ `CHAT/QUESTION`
     - Greetings (`/^(?:hi|hello|hey)/i`) $\rightarrow$ `CHAT/QUESTION`
     - Read-only explanations (`/^(?:how does|explain|what does)/i`) without code mutation verbs $\rightarrow$ `CODE-EXPLAIN`
     - Small mutations (single function, fix, edit, typo) $\rightarrow$ `SMALL-TASK`
     - Multi-file or architectural changes $\rightarrow$ `LARGE-TASK`
  3. **Fast LLM Intent Classifier Fallback**:
     - Optional single-token probe when heuristic confidence is $< 0.85$.

### 3.4 Planner & Topological DAG
- **Task Decomposition**:
  - Lead Architect generates a candidate plan as a structured JSON array of tasks, each specifying `id`, `title`, `description`, `assignedRole`, `dependencies`, and `acceptanceCriteria`.
- **Validation & Self-Healing (`PlanValidator`)**:
  - Prunes self-dependencies ($T_i \rightarrow T_i$).
  - Strips references to nonexistent task IDs.
  - Detects cyclic dependencies using Kahn's algorithm; if cycles exist, prunes back-edges or falls back to a deterministic linear chain ($T_1 \rightarrow T_2 \rightarrow \dots \rightarrow T_n$).
  - Caps maximum task graph size to 8 tasks to prevent combinatorial explosion.
- **Topological Sorting (`Blackboard.computeTopologicalSort`)**:
  - Computes exact topological order and marks dependency-free tasks as `READY` for worker pickup.

### 3.5 Swarm Runtime & Worker Dispatch
- **Modes**:
  - `SOLO`: 1 agent executes tasks. Verification is performed in a separate pass with fresh context.
  - `TEAM`: 2 to 5 specialized agent roles with user-assigned models:
    - `Architect` / `Nexus`: Orchestration and task graph planning.
    - `Scout` / `Harper`: Read-only codebase explorer and RepoMap navigation.
    - `Coder` / `Benjamin`: Builder implementing modifications in isolated Git worktrees.
    - `Verifier` / `Lucas`: Adversarial maker-checker gate enforcing DoD evidence.
- **Git Worktree Isolation**:
  - Each builder task executes in an isolated temporary worktree branch (`.nomin/worktrees/task-...`), preventing dirtying the main working tree until verified.

### 3.6 DoD Gate & AST Integrity
- **Physical Proof Engine (`DoDEngine`)**:
  - Extracts executable verification commands (`npm test`, `npm run build`, `python -m pytest`).
  - Spawns child processes in the worktree and captures exit codes, stdout, and stderr.
  - Rejects task completion if exit code $\neq 0$.
- **AST Anti-Cheat Gate (`AstIntegrityInspector`)**:
  - Audits changed files using TypeScript compiler API.
  - Blocks release if implementation contains fake stubs (`throw new Error("TODO")`, empty function bodies, commented-out tests).

### 3.7 Provider Layer & Model Management
- **HTTP Client (`NominHttpClient`)**:
  - Node.js persistent connection pooling via `http.Agent` / `https.Agent` (`keepAlive: true`).
  - SSE streaming parser parsing `data: {...}` lines.
  - Separates native reasoning streams (`delta.reasoning_content`) and `<think>` blocks from standard user-facing text.
- **Model Discovery (`LiveCatalogManager`)**:
  - Queries `GET /v1/models` from the active provider.
  - Caches catalog to `~/.nomin/catalogs/catalog_<provider>.json` with 24-hour TTL and background refresh.
- **Transactional Model Switcher (`ModelValidator` & `ModelPicker`)**:
  - Flow: Select Model $\rightarrow$ Select Reasoning Effort $\rightarrow$ Probe Model with live completion $\rightarrow$ Commit to state.
  - On probe failure: Retains previous active model, displays exact provider error, and prompts user.
- **Error Classifier (`ErrorClassifier`)**:
  - Identifies 401/403 (Auth/Permissions), 404 (Not Found), 410 (Model Retired), 429 (Rate Limited), 5xx (Server Error), 400 (Bad Parameter).
  - Automatically retries 400/422 requests once without `reasoning_effort` if rejected by provider.

### 3.8 Keychain & Credential Store
- **Key Storage Hierarchy**:
  1. OS Credential Store (Windows Credential Manager / macOS Keychain / libsecret)
  2. Encrypted Vault: `~/.nomin/vault.enc` (AES-256-GCM with PBKDF2 salt and restrictive 0600 file permissions)
  3. Environment variables (`NVIDIA_API_KEY`, `OPENAI_API_KEY`, etc.)
  4. Local project `.env` (strictly scoped to project directory)
- **Security Rule**:
  - Plaintext API keys must never be stored in `config.json`.
  - Keys must be masked in all logs, UI displays, crash dumps, and telemetry.

### 3.9 Rate Limiter Scheduler
- **Sliding Window Token Bucket (`NominRateLimitScheduler`)**:
  - Enforces per-provider and per-model limits (RPM and TPM).
  - Priority Queue:
    1. `USER_INTERACTIVE` (direct chat responses, live keystroke validation)
    2. `FOREGROUND_TASK` (active coding subtask)
    3. `BACKGROUND` (RepoMap indexing, speculative tool runs)
  - Exponential backoff with full decorrelated jitter on 429 or 5xx responses.
  - Dynamic adaptation to provider rate limit response headers (`x-ratelimit-remaining`, `retry-after`).

### 3.10 Terminal UI (TUI)
- **Component Architecture**:
  - Stateless renderer functions accepting typed properties and returning ANSI line strings.
  - In-place redrawing using VT100 cursor movement (`\x1b[<n>A\x1b[0J`) to eliminate terminal flicker and scrollback pollution.
  - Contextual footers rendering active hotkeys (`↑/↓ move · enter select · esc back · type to filter`).
