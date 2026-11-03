# Comprehensive Comparison Matrix: 11 Systems × 12 Architectural Dimensions

> **Methodology**: Systematic evaluation across verified source checkouts, official specifications, and empirical test harnesses.
> **Tagging**: All data points are marked as `[VERIFIED]` from repository inspection, `[DOCUMENTED]` from official guides, or `[INFERRED]` from benchmark analysis.

---

## The Master Matrix

| Feature / Dimension | OpenCode (`sst/opencode`) | DeepSeek Harness (`@deepseek-ai/dsh`) | Grok Build (`grok-build`) | Claude Code (Anthropic) | Aider (`aider-chat`) | SWE-agent (Princeton) | OpenHands (`software-agent-sdk`) | Cline / Roo Code | Continue (`continuedev`) | ZCode / Kimi Code | Google Antigravity | Nomin Code (Target Spec) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Core Agent Loop & Language** | Effect-TS Reactive Loop `[VERIFIED]` | Cordis Plugin Framework (TS) `[VERIFIED]` | Rust Tokio Actor System `[VERIFIED]` | TypeScript CLI Loop `[DOCUMENTED]` | Python Iterative Loop `[VERIFIED]` | Python ReAct Loop `[VERIFIED]` | Python FastAPI + EventStream `[VERIFIED]` | TypeScript Async Loop `[VERIFIED]` | TypeScript / Node.js `[VERIFIED]` | Node.js / Rust Native `[VERIFIED]` | Python / TypeScript Hybrid `[DOCUMENTED]` | **Decoupled TS & Python Skeletons** |
| **2. Primary Edit Strategy** | Patchmark / Whole File `[VERIFIED]` | Structured File-Store `[VERIFIED]` | In-memory AST Edit `[VERIFIED]` | Targeted Line Edit `[DOCUMENTED]` | Search-Replace Blocks with Levenshtein `[VERIFIED]` | ACI `edit_lines` `<start>:<end>` `[VERIFIED]` | Whole-File / Diff `[VERIFIED]` | Search-Replace & Whole-File `[VERIFIED]` | Streaming Myers Diff `[VERIFIED]` | Chunked Search-Replace `[VERIFIED]` | Block Replacement `[DOCUMENTED]` | **Multi-tier Fuzzy Search-Replace + Myers Stream** |
| **3. Codebase Retrieval** | Ripgrep + File Tree `[VERIFIED]` | Directory Index `[VERIFIED]` | In-memory AST Scope Graph `[VERIFIED]` | Grep + Glob + LSP `[DOCUMENTED]` | Tree-sitter PageRank RepoMap `[VERIFIED]` | `open_file` + `scroll_down` `[VERIFIED]` | Vector Search + Ripgrep `[VERIFIED]` | Ripgrep + AST Defs `[VERIFIED]` | SQLite Vector Embeddings `[VERIFIED]` | Native PE Search Binary `[VERIFIED]` | Grep / Glob + Symbol Index `[DOCUMENTED]` | **Tree-sitter RepoMap + Scope Graph + LSP** |
| **4. Subagents & Topology** | Linear Subagent Jobs `[VERIFIED]` | Cordis Subagents `[VERIFIED]` | Message-Delivery Actor Mesh `[VERIFIED]` | Agent Teams + Mailbox `[DOCUMENTED]` | Architect / Editor Dual Agent `[VERIFIED]` | Single Agent + Reviewer `[VERIFIED]` | Orchestrator-Worker Container `[VERIFIED]` | Dynamic Role Modes `[VERIFIED]` | Single-agent chat `[VERIFIED]` | ACP Multi-Server `[VERIFIED]` | Hub & Spoke Reactive `[DOCUMENTED]` | **Hierarchical Swarm + Central Blackboard** |
| **5. Context Compaction** | Auto-buffer (15% / 16K free) `[VERIFIED]` | Fiber Compaction `[VERIFIED]` | Compaction Transcripts `[VERIFIED]` | Auto-summarize at 80% `[DOCUMENTED]` | History truncation by tokens `[VERIFIED]` | Trajectory sliding window `[VERIFIED]` | Message list pruning `[VERIFIED]` | Sliding token window `[VERIFIED]` | Manual chat clear `[VERIFIED]` | Minidb session prune `[VERIFIED]` | Artifact offload `[DOCUMENTED]` | **Dual-Tier: 15% Buffer + Artifact Offload** |
| **6. Reasoning / Thinking Handling** | Basic text strip `[VERIFIED]` | Native Replay + Signatures `[VERIFIED]` | Token strip `[VERIFIED]` | Native Anthropic Thinking `[DOCUMENTED]` | Strips `<think>` tags `[VERIFIED]` | Not handled `[VERIFIED]` | LiteLLM token extraction `[VERIFIED]` | Strips `<think>` blocks `[VERIFIED]` | Not handled `[VERIFIED]` | Native GLM/Kimi CoT `[VERIFIED]` | Extracted CoT `[DOCUMENTED]` | **Full Replay + Delta Stream Parser** |
| **7. Worktree / Sandbox Isolation** | In-place / worktree spec `[VERIFIED]` | Native Process Sandbox `[VERIFIED]` | Btrfs / OverlayFS / Git Worktree `[VERIFIED]` | `.claude/worktrees/` `[DOCUMENTED]` | In-place with auto-git commit `[VERIFIED]` | Docker Container Sandbox `[VERIFIED]` | Docker Container + PTY `[VERIFIED]` | Local filesystem `[VERIFIED]` | Local filesystem `[VERIFIED]` | Local filesystem `[VERIFIED]` | Sandboxed CLI execution `[DOCUMENTED]` | **Git Worktree Per Agent + Merge Pipeline** |
| **8. Rate Limiting & Retry** | Effect Schedule + Retry-After `[VERIFIED]` | `llm-retry` module `[VERIFIED]` | Tokio rate-limit `[VERIFIED]` | Bounded exponential backoff `[DOCUMENTED]` | Basic litellm retry `[VERIFIED]` | None (assumes dedicated API) `[VERIFIED]` | LiteLLM fallback `[VERIFIED]` | Basic exponential backoff `[VERIFIED]` | Basic exponential backoff `[VERIFIED]` | Fixed-interval retry `[VERIFIED]` | Reactive queue backpressure `[DOCUMENTED]` | **Dual Token/Leaky Bucket + Full Jitter** |
| **9. Definition of Done / Verification** | User approval prompt `[VERIFIED]` | None `[VERIFIED]` | `TodoGate` check `[VERIFIED]` | Test execution prompt `[DOCUMENTED]` | Automated git commit `[VERIFIED]` | Flake8 linter hook `[VERIFIED]` | Unit test runner `[VERIFIED]` | User approval UI `[VERIFIED]` | Manual user review `[VERIFIED]` | Formal proof hook `[VERIFIED]` | Artifact verification `[DOCUMENTED]` | **Two-Phase DoD Evidence Gate + Verifier Agent** |
| **10. Prompt Reminders / Nudges** | Instruction State `[VERIFIED]` | Cordis Hooks `[VERIFIED]` | `TodoNudge` + `TodoGate` `[VERIFIED]` | System Reminder Injection `[DOCUMENTED]` | Base system prompt `[VERIFIED]` | ACI instructions `[VERIFIED]` | Step-end reminders `[VERIFIED]` | Custom instructions `[VERIFIED]` | Slash commands `[VERIFIED]` | System prompt `[VERIFIED]` | Reactive notifications `[DOCUMENTED]` | **Turn-End TodoGate + Periodic Nudges** |
| **11. Provider & Model Agnosticism** | Multi-provider (`@opencode/ai`) `[VERIFIED]` | DeepSeek optimized `[VERIFIED]` | xAI backend focused `[VERIFIED]` | Anthropic Claude only `[DOCUMENTED]` | LiteLLM / 100+ models `[VERIFIED]` | LiteLLM / OpenAI API `[VERIFIED]` | LiteLLM / 100+ models `[VERIFIED]` | 20+ Providers `[VERIFIED]` | 20+ Providers `[VERIFIED]` | Kimi/GLM native `[VERIFIED]` | Google Gemini native `[DOCUMENTED]` | **100% Agnostic + Auto-Profiling Probe** |
| **12. Latency Optimization** | Server SSE Streaming `[VERIFIED]` | Native SSE delta decoding `[VERIFIED]` | Rust native zero-cost async `[VERIFIED]` | Prefix caching `[DOCUMENTED]` | Streaming completions `[VERIFIED]` | Blocking batch execution `[VERIFIED]` | WebSocket streaming `[VERIFIED]` | Fast UI streaming `[VERIFIED]` | Myers stream diff `[VERIFIED]` | SSE stream `[VERIFIED]` | Parallel subagent stream `[DOCUMENTED]` | **Speculative Tool Calls + Streaming Myers Diff** |

---

## Deep Dive Analysis: Key Architectural Tradeoffs

### 1. Edit Strategy: Search-Replace vs. Whole-File vs. Unified Diff
- **Whole-File Rewrites (`OpenHands`, naive agents)**:
  - *Failure Mode*: Fails drastically on files > 150 lines with smaller models (14B–32B). Models emit `// ... remaining code ...` or accidentally delete comments and imports.
  - *Verdict for Nomin Code*: **Strictly Rejected** for files over 50 lines.
- **Unified Diff Patches (`SWE-agent`, `patch`)**:
  - *Failure Mode*: Small models are notoriously poor at mental arithmetic and line-offset counting, causing hunk rejections (`patch failed: fuzz factor exceeded`).
  - *Verdict for Nomin Code*: **Rejected as primary**, retained only as an internal export format for Git.
- **Search-Replace Blocks with Fuzzy Fallback (`Aider`, `Nomin Code`)**:
  - *Winning Pattern*: The model specifies a unique snippet of 3–10 lines to find, followed by the replacement lines.
  - *Fuzzy Resilience*: Implementing Levenshtein similarity (>0.85 threshold) and whitespace insensitivity ensures edits apply cleanly even when line endings or indentation vary.

### 2. Multi-Agent Topology: Peer-to-Peer vs. Central Blackboard
- **Pure Peer-to-Peer Swarms (Grok / Autonomous Agents)**:
  - *Failure Mode*: Rapidly devolves into endless conversational loops, hallucinated consensus, and runaway token costs when small models talk to small models without a designated tie-breaker.
- **Pure Orchestrator-Worker (Classic Claude Code / OpenCode)**:
  - *Failure Mode*: Central orchestrator becomes a bottleneck; cannot parallelize cross-cutting tasks (e.g. frontend, backend, test) efficiently.
- **Hybrid Blackboard + Role-Specialized Swarm (`Nomin Code Reference Architecture`)**:
  - *Winning Pattern*: A central shared state (Blackboard) records the formal Task DAG, symbol cache, and merge locks. A Lead Architect decomposes work and sets acceptance criteria; specialized workers (Coder, Tester) execute concurrently in isolated Git worktrees; an independent Verifier controls the completion gate.
