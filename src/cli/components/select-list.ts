/**
 * Reusable Arrow-Navigated Select List Component
 * Virtualized scrolling window (10-15 rows), position indicator, PageUp/PageDown, Home/End,
 * highlighted cursor (accent + pointer ❯), mouse click/wheel support, and dim footer hints.
 */

import { ThemeManager } from '../theme.js';
import { RawInputReader, type KeyStroke } from '../raw-input.js';
import { FooterHints } from './footer-hints.js';

export interface SelectOption<T = string> {
  id: string;
  label: string;
  secondary?: string;
  value: T;
  disabled?: boolean;
}

export interface SelectListConfig<T = string> {
  title?: string;
  options: SelectOption<T>[];
  pageSize?: number;
  initialIndex?: number;
}

export class SelectList<T = string> {
  private options: SelectOption<T>[];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private pageSize: number;
  private title?: string;

  constructor(config: SelectListConfig<T>) {
    this.options = config.options;
    this.pageSize = config.pageSize || 12;
    this.title = config.title;
    this.selectedIndex = Math.max(0, Math.min(config.initialIndex ?? 0, this.options.length - 1));
    this.adjustScroll();
  }

  public getSelected(): SelectOption<T> | null {
    if (this.options.length === 0) return null;
    return this.options[this.selectedIndex] || null;
  }

  public getSelectedIndex(): number {
    return this.selectedIndex;
  }

  private adjustScroll(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.pageSize) {
      this.scrollOffset = this.selectedIndex - this.pageSize + 1;
    }
  }

  public handleKey(key: KeyStroke): 'continue' | 'select' | 'cancel' {
    const total = this.options.length;
    if (total === 0) {
      if (key.name === 'escape') return 'cancel';
      return 'continue';
    }

    if (key.name === 'up' || (key.name === 'char' && key.char === 'k')) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'down' || (key.name === 'char' && key.char === 'j')) {
      if (this.selectedIndex < total - 1) {
        this.selectedIndex++;
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'pageup') {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.pageSize);
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'pagedown') {
      this.selectedIndex = Math.min(total - 1, this.selectedIndex + this.pageSize);
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'home') {
      this.selectedIndex = 0;
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'end') {
      this.selectedIndex = total - 1;
      this.adjustScroll();
      return 'continue';
    }

    // Number shortcuts for short lists (< 10)
    if (total < 10 && key.name === 'char' && key.char && key.char >= '1' && key.char <= '9') {
      const idx = parseInt(key.char, 10) - 1;
      if (idx < total) {
        this.selectedIndex = idx;
        return 'select';
      }
    }

    // Mouse scroll
    if (key.name === 'mouse-scroll-up') {
      if (this.selectedIndex > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 3);
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'mouse-scroll-down') {
      if (this.selectedIndex < total - 1) {
        this.selectedIndex = Math.min(total - 1, this.selectedIndex + 3);
        this.adjustScroll();
      }
      return 'continue';
    }

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
    const total = this.options.length;

    // Optional header with position counter
    const position = total > 0 ? ` (${this.selectedIndex + 1} / ${total})` : '';
    if (this.title) {
      lines.push(`  ${c.bold}${this.title}${c.reset}${c.secondary}${position}${c.reset}`);
    }

    if (total === 0) {
      lines.push(`  ${c.secondary}(no items)${c.reset}`);
      return lines;
    }

    const visibleItems = this.options.slice(this.scrollOffset, this.scrollOffset + this.pageSize);

    // Scroll up indicator
    const hasMoreAbove = this.scrollOffset > 0;
    lines.push(`  ${c.secondary}${hasMoreAbove ? '▲ more above' : ' '}${c.reset}`);

    // Visible window
    const maxLabelLen = Math.max(...visibleItems.map(i => i.label.length), 8);
    visibleItems.forEach((item, localIdx) => {
      const globalIdx = this.scrollOffset + localIdx;
      const isSelected = globalIdx === this.selectedIndex;
      const labelPadded = item.label.padEnd(maxLabelLen, ' ');
      const secStr = item.secondary ? `  ${item.secondary}` : '';

      if (isSelected) {
        lines.push(`  ${c.peachBg}  ❯ ${labelPadded}${secStr}  ${c.reset}`);
      } else {
        lines.push(`      ${c.bold}${c.text}${labelPadded}${c.reset}${c.secondary}${secStr}${c.reset}`);
      }
    });

    // Scroll down indicator
    const hasMoreBelow = this.scrollOffset + this.pageSize < total;
    lines.push(`  ${c.secondary}${hasMoreBelow ? '▼ more below' : ' '}${c.reset}`);

    // Dim footer hints
    lines.push(FooterHints.render([
      { key: '↑/↓', label: 'move' },
      { key: 'enter', label: 'select' },
      { key: 'esc', label: 'cancel' },
    ]));

    return lines;
  }

  public async prompt(
    stdin: NodeJS.ReadStream = process.stdin,
    stdout: NodeJS.WriteStream = process.stdout
  ): Promise<SelectOption<T> | null> {
    RawInputReader.enableRawMode(stdin);
    RawInputReader.enableMouse(stdout);
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

    return new Promise<SelectOption<T> | null>((resolve) => {
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
        RawInputReader.disableMouse(stdout);
      };

      stdin.on('data', onData);
    });
  }
}
