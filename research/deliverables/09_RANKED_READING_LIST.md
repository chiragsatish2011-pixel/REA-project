# Ranked Bibliography & Technical Reading List

> **Target Audience**: AI systems engineers constructing production coding agent runtimes.
> **Ranking Criterion**: Direct implementation utility for building *Nomin Code* (architecture, rate-limit reliability, editing fidelity, multi-agent coordination).

---

## 1. Top Repositories (Ranked by Implementation Value)

| Rank | Repository & Source Path | Core Engineering Concept to Extract | Direct Source Link |
| :--- | :--- | :--- | :--- |
| **1** | **`sst/opencode`** (`packages/core/src/`) | Effect-TS runtime, `model-retry.ts` bounded jitter backoff, `compaction.ts` 15% free buffer policy, durable SQLite session storage. | [github.com/sst/opencode](https://github.com/sst/opencode) |
| **2** | **`Aider`** (`aider/`) | Tree-sitter PageRank RepoMap (`repomap.py`), Architect/Editor dual agent split (`architect_coder.py`), multi-tier fuzzy search-replace matching (`search_replace.py`). | [github.com/Aider-AI/aider](https://github.com/Aider-AI/aider) |
| **3** | **`@deepseek-ai/dsh`** (`packages/llm/`) | Native reasoning/thinking token stream translation (`translate.ts`), cryptographic signature replay (`serialize.ts`), exact prompt cache accounting (`updateUsage`). | [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| **4** | **`SWE-agent`** (`sweagent/`) | Agent-Computer Interface (ACI), windowed file viewing (`open_file`, `scroll_down`), background flake8 linter hook, trajectory serialization. | [github.com/princeton-nlp/SWE-agent](https://github.com/princeton-nlp/SWE-agent) |
| **5** | **`Continue`** (`core/diff/`) | Streaming Myers diff algorithm (`myers.ts`, `streamDiff.ts`) for real-time token-by-token diff rendering without blocking. | [github.com/continuedev/continue](https://github.com/continuedev/continue) |
| **6** | **`OpenHands`** (`openhands-workspace/`) | Event-stream architecture, Docker container sandbox isolation, PTY terminal streaming. | [github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands) |
| **7** | **`Cline / Roo Code`** (`sdk/packages/core/`) | Visual diff confirmation gates, granular tool auto-approval permissions, dynamic role-based system prompts. | [github.com/cline/cline](https://github.com/cline/cline) |

---

## 2. Foundational Research Papers

1. **"SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering"** (Yang et al., Princeton, 2024)
   - *Key Takeaway*: Proves that designing LLM-tailored CLI commands (ACI) with bounded outputs boosts solve rate on real GitHub issues by >15% compared to raw bash.
   - *Link*: [arxiv.org/abs/2405.15793](https://arxiv.org/abs/2405.15793)
2. **"ReAct: Synergizing Reasoning and Acting in Language Models"** (Yao et al., 2022)
   - *Key Takeaway*: Foundational pattern for interleaved thought-action-observation loops.
   - *Link*: [arxiv.org/abs/2210.03629](https://arxiv.org/abs/2210.03629)
3. **"Reflexion: Language Agents with Verbal Reinforcement Learning"** (Shinn et al., 2023)
   - *Key Takeaway*: Demonstrates that self-evaluating execution traces and injecting verbal critiques into subsequent turns dramatically improves coding task completion.
   - *Link*: [arxiv.org/abs/2303.11366](https://arxiv.org/abs/2303.11366)
4. **"Tree of Thoughts: Deliberate Problem Solving with Large Language Models"** (Yao et al., 2023)
   - *Key Takeaway*: Core algorithm behind multi-path branch exploration and rollback for complex refactoring tasks.
   - *Link*: [arxiv.org/abs/2305.10601](https://arxiv.org/abs/2305.10601)
5. **"MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework"** (Hong et al., 2023)
   - *Key Takeaway*: Establishes Standard Operating Procedures (SOPs) and structured role specialization (Architect, Engineer, QA) to prevent multi-agent chaos.
   - *Link*: [arxiv.org/abs/2308.00352](https://arxiv.org/abs/2308.00352)

---

## 3. Engineering Documentation & Articles

1. **AWS Architecture: "Exponential Backoff and Jitter"** (Marc Brooker)
   - *Key Takeaway*: Mathematical proof of why "Full Jitter" dominates "Equal Jitter" and "Decorrelated Jitter" in high-concurrency rate-limited distributed systems.
   - *Link*: [aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
2. **Anthropic Engineering: "Claude Code Architecture & Agent Teams"**
   - *Key Takeaway*: In-depth design of peer mailboxes, subagent token budgets (15,000 token limit), and `.claude/worktrees/` git sandboxing.
   - *Link*: [code.claude.com/docs](https://code.claude.com/docs)
3. **DeepSeek Engineering: "DeepSeek-V3 & R1 Architecture Technical Report"**
   - *Key Takeaway*: Details of multi-head latent attention (MLA), native reasoning tokens, and context caching economics.
   - *Link*: [arxiv.org/abs/2412.19437](https://arxiv.org/abs/2412.19437)
4. **NVIDIA NIM Microservices Documentation**
   - *Key Takeaway*: Deployment specs for TensorRT-LLM container microservices, OpenAI-compatible parameter mappings, and rate-limiting headers.
   - *Link*: [docs.nvidia.com/nim/](https://docs.nvidia.com/nim/)
