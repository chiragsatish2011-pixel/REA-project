/**
 * Reusable Interactive Confirmation & Permission Dialog
 * Supports hotkeys (a, y, n, p) or arrow navigation, Enter to select, Esc to cancel.
 */

import { ThemeManager } from '../theme.js';
import { RawInputReader, type KeyStroke } from '../raw-input.js';
import { FooterHints } from './footer-hints.js';

export interface ConfirmChoice<T = string> {
  key: string;       // e.g. 'y', 'a', 'n', 'p'
  label: string;     // e.g. 'Allow once'
  value: T;
  isDanger?: boolean;
}

export interface ConfirmDialogConfig<T = string> {
  promptText: string;
  detail?: string;
  choices?: ConfirmChoice<T>[];
  defaultChoiceKey?: string;
}

export class ConfirmDialog<T = string> {
  private choices: ConfirmChoice<T>[];
  private selectedIndex = 0;
  private promptText: string;
  private detail?: string;

  constructor(config: ConfirmDialogConfig<T>) {
    this.promptText = config.promptText;
    this.detail = config.detail;
    this.choices = config.choices || [
      { key: 'y', label: 'Allow once', value: 'yes' as any },
      { key: 'a', label: 'Always allow', value: 'always' as any },
      { key: 'p', label: 'Plan mode', value: 'plan' as any },
      { key: 'n', label: 'Deny', value: 'no' as any, isDanger: true },
    ];

    if (config.defaultChoiceKey) {
      const idx = this.choices.findIndex(c => c.key.toLowerCase() === config.defaultChoiceKey?.toLowerCase());
      if (idx >= 0) this.selectedIndex = idx;
    }
  }

  public getSelected(): ConfirmChoice<T> {
    return this.choices[this.selectedIndex];
  }

  public handleKey(key: KeyStroke): 'continue' | 'select' | 'cancel' {
    // Arrow keys
    if (key.name === 'left' || key.name === 'up' || (key.name === 'char' && (key.char === 'h' || key.char === 'k'))) {
      if (this.selectedIndex > 0) this.selectedIndex--;
      return 'continue';
    }

    if (key.name === 'right' || key.name === 'down' || (key.name === 'char' && (key.char === 'l' || key.char === 'j'))) {
      if (this.selectedIndex < this.choices.length - 1) this.selectedIndex++;
      return 'continue';
    }

    // Direct key shortcuts (y, a, n, p)
    if (key.name === 'char' && key.char) {
      const matchedIdx = this.choices.findIndex(c => c.key.toLowerCase() === key.char?.toLowerCase());
      if (matchedIdx >= 0) {
        this.selectedIndex = matchedIdx;
        return 'select';
      }
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

    lines.push(`  ${c.warning}⚠️  ${this.promptText}${c.reset}`);
    if (this.detail) {
      lines.push(`  ${c.secondary}${this.detail}${c.reset}`);
    }

    // Horizontal choices row
    const pills = this.choices.map((ch, idx) => {
      const isSelected = idx === this.selectedIndex;
      const keyStr = `[${ch.key}]`;
      if (isSelected) {
        const color = ch.isDanger ? c.error : c.accent;
        return `${color}${c.bold}❯ ${keyStr} ${ch.label}${c.reset}`;
      }
      return `${c.secondary}${keyStr} ${ch.label}${c.reset}`;
    });

    lines.push(`  ${pills.join(`  ${c.border}│${c.reset}  `)}`);
    lines.push(FooterHints.render([
      { key: '←/→', label: 'move' },
      { key: 'enter', label: 'confirm' },
      { key: 'hotkey', label: 'press key directly' },
      { key: 'esc', label: 'deny' },
    ]));

    return lines;
  }

  public async prompt(
    stdin: NodeJS.ReadStream = process.stdin,
    stdout: NodeJS.WriteStream = process.stdout
  ): Promise<ConfirmChoice<T> | null> {
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

    return new Promise<ConfirmChoice<T> | null>((resolve) => {
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
