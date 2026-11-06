/**
 * @file path-resolver.ts
 * @description Single Source of Truth for Path Parsing, Normalization, and Resolution in Nomin Code.
 * Handles:
 *   - Shell-style tokenizing for quoted and unquoted arguments with follow-up prose
 *   - Absolute paths (Windows drive letters, UNC, rooted) used as-is, never joined onto cwd
 *   - Relative paths resolved against workspace root
 *   - ~, %VAR%, $env:VAR, $VAR expansion
 *   - Case-insensitive filesystem matching on Windows
 *   - Longest-prefix directory matching for unquoted paths with follow-up prose
 *   - Detailed error differentiation: not_found, is_file, permission_denied
 * Zero external dependencies (pure Node.js).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface PathResolutionResult {
  success: boolean;
  resolvedPath: string;
  rawPathToken: string;
  followUpText: string;
  error?: string;
  errorType?: 'not_found' | 'is_file' | 'permission_denied' | 'invalid_path';
  wasAmbiguous?: boolean;
}

export class SharedPathResolver {
  /**
   * Parses shell-style arguments to /cd and resolves the target directory.
   */
  public static parseAndResolve(rawInput: string, currentWorkspace: string): PathResolutionResult {
    const trimmed = (rawInput || '').trim();

    if (!trimmed) {
      return {
        success: true,
        resolvedPath: path.resolve(currentWorkspace),
        rawPathToken: '',
        followUpText: '',
      };
    }

    let rawPathToken = '';
    let followUpText = '';

    const firstChar = trimmed[0];
    if (firstChar === '"' || firstChar === "'") {
      // 1. Quoted argument: scan for closing quote
      const quoteChar = firstChar;
      let closingIndex = -1;

      // In Windows paths inside quotes, backslashes are literal
      for (let i = 1; i < trimmed.length; i++) {
        if (trimmed[i] === quoteChar) {
          closingIndex = i;
          break;
        }
      }

      if (closingIndex !== -1) {
        rawPathToken = trimmed.slice(1, closingIndex).trim();
        followUpText = trimmed.slice(closingIndex + 1).trim();
      } else {
        // Unclosed quote: consume rest of string as path
        rawPathToken = trimmed.slice(1).trim();
        followUpText = '';
      }
    } else {
      // 2. Unquoted argument
      // First, test if the entire trimmed string resolves to an existing directory
      const wholeCandidate = SharedPathResolver.resolveCandidate(trimmed, currentWorkspace);
      if (wholeCandidate && SharedPathResolver.isDirectory(wholeCandidate)) {
        rawPathToken = trimmed;
        followUpText = '';
      } else {
        // Try progressively shorter prefixes split at whitespace
        const tokens = trimmed.split(/\s+/).filter(Boolean);
        let foundPrefix = false;

        for (let len = tokens.length - 1; len >= 1; len--) {
          const candidateStr = tokens.slice(0, len).join(' ');
          const candidatePath = SharedPathResolver.resolveCandidate(candidateStr, currentWorkspace);
          if (candidatePath && SharedPathResolver.isDirectory(candidatePath)) {
            rawPathToken = candidateStr;
            followUpText = tokens.slice(len).join(' ');
            foundPrefix = true;
            break;
          }
        }

        if (!foundPrefix) {
          // If no prefix exists as a directory, use first token as path candidate
          rawPathToken = tokens[0] || trimmed;
          followUpText = tokens.slice(1).join(' ');
        }
      }
    }

    // Resolve the extracted rawPathToken
    return SharedPathResolver.resolveAndValidate(rawPathToken, currentWorkspace, followUpText);
  }

  /**
   * Resolves a raw path token against current workspace and validates on filesystem.
   */
  public static resolveAndValidate(
    rawPathToken: string,
    currentWorkspace: string,
    followUpText: string = ''
  ): PathResolutionResult {
    const cleaned = SharedPathResolver.cleanPathString(rawPathToken);

    if (!cleaned) {
      return {
        success: true,
        resolvedPath: path.resolve(currentWorkspace),
        rawPathToken: '',
        followUpText,
      };
    }

    const resolved = SharedPathResolver.resolveCandidate(cleaned, currentWorkspace);

    // 1. Existence check
    if (!fs.existsSync(resolved)) {
      return {
        success: false,
        resolvedPath: resolved,
        rawPathToken,
        followUpText,
        errorType: 'not_found',
        error: `Directory not found: "${rawPathToken}". Path does not exist.`,
      };
    }

    // 2. Directory check
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch (err: any) {
      return {
        success: false,
        resolvedPath: resolved,
        rawPathToken,
        followUpText,
        errorType: 'invalid_path',
        error: `Cannot access path "${rawPathToken}": ${err.message}`,
      };
    }

    if (!stat.isDirectory()) {
      return {
        success: false,
        resolvedPath: resolved,
        rawPathToken,
        followUpText,
        errorType: 'is_file',
        error: `Path is a file, not a directory: "${rawPathToken}". Use read_file to view file contents.`,
      };
    }

    // 3. Permission check
    try {
      fs.accessSync(resolved, fs.constants.R_OK);
    } catch (err: any) {
      return {
        success: false,
        resolvedPath: resolved,
        rawPathToken,
        followUpText,
        errorType: 'permission_denied',
        error: `Permission denied: "${rawPathToken}". Cannot access directory.`,
      };
    }

    // 4. Canonicalize casing on Windows
    let canonicalPath = resolved;
    try {
      if (process.platform === 'win32' && fs.realpathSync.native) {
        canonicalPath = fs.realpathSync.native(resolved);
      }
    } catch (_) {
      canonicalPath = resolved;
    }

    return {
      success: true,
      resolvedPath: canonicalPath,
      rawPathToken,
      followUpText,
    };
  }

  /**
   * Expands variables, ~, and resolves absolute or relative paths.
   */
  public static resolveCandidate(input: string, currentWorkspace: string): string {
    let s = SharedPathResolver.cleanPathString(input);
    if (!s) return path.resolve(currentWorkspace);

    // Expand ~ to user home
    if (s === '~') {
      s = os.homedir();
    } else if (s.startsWith('~/') || s.startsWith('~\\')) {
      s = path.join(os.homedir(), s.slice(2));
    }

    // Expand %VAR%
    s = s.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');

    // Expand $env:VAR (PowerShell syntax)
    s = s.replace(/\$env:([A-Za-z0-9_]+)/gi, (_, name) => process.env[name] || '');

    // Expand $VAR (Unix syntax)
    s = s.replace(/\$([A-Za-z0-9_]+)/g, (_, name) => process.env[name] || '');

    // Normalize slashes
    s = path.normalize(s);

    // Strip trailing dot/space unless root
    if (s.length > 3 && (s.endsWith('/.') || s.endsWith('\\.'))) {
      s = s.slice(0, -2);
    }
    if (s.length > 3 && (s.endsWith('/') || s.endsWith('\\'))) {
      s = s.slice(0, -1);
    }

    // Check if absolute:
    // Windows: C:\, C:/, \\server\share, \rooted
    // Unix: /abs
    const isWinDrive = /^[a-zA-Z]:[/\\]?/.test(s);
    const isUnc = /^(\\\\[^\\]+\\[^\\]+|\/\/[^\/]+\/[^\/]+)/.test(s);
    const isRooted = /^[/\\]/.test(s);

    if (path.isAbsolute(s) || isWinDrive || isUnc || (isRooted && process.platform !== 'win32')) {
      return path.resolve(s);
    }

    if (isRooted && process.platform === 'win32') {
      // Rooted to current drive on Windows e.g. \Windows -> C:\Windows
      const drive = path.resolve(currentWorkspace).slice(0, 2);
      return path.resolve(`${drive}${s}`);
    }

    // Relative path
    return path.resolve(currentWorkspace, s);
  }

  /**
   * Strips surrounding quotes and trims whitespace safely.
   */
  public static cleanPathString(raw: string): string {
    let s = (raw || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  private static isDirectory(p: string): boolean {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }
}
