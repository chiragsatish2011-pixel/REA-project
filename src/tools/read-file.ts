/**
 * @file read-file.ts
 * @description Windowed file reader for Nomin Code.
 * Supports line range windowing (start_line, end_line), line numbering,
 * and safety guards against binary files and files > 10MB.
 * Zero external dependencies (pure Node.js).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Tool,
  ToolExecutionContext,
  ToolResult,
  ToolParametersSchema,
  ReadFileResult,
} from './types.js';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const BINARY_CHECK_BUFFER_SIZE = 4096;
const DEFAULT_MAX_WINDOW_LINES = 500;

/**
 * Checks whether a file buffer represents binary content.
 * Inspects the presence of null bytes (0x00) or high ratio of non-printable control characters.
 */
export function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  let nonPrintableCount = 0;
  const sampleSize = Math.min(buffer.length, BINARY_CHECK_BUFFER_SIZE);

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    // Immediate null byte check
    if (byte === 0) {
      return true;
    }
    // Check non-printable control characters (excluding TAB=9, LF=10, CR=13)
    if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 27) {
      nonPrintableCount++;
    }
  }

  // If more than 30% are non-printable control characters, treat as binary
  return nonPrintableCount / sampleSize > 0.3;
}

export class ReadFileTool implements Tool {
  public readonly name = 'read_file';
  public readonly description =
    'Reads lines from a file with line numbering and range windowing (start_line, end_line). Guarded against binary files and files > 10MB.';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative or absolute path of the file to read.',
      },
      start_line: {
        type: 'integer',
        description: '1-based starting line number (default: 1).',
        default: 1,
      },
      end_line: {
        type: 'integer',
        description: '1-based ending line number (default: start_line + 500 or end of file).',
      },
      include_line_numbers: {
        type: 'boolean',
        description: 'Whether to prepend line numbers to each line (default: true).',
        default: true,
      },
    },
    required: ['path'],
  };

  public async execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const inputPath = args.path as string;
    if (!inputPath) {
      return { success: false, output: '', error: 'Missing required argument: path' };
    }

    const resolvedPath = path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(context.worktreePath, inputPath);

    if (!fs.existsSync(resolvedPath)) {
      return {
        success: false,
        output: '',
        error: `File does not exist: ${inputPath}`,
      };
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return {
        success: false,
        output: '',
        error: `Path is a directory, not a file: ${inputPath}. Use search_glob or list tools instead.`,
      };
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      return {
        success: false,
        output: '',
        error: `File size (${(stat.size / (1024 * 1024)).toFixed(2)} MB) exceeds 10MB safety limit: ${inputPath}`,
      };
    }

    // Binary check
    const fd = fs.openSync(resolvedPath, 'r');
    const checkBuf = Buffer.alloc(BINARY_CHECK_BUFFER_SIZE);
    const bytesRead = fs.readSync(fd, checkBuf, 0, BINARY_CHECK_BUFFER_SIZE, 0);
    fs.closeSync(fd);

    if (isBinaryBuffer(checkBuf.subarray(0, bytesRead))) {
      return {
        success: false,
        output: '',
        error: `Cannot read binary file: ${inputPath}`,
      };
    }

    // Read file text
    const rawContent = fs.readFileSync(resolvedPath, 'utf-8');
    const allLines = rawContent.split(/\r?\n/);
    const totalLines = allLines.length;

    let startLine = typeof args.start_line === 'number' && args.start_line > 0 ? Math.floor(args.start_line) : 1;
    let endLine = typeof args.end_line === 'number' && args.end_line > 0 ? Math.floor(args.end_line) : undefined;
    const includeNumbers = args.include_line_numbers !== false;

    if (startLine > totalLines && totalLines > 0) {
      return {
        success: false,
        output: '',
        error: `Requested start_line ${startLine} is beyond the total lines in file (${totalLines}): ${inputPath}`,
      };
    }

    if (endLine === undefined) {
      endLine = Math.min(totalLines, startLine + DEFAULT_MAX_WINDOW_LINES - 1);
    } else {
      endLine = Math.min(totalLines, endLine);
    }

    if (endLine < startLine) {
      return {
        success: false,
        output: '',
        error: `end_line (${endLine}) cannot be smaller than start_line (${startLine}).`,
      };
    }

    const selectedLines = allLines.slice(startLine - 1, endLine);
    const isTruncated = endLine < totalLines;

    let formattedOutput = '';
    if (includeNumbers) {
      const padding = String(endLine).length;
      formattedOutput = selectedLines
        .map((line, idx) => {
          const lineNum = String(startLine + idx).padStart(padding, ' ');
          return `${lineNum}: ${line}`;
        })
        .join('\n');
    } else {
      formattedOutput = selectedLines.join('\n');
    }

    if (isTruncated) {
      formattedOutput += `\n\n[... File truncated at line ${endLine} of ${totalLines}. Use start_line=${endLine + 1} to read more ...]`;
    }

    const resultData: ReadFileResult = {
      path: inputPath,
      totalLines,
      startLine,
      endLine,
      linesRead: selectedLines.length,
      truncated: isTruncated,
      content: formattedOutput,
    };

    return {
      success: true,
      output: formattedOutput,
      data: resultData,
      metadata: {
        totalLines,
        startLine,
        endLine,
        linesRead: selectedLines.length,
        truncated: isTruncated,
      },
    };
  }
}
