/**
 * @file model-picker.ts
 * @description Elegant Interactive Model Picker for Nomin Code (OpenCode & Claude Code Style).
 * Features:
 *   - Category tabs cycling with Tab (all, chat, reasoning, tools, favorites, recent)
 *   - Live search filter box
 *   - Position indicator [n / total]
 *   - Selection detail line (Context, Tools, Reasoning)
 *   - Integrated Reasoning Effort configuration step for reasoning models (←/→ adjust, enter confirm)
 *   - Single unified keystroke loop (Up/Down move, Left/Right effort, Enter confirm)
 *   - Zero hardcoded model tips or fake latencies
 * Zero external dependencies (pure Node.js).
 */

import { ThemeManager } from './theme.js';
import { RawInputReader, type KeyStroke } from './raw-input.js';
import { SelectList } from './components/select-list.js';
import { ModelValidator } from '../provider/model-validator.js';
import { isChatCallableModel } from '../provider/live-catalog.js';
import type { DiscoveredModel, ReasoningEffort } from '../provider/types.js';
import type { NominHttpClient } from '../provider/client.js';

export interface ModelPickerResult {
  modelId: string;
  reasoningEffort?: string;
  assignedRole?: string;
  verified?: boolean;
  rejected?: boolean;
  verificationError?: string;
}

export interface ModelPickerConfig {
  models: DiscoveredModel[];
  activeModel?: string;
  favorites?: string[];
  recentlyUsed?: string[];
  retiredModels?: Record<string, string>;
  isTeamMode?: boolean;
  currentRoles?: Record<string, string>;
  client?: NominHttpClient;
  providerName: string;
  onFavoriteToggle?: (modelId: string, isFav: boolean) => void;
}

export class ModelPicker {
  private allModels: DiscoveredModel[];
  private filteredModels: DiscoveredModel[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private pageSize = 12;
  private query = '';
  private categories = ['all', 'chat', 'reasoning', 'tools', 'favorites', 'recent'];
  private currentCategoryIndex = 0;
  private favorites: Set<string>;
  private recentlyUsed: Set<string>;
  private retired: Record<string, string>;
  private activeModel?: string;
  private onFavoriteToggle?: (modelId: string, isFav: boolean) => void;

  private effortLevels: Array<{ id: ReasoningEffort; label: string; budget: string }> = [
    { id: 'off', label: 'off', budget: '0 tokens (direct answer)' },
    { id: 'low', label: 'low', budget: '1,024 tokens (fast)' },
    { id: 'medium', label: 'medium', budget: '2,048 tokens (balanced)' },
    { id: 'high', label: 'high', budget: '4,096 tokens (deep reasoning)' },
    { id: 'max', label: 'max', budget: '8,192 tokens (maximum depth)' },
  ];
  private effortIdx = 2; // medium

  constructor(private config: ModelPickerConfig) {
    this.allModels = config.models.filter(m => isChatCallableModel(m.id, m.modelType));
    this.activeModel = config.activeModel;
    this.favorites = new Set(config.favorites || []);
    this.recentlyUsed = new Set(config.recentlyUsed || []);
    this.retired = config.retiredModels || {};
    this.onFavoriteToggle = config.onFavoriteToggle;
    this.applyFilter();
  }

  public getActiveCategory(): string {
    return this.categories[this.currentCategoryIndex] || 'all';
  }

  public getReasoningEffort(): ReasoningEffort {
    return this.effortLevels[this.effortIdx].id;
  }

  private applyFilter(): void {
    const q = this.query.trim().toLowerCase();
    const cat = this.getActiveCategory();

    this.filteredModels = this.allModels.filter(m => {
      if (!isChatCallableModel(m.id, m.modelType)) return false;
      if (this.retired[m.id] && !q.includes('retired')) return false;

      // Category filter
      if (cat === 'reasoning' && !m.supportsReasoning) return false;
      if (cat === 'tools' && !m.supportsTools) return false;
      if (cat === 'favorites' && !this.favorites.has(m.id)) return false;
      if (cat === 'recent' && !this.recentlyUsed.has(m.id)) return false;

      if (!q) return true;
      const target = `${m.id} ${m.publisher || ''} ${m.modelType || ''}`.toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      return words.every(w => target.includes(w));
    });

    if (this.selectedIndex >= this.filteredModels.length) {
      this.selectedIndex = Math.max(0, this.filteredModels.length - 1);
    }
    this.adjustScroll();
  }

  private adjustScroll(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.pageSize) {
      this.scrollOffset = this.selectedIndex - this.pageSize + 1;
    }
  }

  public getSelected(): DiscoveredModel | null {
    if (this.filteredModels.length === 0) return null;
    return this.filteredModels[this.selectedIndex] || null;
  }

  public handleKey(key: KeyStroke): 'continue' | 'select' | 'cancel' {
    const total = this.filteredModels.length;

    if (key.name === 'up') {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'down') {
      if (this.selectedIndex < total - 1) {
        this.selectedIndex++;
        this.adjustScroll();
      }
      return 'continue';
    }

    // Left/Right adjust reasoning effort
    if (key.name === 'left') {
      this.effortIdx = Math.max(0, this.effortIdx - 1);
      return 'continue';
    }

    if (key.name === 'right') {
      this.effortIdx = Math.min(this.effortLevels.length - 1, this.effortIdx + 1);
      return 'continue';
    }

    if (key.name === 'pageup') {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.pageSize);
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'pagedown') {
      this.selectedIndex = Math.min(Math.max(0, total - 1), this.selectedIndex + this.pageSize);
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'home') {
      this.selectedIndex = 0;
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'end') {
      this.selectedIndex = Math.max(0, total - 1);
      this.adjustScroll();
      return 'continue';
    }

    // Tab cycles categories
    if (key.name === 'tab') {
      this.currentCategoryIndex = (this.currentCategoryIndex + 1) % this.categories.length;
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.applyFilter();
      return 'continue';
    }

    // 'f' toggles favorite when query empty or Ctrl+F
    if ((key.name === 'char' && key.char === 'f' && !this.query) || key.name === 'ctrl-f') {
      const selected = this.getSelected();
      if (selected) {
        const isFav = this.favorites.has(selected.id);
        if (isFav) {
          this.favorites.delete(selected.id);
        } else {
          this.favorites.add(selected.id);
        }
        if (this.onFavoriteToggle) {
          this.onFavoriteToggle(selected.id, !isFav);
        }
        this.applyFilter();
      }
      return 'continue';
    }

    // Backspace modifies query
    if (key.name === 'backspace') {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
      }
      return 'continue';
    }

    // Space character in query
    if (key.name === 'space') {
      this.query += ' ';
      this.applyFilter();
      return 'continue';
    }

    // Typing adds to query
    if (key.name === 'char' && key.char) {
      this.query += key.char;
      this.applyFilter();
      return 'continue';
    }

    if (key.name === 'enter') {
      return this.filteredModels.length > 0 ? 'select' : 'continue';
    }

    if (key.name === 'escape') {
      return 'cancel';
    }

    return 'continue';
  }

  public render(): string[] {
    const c = ThemeManager.getColors();
    const lines: string[] = [];
    const total = this.filteredModels.length;
    const curIdx = total > 0 ? this.selectedIndex + 1 : 0;

    // Line 1: Model Selection (Provider) [n/total]
    lines.push(`  ${c.bold}Model Selection${c.reset}  ${c.secondary}(${this.config.providerName})${c.reset}  ${c.accent}[${curIdx}/${total}]${c.reset}`);

    // Line 2: Filter tabs
    const catPills = this.categories.map((cat, idx) => {
      if (idx === this.currentCategoryIndex) {
        return `${c.accent}${c.bold}[${cat.toUpperCase()}]${c.reset}`;
      }
      return `${c.secondary}${cat}${c.reset}`;
    });
    lines.push(`  ${c.secondary}Filter:${c.reset} ${catPills.join('  ')}`);

    // Line 3: Search box
    lines.push(`  ${c.secondary}Search:${c.reset} ${c.text}${this.query}${c.accent}▋${c.reset}`);
    lines.push('');

    if (total === 0) {
      lines.push(`  ${c.secondary}   No models match '${this.query}'. (Backspace to edit filter, Tab to switch category)${c.reset}`);
      lines.push('');
      lines.push(`  ${c.secondary}tab cycle filters · esc cancel${c.reset}`);
      return lines;
    }

    const termWidth = process.stdout.columns || 80;
    const cardWidth = Math.max(68, Math.min(termWidth - 4, 96));
    const nameWidth = Math.min(48, Math.max(36, cardWidth - 36));
    const descWidth = Math.max(22, cardWidth - nameWidth - 8);

    const visible = this.filteredModels.slice(this.scrollOffset, this.scrollOffset + this.pageSize);

    if (this.scrollOffset > 0) {
      lines.push(`  ${c.secondary}▲ more above${c.reset}`);
    }

    visible.forEach((m, localIdx) => {
      const globalIdx = this.scrollOffset + localIdx;
      const isSelected = globalIdx === this.selectedIndex;
      const isRetired = Boolean(this.retired[m.id]);
      const isFav = this.favorites.has(m.id);
      const isActive = m.id === this.activeModel;

      const tags: string[] = [];
      if (m.contextWindow) {
        const kTok = Math.round(m.contextWindow / 1000);
        tags.push(`${kTok}k`);
      }
      if (m.supportsTools) tags.push('tools');
      if (m.supportsReasoning) tags.push('reasoning');
      if (isActive) tags.push('active');
      if (isFav) tags.push('★');
      if (isRetired) tags.push('retired');

      let desc = tags.join(' · ');
      if (desc.length > descWidth) {
        desc = desc.slice(0, descWidth - 1) + '…';
      }

      let name = m.id;
      if (name.length > nameWidth) {
        name = name.slice(0, nameWidth - 1) + '…';
      }

      const namePadded = name.padEnd(nameWidth, ' ');
      const descPadded = desc.padEnd(descWidth, ' ');

      if (isSelected) {
        lines.push(`  ${c.accent}>${c.reset} ${c.bold}${c.accent}${namePadded}${c.reset}  ${c.accent}${descPadded}${c.reset}`);
      } else {
        lines.push(`    ${c.text}${namePadded}${c.reset}  ${c.secondary}${descPadded}${c.reset}`);
      }
    });

    if (this.scrollOffset + this.pageSize < total) {
      lines.push(`  ${c.secondary}▼ more below${c.reset}`);
    }

    lines.push('');

    // Selected model details summary line
    const sel = this.getSelected();
    if (sel) {
      const ctxStr = sel.contextWindow ? `${Math.round(sel.contextWindow / 1000)}K ctx` : 'Standard ctx';
      const toolsStr = sel.supportsTools ? 'Yes' : 'No';
      const reasoningStr = sel.supportsReasoning ? 'Yes' : 'No';
      lines.push(`  ${c.secondary}Selected:${c.reset} ${c.bold}${c.text}${sel.id}${c.reset} ${c.secondary}| Context: ${ctxStr} | Tools: ${toolsStr} | Reasoning: ${reasoningStr}${c.reset}`);
    }

    lines.push(`  ${c.secondary}↑/↓ move · enter select · type filter · tab cycle filters · t test model · f favorite · esc cancel${c.reset}`);

    // If selected model supports reasoning, render the reasoning effort configuration section (Image 1)
    if (sel && sel.supportsReasoning) {
      lines.push('');
      lines.push(`  ${c.bold}Configure Reasoning Effort for ${sel.id}:${c.reset}`);
      const pills = this.effortLevels.map((opt, i) => {
        if (i === this.effortIdx) {
          return `${c.accent}${c.bold}[ ${opt.label.toUpperCase()} ]${c.reset}`;
        }
        return `${c.secondary}${opt.label}${c.reset}`;
      });
      lines.push(`  ${pills.join(' | ')}`);
      lines.push(`  ${c.secondary}Budget: ${this.effortLevels[this.effortIdx].budget}${c.reset}`);
      lines.push(`  ${c.secondary}←/→ adjust · enter confirm · esc cancel${c.reset}`);
    }

    return lines;
  }

  public async prompt(
    stdin: NodeJS.ReadStream = process.stdin,
    stdout: NodeJS.WriteStream = process.stdout
  ): Promise<ModelPickerResult | null> {
    // If in Team Mode, first pick a role
    let targetRole: string | undefined;
    if (this.config.isTeamMode) {
      const rolePicker = new SelectList({
        title: 'Team Mode: Select Swarm Role to Configure',
        options: [
          { id: 'architect', label: 'architect', secondary: `Current: ${this.config.currentRoles?.architect || 'unassigned'}`, value: 'architect' },
          { id: 'coder', label: 'coder', secondary: `Current: ${this.config.currentRoles?.coder || 'unassigned'}`, value: 'coder' },
          { id: 'tester', label: 'tester', secondary: `Current: ${this.config.currentRoles?.tester || 'unassigned'}`, value: 'tester' },
          { id: 'verifier', label: 'verifier', secondary: `Current: ${this.config.currentRoles?.verifier || 'unassigned'}`, value: 'verifier' },
        ],
      });
      const roleChoice = await rolePicker.prompt(stdin, stdout);
      if (!roleChoice) return null;
      targetRole = roleChoice.value;
    }

    RawInputReader.enableRawMode(stdin);
    let lineCount = 0;

    const redraw = () => {
      if (lineCount > 0) {
        stdout.write(`\x1b[${lineCount}A\x1b[0J`);
      }
      const rendered = this.render();
      stdout.write(rendered.join('\n') + '\n');
      lineCount = rendered.length;
    };

    redraw();

    const selectedModel = await new Promise<DiscoveredModel | null>((resolve) => {
      const onData = (chunk: Buffer) => {
        const strokes = RawInputReader.parse(chunk);
        for (const stroke of strokes) {
          const action = this.handleKey(stroke);
          if (action === 'select') {
            cleanup();
            resolve(this.getSelected());
            return;
          }
          if (action === 'cancel') {
            cleanup();
            resolve(null);
            return;
          }
        }
        redraw();
      };

      const cleanup = () => {
        stdin.removeListener('data', onData);
        RawInputReader.disableRawMode(stdin);
      };

      stdin.on('data', onData);
    });

    if (!selectedModel) return null;

    const chosenEffort = selectedModel.supportsReasoning ? this.getReasoningEffort() : 'medium';

    // Single-step verification with client if provided
    if (this.config.client) {
      stdout.write(`\n  \x1b[38;2;88;166;255m⠋\x1b[0m Verifying ${selectedModel.id} with ${this.config.providerName}...\n`);
      const res = await ModelValidator.validateModel(this.config.client, selectedModel.id);
      if (res.ok) {
        stdout.write(`  \x1b[38;2;88;166;255m✔\x1b[0m Successfully verified ${selectedModel.id}!\n\n`);
        return {
          modelId: selectedModel.id,
          reasoningEffort: chosenEffort,
          assignedRole: targetRole,
          verified: true,
        };
      } else {
        const detail = res.error?.providerDetail || 'Verification failed';
        const isAuthFailure =
          detail.toLowerCase().includes('authorization') ||
          detail.toLowerCase().includes('forbidden') ||
          res.error?.category === 'AUTH_FAILED';
        const isCurrentRetired = this.activeModel && Boolean(this.retired[this.activeModel]);

        let keepingText = '';
        if (isCurrentRetired) {
          keepingText = ` Note: Previous model '${this.activeModel}' was retired.`;
        } else if (this.activeModel) {
          keepingText = ` Keeping current model: ${this.activeModel}`;
        }

        stdout.write(`  \x1b[38;2;240;136;62m✖ Cannot activate ${selectedModel.id}: Verification failed (${detail}).${keepingText}\x1b[0m\n`);

        const isTimeout =
          detail.toLowerCase().includes('timed out') ||
          detail.toLowerCase().includes('abort') ||
          res.error?.category === 'NETWORK_ERROR';

        if (isAuthFailure) {
          stdout.write(`  \x1b[38;2;88;166;255m💡 Tip:\x1b[0m ${this.config.providerName} rejected your API key during inference verification.\n`);
          stdout.write(`     • Run \x1b[1m/key <your-api-key>\x1b[0m to configure a working inference key.\n`);
          stdout.write(`     • Ensure your key has 'Public API Endpoints' enabled at build.nvidia.com.\n\n`);
        } else if (isTimeout) {
          stdout.write(`  \x1b[38;2;88;166;255m💡 Tip:\x1b[0m ${this.config.providerName} did not respond within the verification deadline.\n`);
          stdout.write(`     • Upstream queue delays or cold-booting may be occurring on ${this.config.providerName}.\n`);
          stdout.write(`     • Run /model to pick another active model or retry.\n\n`);
        } else {
          stdout.write('\n');
        }

        return {
          modelId: isCurrentRetired ? '' : (this.activeModel || selectedModel.id),
          reasoningEffort: chosenEffort,
          assignedRole: targetRole,
          verified: false,
          rejected: true,
          verificationError: detail,
        };
      }
    }

    return {
      modelId: selectedModel.id,
      reasoningEffort: chosenEffort,
      assignedRole: targetRole,
      verified: true,
    };
  }
}
