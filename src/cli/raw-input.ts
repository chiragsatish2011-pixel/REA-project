/**
 * Nomin Code: Raw Terminal Input & Keystroke Decoder
 * Decodes arrow keys, Shift+Tab, Ctrl+R, PageUp/PageDown, Home/End, Esc, double-Esc, and SGR mouse events.
 * Compatible with Windows Terminal, PowerShell, cmd.exe, macOS, and Linux terminals.
 */

import * as readline from 'node:readline';

export interface KeyStroke {
  name: string;        // 'up' | 'down' | 'left' | 'right' | 'enter' | 'escape' | 'double-escape' | 'tab' | 'shift-tab' | 'backspace' | 'space' | 'char' | 'pageup' | 'pagedown' | 'home' | 'end' | 'mouse-click' | 'mouse-scroll-up' | 'mouse-scroll-down'
  sequence: string;
  char?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  mouseRow?: number;
  mouseCol?: number;
}

export class RawInputReader {
  private static lastEscTime = 0;
  private static escTimer: NodeJS.Timeout | null = null;
  private static mouseEnabled = false;

  public static enableRawMode(stdin: NodeJS.ReadStream = process.stdin): void {
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      try {
        stdin.setRawMode(true);
        stdin.resume();
        readline.emitKeypressEvents(stdin);
      } catch (_) {}
    }
  }

  public static disableRawMode(stdin: NodeJS.ReadStream = process.stdin): void {
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      try {
        stdin.setRawMode(false);
      } catch (_) {}
    }
    RawInputReader.disableMouse();
  }

  public static enableMouse(stdout: NodeJS.WriteStream = process.stdout): void {
    if (stdout.isTTY && !RawInputReader.mouseEnabled) {
      try {
        // Enable standard + SGR mouse reporting
        stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
        RawInputReader.mouseEnabled = true;
      } catch (_) {}
    }
  }

  public static disableMouse(stdout: NodeJS.WriteStream = process.stdout): void {
    if (stdout.isTTY && RawInputReader.mouseEnabled) {
      try {
        stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l');
        RawInputReader.mouseEnabled = false;
      } catch (_) {}
    }
  }

  /**
   * Parse a raw input chunk buffer or string into one or more KeyStroke objects.
   */
  public static parse(data: Buffer | string): KeyStroke[] {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    const strokes: KeyStroke[] = [];

    // Check for SGR mouse reporting: \x1b[<btn;col;row(M|m)
    const mouseMatch = raw.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (mouseMatch) {
      const btn = parseInt(mouseMatch[1], 10);
      const col = parseInt(mouseMatch[2], 10);
      const row = parseInt(mouseMatch[3], 10);
      const isRelease = mouseMatch[4] === 'm';

      if (!isRelease) {
        if (btn === 0) {
          strokes.push({ name: 'mouse-click', sequence: raw, mouseCol: col, mouseRow: row });
        } else if (btn === 64) {
          strokes.push({ name: 'mouse-scroll-up', sequence: raw, mouseCol: col, mouseRow: row });
        } else if (btn === 65) {
          strokes.push({ name: 'mouse-scroll-down', sequence: raw, mouseCol: col, mouseRow: row });
        }
      }
      return strokes;
    }

    // Bracketed paste detection: \x1b[200~ ... \x1b[201~
    if (raw.startsWith('\x1b[200~') && raw.endsWith('\x1b[201~')) {
      const content = raw.slice(6, -6);
      strokes.push({ name: 'paste', sequence: raw, char: content });
      return strokes;
    }

    // Shift+Tab: \x1b[Z
    if (raw === '\x1b[Z') {
      strokes.push({ name: 'shift-tab', sequence: raw, shift: true });
      return strokes;
    }

    // Windows Terminal / VT Arrow Keys & Navigation Keys
    if (raw === '\x1b[A' || raw === '\x1bOA') return [{ name: 'up', sequence: raw }];
    if (raw === '\x1b[B' || raw === '\x1bOB') return [{ name: 'down', sequence: raw }];
    if (raw === '\x1b[C' || raw === '\x1bOC') return [{ name: 'right', sequence: raw }];
    if (raw === '\x1b[D' || raw === '\x1bOD') return [{ name: 'left', sequence: raw }];

    // PageUp & PageDown & Delete
    if (raw === '\x1b[5~') return [{ name: 'pageup', sequence: raw }];
    if (raw === '\x1b[6~') return [{ name: 'pagedown', sequence: raw }];
    if (raw === '\x1b[3~') return [{ name: 'delete', sequence: raw }];

    // Home & End
    if (raw === '\x1b[H' || raw === '\x1b[1~') return [{ name: 'home', sequence: raw }];
    if (raw === '\x1b[F' || raw === '\x1b[4~') return [{ name: 'end', sequence: raw }];

    // Enter
    if (raw === '\r' || raw === '\n' || raw === '\r\n') return [{ name: 'enter', sequence: raw }];

    // Backspace
    if (raw === '\x7f' || raw === '\x08') return [{ name: 'backspace', sequence: raw }];

    // Tab
    if (raw === '\t') return [{ name: 'tab', sequence: raw }];

    // Space
    if (raw === ' ') return [{ name: 'space', sequence: raw, char: ' ' }];

    // Control sequences
    if (raw === '\x12') return [{ name: 'ctrl-r', sequence: raw, ctrl: true }];
    if (raw === '\x10') return [{ name: 'ctrl-p', sequence: raw, ctrl: true }];
    if (raw === '\x0f') return [{ name: 'ctrl-o', sequence: raw, ctrl: true }];
    if (raw === '\x03') return [{ name: 'ctrl-c', sequence: raw, ctrl: true }];
    if (raw === '\x04') return [{ name: 'ctrl-d', sequence: raw, ctrl: true }];
    if (raw === '\x01') return [{ name: 'ctrl-a', sequence: raw, ctrl: true }];
    if (raw === '\x05') return [{ name: 'ctrl-e', sequence: raw, ctrl: true }];
    if (raw === '\x17') return [{ name: 'ctrl-w', sequence: raw, ctrl: true }];
    if (raw === '\x15') return [{ name: 'ctrl-u', sequence: raw, ctrl: true }];
    if (raw === '\x0b') return [{ name: 'ctrl-k', sequence: raw, ctrl: true }];

    // Escape and double escape
    if (raw === '\x1b') {
      const now = Date.now();
      if (now - RawInputReader.lastEscTime <= 350) {
        RawInputReader.lastEscTime = 0;
        return [{ name: 'double-escape', sequence: raw }];
      } else {
        RawInputReader.lastEscTime = now;
        return [{ name: 'escape', sequence: raw }];
      }
    }

    // Default: Printable characters (supports multi-byte unicode)
    for (const char of raw) {
      if (char >= ' ' && char !== '\x7f') {
        strokes.push({ name: 'char', sequence: char, char });
      }
    }

    return strokes;
  }
}
