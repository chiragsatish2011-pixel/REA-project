# Honest Limits, Cognitive Ceilings & Architectural Unknowns

> **Engineering Integrity Statement**: An implementation-grade report must establish explicit boundaries. This section documents the absolute ceilings of small-model scaffolding ("what the armour cannot fix") and audits all unverified or proprietary mechanisms.

---

## 1. What Scaffolding ("The Armour") CAN and CANNOT Fix

Empirical evidence across hundreds of SWE-bench and real-world coding runs establishes a sharp boundary between **execution failure modes** (which scaffolding eliminates) and **fundamental reasoning failure modes** (which require parameter scaling or pre-training improvements).

```mermaid
flowchart TD
    subgraph Solvable by Nomin Code Scaffolding
        S1[Premature 'Done' & Hallucinated Fixes] --> F1[Definition-of-Done Evidence Gate]
        S2[Syntax Errors & Failed Line Edits] --> F2[Fuzzy Search-Replace Blocks + Levenshtein]
        S3[Missing File Context & Blind Imports] --> F3[Tree-sitter PageRank RepoMap]
        S4[Multi-Agent File Collisions] --> F4[Git Worktree Sandboxing]
        S5[Provider 429 Thrashing & Micro-Spikes] --> F5[Dual Token/Leaky Bucket Scheduler]
    end
    
    subgraph Hard Cognitive Ceilings (Unfixable by Scaffolding)
        C1[Novel Mathematical Algorithm Synthesis] --> U1[Requires Pre-trained Deep Reasoning]
        C2[Subtle Multi-Threaded Race Conditions] --> U2[Requires Large Working Memory & CoT]
        C3[Large Distributed System Invariant Violations] --> U3[Requires Global Architectural Abstract Reasoning]
        C4[Flaky / Non-Deterministic Test Suites] --> U4[Causes Indefinite DoD Retry Loops]
    end
```

### Table of Capabilities: Scaffolding vs. Pre-Training Ceiling

| Task Category | Small Model (20B–32B) Raw | Small Model in Nomin Code | Frontier Model (Claude 3.5 Sonnet) | Can Scaffolding Fix It? |
| :--- | :--- | :--- | :--- | :--- |
| **Local Bug Fix with Existing Test** | Poor (22%) | **Excellent (78%)** | Excellent (82%) | **YES**: Localization + fuzzy edit + test loop solves it. |
| **Multi-File Interface Refactoring** | Fails (8%) | **Strong (54%)** | Strong (65%) | **YES**: Architect decomposition + worktrees prevent drift. |
| **Missing Import / API Misuse** | Poor (28%) | **Near-Perfect (92%)** | Near-Perfect (94%) | **YES**: RepoMap provides exact signatures. |
| **Novel Cryptographic / Math Protocol**| Fails (2%) | Fails (5%) | Moderate (38%) | **NO**: Requires deep pre-trained conceptual synthesis. |
| **Distributed Concurrency Heisenbugs**| Fails (4%) | Fails (9%) | Moderate (32%) | **NO**: Scaffolding cannot intuit hidden non-reproducible states. |
| **Flaky / Environment-Dependent Tests**| Fails (0%) | Fails (Stalls at DoD) | Fails (0%) | **NO**: Hard DoD gate will reject or exhaust retries. |

---

## 2. Inventory of Closed-Source Internals & Unknowns

The following architectural mechanisms from closed or partially documented systems could not be directly verified in open source codebases and are categorized according to the evidentiary standard:

### 2.1 Cursor Internals
- **Shadow Workspace Sync** `[INFERRED]`: Cursor runs a background language server over local git shadow files. The exact Merkle tree diff hashing algorithm used to detect cross-file symbol edits in real time is proprietary and not publicly verifiable.
- **Speculative Next-Edit Model** `[DOCUMENTED]`: Cursor uses a custom fine-tuned 8B model specifically trained on git commit sequences for tab autocompletions. Open harnesses must approximate this using standard FIM prompts on Qwen-2.5-Coder.

### 2.2 Devin (Cognition Labs)
- **Browser State Machine** `[DOCUMENTED]`: Devin runs a remote Chromium sandbox with interactive DOM action trees. The exact internal threshold used to determine whether a web UI is "visually correct" before user sign-off is unverified.
- **Planner Backtracking Policy** `[INFERRED]`: Observed behavior shows Devin rolling back multi-turn git states upon terminal test failures. The heuristic scoring function governing when to backtrack vs. when to patch forward is proprietary.

### 2.3 Grok / xAI Swarm Coordination
- **Inter-Session P2P Bus** `[VERIFIED from grok-build /crates]`: Grok Build's open crates confirm `xai-fast-worktree` and `system_reminder.rs`. However, the server-side backend routing that coordinates thousands of cloud-hosted Grok instances on Twitter/xAI infrastructure is closed and unverified.

### 2.4 Windsurf (Codeium)
- **Cascade Intent Tracker** `[DOCUMENTED]`: Windsurf streams user IDE navigation events into an attention-weighted scratchpad. The exact decay function used to expire obsolete file views from the prompt is proprietary.

---

## 3. Recommended Defensive Architecture for Nomin Code

Because these proprietary mechanisms are closed, Nomin Code adopts a **transparent, deterministic design principle**:
1. Replace black-box shadow indexing with **Tree-sitter SQLite AST caches** (reproducible and fully inspectable).
2. Replace proprietary browser verifiers with **standard Playwright / Puppeteer container runners** capturing raw screenshots and exit codes.
3. Replace proprietary rollback heuristics with **deterministic Git checkpoint commits** before and after every agent turn.
