/**
 * Reusable Multi-Select Checkbox Component
 * Used for Team model pools, file selections, and batch actions.
 * Navigated with Up/Down arrows, Space to toggle checkboxes, Enter to confirm, Esc to cancel.
 */

import { ThemeManager } from '../theme.js';
import { RawInputReader, type KeyStroke } from '../raw-input.js';
import { FooterHints } from './footer-hints.js';

export interface MultiSelectItem<T = string> {
  id: string;
  label: string;
  secondary?: string;
  selected?: boolean;
  value: T;
}

export interface MultiSelectConfig<T = string> {
  title?: string;
  items: MultiSelectItem<T>[];
  pageSize?: number;
}

export class MultiSelect<T = string> {
  private items: MultiSelectItem<T>[];
  private cursorIndex = 0;
  private scrollOffset = 0;
  private pageSize: number;
  private title?: string;

  constructor(config: MultiSelectConfig<T>) {
    this.items = config.items.map(it => ({ ...it, selected: Boolean(it.selected) }));
    this.pageSize = config.pageSize || 12;
    this.title = config.title;
    this.adjustScroll();
  }

  public getSelectedItems(): MultiSelectItem<T>[] {
    return this.items.filter(it => it.selected);
  }

  public getSelectedCount(): number {
    return this.items.filter(it => it.selected).length;
  }

  private adjustScroll(): void {
    if (this.cursorIndex < this.scrollOffset) {
      this.scrollOffset = this.cursorIndex;
    } else if (this.cursorIndex >= this.scrollOffset + this.pageSize) {
      this.scrollOffset = this.cursorIndex - this.pageSize + 1;
    }
  }

  public handleKey(key: KeyStroke): 'continue' | 'select' | 'cancel' {
    const total = this.items.length;
    if (total === 0) {
      if (key.name === 'escape') return 'cancel';
      return 'continue';
    }

    if (key.name === 'up' || (key.name === 'char' && key.char === 'k')) {
      if (this.cursorIndex > 0) {
        this.cursorIndex--;
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'down' || (key.name === 'char' && key.char === 'j')) {
      if (this.cursorIndex < total - 1) {
        this.cursorIndex++;
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'pageup') {
      this.cursorIndex = Math.max(0, this.cursorIndex - this.pageSize);
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'pagedown') {
      this.cursorIndex = Math.min(total - 1, this.cursorIndex + this.pageSize);
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'home') {
      this.cursorIndex = 0;
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'end') {
      this.cursorIndex = total - 1;
      this.adjustScroll();
      return 'continue';
    }

    // Space key: toggle checkbox on current cursor item
    if (key.name === 'space') {
      const cur = this.items[this.cursorIndex];
      if (cur) {
        cur.selected = !cur.selected;
      }
      return 'continue';
    }

    // Enter confirms selections
    if (key.name === 'enter') {
      return 'select';
    }

    if (key.name === 'escape') {
      return 'cancel';
    }

    return 'continue';
  }

  public render(): string[] {
    const c = ThemeManager.getColors();
    const lines: string[] = [];
    const total = this.items.length;
    const count = this.getSelectedCount();

    // Title + selected count
    const headerTitle = this.title || 'Select items';
    lines.push(`  ${c.bold}${headerTitle}${c.reset}  ${c.accent}[${count} selected]${c.reset}${c.secondary} (${this.cursorIndex + 1} / ${total})${c.reset}`);

    if (total === 0) {
      lines.push(`  ${c.secondary}(no items)${c.reset}`);
      return lines;
    }

    const visible = this.items.slice(this.scrollOffset, this.scrollOffset + this.pageSize);

    // Scroll up indicator
    const hasMoreAbove = this.scrollOffset > 0;
    lines.push(`  ${c.secondary}${hasMoreAbove ? '▲ more above' : ' '}${c.reset}`);

    visible.forEach((item, localIdx) => {
      const globalIdx = this.scrollOffset + localIdx;
      const isCursor = globalIdx === this.cursorIndex;
      const pointer = isCursor ? `${c.accent}❯${c.reset}` : ' ';
      const checkbox = item.selected
        ? `${c.success}[✔]${c.reset}`
        : `${c.secondary}[ ]${c.reset}`;
      const labelStr = isCursor
        ? `${c.accent}${c.bold}${item.label}${c.reset}`
        : `${c.text}${item.label}${c.reset}`;
      const secStr = item.secondary ? `  ${c.secondary}${item.secondary}${c.reset}` : '';

      lines.push(`  ${pointer} ${checkbox} ${labelStr}${secStr}`);
    });

    // Scroll down indicator
    const hasMoreBelow = this.scrollOffset + this.pageSize < total;
    lines.push(`  ${c.secondary}${hasMoreBelow ? '▼ more below' : ' '}${c.reset}`);

    // Footer hints
    lines.push(FooterHints.render([
      { key: '↑/↓', label: 'move' },
      { key: 'space', label: 'toggle' },
      { key: 'enter', label: 'confirm' },
      { key: 'esc', label: 'cancel' },
    ]));

    return lines;
  }

  public async prompt(
    stdin: NodeJS.ReadStream = process.stdin,
    stdout: NodeJS.WriteStream = process.stdout
  ): Promise<MultiSelectItem<T>[] | null> {
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

    return new Promise<MultiSelectItem<T>[] | null>((resolve) => {
      const onData = (chunk: Buffer) => {
        const strokes = RawInputReader.parse(chunk);
        for (const stroke of strokes) {
          const action = this.handleKey(stroke);
          if (action === 'select') {
            cleanup();
            resolve(this.getSelectedItems());
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
  }
}
