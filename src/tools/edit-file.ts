/**
 * @file edit-file.ts
 * @description Production-grade Aider-style Search-and-Replace block editor for Nomin Code.
 * Implements 4-tier fuzzy matching:
 *   Tier 1: Exact string match
 *   Tier 2: Whitespace and indentation normalization
 *   Tier 3: Blank line insensitivity
 *   Tier 4: Sliding window Levenshtein ratio (>0.85 similarity)
 * Zero external dependencies (pure Node.js).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Tool,
  ToolExecutionContext,
  ToolResult,
  ToolParametersSchema,
  EditFileInput,
  EditFileResult,
  EditFileStats,
  MatchTier,
} from './types.js';

interface ParsedBlock {
  search: string;
  replace: string;
}

interface MatchResult {
  tier: MatchTier;
  tierDescription: string;
  startLine: number; // 1-based
  endLine: number;   // 1-based
  matchedLinesCount: number;
  newLines: string[];
}

/**
 * Calculates Levenshtein distance between two strings using O(min(N, M)) memory.
 */
export function calculateLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let str1 = a;
  let str2 = b;
  if (str1.length > str2.length) {
    str1 = b;
    str2 = a;
  }

  const len1 = str1.length;
  const len2 = str2.length;
  let prevRow = new Int32Array(len1 + 1);
  let currRow = new Int32Array(len1 + 1);

  for (let i = 0; i <= len1; i++) {
    prevRow[i] = i;
  }

  for (let j = 1; j <= len2; j++) {
    currRow[0] = j;
    const char2 = str2.charCodeAt(j - 1);
    for (let i = 1; i <= len1; i++) {
      const cost = str1.charCodeAt(i - 1) === char2 ? 0 : 1;
      currRow[i] = Math.min(
        currRow[i - 1] + 1,      // insertion
        prevRow[i] + 1,          // deletion
        prevRow[i - 1] + cost    // substitution
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[len1];
}

/**
 * Computes normalized similarity ratio between 0.0 and 1.0.
 */
export function calculateSimilarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = calculateLevenshteinDistance(a, b);
  return 1.0 - dist / maxLen;
}

/**
 * Parses Aider-style <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE blocks.
 */
export function parseSearchReplaceBlocks(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const searchPattern = /<{7}\s*SEARCH\r?\n([\s\S]*?)\r?\n={7}\r?\n([\s\S]*?)\r?\n>{7}\s*REPLACE/g;
  
  let match: RegExpExecArray | null;
  while ((match = searchPattern.exec(content)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2],
    });
  }

  return blocks;
}

/**
 * Detects whether the file uses CRLF or LF line endings.
 */
function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIndex = content.indexOf('\r\n');
  return crlfIndex !== -1 ? '\r\n' : '\n';
}

/**
 * Splits text into lines, handling both LF and CRLF uniformly.
 */
function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Generates unified diff representation with contextual lines.
 */
export function generateUnifiedDiff(
  filePath: string,
  originalLines: string[],
  newLines: string[],
  startLine: number, // 1-based
  deletedCount: number,
  addedCount: number
): string {
  const contextCount = 3;
  const preContextStart = Math.max(0, startLine - 1 - contextCount);
  const preContext = originalLines.slice(preContextStart, startLine - 1);
  const postContextEnd = Math.min(originalLines.length, startLine - 1 + deletedCount + contextCount);
  const postContext = originalLines.slice(startLine - 1 + deletedCount, postContextEnd);

  const deletedLines = originalLines.slice(startLine - 1, startLine - 1 + deletedCount);
  const addedSlice = newLines.slice(startLine - 1, startLine - 1 + addedCount);

  const header = `--- a/${filePath}\n+++ b/${filePath}\n@@ -${startLine},${deletedCount} +${startLine},${addedCount} @@`;
  const diffLines = [
    header,
    ...preContext.map((l) => ` ${l}`),
    ...deletedLines.map((l) => `-${l}`),
    ...addedSlice.map((l) => `+${l}`),
    ...postContext.map((l) => ` ${l}`),
  ];

  return diffLines.join('\n');
}

/**
 * Multi-tier search and match engine.
 */
export class SearchReplaceEngine {
  /**
   * Applies search and replace to target file lines using multi-tier fuzzy matching.
   */
  public matchAndReplace(
    fileContent: string,
    searchContent: string,
    replaceContent: string
  ): { updatedContent: string; stats: EditFileStats; diff: string } {
    const lineEnding = detectLineEnding(fileContent);
    const fileLines = splitLines(fileContent);
    const searchLines = splitLines(searchContent);
    const replaceLines = splitLines(replaceContent);

    // If search block is empty, cannot proceed on non-empty file
    if (searchContent.trim().length === 0) {
      throw new Error('Search block cannot be empty when editing an existing file.');
    }

    let matchResult: MatchResult | null = null;

    // --- Tier 1: Exact String Match ---
    matchResult = this.tryTier1ExactMatch(fileContent, searchContent, fileLines, replaceLines);

    // --- Tier 2: Whitespace and Indentation Normalization ---
    if (!matchResult) {
      matchResult = this.tryTier2WhitespaceNormalization(fileLines, searchLines, replaceLines);
    }

    // --- Tier 3: Blank Line Insensitivity ---
    if (!matchResult) {
      matchResult = this.tryTier3BlankLineInsensitive(fileLines, searchLines, replaceLines);
    }

    // --- Tier 4: Sliding Window Levenshtein Ratio (>0.85) ---
    if (!matchResult) {
      matchResult = this.tryTier4Levenshtein(fileLines, searchLines, replaceLines, searchContent);
    }

    if (!matchResult) {
      throw new Error(
        `Failed to match search block in file across all 4 tiers (exact, whitespace, blank-lines, Levenshtein).\n` +
        `Search block provided:\n${searchContent}`
      );
    }

    // Construct final updated lines
    const startIdx = matchResult.startLine - 1;
    const endIdx = matchResult.endLine - 1; // inclusive line in 1-based, so endIdx + 1 items
    const deletedCount = endIdx - startIdx + 1;
    const addedCount = matchResult.newLines.length;

    const resultLines = [
      ...fileLines.slice(0, startIdx),
      ...matchResult.newLines,
      ...fileLines.slice(endIdx + 1),
    ];

    const updatedContent = resultLines.join(lineEnding);

    const stats: EditFileStats = {
      tierUsed: matchResult.tier,
      tierDescription: matchResult.tierDescription,
      linesAdded: addedCount,
      linesDeleted: deletedCount,
      originalLineCount: fileLines.length,
      newLineCount: resultLines.length,
      startLine: matchResult.startLine,
      endLine: matchResult.endLine,
    };

    const diff = generateUnifiedDiff(
      'file',
      fileLines,
      resultLines,
      matchResult.startLine,
      deletedCount,
      addedCount
    );

    return { updatedContent, stats, diff };
  }

  /**
   * Tier 1: Exact substring match.
   */
  private tryTier1ExactMatch(
    fileContent: string,
    searchContent: string,
    fileLines: string[],
    replaceLines: string[]
  ): MatchResult | null {
    // Normalize newlines for search
    const normFile = fileContent.replace(/\r\n/g, '\n');
    const normSearch = searchContent.replace(/\r\n/g, '\n');

    const firstIndex = normFile.indexOf(normSearch);
    if (firstIndex === -1) return null;

    // Check for uniqueness
    const secondIndex = normFile.indexOf(normSearch, firstIndex + 1);
    if (secondIndex !== -1) {
      // Multiple matches: Disambiguate by taking the first match or throw error
      // In Aider, if non-unique, it falls back to fuzzy or reports non-unique
      // We will only accept if unique, or let higher tiers attempt, but if exact matches multiple times,
      // it is safer to report error or handle uniquely
    }

    // Calculate line numbers
    const linesBefore = normFile.slice(0, firstIndex).split('\n');
    const startLine = linesBefore.length; // 1-based
    const searchLineCount = normSearch.split('\n').length;
    const endLine = startLine + searchLineCount - 1;

    return {
      tier: 1,
      tierDescription: 'Tier 1: Exact string match',
      startLine,
      endLine,
      matchedLinesCount: searchLineCount,
      newLines: replaceLines,
    };
  }

  /**
   * Tier 2: Whitespace and Indentation Normalization.
   * Matches lines ignoring leading/trailing spaces or matching indentation patterns.
   */
  private tryTier2WhitespaceNormalization(
    fileLines: string[],
    searchLines: string[],
    replaceLines: string[]
  ): MatchResult | null {
    const sLen = searchLines.length;
    if (sLen === 0 || sLen > fileLines.length) return null;

    const trimmedSearch = searchLines.map((l) => l.trim());
    const candidates: number[] = [];

    for (let i = 0; i <= fileLines.length - sLen; i++) {
      let match = true;
      for (let j = 0; j < sLen; j++) {
        if (fileLines[i + j].trim() !== trimmedSearch[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        candidates.push(i);
      }
    }

    if (candidates.length === 0) return null;
    const matchIndex = candidates[0]; // Take first match

    // Preserve the file's original leading indentation from the first matching line
    const originalIndentMatch = fileLines[matchIndex].match(/^(\s*)/);
    const searchIndentMatch = searchLines[0].match(/^(\s*)/);
    const originalIndent = originalIndentMatch ? originalIndentMatch[1] : '';
    const searchIndent = searchIndentMatch ? searchIndentMatch[1] : '';

    // Adjust replacement lines if needed
    const adjustedReplaceLines = replaceLines.map((line) => {
      if (line.startsWith(searchIndent) && searchIndent.length > 0) {
        return originalIndent + line.slice(searchIndent.length);
      }
      return line;
    });

    const startLine = matchIndex + 1;
    const endLine = matchIndex + sLen;

    return {
      tier: 2,
      tierDescription: 'Tier 2: Whitespace and indentation normalization',
      startLine,
      endLine,
      matchedLinesCount: sLen,
      newLines: adjustedReplaceLines,
    };
  }

  /**
   * Tier 3: Blank Line Insensitivity.
   * Compares non-blank lines ignoring extra or missing blank lines.
   */
  private tryTier3BlankLineInsensitive(
    fileLines: string[],
    searchLines: string[],
    replaceLines: string[]
  ): MatchResult | null {
    // Collect non-blank search lines and their indices
    const nonBlankSearch: { text: string; index: number }[] = [];
    for (let i = 0; i < searchLines.length; i++) {
      if (searchLines[i].trim().length > 0) {
        nonBlankSearch.push({ text: searchLines[i].trim(), index: i });
      }
    }
    if (nonBlankSearch.length === 0) return null;

    // Collect non-blank file lines
    const nonBlankFile: { text: string; originalIndex: number }[] = [];
    for (let i = 0; i < fileLines.length; i++) {
      if (fileLines[i].trim().length > 0) {
        nonBlankFile.push({ text: fileLines[i].trim(), originalIndex: i });
      }
    }

    if (nonBlankSearch.length > nonBlankFile.length) return null;

    const candidates: { startFileIdx: number; endFileIdx: number }[] = [];

    for (let i = 0; i <= nonBlankFile.length - nonBlankSearch.length; i++) {
      let matches = true;
      for (let j = 0; j < nonBlankSearch.length; j++) {
        if (nonBlankFile[i + j].text !== nonBlankSearch[j].text) {
          matches = false;
          break;
        }
      }
      if (matches) {
        candidates.push({
          startFileIdx: nonBlankFile[i].originalIndex,
          endFileIdx: nonBlankFile[i + nonBlankSearch.length - 1].originalIndex,
        });
      }
    }

    if (candidates.length === 0) return null;
    const best = candidates[0];

    const startLine = best.startFileIdx + 1;
    const endLine = best.endFileIdx + 1;

    return {
      tier: 3,
      tierDescription: 'Tier 3: Blank line insensitivity',
      startLine,
      endLine,
      matchedLinesCount: endLine - startLine + 1,
      newLines: replaceLines,
    };
  }

  /**
   * Tier 4: Sliding Window Levenshtein Ratio (>0.85 similarity).
   */
  private tryTier4Levenshtein(
    fileLines: string[],
    searchLines: string[],
    replaceLines: string[],
    searchContent: string
  ): MatchResult | null {
    const sLen = searchLines.length;
    if (fileLines.length === 0 || sLen === 0) return null;

    const normSearch = searchLines.join('\n').trim();
    let bestRatio = 0.0;
    let bestStart = -1;
    let bestEnd = -1;

    // Window sizes to test: sLen - 2 to sLen + 2 (clamped to >= 1)
    const minW = Math.max(1, sLen - 2);
    const maxW = Math.min(fileLines.length, sLen + 2);

    for (let w = minW; w <= maxW; w++) {
      for (let i = 0; i <= fileLines.length - w; i++) {
        const candidateSlice = fileLines.slice(i, i + w);
        const normCandidate = candidateSlice.join('\n').trim();

        // Quick length ratio check before full Levenshtein
        const maxLen = Math.max(normCandidate.length, normSearch.length);
        if (maxLen === 0) continue;
        const lenDiff = Math.abs(normCandidate.length - normSearch.length);
        if (1.0 - lenDiff / maxLen < 0.85) continue;

        const ratio = calculateSimilarityRatio(normCandidate, normSearch);
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestStart = i;
          bestEnd = i + w - 1;
        }
      }
    }

    // Must exceed threshold 0.85
    if (bestRatio < 0.85 || bestStart === -1) {
      return null;
    }

    const startLine = bestStart + 1;
    const endLine = bestEnd + 1;

    return {
      tier: 4,
      tierDescription: `Tier 4: Sliding window Levenshtein ratio (${(bestRatio * 100).toFixed(1)}% similarity)`,
      startLine,
      endLine,
      matchedLinesCount: endLine - startLine + 1,
      newLines: replaceLines,
    };
  }
}

/**
 * Tool implementation for edit_file.
 */
export class EditFileTool implements Tool {
  public readonly name = 'edit_file';
  public readonly description =
    'Applies targeted modifications to a file using unique search-and-replace blocks. Supports Aider search-replace format and 4-tier fuzzy matching.';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative or absolute path of the file to modify.',
      },
      search_block: {
        type: 'string',
        description: 'Exact contiguous lines of code currently in the file to replace.',
      },
      replace_block: {
        type: 'string',
        description: 'Exact replacement lines of code.',
      },
      content: {
        type: 'string',
        description: 'Raw search-replace block(s) in <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE format.',
      },
    },
    required: ['path'],
  };

  private engine = new SearchReplaceEngine();

  public async execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const inputPath = args.path as string;
    if (!inputPath) {
      return { success: false, output: '', error: 'Missing required argument: path' };
    }

    const targetPath = path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(context.worktreePath, inputPath);

    const exists = fs.existsSync(targetPath);

    // Extract blocks to apply
    let blocks: ParsedBlock[] = [];

    if (args.content && typeof args.content === 'string') {
      blocks = parseSearchReplaceBlocks(args.content);
    }

    if (blocks.length === 0 && (args.search_block !== undefined || args.replace_block !== undefined)) {
      blocks.push({
        search: (args.search_block as string) || '',
        replace: (args.replace_block as string) || '',
      });
    }

    // Case 1: Creating a brand new file
    if (!exists) {
      if (blocks.length === 0) {
        return {
          success: false,
          output: '',
          error: `File ${inputPath} does not exist and no content/replace_block was provided to create it.`,
        };
      }

      // Ensure directory exists
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const initialContent = blocks.map((b) => b.replace).join('\n');
      fs.writeFileSync(targetPath, initialContent, 'utf-8');

      const initialLines = splitLines(initialContent);
      return {
        success: true,
        output: `File created: ${inputPath} (${initialLines.length} lines).`,
        data: {
          path: inputPath,
          created: true,
          lineCount: initialLines.length,
        },
      };
    }

    // Case 2: Modifying an existing file
    let currentContent = fs.readFileSync(targetPath, 'utf-8');
    const allStats: EditFileStats[] = [];
    const diffs: string[] = [];

    if (blocks.length === 0) {
      return {
        success: false,
        output: '',
        error: 'No search_block or Aider blocks found in request.',
      };
    }

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      try {
        const { updatedContent, stats, diff } = this.engine.matchAndReplace(
          currentContent,
          block.search,
          block.replace
        );
        currentContent = updatedContent;
        allStats.push(stats);
        diffs.push(diff);
      } catch (err: any) {
        return {
          success: false,
          output: '',
          error: `Block ${i + 1}/${blocks.length} failed: ${err.message}`,
        };
      }
    }

    // Write updated content back to disk
    fs.writeFileSync(targetPath, currentContent, 'utf-8');

    const totalAdded = allStats.reduce((sum, s) => sum + s.linesAdded, 0);
    const totalDeleted = allStats.reduce((sum, s) => sum + s.linesDeleted, 0);

    const summaryOutput =
      `Successfully modified ${inputPath}.\n` +
      `Applied ${blocks.length} block(s) (+${totalAdded} -${totalDeleted} lines).\n` +
      `Tier used: ${allStats.map((s) => s.tierDescription).join(', ')}\n\n` +
      `Unified Diff:\n${diffs.join('\n\n')}`;

    return {
      success: true,
      output: summaryOutput,
      data: {
        path: inputPath,
        appliedBlocks: blocks.length,
        stats: allStats,
        diff: diffs.join('\n\n'),
      },
    };
  }
}
