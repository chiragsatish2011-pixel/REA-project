/**
 * @file index.ts
 * @description Central Tool Registry and Execution Engine for Nomin Code.
 * Registers tools, formats OpenAI / NVIDIA NIM tool schemas, and routes execution safely.
 * Zero external dependencies (pure Node.js).
 */

import type {
  Tool,
  ToolExecutionContext,
  ToolResult,
  OpenAIFunctionDefinition,
} from './types.js';

import { EditFileTool } from './edit-file.js';
import { ReadFileTool } from './read-file.js';
import { SearchGrepTool, SearchGlobTool } from './search.js';
import { BashTool } from './bash.js';
import { RepoMapTool } from './repomap.js';

export * from './types.js';
export * from './edit-file.js';
export * from './read-file.js';
export * from './search.js';
export * from './bash.js';
export * from './worktree.js';
export * from './repomap.js';

/**
 * Central Tool Registry managing tool registration, schema extraction, and execution routing.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  /**
   * Registers the 6 standard Nomin Code tools.
   */
  public registerDefaultTools(): void {
    this.registerTool(new EditFileTool());
    this.registerTool(new ReadFileTool());
    this.registerTool(new SearchGrepTool());
    this.registerTool(new SearchGlobTool());
    this.registerTool(new BashTool());
    this.registerTool(new RepoMapTool());
  }

  /**
   * Registers a new or custom tool.
   */
  public registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregisters a tool by name.
   */
  public unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Retrieves a tool by name (with alias support for bash -> execute_command).
   */
  public getTool(name: string): Tool | undefined {
    if (name === 'bash') {
      return this.tools.get('execute_command') || this.tools.get('bash');
    }
    return this.tools.get(name);
  }

  /**
   * Checks whether a tool exists in the registry (with alias support).
   */
  public hasTool(name: string): boolean {
    if (name === 'bash') {
      return this.tools.has('execute_command') || this.tools.has('bash');
    }
    return this.tools.has(name);
  }

  /**
   * Returns an array of all registered tools.
   */
  public getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns list of names of all registered tools.
   */
  public getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Returns array of tool definitions formatted for OpenAI / NVIDIA NIM function-calling.
   */
  public getSchemas(): OpenAIFunctionDefinition[] {
    return this.getAllTools().map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Validates arguments against required schema properties.
   */
  private validateArguments(tool: Tool, args: Record<string, any>): string | null {
    const required = tool.parameters.required || [];
    for (const key of required) {
      if (args[key] === undefined || args[key] === null || args[key] === '') {
        return `Missing required parameter '${key}' for tool '${tool.name}'`;
      }
    }
    return null;
  }

  /**
   * Dispatches and safely executes a tool with the provided context.
   */
  public async executeTool(
    name: string,
    args: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool '${name}' not found in registry. Available tools: ${this.getToolNames().join(', ')}`,
      };
    }

    // Argument validation
    const validationError = this.validateArguments(tool, args);
    if (validationError) {
      return {
        success: false,
        output: '',
        error: validationError,
      };
    }

    try {
      return await tool.execute(args, context);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: `Unhandled execution error in tool '${name}': ${err.message || String(err)}`,
        data: {
          stack: err.stack,
        },
      };
    }
  }
}

/**
 * Default global ToolRegistry singleton instance.
 */
export const defaultToolRegistry = new ToolRegistry();
