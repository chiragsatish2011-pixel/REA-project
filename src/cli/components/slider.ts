/**
 * Inline Slider / Choice Cycler Component
 * Navigated with Left/Right arrows (also h/l), Enter to confirm, Esc to cancel.
 */

import { ThemeManager } from '../theme.js';
import { RawInputReader, type KeyStroke } from '../raw-input.js';
import { FooterHints } from './footer-hints.js';

export interface SliderOption<T = string> {
  label: string;
  value: T;
  description?: string;
}

export interface SliderConfig<T = string> {
  title: string;
  options: SliderOption<T>[];
  initialIndex?: number;
  onSelect?: (option: SliderOption<T>) => void;
  onCancel?: () => void;
}

export class InlineSlider<T = string> {
  private currentIndex: number;
  private options: SliderOption<T>[];
  private title: string;

  constructor(private config: SliderConfig<T>) {
    this.options = config.options;
    this.currentIndex = Math.max(0, Math.min(config.initialIndex ?? 0, this.options.length - 1));
    this.title = config.title;
  }

  public getSelected(): SliderOption<T> {
    return this.options[this.currentIndex];
  }

  public handleKey(key: KeyStroke): 'continue' | 'select' | 'cancel' {
    if (key.name === 'left' || key.name === 'char' && key.char === 'h') {
      if (this.currentIndex > 0) {
        this.currentIndex--;
      }
      return 'continue';
    }
    if (key.name === 'right' || key.name === 'char' && key.char === 'l') {
      if (this.currentIndex < this.options.length - 1) {
        this.currentIndex++;
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

    // Header title
    lines.push(`  ${c.bold}${this.title}${c.reset}`);

    // Slider options row
    const items = this.options.map((opt, idx) => {
      if (idx === this.currentIndex) {
        return `${c.accent}${c.bold}[ ${opt.label.toUpperCase()} ]${c.reset}`;
      }
      return `${c.secondary}${opt.label}${c.reset}`;
    });

    lines.push(`  ${items.join(`  ${c.border}│${c.reset}  `)}`);

    // Active item description if any
    const active = this.options[this.currentIndex];
    if (active.description) {
      lines.push(`  ${c.dim}${active.description}${c.reset}`);
    }

    // Context-aware footer hint
    lines.push('');
    lines.push(FooterHints.render([
      { key: '←/→', label: 'adjust' },
      { key: 'enter', label: 'confirm' },
      { key: 'esc', label: 'cancel' },
    ]));

    return lines;
  }

  /**
   * Run the interactive slider loop.
   */
  public async prompt(
    stdin: NodeJS.ReadStream = process.stdin,
    stdout: NodeJS.WriteStream = process.stdout
  ): Promise<SliderOption<T> | null> {
    RawInputReader.enableRawMode(stdin);
    let lineCount = 0;

    const redraw = () => {
      // Clear previously printed lines if any
      if (lineCount > 0) {
        stdout.write(`\x1b[${lineCount}A\x1b[0J`);
      }
      const rendered = this.render();
      stdout.write(rendered.join('\n') + '\n');
      lineCount = rendered.length;
    };

    redraw();

    return new Promise<SliderOption<T> | null>((resolve) => {
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
  }
}
