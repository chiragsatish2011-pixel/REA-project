/**
 * Interactive Timeline Viewer for /undo and /redo checkpoints
 * Up/Down navigation to select commit or checkpoint, Enter to restore, Esc to cancel.
 */

import { ThemeManager } from '../theme.js';
import { RawInputReader, type KeyStroke } from '../raw-input.js';
import { FooterHints } from './footer-hints.js';

export interface CheckpointItem {
  id: string;          // commit hash or checkpoint id
  title: string;       // e.g. "Added auth token validation"
  time: string;        // e.g. "2 mins ago"
  agent?: string;      // e.g. "coder"
  filesChanged?: number;
  isCurrent?: boolean;
}

export class TimelineViewer {
  private cursorIndex = 0;

  constructor(private checkpoints: CheckpointItem[]) {
    // Find current or start at 0
    const curIdx = checkpoints.findIndex(cp => cp.isCurrent);
    if (curIdx >= 0) this.cursorIndex = curIdx;
  }

  public getSelected(): CheckpointItem | null {
    return this.checkpoints[this.cursorIndex] || null;
  }

  public handleKey(key: KeyStroke): 'continue' | 'select' | 'cancel' {
    const total = this.checkpoints.length;
    if (total === 0) return key.name === 'escape' ? 'cancel' : 'continue';

    if (key.name === 'up' || (key.name === 'char' && key.char === 'k')) {
      if (this.cursorIndex > 0) this.cursorIndex--;
      return 'continue';
    }

    if (key.name === 'down' || (key.name === 'char' && key.char === 'j')) {
      if (this.cursorIndex < total - 1) this.cursorIndex++;
      return 'continue';
    }

    if (key.name === 'enter') return 'select';
    if (key.name === 'escape') return 'cancel';

    return 'continue';
  }

  public render(): string[] {
    const c = ThemeManager.getColors();
    const lines: string[] = [];

    lines.push(`  ${c.bold}Checkpoint Timeline & Rollback${c.reset}`);
    lines.push(`  ${c.secondary}Select a checkpoint to restore workspace state:${c.reset}`);
    lines.push('');

    this.checkpoints.forEach((cp, idx) => {
      const isCursor = idx === this.cursorIndex;
      const pointer = isCursor ? `${c.accent}❯${c.reset}` : ' ';
      const node = cp.isCurrent ? `${c.accent}● HEAD${c.reset}` : `${c.secondary}○${c.reset}`;
      const titleStr = isCursor ? `${c.accent}${c.bold}${cp.title}${c.reset}` : `${c.text}${cp.title}${c.reset}`;
      const timeStr = `${c.secondary}(${cp.time})${c.reset}`;
      const files = cp.filesChanged !== undefined ? ` ${c.info}[${cp.filesChanged} files]${c.reset}` : '';

      lines.push(`  ${pointer} ${node}  ${titleStr}  ${timeStr}${files}`);
    });

    lines.push('');
    lines.push(FooterHints.render([
      { key: '↑/↓', label: 'navigate checkpoints' },
      { key: 'enter', label: 'restore to this point' },
      { key: 'esc', label: 'cancel' },
    ]));

    return lines;
  }

  public async prompt(
    stdin: NodeJS.ReadStream = process.stdin,
    stdout: NodeJS.WriteStream = process.stdout
  ): Promise<CheckpointItem | null> {
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

    return new Promise<CheckpointItem | null>((resolve) => {
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
