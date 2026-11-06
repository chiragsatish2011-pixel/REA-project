/**
 * @file search.ts
 * @description High-speed recursive Grep (with regex support) and Glob pattern matcher.
 * Pure Node.js (node:fs, node:path), zero external dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Tool,
  ToolExecutionContext,
  ToolResult,
  ToolParametersSchema,
  SearchGrepInput,
  SearchGrepResult,
  GrepMatch,
  SearchGlobInput,
  SearchGlobResult,
} from './types.js';
import { isBinaryBuffer } from './read-file.js';

export interface GrepOptions {
  pattern?: string;
  query?: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  includePattern?: string;
  excludePattern?: string;
}

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.nomin',
  '.vscode',
  '.idea',
  'coverage',
  '.next',
  '.nuxt',
  'build',
  'out',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svgz',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.iso',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.webm',
  '.pyc', '.class', '.wasm',
]);

/**
 * Converts a glob pattern string to a RegExp.
 * Supports:
 *   ** - recursive directories
 *   *  - wildcards within path segment
 *   ?  - single character
 */
export function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/');
  let regexStr = '^';
  let i = 0;
  const len = normalized.length;

  while (i < len) {
    const c = normalized[i];
    if (c === '*' && normalized[i + 1] === '*') {
      if (normalized[i + 2] === '/') {
        regexStr += '(?:.*\\/)?';
        i += 3;
      } else {
        regexStr += '.*';
        i += 2;
      }
    } else if (c === '*') {
      regexStr += '[^\\/]*';
      i++;
    } else if (c === '?') {
      regexStr += '[^\\/]';
      i++;
    } else if (['.', '(', ')', '+', '^', '$', '{', '}', '|'].includes(c)) {
      regexStr += '\\' + c;
      i++;
    } else {
      regexStr += c;
      i++;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr);
}

/**
 * Normalizes relative path with forward slashes for cross-platform glob matching.
 */
function normalizeRelativePath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

/**
 * Recursively scans directory collecting all relative file paths,
 * with strict file count limits and .gitignore compliance to prevent freezing on large directories.
 */
export function crawlDirectory(
  rootDir: string,
  currentRelDir: string = '',
  ignoredDirs: Set<string> = DEFAULT_IGNORED_DIRS,
  maxFiles: number = 1000
): string[] {
  const currentAbsDir = currentRelDir ? path.join(rootDir, currentRelDir) : rootDir;
  if (!fs.existsSync(currentAbsDir)) return [];

  const results: string[] = [];

  // Parse .gitignore if at root
  const gitignorePatterns: RegExp[] = [];
  if (!currentRelDir && fs.existsSync(path.join(rootDir, '.gitignore'))) {
    try {
      const gitignoreContent = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
      const lines = gitignoreContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      for (const line of lines) {
        try {
          gitignorePatterns.push(globToRegex(line));
        } catch (_) {}
      }
    } catch (_) {}
  }

  function walk(relDir: string): void {
    if (results.length >= maxFiles) return;
    const absDir = relDir ? path.join(rootDir, relDir) : rootDir;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const entryName = entry.name;
      const relPath = relDir ? path.join(relDir, entryName) : entryName;
      const normRel = relPath.replace(/\\/g, '/');

      // Check gitignore patterns
      if (gitignorePatterns.some((re) => re.test(normRel) || re.test(entryName))) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entryName)) {
          walk(relPath);
        }
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        results.push(relPath);
      }
    }
  }

  walk(currentRelDir);
  return results;
}

/**
 * High-speed recursive Grep implementation.
 */
export function grepInDirectory(
  baseDir: string,
  targetPath: string,
  options: {
    query: string;
    isRegex?: boolean;
    caseSensitive?: boolean;
    maxResults?: number;
    includePattern?: string;
    excludePattern?: string;
  }
): SearchGrepResult {
  const resolvedTarget = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(baseDir, targetPath);

  if (!fs.existsSync(resolvedTarget)) {
    return { matches: [], totalMatches: 0, filesSearched: 0, truncated: false };
  }

  const stat = fs.statSync(resolvedTarget);
  let filesToSearch: { absPath: string; relPath: string }[] = [];

  if (stat.isFile()) {
    filesToSearch.push({
      absPath: resolvedTarget,
      relPath: path.relative(baseDir, resolvedTarget),
    });
  } else {
    const allRel = crawlDirectory(resolvedTarget, '', DEFAULT_IGNORED_DIRS);
    filesToSearch = allRel.map((rel) => ({
      absPath: path.join(resolvedTarget, rel),
      relPath: path.relative(baseDir, path.join(resolvedTarget, rel)),
    }));
  }

  let includeRegex: RegExp | null = null;
  if (options.includePattern) {
    includeRegex = globToRegex(options.includePattern);
  }
  let excludeRegex: RegExp | null = null;
  if (options.excludePattern) {
    excludeRegex = globToRegex(options.excludePattern);
  }

  if (includeRegex || excludeRegex) {
    filesToSearch = filesToSearch.filter((f) => {
      const norm = normalizeRelativePath(f.relPath);
      if (includeRegex && !includeRegex.test(norm)) return false;
      if (excludeRegex && excludeRegex.test(norm)) return false;
      return true;
    });
  }

  let searchRegex: RegExp;
  if (options.isRegex) {
    const flags = options.caseSensitive ? 'g' : 'gi';
    searchRegex = new RegExp(options.query, flags);
  } else {
    const escaped = options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = options.caseSensitive ? 'g' : 'gi';
    searchRegex = new RegExp(escaped, flags);
  }

  const maxResults = options.maxResults || 100;
  const matches: GrepMatch[] = [];
  let filesSearchedCount = 0;
  let truncated = false;

  for (const file of filesToSearch) {
    const ext = path.extname(file.absPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) continue;

    try {
      const fileStat = fs.statSync(file.absPath);
      if (fileStat.size > 10 * 1024 * 1024) continue;

      const fd = fs.openSync(file.absPath, 'r');
      const checkBuf = Buffer.alloc(512);
      const readBytes = fs.readSync(fd, checkBuf, 0, 512, 0);
      fs.closeSync(fd);
      if (isBinaryBuffer(checkBuf.subarray(0, readBytes))) continue;

      filesSearchedCount++;
      const content = fs.readFileSync(file.absPath, 'utf-8');
      const lines = content.split(/\r?\n/);

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        searchRegex.lastIndex = 0;
        const match = searchRegex.exec(line);

        if (match !== null) {
          matches.push({
            file: normalizeRelativePath(file.relPath),
            line: lineIdx + 1,
            column: match.index + 1,
            text: line.trim(),
          });

          if (matches.length >= maxResults) {
            truncated = true;
            break;
          }
        }
      }

      if (truncated) break;
    } catch {
      continue;
    }
  }

  return {
    matches,
    totalMatches: matches.length,
    filesSearched: filesSearchedCount,
    truncated,
  };
}

/**
 * Static Search Tool helper class for backward compatibility.
 */
export class SearchTool {
  public static grep(workdir: string, options: GrepOptions): GrepMatch[] {
    const query = options.query ?? options.pattern ?? '';
    const res = grepInDirectory(workdir, '.', {
      query,
      isRegex: options.isRegex,
      caseSensitive: options.caseSensitive,
      maxResults: options.maxResults,
      includePattern: options.includePattern,
      excludePattern: options.excludePattern,
    });
    return res.matches;
  }

  public static glob(workdir: string, pattern: string, maxResults: number = 200): string[] {
    const allRel = crawlDirectory(workdir, '', DEFAULT_IGNORED_DIRS);
    const regex = globToRegex(pattern);
    const matched = allRel
      .map(normalizeRelativePath)
      .filter((f) => regex.test(f));
    matched.sort();
    return matched.slice(0, maxResults);
  }
}

/**
 * Grep Tool Class
 */
export class SearchGrepTool implements Tool {
  public readonly name = 'search_grep';
  public readonly description =
    'High-speed recursive text and regex search across files in the workspace. Returns matching files, line numbers, and text.';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text or regular expression pattern to search for.',
      },
      path: {
        type: 'string',
        description: 'Relative directory or file path to search within (default: root).',
        default: '.',
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Whether the search is case-sensitive (default: true).',
        default: true,
      },
      is_regex: {
        type: 'boolean',
        description: 'Whether query should be treated as a regular expression (default: false).',
        default: false,
      },
      max_results: {
        type: 'integer',
        description: 'Maximum number of matching lines to return (default: 100).',
        default: 100,
      },
      include_pattern: {
        type: 'string',
        description: 'Glob pattern of files to include (e.g. "**/*.ts").',
      },
      exclude_pattern: {
        type: 'string',
        description: 'Glob pattern of files/directories to exclude.',
      },
    },
    required: ['query'],
  };

  public async execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const query = args.query as string;
    if (!query) {
      return { success: false, output: '', error: 'Missing required argument: query' };
    }

    const searchPath = (args.path as string) || '.';
    const result = grepInDirectory(context.worktreePath, searchPath, {
      query,
      isRegex: args.is_regex === true,
      caseSensitive: args.case_sensitive !== false,
      maxResults: args.max_results || 100,
      includePattern: args.include_pattern,
      excludePattern: args.exclude_pattern,
    });

    if (result.matches.length === 0) {
      return {
        success: true,
        output: `No matches found for "${query}" (searched ${result.filesSearched} files).`,
        data: result,
      };
    }

    const formattedLines = result.matches.map(
      (m) => `${m.file}:${m.line}:${m.column}: ${m.text}`
    );

    let output = formattedLines.join('\n');
    if (result.truncated) {
      output += `\n\n[... Search truncated at ${result.matches.length} matches. Narrow your query or increase max_results ...]`;
    }

    return {
      success: true,
      output: `Found ${result.totalMatches} match(es) across ${result.filesSearched} file(s):\n\n${output}`,
      data: result,
      metadata: {
        totalMatches: result.totalMatches,
        filesSearched: result.filesSearched,
        truncated: result.truncated,
      },
    };
  }
}

/**
 * Glob Pattern Search Tool
 */
export class SearchGlobTool implements Tool {
  public readonly name = 'search_glob';
  public readonly description =
    'Finds files matching a glob pattern (e.g. "**/*.ts", "src/**/*.js", "tests/*.test.ts") using pure Node.js.';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match file paths against.',
      },
      path: {
        type: 'string',
        description: 'Directory path to search within (default: root).',
        default: '.',
      },
      max_results: {
        type: 'integer',
        description: 'Maximum number of file paths to return (default: 200).',
        default: 200,
      },
    },
    required: ['pattern'],
  };

  public async execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const pattern = args.pattern as string;
    if (!pattern) {
      return { success: false, output: '', error: 'Missing required argument: pattern' };
    }

    const targetRel = (args.path as string) || '.';
    const targetAbs = path.isAbsolute(targetRel)
      ? targetRel
      : path.resolve(context.worktreePath, targetRel);

    if (!fs.existsSync(targetAbs)) {
      return {
        success: false,
        output: '',
        error: `Directory not found: ${targetRel}`,
      };
    }

    const maxResults = args.max_results || 200;
    const allRelFiles = crawlDirectory(targetAbs, '', DEFAULT_IGNORED_DIRS);
    const regex = globToRegex(pattern);

    const matchedFiles: string[] = [];
    let truncated = false;

    for (const relFile of allRelFiles) {
      const norm = normalizeRelativePath(relFile);
      if (regex.test(norm)) {
        matchedFiles.push(norm);
        if (matchedFiles.length >= maxResults) {
          truncated = true;
          break;
        }
      }
    }

    matchedFiles.sort();

    const resultData: SearchGlobResult = {
      files: matchedFiles,
      totalFiles: matchedFiles.length,
      truncated,
    };

    if (matchedFiles.length === 0) {
      return {
        success: true,
        output: `No files matched pattern: "${pattern}"`,
        data: resultData,
      };
    }

    let output = matchedFiles.join('\n');
    if (truncated) {
      output += `\n\n[... Truncated at ${matchedFiles.length} files ...]`;
    }

    return {
      success: true,
      output: `Found ${matchedFiles.length} file(s) matching "${pattern}":\n\n${output}`,
      data: resultData,
      metadata: {
        totalFiles: matchedFiles.length,
        truncated,
      },
    };
  }
}
