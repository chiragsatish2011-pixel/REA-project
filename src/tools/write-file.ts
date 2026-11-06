/**
 * @file write-file.ts
 * @description Direct file creation and full overwriting tool for Nomin Code.
 * Creates parent directories automatically.
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

export class WriteFileTool implements Tool {
  public readonly name = 'write_file';
  public readonly description =
    'Writes full content to a file, creating it and any required parent directories if they do not exist.';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative or absolute path of the file to write.',
      },
      content: {
        type: 'string',
        description: 'Full text content to write to the file.',
      },
    },
    required: ['path', 'content'],
  };

  public async execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const inputPath = args.path as string;
    const content = typeof args.content === 'string' ? args.content : String(args.content ?? '');

    if (!inputPath) {
      return { success: false, output: '', error: 'Missing required argument: path' };
    }

    const baseDir = context.worktreePath || context.workdir || process.cwd();
    let cleaned = inputPath.replace(/^["']|["']$/g, '').trim();

    const targetPath = path.isAbsolute(cleaned)
      ? path.normalize(cleaned)
      : path.resolve(baseDir, cleaned);

    try {
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(targetPath, content, 'utf-8');
      const lines = content.split(/\r?\n/).length;
      const bytes = Buffer.byteLength(content, 'utf-8');

      return {
        success: true,
        output: `File successfully written to ${cleaned} (${lines} lines, ${bytes} bytes).`,
        data: {
          path: targetPath,
          lines,
          bytes,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: `Failed to write file ${targetPath}: ${err.message}`,
      };
    }
  }
}
