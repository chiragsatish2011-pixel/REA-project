/**
 * Reusable Unified Diff Viewer Component
 * Line numbers, red/green coloring, hunk headers, and per-hunk stats.
 */

import { ThemeManager } from '../theme.js';

export interface DiffHunk {
  header: string;
  lines: string[];
  addedCount: number;
  removedCount: number;
}

export class DiffViewer {
  public static parseHunks(diffText: string): DiffHunk[] {
    const rawLines = diffText.split('\n');
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;

    for (const line of rawLines) {
      if (line.startsWith('@@')) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          header: line,
          lines: [],
          addedCount: 0,
          removedCount: 0,
        };
        continue;
      }

      if (currentHunk) {
        currentHunk.lines.push(line);
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentHunk.addedCount++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentHunk.removedCount++;
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  public static renderUnified(filePath: string, diffText: string): string[] {
    const c = ThemeManager.getColors();
    const lines: string[] = [];
    const hunks = DiffViewer.parseHunks(diffText);

    let totalAdded = 0;
    let totalRemoved = 0;
    for (const h of hunks) {
      totalAdded += h.addedCount;
      totalRemoved += h.removedCount;
    }

    // Header banner with stats
    const statsStr = `${c.success}+${totalAdded}${c.reset} ${c.error}-${totalRemoved}${c.reset}`;
    lines.push(`  ${c.accent}◈ Diff:${c.reset} ${c.bold}${filePath}${c.reset}  ${statsStr}`);

    if (hunks.length === 0) {
      lines.push(`  ${c.secondary}(no diff changes)${c.reset}`);
      return lines;
    }

    for (const hunk of hunks) {
      lines.push(`  ${c.info}${hunk.header}${c.reset}`);
      for (const line of hunk.lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          lines.push(`  ${c.diffAddBg || ''}${c.success}${line}${c.reset}`);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lines.push(`  ${c.diffRemoveBg || ''}${c.error}${line}${c.reset}`);
        } else {
          lines.push(`  ${c.secondary}${line}${c.reset}`);
        }
      }
    }

    return lines;
  }

  /**
   * Renders high-fidelity OpenCode style edit card with line number gutters and tinted background rows.
   */
  public static renderOpenCodeEdit(filePath: string, diffText: string): string[] {
    const c = ThemeManager.getColors();
    const lines: string[] = [];
    lines.push(`  ${c.secondary}←${c.reset} ${c.bold}Edit${c.reset} ${c.text}${filePath}${c.reset}`);
    lines.push('');

    const rawLines = diffText.split('\n');
    let oldLine = 1;
    let newLine = 1;

    for (const raw of rawLines) {
      if (raw.startsWith('@@')) {
        const m = raw.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
        if (m) {
          oldLine = parseInt(m[1], 10);
          newLine = parseInt(m[2], 10);
        }
        continue;
      }
      if (raw.startsWith('---') || raw.startsWith('+++')) continue;

      if (raw.startsWith('-')) {
        const numStr = String(oldLine).padStart(4, ' ');
        oldLine++;
        const content = raw.slice(1).startsWith(' ') ? raw.slice(2) : raw.slice(1);
        const bg = c.diffRemoveBg || '\x1b[48;2;60;22;28m';
        const fg = c.diffRemoveText || c.error;
        lines.push(`  ${bg}${fg}${numStr} -  ${content}${c.reset}`);
      } else if (raw.startsWith('+')) {
        const numStr = String(newLine).padStart(4, ' ');
        newLine++;
        const content = raw.slice(1).startsWith(' ') ? raw.slice(2) : raw.slice(1);
        const bg = c.diffAddBg || '\x1b[48;2;16;44;38m';
        const fg = c.diffAddText || c.success;
        lines.push(`  ${bg}${fg}${numStr} +  ${content}${c.reset}`);
      } else {
        const numStr = String(newLine).padStart(4, ' ');
        oldLine++;
        newLine++;
        const content = raw.startsWith(' ') ? raw.slice(1) : raw;
        lines.push(`  ${c.secondary}${numStr}${c.reset}      ${c.text}${content}${c.reset}`);
      }
    }
    return lines;
  }
}
