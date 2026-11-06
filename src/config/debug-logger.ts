/**
 * @file debug-logger.ts
 * @description Safe Debug Logger for Nomin Code.
 * When enabled via `/debug on` or `--debug`, logs full HTTP requests (system prompt, messages, tools)
 * and responses to `<workdir>/.nomin/debug.log` with credentials and keys safely redacted.
 * Zero external dependencies (pure Node.js).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RedactionEngine } from './keychain.js';

export class DebugLogger {
  private static isEnabled = false;
  private static logFilePath: string | null = null;

  public static enable(workdir?: string): string {
    DebugLogger.isEnabled = true;
    const baseDir = workdir || process.cwd();
    const nominDir = path.join(baseDir, '.nomin');
    try {
      if (!fs.existsSync(nominDir)) {
        fs.mkdirSync(nominDir, { recursive: true });
      }
      DebugLogger.logFilePath = path.join(nominDir, 'debug.log');
    } catch {
      DebugLogger.logFilePath = path.join(os.tmpdir(), 'nomin-debug.log');
    }

    const header = `\n=== Nomin Code Debug Session Started [${new Date().toISOString()}] ===\n`;
    try {
      fs.appendFileSync(DebugLogger.logFilePath, header, 'utf-8');
    } catch (_) {}

    return DebugLogger.logFilePath;
  }

  public static disable(): void {
    DebugLogger.isEnabled = false;
  }

  public static toggle(workdir?: string): { enabled: boolean; logFile?: string } {
    if (DebugLogger.isEnabled) {
      DebugLogger.disable();
      return { enabled: false };
    } else {
      const file = DebugLogger.enable(workdir);
      return { enabled: true, logFile: file };
    }
  }

  public static getLogPath(): string | null {
    return DebugLogger.logFilePath;
  }

  public static getActiveStatus(): boolean {
    return DebugLogger.isEnabled;
  }

  public static logRequest(endpoint: string, payload: Record<string, any>): void {
    if (!DebugLogger.isEnabled || !DebugLogger.logFilePath) return;

    try {
      const timestamp = new Date().toISOString();
      const sanitized = RedactionEngine.redactDeep(payload);
      const entry = `\n--- [${timestamp}] HTTP REQUEST --> ${endpoint} ---\n${JSON.stringify(sanitized, null, 2)}\n`;
      fs.appendFileSync(DebugLogger.logFilePath, entry, 'utf-8');
    } catch (_) {}
  }

  public static logResponse(endpoint: string, response: Record<string, any> | string): void {
    if (!DebugLogger.isEnabled || !DebugLogger.logFilePath) return;

    try {
      const timestamp = new Date().toISOString();
      let text = '';
      if (typeof response === 'string') {
        text = RedactionEngine.redact(response);
      } else {
        const sanitized = RedactionEngine.redactDeep(response);
        text = JSON.stringify(sanitized, null, 2);
      }
      const entry = `\n--- [${timestamp}] HTTP RESPONSE <-- ${endpoint} ---\n${text}\n`;
      fs.appendFileSync(DebugLogger.logFilePath, entry, 'utf-8');
    } catch (_) {}
  }
}
