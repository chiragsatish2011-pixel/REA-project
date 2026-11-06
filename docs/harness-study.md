# Agent Harness Teardown & Comparative Architecture Study (v2.5)

**Author:** Nomin Code Core Architecture Team  
**Date:** 2026-11-05  
**Methodology:** Direct AST source code inspection of local repositories in `research/repos/`, public developer documentation, and verified empirical observation.  
**Tag Legend:**
- `[VERIFIED]`: Directly confirmed by inspecting local source files in `research/repos/` (file path and line range cited).
- `[DOCUMENTED]`: Confirmed via official public vendor documentation, whitepapers, or API specifications.
- `[INFERRED]`: Inferred from runtime observation and system behavior of closed harnesses (e.g. Claude Code, Antigravity).
- `[UNVERIFIED]`: Anecdotal, community-reported, or third-party claim not yet independently validated.

---

## 1. Subsystem-by-Subsystem Comparative Matrix

### 1.1 Core Agent Loop

| Harness | Primary File & Line Reference | Architectural Pattern | Verification Tag |
| :--- | :--- | :--- | :--- |
| **OpenCode** | [`research/repos/opencode/packages/core/src/session/runner.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/research/repos/opencode/packages/core/src/session/runner.ts) | Effect-TS driven streaming turn loop. Message stream sent to `LLMClient`. When tool calls arrive, pauses stream, dispatches tool via `ToolExecutor`, stores result in SQLite message table, and recurses until model outputs zero tool calls. | `[VERIFIED]` |
| **Aider** | [`research/repos/aider/aider/coders/base_coder.py:200-450`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/research/repos/aider/aider/coders/base_coder.py) | Monolithic generator loop `Coder.run()`. Assembles repository map (`RepoMap`), context files, and streams response from `litellm`. Extracts SEARCH/REPLACE blocks, applies file edits, commits to git, and runs linter reflections. | `[VERIFIED]` |
| **Goose** | [`research/repos/goose/crates/goose/src/agents/mod.rs`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/research/repos/goose/crates/goose/src/agents/mod.rs) | Rust async actor loop. Messages pass through extension filters. Calls MCP tool servers and aggregates tool results into conversational history. | `[VERIFIED]` |
| **Gemini CLI** | [`research/repos/gemini-cli/packages/core/src/index.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/research/repos/gemini-cli/packages/core/src/index.ts) | Multi-turn streaming generator using Gemini SDK. Routes tool call parts through a confirmation bus before executing shell commands. | `[VERIFIED]` |
| **Cline** | [`research/repos/cline/src/core/controller/index.ts`](file:///c:/Users/A2_B2_Chirag/Documents/Opencode%20Reverse%20Engineering/research/repos/cline/src/core/controller/index.ts) | Recursive async state machine. Emits native function calls or XML tool tags (`read_file`, `write_to_file`, `execute_command`), requests user permission in webview, and appends output to session context. | `[VERIFIED]` |
| **Claude Code** | Public Documentation & Observed Behavior | Discrete state machine: `INPUT -> PROMPT_ASSEMBLY -> MODEL_STREAM -> TOOL_DISPATCH -> VERIFICATION`. Zero tool calls renders directly as natural conversational text. Tool invocations trigger collapsible ANSI output lines and sub-processes. | `[DOCUMENTED]` / `[INFERRED]` |
| **Antigravity** | Google DeepMind Internal Guidelines & Observed Behavior | Agentic pairing loop with reactive message awakening. Multi-agent subagents communicate over typed JSONL transcripts without busy-wait polling; renders markdown artifacts to persistent session brain. | `[DOCUMENTED]` / `[INFERRED]` |

---

### 1.2 Intent Handling & Conversational vs Coding Routing

| Harness | Primary Mechanism | Details | Verification Tag |
| :--- | :--- | :--- | :--- |
| **OpenCode** | Unified Conversation Model | There is **no artificial boundary** between a chat mode and a coding mode. A message is processed through the exact same agent loop. If the model chooses to call tools, it acts; if it outputs text, it speaks. | `[VERIFIED]` |
| **Aider** | Command Prefix vs Chat | Lines starting with `/` are intercepted as CLI commands (`/add`, `/test`, `/diff`). All other text is fed to the model prompt. If the prompt asks a question, the model responds in natural language; if it asks for changes, the model emits diff blocks. | `[VERIFIED]` |
| **Claude Code** | Intent Heuristics & Unified Loop | Questions receive immediate natural text responses without running git diffs or file mutations. Explicit commands (`/plan`, `/compact`, `/help`) execute immediately. Modifying code occurs only when the user asks or approves file changes. | `[DOCUMENTED]` / `[INFERRED]` |
| **Nomin Code Failure (v1.0)** | Rigid Binary Regex Split | Nomin Code incorrectly attempted to classify inputs into `handleConversationalPrompt()` (which fell back to a hardcoded marketing banner on API errors) vs `executeUserTask()` (which unconditionally spawned a 4-agent swarm on words like "wtf"). | `[VERIFIED]` (Repo defect) |
| **Nomin Code Fix (v2.5)** | Unified Single-Loop Intent Router | High-speed heuristic router classifies: `CHAT/QUESTION`, `CODE-EXPLAIN`, `SMALL-TASK`, `LARGE-TASK`, `SLASH-COMMAND`, `UNCLEAR/NOISE`. `UNCLEAR/NOISE` returns a short conversational clarification prompt. Only `LARGE-TASK` or explicit `/plan` invokes the swarm. | `[VERIFIED]` (Implemented in `src/swarm/intent-router.ts`) |

---

### 1.3 Error Handling & Self-Repair

| Harness | Failure Mode | Repair Strategy | Verification Tag |
| :--- | :--- | :--- | :--- |
| **OpenCode** | Tool execution exception (`packages/core/src/tool.ts`) | Catches runtime errors and serializes error object as a tool result message `{ role: "tool", content: "Error: " + err.message }`. Next turn allows model to self-repair. | `[VERIFIED]` |
| **Aider** | Search block mismatch (`aider/coders/base_coder.py`) | If exact search chunk is not found, computes fuzzy/Levenshtein distance, provides line number hint to model, and retries up to `num_reflections` times. | `[VERIFIED]` |
| **NVIDIA NIM Gateway** | 410 Gone / 403 Forbidden | 410 indicates a model that passed its end-of-life retirement date. 403 Forbidden indicates missing "Public API Endpoints" / inference permission on the NVIDIA organization account. Must be categorized distinctly without infinite retries. | `[VERIFIED]` (Confirmed via live HTTP probe) |
| **Claude Code** | Rate Limit (429) & Network Jitter (5xx) | Honors `retry-after` header strictly. Uses exponential backoff with full decorrelated jitter. Displays an in-place rate-limit countdown without flooding terminal scrollback. | `[DOCUMENTED]` / `[INFERRED]` |

---

### 1.4 Completion Verification & Definition of Done (DoD)

| Harness | Mechanism | Verification Guarantee | Verification Tag |
| :--- | :--- | :--- | :--- |
| **SWE-agent** | `sweagent/agent/reviewer.py` | Strictly blocks submission until verification script exits with return code 0. Rejects any attempt to emit completion tokens while tests are failing. | `[VERIFIED]` |
| **Claude Code** | Verification Phase | Runs project test command (`npm test`, `pytest`, `cargo test`) before summarizing task completion. Re-evaluates git diff to ensure no unexpected modifications or deleted tests. | `[DOCUMENTED]` / `[INFERRED]` |
| **Nomin Code** | `DoDEngine` & `AstIntegrityInspector` | Extracts acceptance criteria into executable bash commands. Executes checks in isolated worktrees. Inspects AST to ensure functions are not hollowed out (`TODO`, empty pass). Verification only applies to code modifications, never on chat turns. | `[VERIFIED]` (In `src/verifier/`) |

---

### 1.5 Terminal UI (TUI) Patterns & Ergonomics

| Feature | OpenCode (`packages/tui`) | Aider (`aider/io.py`) | Claude Code (Observed) | Nomin Code v2.5 Specification |
| :--- | :--- | :--- | :--- | :--- |
| **Navigation** | Arrow keys (`Up`/`Down`), Enter to select, Esc to cancel. `[VERIFIED]` | Prompt-toolkit completions, arrow navigation. `[VERIFIED]` | Full arrow-key menus, zero typed numbers. `[DOCUMENTED]` | Arrow-key navigation across all menus, lists, and dialogs. Zero typed index numbers. |
| **Filtering** | Type-to-filter with instant live update. `[VERIFIED]` | File autocomplete on `@` / Tab. `[VERIFIED]` | Dynamic fuzzy filtering in `/model` and command palettes. `[DOCUMENTED]` | `FilterableList` virtualized fuzzy filtering over 100+ items. |
| **Effort / Thinking** | Variant selector with token budget. `[VERIFIED]` | N/A (model dependent). | Inline slider / option selector. `[DOCUMENTED]` | `InlineSlider` component with Left/Right arrow keys (`off`, `low`, `med`, `high`, `max`). |
| **Scrollback** | Clean rendering with in-place updates. `[VERIFIED]` | Streaming text output with minimal clears. `[VERIFIED]` | Docked status bar, single launch banner, zero redraw spam into scrollback. `[DOCUMENTED]` | Pinned single-line status bar and contextual footer. Redraws update in place via ANSI cursor control. |

---

## 2. Multi-Agent Swarm & Team Structure (Grok Claims Deconstruction)

### 2.1 Grok 4.20 Swarm Structure Analysis
- **Reported Names in Community**: `NEXUS` (Orchestrator), `HARPER` (Scout/Researcher), `BENJAMIN` (Builder/Coder), `LUCAS` (Adversarial Verifier).
- **Claim Status**: `[UNVERIFIED]` (Source: Community reverse-engineering posts and public discourse; xAI has not published official SDK code for these specific names).
- **Documented xAI Multi-Agent Behavior**: Official xAI system descriptions state that multiple agents deliberate internally on queries and a synthesizer produces the final answer within an internal inference pass.
- **Critical Architectural Difference**:
  - In a proprietary cloud service like Grok, agent discussions occur inside internal inference clusters.
  - In a client-side harness like Nomin Code, each agent role makes **independent external HTTP API calls** against the user's provider endpoint (e.g. NVIDIA NIM or OpenAI).
  - A 4-agent swarm making 5 turns each consumes $\approx 20$ API calls per user goal.
  - At an account rate limit of 30–40 RPM, an unthrottled swarm will trigger HTTP 429 within 30 seconds.
- **Nomin Code Adopted Solution**:
  1. Default to **SOLO Mode** (1 model, 1 agent loop). Verification runs as a separate fresh-context pass.
  2. Support **TEAM Mode** (2 to 5 agents) where the user explicitly assigns models from their active provider. Roles can share a single model to conserve rate limits.
  3. Strict **Request Budgeting**: Pre-calculate estimated API calls per task, display the budget to the user, and enforce request caps through `NominRateLimitScheduler`.
