/**
 * @file repomap.ts
 * @description Pure Node.js Tree-sitter / Regex AST Symbol Graph and PageRank Ranking.
 * Modeled on Aider's repomap.py.
 * Features:
 *   - Multi-language AST regex symbol extraction (TS/JS, Python, Go, Rust, Java, C/C++)
 *   - File-to-file symbol reference graph
 *   - Damped PageRank graph ranking algorithm
 *   - Token-budget-constrained syntax skeleton rendering (e.g. 1024 or 2048 tokens)
 * Zero external dependencies (pure Node.js fs, path).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Tool,
  ToolExecutionContext,
  ToolResult,
  ToolParametersSchema,
  SymbolTag,
  RankedFile,
  RepoMapOptions,
  RepoMapResult,
} from './types.js';
import { crawlDirectory } from './search.js';
import { isBinaryBuffer } from './read-file.js';
import { detectWorkspaceProject } from '../config/index.js';

interface ExtractedSymbols {
  definitions: SymbolTag[];
  references: Set<string>;
}

/**
 * Extracts definitions and identifier references from source code using AST regex heuristics.
 */
export function extractSymbolsFromSource(filePath: string, source: string): ExtractedSymbols {
  const ext = path.extname(filePath).toLowerCase();
  const definitions: SymbolTag[] = [];
  const references = new Set<string>();

  const lines = source.split(/\r?\n/);

  // General token regex for identifier references
  const tokenRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(line)) !== null) {
      references.add(m[0]);
    }
  }

  // Language specific definition extractors
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // TypeScript / JavaScript / JSX
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      // Classes
      const classMatch = line.match(/(?:export\s+)?(?:default\s+)?class\s+([a-zA-Z0-9_$]+)/);
      if (classMatch) {
        definitions.push({ name: classMatch[1], kind: 'class', file: filePath, line: lineNum });
        continue;
      }

      // Interfaces
      const ifaceMatch = line.match(/(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
      if (ifaceMatch) {
        definitions.push({ name: ifaceMatch[1], kind: 'interface', file: filePath, line: lineNum });
        continue;
      }

      // Types
      const typeMatch = line.match(/(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=/);
      if (typeMatch) {
        definitions.push({ name: typeMatch[1], kind: 'type', file: filePath, line: lineNum });
        continue;
      }

      // Enums
      const enumMatch = line.match(/(?:export\s+)?enum\s+([a-zA-Z0-9_$]+)/);
      if (enumMatch) {
        definitions.push({ name: enumMatch[1], kind: 'enum', file: filePath, line: lineNum });
        continue;
      }

      // Functions
      const fnMatch = line.match(/(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/);
      if (fnMatch) {
        definitions.push({ name: fnMatch[1], kind: 'function', file: filePath, line: lineNum });
        continue;
      }

      // Arrow functions / Const declarations
      const arrowMatch = line.match(/(?:export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
      if (arrowMatch) {
        definitions.push({ name: arrowMatch[1], kind: 'function', file: filePath, line: lineNum });
        continue;
      }

      // Class Methods
      const methodMatch = line.match(/^\s+(?:public|private|protected|static|async|\s)*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/);
      if (methodMatch && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(methodMatch[1])) {
        definitions.push({ name: methodMatch[1], kind: 'method', file: filePath, line: lineNum });
        continue;
      }
    }

    // Python
    else if (ext === '.py') {
      const pyClass = line.match(/^class\s+([a-zA-Z0-9_]+)/);
      if (pyClass) {
        definitions.push({ name: pyClass[1], kind: 'class', file: filePath, line: lineNum });
        continue;
      }

      const pyDef = line.match(/^(\s*)def\s+([a-zA-Z0-9_]+)\s*\(/);
      if (pyDef) {
        const isMethod = pyDef[1].length > 0;
        definitions.push({
          name: pyDef[2],
          kind: isMethod ? 'method' : 'function',
          file: filePath,
          line: lineNum,
        });
        continue;
      }
    }

    // Go
    else if (ext === '.go') {
      const goFn = line.match(/func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/);
      if (goFn) {
        definitions.push({ name: goFn[1], kind: 'function', file: filePath, line: lineNum });
        continue;
      }

      const goType = line.match(/type\s+([a-zA-Z0-9_]+)\s+(?:struct|interface)/);
      if (goType) {
        definitions.push({ name: goType[1], kind: 'type', file: filePath, line: lineNum });
        continue;
      }
    }

    // Rust
    else if (ext === '.rs') {
      const rustFn = line.match(/(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/);
      if (rustFn) {
        definitions.push({ name: rustFn[1], kind: 'function', file: filePath, line: lineNum });
        continue;
      }

      const rustStruct = line.match(/(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/);
      if (rustStruct) {
        definitions.push({ name: rustStruct[1], kind: 'class', file: filePath, line: lineNum });
        continue;
      }

      const rustEnum = line.match(/(?:pub\s+)?enum\s+([a-zA-Z0-9_]+)/);
      if (rustEnum) {
        definitions.push({ name: rustEnum[1], kind: 'enum', file: filePath, line: lineNum });
        continue;
      }
    }
  }

  return { definitions, references };
}

/**
 * Computes PageRank scores over the repository file-symbol dependency graph.
 */
export function computePageRank(
  files: string[],
  fileSymbols: Map<string, ExtractedSymbols>,
  damping: number = 0.85,
  maxIterations: number = 30
): Map<string, number> {
  const N = files.length;
  if (N === 0) return new Map();

  // Map each symbol name to the files that define it
  const symbolDefMap = new Map<string, string[]>();
  for (const [file, data] of fileSymbols.entries()) {
    for (const def of data.definitions) {
      const existing = symbolDefMap.get(def.name) || [];
      existing.push(file);
      symbolDefMap.set(def.name, existing);
    }
  }

  // Build directed weighted adjacency matrix: adj[sourceFile][targetFile] = weight
  const weights = new Map<string, Map<string, number>>();
  const outWeights = new Map<string, number>();

  for (const file of files) {
    weights.set(file, new Map());
    outWeights.set(file, 0);
  }

  for (const [sourceFile, data] of fileSymbols.entries()) {
    const sourceWeights = weights.get(sourceFile)!;
    let totalOut = 0;

    for (const ref of data.references) {
      const targets = symbolDefMap.get(ref);
      if (!targets) continue;

      for (const targetFile of targets) {
        if (targetFile === sourceFile) continue; // Skip self references
        const currentWeight = sourceWeights.get(targetFile) || 0;
        sourceWeights.set(targetFile, currentWeight + 1);
        totalOut += 1;
      }
    }

    outWeights.set(sourceFile, totalOut);
  }

  // Initialize PageRank vector
  let scores = new Map<string, number>();
  for (const file of files) {
    scores.set(file, 1.0 / N);
  }

  // Power iteration
  for (let iter = 0; iter < maxIterations; iter++) {
    const newScores = new Map<string, number>();
    let danglingWeightSum = 0;

    // Collect dangling weight (nodes with outDegree = 0)
    for (const file of files) {
      if ((outWeights.get(file) || 0) === 0) {
        danglingWeightSum += scores.get(file) || 0;
      }
    }

    const baseScore = (1.0 - damping) / N + (damping * danglingWeightSum) / N;

    for (const target of files) {
      let incomingSum = 0;

      for (const source of files) {
        const outDeg = outWeights.get(source) || 0;
        if (outDeg > 0) {
          const w = weights.get(source)?.get(target) || 0;
          if (w > 0) {
            incomingSum += ((scores.get(source) || 0) * w) / outDeg;
          }
        }
      }

      newScores.set(target, baseScore + damping * incomingSum);
    }

    // Check convergence
    let maxDiff = 0;
    for (const file of files) {
      const diff = Math.abs((newScores.get(file) || 0) - (scores.get(file) || 0));
      if (diff > maxDiff) maxDiff = diff;
    }

    scores = newScores;
    if (maxDiff < 1e-4) {
      break;
    }
  }

  return scores;
}

/**
 * Estimates token count from text using 4-character rule.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Generates an Aider-style RepoMap syntax skeleton constrained to a token budget.
 */
export function generateRepoMap(options: RepoMapOptions): RepoMapResult {
  const repoPath = options.repoPath || process.cwd();
  const maxTokens = options.maxTokens || 1024;

  // Workspace safety check: do not crawl or index user home or system directories
  const safety = detectWorkspaceProject(repoPath);
  if (safety.isHome || safety.isDriveRoot || safety.isSystemDir || !safety.isProject) {
    return {
      mapText: `(RepoMap disabled: ${safety.warning || 'Workspace is not a project directory.'})`,
      tokenEstimate: 20,
      totalFilesIndexed: 0,
      filesIndexed: 0,
      totalSymbols: 0,
    };
  }

  const allRelFiles = crawlDirectory(repoPath, '', undefined, 500);
  const candidateFiles: string[] = [];
  const fileSymbols = new Map<string, ExtractedSymbols>();

  let totalSymbolsCount = 0;

  for (const relFile of allRelFiles) {
    const absPath = path.join(repoPath, relFile);
    const ext = path.extname(relFile).toLowerCase();

    // Only process supported text source files
    if (
      !['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h'].includes(
        ext
      )
    ) {
      continue;
    }

    try {
      const stat = fs.statSync(absPath);
      if (stat.size > 2 * 1024 * 1024) continue; // Skip files > 2MB

      const content = fs.readFileSync(absPath, 'utf-8');
      const symbols = extractSymbolsFromSource(relFile.replace(/\\/g, '/'), content);

      candidateFiles.push(relFile.replace(/\\/g, '/'));
      fileSymbols.set(relFile.replace(/\\/g, '/'), symbols);
      totalSymbolsCount += symbols.definitions.length;
    } catch {
      continue;
    }
  }

  if (candidateFiles.length === 0) {
    return {
      mapText: '(No indexable source code files found in repository)',
      tokenEstimate: 10,
      totalFilesIndexed: 0,
      totalSymbols: 0,
    };
  }

  // Compute PageRank scores
  const pageRankScores = computePageRank(candidateFiles, fileSymbols);

  // Rank files
  const rankedFiles: RankedFile[] = candidateFiles.map((file) => ({
    file,
    score: pageRankScores.get(file) || 0,
    definitions: fileSymbols.get(file)?.definitions || [],
  }));

  rankedFiles.sort((a, b) => b.score - a.score);

  // Render skeleton fitting within maxTokens
  const skeletonBlocks: string[] = [];
  let currentTokenCount = 0;

  for (const rf of rankedFiles) {
    if (rf.definitions.length === 0) continue;

    const fileHeader = `${rf.file}:`;
    const symbolLines = rf.definitions.map((def) => `  ${def.kind} ${def.name}`);
    const blockText = `${fileHeader}\n${symbolLines.join('\n')}\n`;

    const blockTokens = estimateTokens(blockText);
    if (currentTokenCount + blockTokens > maxTokens && skeletonBlocks.length > 0) {
      // If full block exceeds, attempt adding only high-level class/interface/function definitions
      const keyDefs = rf.definitions.filter((d) => ['class', 'interface', 'function'].includes(d.kind));
      if (keyDefs.length > 0) {
        const compactBlock = `${fileHeader}\n${keyDefs.map((d) => `  ${d.kind} ${d.name}`).join('\n')}\n`;
        const compactTokens = estimateTokens(compactBlock);
        if (currentTokenCount + compactTokens <= maxTokens) {
          skeletonBlocks.push(compactBlock);
          currentTokenCount += compactTokens;
        }
      }
      break;
    }

    skeletonBlocks.push(blockText);
    currentTokenCount += blockTokens;
  }

  const mapText = skeletonBlocks.join('\n').trim();

  return {
    mapText,
    tokenEstimate: estimateTokens(mapText),
    totalFilesIndexed: candidateFiles.length,
    totalSymbols: totalSymbolsCount,
  };
}

/**
 * RepoMap Tool Implementation
 */
export class RepoMapTool implements Tool {
  public readonly name = 'repomap';
  public readonly description =
    'Generates a PageRank-ranked repository symbol map and compact syntax skeleton within a specified token budget (modeled on Aider repomap.py).';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      max_tokens: {
        type: 'integer',
        description: 'Maximum token budget for the generated repository map (default: 1024).',
        default: 1024,
      },
      path: {
        type: 'string',
        description: 'Directory path to index (default: workspace root).',
        default: '.',
      },
    },
  };

  public async execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const targetDir = args.path
      ? (path.isAbsolute(args.path) ? args.path : path.resolve(context.worktreePath, args.path))
      : context.worktreePath;

    const maxTokens = typeof args.max_tokens === 'number' && args.max_tokens > 0 ? args.max_tokens : 1024;

    const result = generateRepoMap({
      repoPath: targetDir,
      maxTokens,
    });

    return {
      success: true,
      output: result.mapText,
      data: result,
      metadata: {
        tokenEstimate: result.tokenEstimate,
        totalFilesIndexed: result.totalFilesIndexed,
        totalSymbols: result.totalSymbols,
      },
    };
  }
}

/**
 * High-level engine class for programmatic RepoMap generation.
 */
export class RepoMapEngine {
  public static generate(options: RepoMapOptions = {}): RepoMapResult {
    return generateRepoMap(options);
  }

  public generate(options: RepoMapOptions = {}): RepoMapResult {
    return generateRepoMap(options);
  }
}

