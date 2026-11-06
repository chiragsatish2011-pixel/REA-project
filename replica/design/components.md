# Component Specifications: Claude Code Replica (Aurora Theme)

Design specifications for CLI terminal and web components, built with Aurora design tokens.

---

## 1. Terminal Prompt & Input Box
- **Purpose:** Primary REPL entry point with live raw-input character handling, multiline paste detection, and prompt suggestions.
- **Tokens:**
  - Background: `var(--color-surface)` (`#121826`)
  - Border: `var(--color-accent)` (`#06b6d4`) on active focus, `var(--color-border)` (`#1e293b`) when idle.
  - Text: `var(--color-text)` (`#f8fafc`)
  - Placeholder: `var(--color-text-muted)` (`#94a3b8`)
- **Key States:**
  - `idle`: Single border with subtle prompt indicator `> ` in `text-muted`.
  - `typing`: Active cyan border, glowing cursor.
  - `streaming`: Border pulses in `aurora-emerald` (`#34d399`), input locked or queued.
  - `multiline`: Expanded box with line numbers and token estimate.

---

## 2. Slash Menu Overlay Popup
- **Purpose:** Fast fuzzy-filtered command palette triggered by `/`.
- **Tokens:**
  - Container: `var(--color-surface)` with `var(--shadow-pop)`
  - Active selection background: `#1e293b` with cyan cursor prefix `● ` or `>`
  - Command name: `var(--color-accent)` (`#06b6d4`, bold)
  - Category tag: `var(--color-aurora-violet)` (`#c084fc`)
  - Description: `var(--color-text-muted)` (`#94a3b8`)
- **Key States:**
  - `open`: Anchored above or below cursor line.
  - `navigating`: Up/Down cycles selection with inverted focus row.
  - `filtered`: Instant alphanumeric query narrowing with highlighted character match.

---

## 3. Interactive Model Picker & Live Catalog
- **Purpose:** Full arrow-key interactive catalog with fuzzy filtering, favorites, provider tags, and reasoning effort cycler.
- **Tokens:**
  - Active Item: Cyan text `accent` (`#06b6d4`), inverted or card background `#1b253b`.
  - Context Window Badge: `info` (`#38bdf8`)
  - Reasoning Tag: `aurora-magenta` (`#e879f9`)
  - Provider Badge: `text-muted` (`#94a3b8`)
- **Key States:**
  - `scrolling`: Smooth virtualized windowing for 120+ models without terminal flicker.
  - `effort cycler`: Left/Right arrows cycle reasoning effort (`off`, `low`, `medium`, `high`, `max`).

---

## 4. Unified Diff & Patch Card
- **Purpose:** Compact, hunk-aware code modification display with syntax coloring.
- **Tokens:**
  - File header: `var(--color-text)` with bold file path and change count `+N / -M`.
  - Added line: `+ ` in `var(--color-success)` (`#2dd4bf`) with subtle green tint background.
  - Deleted line: `- ` in `var(--color-danger)` (`#fb7185`) with subtle red tint background.
  - Context line: `var(--color-text-muted)` (`#94a3b8`).
- **Key States:**
  - `collapsed`: Single-line summary `Edited src/auth.ts (+14 -3 lines)`.
  - `expanded`: Full colored unified diff.

---

## 5. Swarm Dashboard & Blackboard DAG
- **Purpose:** Multi-agent swarm coordination view (Architect, Coder, Tester, Verifier).
- **Tokens:**
  - Header: Aurora gradient text or bold `accent` title.
  - Active Agent: `aurora-emerald` (`#34d399`) with animated spinner.
  - Waiting Agent: `text-muted` (`#94a3b8`).
  - Completed Gate: `success` (`#2dd4bf`) `✔ PASS`.
  - Blocked Gate: `danger` (`#fb7185`) `✖ BLOCKED`.
- **Key States:**
  - `solo mode`: Displays single primary agent loop and telemetry.
  - `team swarm`: Tabbed or split DAG showing concurrent worktrees and cross-agent mailbox status.

---

## 6. Security & Permission Confirmation Dialog
- **Purpose:** Interactive prompt for high-risk bash commands, file modifications, or network requests.
- **Tokens:**
  - Border: `warning` (`#fcd34d`) for bash / shell, `danger` (`#fb7185`) for filesystem deletions.
  - Buttons:
    - `Allow Once` (Enter): `success` (`#2dd4bf`)
    - `Always Allow`: `accent` (`#06b6d4`)
    - `Deny` (Esc): `danger` (`#fb7185`)
- **Accessibility:**
  - Clear keyboard focus ring, explicit hotkey indicators (`[y]es`, `[n]o`, `[a]lways`).
