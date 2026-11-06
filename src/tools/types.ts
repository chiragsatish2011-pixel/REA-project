/**
 * @file types.ts
 * @description Core tool definitions, execution contexts, and schema types for Nomin Code.
 * Production-ready, zero external dependencies.
 */

/**
 * Context passed into every tool execution.
 * Contains session, agent, workspace, and tracing identifiers.
 */
export interface ToolExecutionContext {
  sessionID?: string;
  agentID?: string;
  worktreePath: string;
  workdir?: string;
  callID?: string;
  abortSignal?: AbortSignal;
  role?: string;
  taskId?: string;
}

/**
 * Standardized result returned by any tool execution.
 */
export interface ToolResult {
  success: boolean;
  output: string;
  data?: any;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * JSON Schema property definition matching OpenAI / NVIDIA NIM function parameters.
 */
export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: Record<string, unknown>;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
}

/**
 * JSON Schema for tool parameters object.
 */
export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * OpenAI / NVIDIA NIM function definition format.
 */
export interface OpenAIFunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParametersSchema;
  };
}

/**
 * Abstract Tool interface implemented by all Nomin Code tools.
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParametersSchema;
  execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Tool-Specific Input & Output Types
// ---------------------------------------------------------------------------

/**
 * Edit File Tool Input
 */
export interface EditFileInput {
  path: string;
  search_block?: string;
  replace_block?: string;
  content?: string; // If raw Aider block <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE is supplied
}

/**
 * Edit File Match Tier
 */
export type MatchTier = 1 | 2 | 3 | 4;

export interface EditFileStats {
  tierUsed: MatchTier;
  tierDescription: string;
  linesAdded: number;
  linesDeleted: number;
  originalLineCount: number;
  newLineCount: number;
  startLine: number;
  endLine: number;
}

export interface EditFileResult {
  path: string;
  stats: EditFileStats;
  diff: string;
  appliedCount: number;
}

/**
 * Read File Tool Input
 */
export interface ReadFileInput {
  path: string;
  start_line?: number;
  end_line?: number;
  include_line_numbers?: boolean;
}

export interface ReadFileResult {
  path: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  linesRead: number;
  truncated: boolean;
  content: string;
}

/**
 * Search Tools Input
 */
export interface SearchGrepInput {
  query: string;
  path?: string;
  case_sensitive?: boolean;
  is_regex?: boolean;
  max_results?: number;
  include_pattern?: string;
  exclude_pattern?: string;
}

export interface GrepMatch {
  file: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchGrepResult {
  matches: GrepMatch[];
  totalMatches: number;
  filesSearched: number;
  truncated: boolean;
}

export interface SearchGlobInput {
  pattern: string;
  path?: string;
  max_results?: number;
}

export interface SearchGlobResult {
  files: string[];
  totalFiles: number;
  truncated: boolean;
}

/**
 * Sandboxed Bash / Command Execution Input
 */
export interface BashInput {
  command: string;
  timeout_seconds?: number;
  cwd?: string;
  env?: Record<string, string>;
  max_output_length?: number;
}

export interface BashResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
  truncated: boolean;
  timedOut: boolean;
}

/**
 * Git Worktree Management Types
 */
export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
  commitHash: string;
  isBare: boolean;
  isLocked: boolean;
}

export interface MicroCommitResult {
  success: boolean;
  commitHash?: string;
  message: string;
  changedFiles: string[];
}

export interface WorktreeMergeResult {
  success: boolean;
  targetBranch: string;
  sourceBranch: string;
  mergeCommitHash?: string;
  conflictFiles?: string[];
  error?: string;
}

/**
 * RepoMap Symbol & Ranking Types
 */
export interface SymbolTag {
  name: string;
  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable' | 'enum';
  file: string;
  line: number;
}

export interface SymbolReference {
  name: string;
  file: string;
  line: number;
}

export interface RankedFile {
  file: string;
  score: number;
  definitions: SymbolTag[];
}

export interface RepoMapOptions {
  repoPath?: string;
  maxTokens?: number;
  filterFiles?: string[];
  excludePatterns?: string[];
}

export interface RepoMapResult {
  mapText: string;
  tokenEstimate: number;
  totalFilesIndexed: number;
  filesIndexed?: number;
  totalSymbols: number;
}
