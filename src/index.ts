/**
 * Nomin Code: Universal AI Coding Harness & Multi-Agent Swarm Runtime
 * 
 * Re-exports the complete production-grade public API:
 * - Provider Layer (Unified Client, Rate Limiter, Capability Probe, JSON Repair)
 * - Tool Execution Engine (Fuzzy Search-Replace, Windowed Reader, Grep/Glob, Sandboxed Bash, Git Worktree Manager, PageRank RepoMap)
 * - Swarm Coordination (Central Blackboard, Reactive Mailbox, Grok-style Turn-End TodoGate & TodoNudge, Proactive 15% Compactor)
 * - Definition-of-Done Engine (Executable Criteria Verification, Adversarial AST Diff Integrity Inspector)
 * - Terminal UI (ANSI Styling, Live Dashboard, Streaming Diff Renderer)
 */

export * from './types.js';
export * from './config/index.js';

// Provider Layer
export { NominHttpClient, NominHttpError } from './provider/client.js';
export { NominRateLimitScheduler, TokenBucket, RequestPriority } from './provider/rate-limiter.js';
export { CapabilityProbe } from './provider/capability-probe.js';
export { JsonRepair } from './provider/json-repair.js';

// Tool Layer
export { ToolRegistry } from './tools/index.js';
export { EditFileTool } from './tools/edit-file.js';
export { ReadFileTool } from './tools/read-file.js';
export { SearchTool } from './tools/search.js';
export { BashTool } from './tools/bash.js';
export { WorktreeManager } from './tools/worktree.js';
export { RepoMapEngine } from './tools/repomap.js';

// Swarm Layer
export { SwarmCoordinator } from './swarm/coordinator.js';
export { Blackboard } from './swarm/blackboard.js';
export { SwarmMailbox } from './swarm/mailbox.js';
export { ReminderTracker } from './swarm/reminder-policy.js';
export { CompactionEngine } from './swarm/compaction.js';

// Verifier Layer
export { DefinitionOfDoneEngine } from './verifier/dod-engine.js';
export { AstIntegrityInspector } from './verifier/ast-integrity.js';

// Terminal UX Layer
export { ANSI, TerminalUI } from './cli/ui.js';
