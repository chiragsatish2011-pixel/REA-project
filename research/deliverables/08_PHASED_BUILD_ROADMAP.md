# Phased Implementation Roadmap & Risk Matrix

> **Execution Blueprint**: Progressive engineering milestones to take Nomin Code from a zero-dependency weekend prototype to an enterprise-grade multi-agent autonomous swarm.

---

## 1. Phased Development Milestones

```mermaid
flowchart LR
    MVP[Phase 1: Weekend MVP\n(Dual Agent + Fuzzy Edit)] --> V1[Phase 2: v1 Production Core\n(4+ Agent Swarm + Worktrees)]
    V1 --> V2[Phase 3: v2 Distributed Swarm\n(AST Scope Graph + Speculative Stream)]
```

### Phase 1: Weekend MVP (48-Hour Sprint)
*Focus: Establish the minimal high-reliability loop with zero false "done" claims and rate-limit safety.*
- **Scope & Features**:
  1. **Dual-Agent Core**: Simple sequential Architect $\to$ Coder pipeline running on an OpenAI-compatible endpoint (NVIDIA NIM or local vLLM).
  2. **Search-Replace Tool**: Implements `edit_file` with basic whitespace-tolerant fuzzy search.
  3. **In-Memory Rate Limiter**: Single Token Bucket enforcing RPM and TPM limits with Full Jitter backoff.
  4. **Basic DoD Gate**: Mandatory compilation/test command check before emitting task completion.
- **Deliverables**: Single-file Python/Node.js script with zero external infrastructure dependencies.

### Phase 2: v1 Production Core (Month 1)
*Focus: Scale to 4 parallel agents, full Git worktree isolation, and complete Definition-of-Done verification.*
- **Scope & Features**:
  1. **4-Agent Swarm**: Fully decoupled Architect, Coder, Tester, and Reviewer communicating via the Central Blackboard (`.nomin/state/blackboard.json`).
  2. **Git Worktree Manager**: Automates creation, micro-commits, and fast-forward merges for `.nomin/worktrees/<agent_id>`.
  3. **Aider-Style RepoMap**: Tree-sitter AST extraction with PageRank symbol ranking constrained to a 2048-token budget.
  4. **Production Rate-Limit Scheduler**: Dual Token Bucket + Leaky Bucket + 3-tier Priority Queue (`CRITICAL`, `INTERACTIVE`, `BACKGROUND`).
  5. **Turn-End TodoGate & Reminders**: Grok-style proactive nudges preventing agent stalling.
  6. **CLI & TUI Interface**: Interactive terminal interface displaying active worktree status and live diff previews.

### Phase 3: v2 Distributed Swarm & Advanced Performance (Months 2–3)
*Focus: Sub-second latency, multi-provider hedging, and distributed cluster execution.*
- **Scope & Features**:
  1. **In-Memory AST Scope Graph**: High-performance symbol dependency graph (modeled on Grok Build `xai-codebase-graph`) eliminating LSP subprocess overhead.
  2. **Speculative Tool Streaming**: Stream delta parsing triggering parallel pre-fetches for read-only tools before turn completion.
  3. **Multi-Endpoint Hedging & Fallback**: Automatic failover from primary NIM instances to secondary local/cloud models upon consecutive 429s or 5xx outages.
  4. **Sandboxed Visual Verifier**: Headless browser sidecar capturing DOM snapshots and UI render proofs for frontend verification.

---

## 2. Risk Matrix & Engineering Mitigations

| Risk ID | Risk Description | Severity | Probability | Concrete Architectural Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **R-1** | **Git Merge Collisions**: Parallel agents edit overlapping code regions, causing unresolvable merge conflicts. | High | Medium | **Architect Dependency Graph**: The Architect decomposes tasks so that independent worktrees never touch the same file concurrently. If an unexpected conflict arises, the Architect is automatically invoked to perform an AST-level merge. |
| **R-2** | **Rate-Limit Lockup (429 Cascade)**: Burst traffic exhausts provider token limits, causing all 4 agents to sleep simultaneously. | High | High | **Priority Queue & Leaky Bucket Shaper**: Lower-priority background test loops are throttled first. Requests are spaced evenly across the rolling minute using the Leaky Bucket formula. |
| **R-3** | **Adversarial Test Weakening**: Coder or Tester comments out failing assertions to artificially satisfy the DoD gate. | Critical | Medium | **AST Diff Inspection**: The Verifier runs an automated check comparing the test file's AST before and after. Any deletion of assertions (`assert`, `expect`, `test`) triggers an immediate `INTEGRITY_VIOLATION` reject. |
| **R-4** | **Context Window Exhaustion**: Long debugging sessions overflow the 32K window on smaller models. | High | High | **Proactive 15% Compaction**: OpenCode-inspired compaction triggers whenever token usage reaches 85% capacity, summarizing historical turns while pinning the system prompt and repo map. |
| **R-5** | **Zombie Agent Loops**: Two agents enter an infinite loop of polite agreement without making code progress. | Medium | Medium | **Hard Turn Limits & TodoGate**: Enforce a strict max-turn guard (e.g. 8 turns per sub-task). Grok-style `TodoGate` forces the agent to report tangible diffs or fail. |
| **R-6** | **Malformed Tool-Call JSON**: 20B open models output invalid JSON escape sequences or trailing commas. | Medium | High | **Grammar-Constrained Decoding & Regex Repair**: Intercept tool-call arguments with an automated JSON cleaner before passing to the tool parser. |
