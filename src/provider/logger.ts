/**
 * Nomin Code: Production File & Diagnostic Logger
 * Writes sanitized debug/info/error traces to ~/.nomin/logs/nomin.log
 * Always redacts sensitive credentials via RedactionEngine.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RedactionEngine } from '../config/keychain.js';

export class NominLogger {
  private static logFilePath: string | null = null;
  private static logDir: string | null = null;

  public static getLogDir(): string {
    if (!this.logDir) {
      const baseDir = process.env.NOMIN_GLOBAL_DIR || path.join(os.homedir(), '.nomin');
      this.logDir = path.join(baseDir, 'logs');
      try {
        if (!fs.existsSync(this.logDir)) {
          fs.mkdirSync(this.logDir, { recursive: true });
        }
      } catch {
        // Fallback to temp directory if home is not writable
        this.logDir = path.join(os.tmpdir(), '.nomin', 'logs');
        if (!fs.existsSync(this.logDir)) {
          fs.mkdirSync(this.logDir, { recursive: true });
        }
      }
    }
    return this.logDir;
  }

  public static getLogFilePath(): string {
    if (!this.logFilePath) {
      this.logFilePath = path.join(this.getLogDir(), 'nomin.log');
    }
    return this.logFilePath;
  }

  public static log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, meta?: unknown): void {
    try {
      const timestamp = new Date().toISOString();
      const sanitizedMsg = RedactionEngine.redact(message);
      let metaStr = '';
      if (meta !== undefined) {
        try {
          const sanitizedMeta = RedactionEngine.redactDeep(meta);
          metaStr = ' ' + JSON.stringify(sanitizedMeta);
        } catch {
          metaStr = ' [unserializable meta]';
        }
      }

      const logLine = `[${timestamp}] [${level}] ${sanitizedMsg}${metaStr}\n`;
      fs.appendFileSync(this.getLogFilePath(), logLine, 'utf8');
    } catch {
      // Never crash the application because logging failed
    }
  }

  public static debug(message: string, meta?: unknown): void {
    this.log('DEBUG', message, meta);
  }

  public static info(message: string, meta?: unknown): void {
    this.log('INFO', message, meta);
  }

  public static warn(message: string, meta?: unknown): void {
    this.log('WARN', message, meta);
  }

  public static error(message: string, meta?: unknown): void {
    this.log('ERROR', message, meta);
  }
}
