/**
 * @file list-dir.ts
 * @description Safe directory listing tool for Nomin Code.
 * Lists entries with types (directory, file, symlink) and sizes.
 * Zero external dependencies (pure Node.js).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Tool,
  ToolExecutionContext,
  ToolResult,
  ToolParametersSchema,
} from './types.js';

export interface DirectoryEntryItem {
  name: string;
  type: 'directory' | 'file' | 'symlink' | 'other';
  sizeBytes?: number;
}

export class ListDirTool implements Tool {
  public readonly name = 'list_dir';
  public readonly description =
    'Lists files and directories in a given path with their types and sizes. Defaults to current workspace directory.';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative or absolute directory path to list (default: "." for current workspace).',
        default: '.',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list recursively (default: false).',
        default: false,
      },
      max_entries: {
        type: 'integer',
        description: 'Maximum number of entries to return (default: 100).',
        default: 100,
      },
    },
    required: [],
  };

  public async execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const rawPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';
    const baseDir = context.worktreePath || context.workdir || process.cwd();

    // Clean quotes from path
    let cleaned = rawPath.replace(/^["']|["']$/g, '').trim();
    if (!cleaned) cleaned = '.';

    const targetPath = path.isAbsolute(cleaned)
      ? path.normalize(cleaned)
      : path.resolve(baseDir, cleaned);

    if (!fs.existsSync(targetPath)) {
      return {
        success: false,
        output: '',
        error: `Directory does not exist: ${targetPath}`,
      };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(targetPath);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: `Cannot stat path ${targetPath}: ${err.message}`,
      };
    }

    if (!stat.isDirectory()) {
      return {
        success: false,
        output: '',
        error: `Path is a file, not a directory: ${targetPath}. Use read_file to view file contents.`,
      };
    }

    const maxEntries = typeof args.max_entries === 'number' && args.max_entries > 0 ? args.max_entries : 100;
    const entries: DirectoryEntryItem[] = [];

    try {
      const dirEntries = fs.readdirSync(targetPath, { withFileTypes: true });

      // Sort: directories first, then alphabetical
      const sorted = [...dirEntries].sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      for (const item of sorted) {
        if (entries.length >= maxEntries) break;
        let type: DirectoryEntryItem['type'] = 'other';
        let sizeBytes: number | undefined;

        if (item.isDirectory()) {
          type = 'directory';
        } else if (item.isFile()) {
          type = 'file';
          try {
            const fileStat = fs.statSync(path.join(targetPath, item.name));
            sizeBytes = fileStat.size;
          } catch (_) {}
        } else if (item.isSymbolicLink()) {
          type = 'symlink';
        }

        entries.push({
          name: item.name,
          type,
          sizeBytes,
        });
      }

      // Format clean output
      const formatBytes = (bytes?: number) => {
        if (bytes === undefined) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      };

      const lines: string[] = [
        `Directory listing of ${targetPath} (${entries.length} items):`,
      ];

      for (const entry of entries) {
        if (entry.type === 'directory') {
          lines.push(`  [DIR]  ${entry.name}/`);
        } else if (entry.type === 'file') {
          const sz = entry.sizeBytes !== undefined ? ` (${formatBytes(entry.sizeBytes)})` : '';
          lines.push(`  [FILE] ${entry.name}${sz}`);
        } else {
          lines.push(`  [${entry.type.toUpperCase()}] ${entry.name}`);
        }
      }

      if (dirEntries.length > maxEntries) {
        lines.push(`  ... and ${dirEntries.length - maxEntries} more items (capped at ${maxEntries})`);
      }

      return {
        success: true,
        output: lines.join('\n'),
        data: {
          path: targetPath,
          totalCount: dirEntries.length,
          returnedCount: entries.length,
          entries,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: `Failed to list directory ${targetPath}: ${err.message}`,
      };
    }
  }
}
