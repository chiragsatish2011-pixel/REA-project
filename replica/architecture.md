# Architecture: Nomin Code CLI (A Clean-Room Rebuild of Claude Code CLI)

A high-performance, model-agnostic terminal agent and multi-agent swarm runtime inspired by Claude Code ergonomics and designed with the **Aurora** aesthetic.

---

## 1. Stack

| Layer | Choice | Why |
| ----- | ------ | --- |
| **Runtime** | Node.js v20+ / v22+ / v24+ | Native `node:test`, modern ESM, fast startup (<50ms cold start), universal across OS. |
| **Language** | TypeScript 5.7+ (NodeNext) | Strict type safety, clean interfaces for tools, swarm coordination, and model adapters. |
| **CLI / TUI Engine** | Custom ANSI & VT100 Raw Engine | Pure zero-overhead terminal rendering without heavy React/Ink reconcilers, supports streaming tokens at 120+ tok/s. |
| **Input Handling** | Raw-mode VT100 key handler | Handles single-key interrupts (`Esc`), arrow navigation, multiline bracketed paste, and live fuzzy filtering. |
| **Model Adaptation** | Universal Model Protocol Adapters | Clean abstraction over NVIDIA NIM, OpenAI, Anthropic, Ollama, and vLLM without vendor lock-in. |
| **Storage / Vault** | Local State & AES-256-GCM Vault | Zero-cloud credentials storage (`~/.nomin/vault.enc`), atomic JSON transcripts in `.nomin/`, and Git worktrees. |
| **Verification Gate** | AST & Fresh-Context Verifier | Enforces DoD (Definition of Done) gates before releasing file edits into the main branch. |
| **Design System** | Aurora Design Tokens | Electric cyan (`#06b6d4`), aurora emerald (`#2dd4bf`), polar night (`#0b0f19`), and AA/AAA WCAG contrast. |

---

## 2. Storage & State Model

```sql
-- Local Session & State Tables (in SQLite or serialized JSONL state in .nomin/)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  active_provider TEXT NOT NULL,
  active_model TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_prompt_tokens INTEGER DEFAULT 0,
  total_completion_tokens INTEGER DEFAULT 0,
  total_cost_cents INTEGER DEFAULT 0
);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence_num INTEGER NOT NULL,
  user_prompt TEXT NOT NULL,
  assistant_response TEXT,
  thinking_output TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  arguments JSON NOT NULL,
  result TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected', 'done'))
);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  git_sha TEXT NOT NULL,
  files_changed JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE blackboard_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assigned_role TEXT CHECK (assigned_role IN ('architect', 'coder', 'tester', 'verifier')),
  status TEXT CHECK (status IN ('pending', 'in_progress', 'review', 'done', 'failed')),
  worktree_path TEXT,
  dod_criteria JSON NOT NULL
);
```

---

## 3. Command API & Flow Router

| Command | Action | Scope | Input | Output | Flow |
| ------- | ------ | ----- | ----- | ------ | ---- |
| `/` | Open Slash Command Palette | REPL | Keystroke `/` | Live fuzzy overlay | F02 |
| `/model` | Open Interactive Model Switcher | REPL | Keystroke `/model` | Virtualized model picker | F03 |
| `/effort` | Cycle thinking token budget | REPL | Left/Right arrows | Updated effort badge | F03 |
| `/mode` | Toggle SOLO vs TEAM swarm | Swarm | `solo` or `team` | Updated mode banner | F05 |
| `/team` | Configure swarm agent roles | Swarm | Role assignments | Swarm status card | F05 |
| `/status` | Render Swarm Task DAG | Swarm | Keystroke | Colored status dashboard | F05 |
| `/compact` | Trigger context compaction | Context | None | Compaction metrics | F04 |
| `/rewind` | Git checkpoint rollback | Context | Selected turn | Git reset & state sync | F04 |
| `/permissions` | Interactive security rule editor | Security | Keybindings | Updated rule set | F01 |
| `/doctor` | Preflight diagnostic scan | Diagnostics | None | System check report | S09 |
| `/theme` | Switch UI colorway (Aurora, etc.) | UI | `aurora`, `dark`, etc. | Immediate palette reload | S02 |

---

## 4. The Parts That Bite & Hard Constraints

1. **Windows Terminal & ANSI Escape Codes:**
   - *Issue:* PowerShell 5.1/7+ and Windows `cmd.exe` historically had inconsistent VT100 / Virtual Terminal Processing support.
   - *Solution:* Auto-enable VT mode via `process.stdout._handle?.setMode(7)` and test `stripAnsi` bounds. Provide graceful fallback for terminals lacking 24-bit TrueColor.
2. **Raw Input Mode & Multiline Paste:**
   - *Issue:* Pasting 200 lines in raw mode floods `stdin` byte-by-byte, which can falsely trigger single-key shortcut handlers.
   - *Solution:* Implemented bracketed paste detection (`\x1b[200~` ... `\x1b[201~`) and a 15ms batch buffer in `RawInputHandler`.
3. **Context Window Token Expiry:**
   - *Issue:* Autonomous tool loops with large bash outputs can blow through 128K context in 10 turns.
   - *Solution:* Proactive compaction triggers at 80% window limit, summarizing turns while preserving critical file diffs and DoD criteria.
4. **Rate Limits & API Dropping:**
   - *Issue:* Parallel swarm agents hitting provider endpoints can trigger HTTP 429 errors.
   - *Solution:* AIMD (Additive Increase / Multiplicative Decrease) rate limiter with exponential backoff and stable prompt prefix caching.

---

## 5. Build Order & Verification

1. **Vertical Slice:**
   - Raw VT100 input handler, prompt box, streaming token renderer, bash tool, file edit tool, and `Esc` interrupt.
2. **Must-Haves:**
   - Slash menu overlay, model picker, diff hunk preview, 4-tier security permissions, git checkpointing.
3. **Should-Haves:**
   - Aurora theme palette with WCAG AAA contrast, doctor diagnostics, proactive compaction.
4. **Could-Haves (Swarm):**
   - Multi-agent swarm coordinator, isolated worktrees, and fresh-context DoD Verifier Gate.
