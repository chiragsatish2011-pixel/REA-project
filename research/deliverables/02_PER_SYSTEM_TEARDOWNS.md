# Per-System Architectural Teardowns

> **Scope**: In-depth reverse-engineering teardowns of 12 primary AI coding agent architectures.
> **Methodology**: Source code analysis of local checkouts in `research/repos/`, official engineering documentation in `research/docs/claude/`, published papers, and observed behavioral traces.
> **Tags**: `[VERIFIED]` (inspected from source code), `[DOCUMENTED]` (from official reference documentation/specifications), `[INFERRED]` (architectural deduction from observed operational characteristics).

---

## 1. OpenCode (`sst/opencode`)

### Architecture Overview
OpenCode is built on a high-concurrency **Effect-TS** reactive microkernel with a strict client/server split, event-driven streaming, and durable SQLite session persistence.

```mermaid
flowchart TD
    Client[TUI / CLI / Web Client] <-->|JSON-RPC / SSE Events| Server[OpenCode Core Server]
    
    subgraph OpenCode Core
        Server --> SessionRunner[Session Runner & Coordinator]
        SessionRunner --> Compaction[Compaction Service (15% Free Buffer)]
        SessionRunner --> ToolRegistry[Tool Engine & CodeMode Sandbox]
        SessionRunner --> ModelRetry[Model Retry & Rate Limiter]
        
        ModelRetry --> AIProvider[Provider Layer (@opencode/ai)]
        ToolRegistry --> FS[File System / Patchmark]
        ToolRegistry --> MCP[MCP Client Manager]
        ToolRegistry --> LSP[LSP Client Manager]
    end
    
    AIProvider <-->|OpenAI / Anthropic / Bedrock| CloudLLM[LLM Endpoints]
```

### Key Source Files & Concepts `[VERIFIED]`
- **`packages/core/src/model-retry.ts`**: Bounded exponential backoff with full jitter and `RETRY_AFTER_MAX = 15 minutes`. Uses Effect-TS `Schedule`:
  ```ts
  const schedule = Schedule.max([
    Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("10 seconds")]),
    Schedule.recurs(10),
  ]).pipe(
    Schedule.jittered,
    Schedule.modifyDelay(({ input, duration: delay }) => {
      const minimum = retryAfter(input)
      return Effect.succeed(Duration.millis(minimum ? Math.max(delay, minimum) : delay))
    })
  )
  ```
- **`packages/core/src/session/compaction.ts`**: Autonomous context compaction. Maintains a configurable buffer (default: **keeps 15% and at least 16K tokens free** below model context window). Employs background summarization fibers and preserves critical system prompt anchors.
- **`packages/core/src/tool.ts` & `specs/v2/tools.md`**: Structural tool definition combining Effect schema and Standard JSON Schema. Every call receives durable invocation context: `sessionID`, `agent`, `messageID`, `callID`, and a streaming `progress()` sink.
- **`packages/core/src/permission.ts`**: Fine-grained capability permissions (`allow`, `ask`, `deny`) with glob-path whitelists and read-only bash command auto-approval.

### Strengths & Weaknesses
- **Strengths**: Industrial-grade error handling via Effect-TS; excellent durable session resume; deterministic retry policies bounded by provider headers; rock-solid compaction triggers.
- **Weaknesses**: High cognitive overhead of Effect-TS codebase; subagent hierarchy is largely sequential rather than autonomous swarm-based; heavy TypeScript runtime footprint.

---

## 2. DeepSeek Harness (`@deepseek-ai/dsh`)

### Architecture Overview
Developed by DeepSeek AI, `dsh` is an everything-is-a-plugin agent harness powered by the [Cordis](https://github.com/cordiverse/cordis) spatiotemporal component model, designed specifically to exploit DeepSeek-V3 and DeepSeek-R1 features.

```mermaid
flowchart TD
    DSH[DSH Core Runtime] --> PluginManager[Cordis Plugin Manager]
    
    PluginManager --> LLMDeepSeek[llm-deepseek Adapter]
    PluginManager --> TokenMeter[Token Meter (Cache Accounting)]
    PluginManager --> SubagentMgr[Subagent Package]
    PluginManager --> CompactionPkg[Compaction & Context Management]
    
    LLMDeepSeek --> SSEParser[SSE Stream Parser]
    SSEParser --> ReplayEngine[Thinking & Signature Replay Engine]
    LLMDeepSeek --> FileStore[FIM & Files API Store]
```

### Key Source Files & Concepts `[VERIFIED]`
- **`packages/llm/llm-deepseek/src/translate.ts`**: Native handling of thinking/reasoning blocks and signatures:
  ```ts
  case 'thinking':
    content = { type: 'reasoning', text: string(native.thinking) }
    replay = { type: 'reasoning', ...native.signature ? { signature: string(native.signature) } : {} }
    break
  ```
  Parses `thinking_delta`, `signature_delta`, and `input_json_delta` chunks directly.
- **`packages/llm/llm-deepseek/src/serialize.ts`**: Replays previous reasoning blocks back to DeepSeek endpoints so the model retains its internal chain-of-thought without losing multi-turn reasoning context.
- **`packages/llm/llm-deepseek/src/translate.ts` (`updateUsage`)**: Explicitly tracks context caching statistics via `cache_read_input_tokens` and `cache_creation_input_tokens`, enabling the scheduler to calculate exact cost and latency amortization.
- **`packages/llm/llm-deepseek/src/adapter.ts`**: Implements JSON repair fallback for malformed tool calls generated by smaller models (`try { JSON.parse(raw) } catch { return {} }`).

### Strengths & Weaknesses
- **Strengths**: World-class handling of reasoning tokens and cryptographic replay signatures; exact prompt caching observability; clean decoupled plugin architecture.
- **Weaknesses**: Developer preview; complex abstraction layers in Cordis; limited out-of-the-box multi-agent orchestration.

---

## 3. Grok Build (`grok-build` / SpaceXAI)

### Architecture Overview
A blazingly fast full-screen TUI coding agent written in **Rust**, featuring high-performance codebase indexing, snapshot-based worktree isolation, and proactive turn reminders.

```mermaid
flowchart TD
    GrokTUI[Grok Terminal TUI / ACP Protocol] --> AgentCore[xai-grok-agent]
    
    AgentCore --> ReminderEngine[system_reminder.rs (TodoGate & TodoNudge)]
    AgentCore --> WorktreeEngine[xai-fast-worktree (btrfs / overlay / git)]
    AgentCore --> CodeGraph[xai-codebase-graph (AST Scope Graph)]
    AgentCore --> ToolRuntime[xai-tool-runtime & Protocol]
    AgentCore --> MessageCore[xai-message-delivery-core]
```

### Key Source Files & Concepts `[VERIFIED]`
- **`crates/codegen/xai-grok-agent/src/system_reminder.rs`**: Proactive turn reminder engine:
  - `TodoNudgeConfig`: Automatically injects a reminder to update tasks if `turns_since_todo_write >= 3`, throttled to once every 5 turns.
  - `TodoGateConfig`: A turn-end gate that halts completion:
    ```rust
    pub const DEFAULT_TODO_GATE_MAX_FIRES: u32 = 2;
    // Injects a <system-reminder> if pending or unbacked in-progress todos
    // remain after a content-only assistant message.
    ```
- **`crates/codegen/xai-fast-worktree/src/`**: Multi-tier filesystem isolation:
  - Leverages Linux `btrfs` copy-on-write subvolumes, `overlayfs`, and `git worktree` to instantiate zero-cost isolated agent environments in <50ms.
  - Automatic garbage collection (`auto_gc.rs`) and background sync (`sync.rs`).
- **`crates/codegen/xai-codebase-graph/src/`**: In-memory AST symbol dependency graph (`index_manager.rs`, `scope_graph`) providing sub-millisecond symbol resolution without external language server latency.

### Strengths & Weaknesses
- **Strengths**: Unmatched execution speed; zero-copy worktree sandboxing; powerful anti-laziness reminders (`TodoGate` prevents premature exit).
- **Weaknesses**: Rust codebase makes third-party scripting harder; tightly integrated with xAI internal backend APIs.

---

## 4. Claude Code (Anthropic)

### Architecture Overview
Anthropic's terminal-native agent designed around subagents, multi-session **Agent Teams**, isolated worktrees, and strict permission tiers.

```mermaid
flowchart TD
    UserCLI[Claude Code CLI] --> MainSession[Main Session (Team Lead)]
    
    subgraph Multi-Agent Hierarchy
        MainSession -->|Agent / TaskCreate| AgentTeams[Agent Teams Coordinator]
        AgentTeams --> Subagent1[Explore Subagent (Read-Only)]
        AgentTeams --> Subagent2[Coder Teammate (Worktree 1)]
        AgentTeams --> Subagent3[Tester Teammate (Worktree 2)]
        
        Subagent1 <-->|SendMessage Mailbox| Subagent2
        Subagent2 <-->|SendMessage Mailbox| Subagent3
    end
    
    MainSession --> Permissions[Auto-Mode Permission Classifier]
    MainSession --> Worktrees[Git Worktree Manager (.claude/worktrees)]
    MainSession --> ContextCompactor[Context Compaction & CLAUDE.md]
```

### Key Reference Specs & Concepts `[DOCUMENTED]`
- **`research/docs/claude/agent-teams.md`**: Experimental multi-agent collaboration. Sessions communicate via direct peer-to-peer mailboxes (`SendMessage`) and a shared task list (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`). Team lead synthesizes results.
- **`research/docs/claude/sub-agents.md`**: Single-session subagents run in isolated context windows with restricted toolsets (e.g. `Explore` is read-only and omits `CLAUDE.md` to conserve context). Hard ceiling: combined subagent descriptions must not exceed **15,000 tokens**.
- **`research/docs/claude/worktrees.md`**: Spawns parallel sessions into `.claude/worktrees/<name>` on dedicated branches (`worktree-<name>`), copying untracked/ignored environment configs via `.worktreeinclude`.
- **`research/docs/claude/tools-reference.md`**: Core toolset (`Read`, `Edit`, `Bash`, `Agent`, `SendMessage`, `LSP`, `Monitor`, `AskUserQuestion`, `Artifact`).
- **Auto-Mode Classifier**: A fast, small classifier model evaluates shell execution commands to auto-approve safe operations while prompting only for destructive file modifications outside the workspace.

### Strengths & Weaknesses
- **Strengths**: Exceptional prompt ergonomics; gold-standard subagent and agent-team models; clean worktree sandboxing.
- **Weaknesses**: Proprietary, closed-source harness; tightly coupled to Claude 3.5 Sonnet / Opus token formats and pricing.

---

## 5. Aider (`aider-chat`)

### Architecture Overview
The benchmark pioneer for LLM-based coding, celebrated for its **RepoMap** PageRank code retrieval, **Architect/Editor** split, and robust edit-block formats.

```mermaid
flowchart LR
    Prompt[User Request] --> RepoMapGen[RepoMap: Tree-sitter + PageRank]
    RepoMapGen --> Arch[Architect Agent (Reasoning Model)]
    Arch -->|Structured Spec| Editor[Editor Agent (Coding Model)]
    Editor --> DiffParser[Search-Replace Block Parser]
    DiffParser -->|Fuzzy Levenshtein Fallback| Disk[Working Directory Files]
    Disk --> GitCommit[Automatic Git Checkpoint Commit]
```

### Key Source Files & Concepts `[VERIFIED]`
- **`aider/repomap.py`**: Tree-sitter extraction of tags (definitions and references) cached in SQLite (`.aider.tags.cache.v4`). Computes PageRank over symbol references to fit the entire repository's architecture into a strict token budget (e.g., 1024 tokens).
- **`aider/coders/architect_coder.py`**: Splits work into two distinct LLM calls:
  1. *Architect*: Decides the implementation strategy using a high-reasoning model.
  2. *Editor*: Formats the strategy into concrete code changes using a fast, code-specialized model.
- **`aider/coders/search_replace.py`**: Highly reliable `<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE` edit blocks with multi-tier fuzzy matching (whitespace tolerance, blank line stripping, sliding window Levenshtein ratio > 0.85).
- **Automated Git Checkpointing**: Commits before and after every turn with auto-generated descriptive commit messages, enabling instant rollback on broken edits.

### Strengths & Weaknesses
- **Strengths**: Maximum efficiency on small context windows; highest edit block application reliability in the industry; works cleanly with open local models.
- **Weaknesses**: Single-threaded, synchronous loop; no native parallel multi-agent swarm; limited autonomous tool calling (mostly bash + edit).

---

## 6. SWE-agent (Princeton University)

### Architecture Overview
Designed specifically for the SWE-bench evaluation benchmark, SWE-agent introduced the **Agent-Computer Interface (ACI)**, transforming the Linux shell into an LLM-friendly IDE.

```mermaid
flowchart TD
    Issue[GitHub Issue Statement] --> SWEAgentLoop[SWE-Agent ReAct Loop]
    
    SWEAgentLoop --> ACI[Agent-Computer Interface (ACI)]
    ACI --> CustomCmds[Custom Commands: open_file, scroll_down, edit_lines]
    ACI --> Linter[Real-time Linter Hook (flake8)]
    ACI --> DockerEnv[Isolated Docker Container Sandbox]
    
    SWEAgentLoop --> Trajectory[Trajectory Recorder & Replay Harness]
```

### Key Source Files & Concepts `[VERIFIED]`
- **`sweagent/tools/commands.py`**: Custom bash commands that bound context output:
  - `open <file> <line>`: Opens a file viewing window of 100 lines centered on `<line>`.
  - `scroll_up`, `scroll_down`: Paginates through files without blowing up the context window.
  - `edit <start_line>:<end_line>`: Direct line-replacement tool.
- **Linting Hooks**: After every edit command, an automated linter (`flake8`) runs in the background. If syntax errors or missing variables are introduced, the error is immediately returned to the model before committing.
- **Strict Trajectory Logging**: Records all commands, thoughts, model inputs/outputs, and environment states into JSONL trajectories for deterministic replay and failure analysis.

### Strengths & Weaknesses
- **Strengths**: High solve rate on real SWE-bench issues; superb command output bounding; automated syntax error catches.
- **Weaknesses**: Tailored for single-issue resolution rather than interactive multi-session development; line-number editing is brittle when file lengths shift.

---

## 7. OpenHands (`software-agent-sdk`)

### Architecture Overview
An extensible, modular open-source platform featuring an independent agent server, Dockerized workspace sandboxes, and a reactive event stream architecture.

```mermaid
flowchart TD
    Client[Web UI / SDK Client] <-->|WebSocket Event Stream| AgentServer[openhands-agent-server]
    
    AgentServer --> Controller[Agent Controller & State Machine]
    Controller --> LLM[LLM Interface (LiteLLM)]
    Controller --> Workspace[openhands-workspace (Docker Sandboxed PTY)]
    Controller --> Tools[openhands-tools (Bash, Browser, FileEdit)]
```

### Key Source Files & Concepts `[VERIFIED]`
- **`openhands-agent-server/`**: FastAPI/WebSocket backend decoupling agent orchestration from user interfaces.
- **`openhands-workspace/`**: Heavy container isolation running a persistent PTY inside Docker, streaming raw ANSI terminal escape sequences and stdout back to the host.
- **State Machine Controller**: Distinct phases (`INITIALIZING`, `RUNNING`, `AWAITING_USER_INPUT`, `STOPPED`, `ERROR`), supporting pause, resume, and step-by-step execution.

### Strengths & Weaknesses
- **Strengths**: Production-grade microservices architecture; full GUI browser-use integration; comprehensive Docker sandboxing.
- **Weaknesses**: Heavy resource footprint; high latency per turn due to complex event plumbing.

---

## 8. Cline / Roo Code

### Architecture Overview
A popular VS Code extension and standalone CLI agent known for its step-by-step approval UX, dynamic system prompt construction, and hierarchical subagent modes.

```mermaid
flowchart TD
    VSCode[VS Code Webview UI / CLI] <--> ClineCore[ClineCore.ts Execution Loop]
    
    ClineCore --> Prompts[Prompt Builder (Context, Rules, Modes)]
    ClineCore --> DiffView[Interactive Diff Review Engine]
    ClineCore --> Permissions[Auto-Approve Granular Permissions]
    ClineCore --> SubagentModes[Subagent Modes (Architect, Code, Ask)]
```

### Key Source Files & Concepts `[VERIFIED]`
- **`sdk/packages/core/src/ClineCore.ts`**: The core recursive ReAct loop. Maintains a persistent message history, evaluates user approval gates, and manages tool invocation states.
- **Granular Auto-Approve**: Allows developers to whitelist specific tools (e.g. `read_file`, `list_files`) while requiring confirmation for `execute_command` or `write_to_file`.
- **Mode-Specific Prompts**: Allows switching roles dynamically (e.g., *Architect* mode has read-only file tools and focuses on high-level planning; *Code* mode has write tools).

### Strengths & Weaknesses
- **Strengths**: Outstanding developer UX; clear visual diffs before applying changes; highly responsive streaming.
- **Weaknesses**: Monolithic agent loop in earlier versions; susceptible to context bloat without proactive compaction.

---

## 9. Continue (`continuedev`)

### Architecture Overview
An open-source AI code assistant specializing in inline completions, chat, and streaming Myers diff edits within IDEs.

### Key Source Files & Concepts `[VERIFIED]`
- **`core/diff/myers.ts` & `streamDiff.ts`**: Implements the classic Myers diff algorithm optimized for **token-by-token streaming**. Allows the IDE to display green/red diff hunks in real-time as the LLM generates replacement tokens, rather than waiting for the entire file to finish generation.
- **`core/indexing/`**: Context provider subsystem indexing local codebases via SQLite and vector embeddings for hybrid retrieval.

---

## 10. ZCode (Zhipu GLM) & Kimi Code (Moonshot AI)

### Architecture Overview
Chinese frontier agent implementations designed to handle ultra-long contexts (128K–2M tokens) and specialized Chinese/English dual-language tokenizers.

### Key Source Files & Concepts `[VERIFIED]`
- **`ZCode`**: Utilizes native CUA (Computer Use Agent) protocols (`zcode-cua`), formal proof verification hooks (`formal-proof`), and pre-packaged native search tools (`native-search-tools-windows-pe.mjs`).
- **`kimi-code` (`packages/agent-core-v2`)**: Implements ACP (Agent Client Protocol) and KAP (Kimi Agent Protocol) servers, paired with a lightweight embedded database (`minidb`) for sub-millisecond local state queries.

---

## 11. Google Antigravity

### Architecture Overview
Google's advanced agentic coding environment, centered on parallel subagents, reactive wakeups, rich generative UI artifacts, and structured skill bundles.

```mermaid
flowchart TD
    AntigravityKernel[Antigravity Runtime] --> AgentManager[Agent Manager & Subagent Hub]
    
    AgentManager --> Subagent1[Codebase Researcher (Read-Only)]
    AgentManager --> Subagent2[Feature Implementer (Read/Write)]
    AgentManager --> Subagent3[Browser / Visual Verifier]
    
    AgentManager --> ArtifactDir[Artifact Engine (.md with Mermaid/KaTeX)]
    AgentManager --> SkillsRegistry[Skills Registry (Custom Workflows)]
    AgentManager --> MessageBus[Reactive Wakeup Messaging System]
```

### Key Reference Concepts `[DOCUMENTED]`
- **Reactive Wakeup (Zero Polling)**: Agents communicate via asynchronous message passing (`send_message`, background tasks). The kernel halts execution when idle and reactivates immediately upon incoming message arrival, eliminating CPU-spinning poll loops.
- **Structured Artifacts**: Employs interactive Markdown documents containing Mermaid architecture diagrams, comparison tables, KaTeX formulas, and carousel components to present actionable technical artifacts without cluttering conversation history.
- **Sandboxed Sidecars & Device Hubs**: Provides sidecars for mobile/browser testing (Android Device Hub, Compose Preview, Chrome DevTools) with automated screenshot verification.

---

## 12. Cursor, Windsurf, Devin, and Manus

### Comparative Teardown `[DOCUMENTED]` / `[INFERRED]`
- **Cursor**: Speculative next-edit prediction via small local models (Cursor Tab FIM); multi-file editing via shadow workspace indexing; semantic symbol reranking over Merkle tree AST hashes.
- **Windsurf (Codeium)**: "Cascade" flow tracking real-time developer intent across file navigation; unified memory model linking IDE events directly to agent prompts.
- **Devin (Cognition)**: Long-horizon autonomous planning; dedicated web browser sandbox with visual feedback; strict Definition-of-Done verification where Devin compiles and verifies running web applications before notifying the user.
- **Manus**: Dynamic task DAG generation with multi-agent delegation; autonomous web scraping and multi-modal report compilation.
