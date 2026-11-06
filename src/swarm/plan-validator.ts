/**
 * @file plan-validator.ts
 * @description Strict JSON schema validator and self-healing auto-repair engine for Architect plans.
 * Guarantees that no planning error or cyclic dependency ever crashes the runtime.
 * Implements:
 *   1. Deterministic repair: Prunes self-dependencies, removes unknown dependency IDs, breaks cyclic back-edges.
 *   2. Linear Fallback: If cycles cannot be cleanly broken, converts to linear dependency chain.
 *   3. Empty plan synthesis: Generates default atomic implementation task for actionable goals.
 *   4. Size & Depth Capping: Caps plan to max 8 verifiable tasks.
 */

import { JsonRepair } from '../provider/json-repair.js';
import type { SwarmTask } from './types.js';

export interface PlanRepairReport {
  valid: boolean;
  repaired: boolean;
  tasks: Array<Omit<SwarmTask, 'createdAt' | 'updatedAt'>>;
  warnings: string[];
}

export type DecomposedPlan = PlanRepairReport;
export type RawPlanTask = any;

export class PlanValidator {
  public static readonly MAX_TASKS = 8;

  /**
   * Parses raw model text into structured task array, handling markdown codeblocks and malformed JSON.
   */
  public static parseRawModelPlan(rawText: string): any[] {
    if (!rawText || typeof rawText !== 'string') return [];

    let jsonStr = rawText.trim();

    // Extract json code block if wrapped in markdown
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // Find outermost array or object
      const startArr = jsonStr.indexOf('[');
      const endArr = jsonStr.lastIndexOf(']');
      if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
        jsonStr = jsonStr.slice(startArr, endArr + 1);
      }
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks;
      if (parsed && typeof parsed === 'object') return [parsed];
      return [];
    } catch {
      // Auto-repair malformed JSON using JsonRepair
      try {
        const repaired = JsonRepair.repair(jsonStr);
        const parsed = JSON.parse(repaired);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks;
        return [];
      } catch {
        return [];
      }
    }
  }

  /**
   * Validates and repairs task list according to strict invariants.
   */
  public static validateAndRepair(
    rawInput: any,
    userGoal: string,
    defaultCommands?: { buildCommand: string; testCommand: string }
  ): PlanRepairReport {
    const warnings: string[] = [];
    let repaired = false;

    const buildCmd = defaultCommands?.buildCommand || 'npm run build';
    const testCmd = defaultCommands?.testCommand || 'npm test';

    let rawTasks: any[] = [];
    if (Array.isArray(rawInput)) {
      rawTasks = rawInput;
    } else if (rawInput && typeof rawInput === 'object' && Array.isArray((rawInput as any).tasks)) {
      rawTasks = (rawInput as any).tasks;
    }

    // 1. Empty Plan Fallback
    if (rawTasks.length === 0) {
      warnings.push('Plan was empty. Synthesizing default 2-task execution plan.');
      return {
        valid: false,
        repaired: true,
        warnings,
        tasks: [
          {
            id: 'T-101',
            title: 'Core Implementation',
            description: `Implement required feature logic for: ${userGoal}`,
            assignedRole: 'Coder',
            dependencies: [],
            status: 'PENDING',
            acceptanceCriteria: [
              {
                id: 'AC-101-1',
                name: 'Syntactic Validation & Build',
                command: buildCmd,
                timeoutSeconds: 30,
                expectedExitCode: 0,
                description: 'Ensure code compiles without type or syntax errors.',
              },
            ],
          },
          {
            id: 'T-102',
            title: 'Adversarial Test & Verification',
            description: `Validate criteria and test edge cases for: ${userGoal}`,
            assignedRole: 'Tester',
            dependencies: ['T-101'],
            status: 'PENDING',
            acceptanceCriteria: [
              {
                id: 'AC-102-1',
                name: 'Unit & Regression Test Execution',
                command: testCmd,
                timeoutSeconds: 60,
                expectedExitCode: 0,
                description: 'Execute automated test suite to ensure all assertions pass.',
              },
            ],
          },
        ],
      };
    }

    // 2. Cap Oversized Plans
    let workingTasks = [...rawTasks];
    if (workingTasks.length > PlanValidator.MAX_TASKS) {
      warnings.push(`Plan had ${workingTasks.length} tasks (max ${PlanValidator.MAX_TASKS}). Truncated to ${PlanValidator.MAX_TASKS} tasks.`);
      workingTasks = workingTasks.slice(0, PlanValidator.MAX_TASKS);
      repaired = true;
    }

    // 3. Deduplicate and normalize Task IDs
    const seenIds = new Set<string>();
    const normalizedTasks: Array<Omit<SwarmTask, 'createdAt' | 'updatedAt'>> = [];

    for (let i = 0; i < workingTasks.length; i++) {
      const item = workingTasks[i] || {};
      let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `T-${101 + i}`;

      if (seenIds.has(id)) {
        const newId = `${id}_${i + 1}`;
        warnings.push(`Duplicate task ID '${id}' renamed to '${newId}'.`);
        id = newId;
        repaired = true;
      }
      seenIds.add(id);

      const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Task ${i + 1}`;
      const description = typeof item.description === 'string' ? item.description.trim() : title;
      const role = ['Coder', 'Tester', 'Verifier', 'Architect'].includes(item.assignedRole)
        ? item.assignedRole
        : (i % 2 === 0 ? 'Coder' : 'Tester');

      const rawDeps: string[] = Array.isArray(item.dependencies) ? item.dependencies : [];
      const criteria = Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria.length > 0
        ? item.acceptanceCriteria.map((c: any, cIdx: number) => ({
            id: c.id || `AC-${id}-${cIdx + 1}`,
            name: c.name || `Criterion ${cIdx + 1}`,
            command: c.command || testCmd,
            timeoutSeconds: Number(c.timeoutSeconds) || 60,
            expectedExitCode: c.expectedExitCode !== undefined ? Number(c.expectedExitCode) : 0,
            description: c.description || c.name || '',
          }))
        : [
            {
              id: `AC-${id}-1`,
              name: 'Automated Test Verification',
              command: testCmd,
              timeoutSeconds: 60,
              expectedExitCode: 0,
              description: 'Verification step',
            },
          ];

      normalizedTasks.push({
        id,
        title,
        description,
        assignedRole: role,
        dependencies: rawDeps,
        status: 'PENDING',
        acceptanceCriteria: criteria,
      });
    }

    // 4. Prune self-dependencies & unknown dependency IDs
    const allTaskIds = new Set(normalizedTasks.map(t => t.id));
    for (const t of normalizedTasks) {
      const origDeps = [...t.dependencies];
      t.dependencies = origDeps.filter(depId => {
        if (depId === t.id) {
          warnings.push(`Task '${t.id}' had self-dependency. Pruned.`);
          repaired = true;
          return false;
        }
        if (!allTaskIds.has(depId)) {
          warnings.push(`Task '${t.id}' referenced non-existent dependency '${depId}'. Pruned.`);
          repaired = true;
          return false;
        }
        return true;
      });
    }

    // 5. Detect and eliminate cycles via DFS back-edge removal
    const cycleEliminated = PlanValidator.eliminateCycles(normalizedTasks);
    if (cycleEliminated.prunedCount > 0) {
      warnings.push(`Eliminated ${cycleEliminated.prunedCount} cyclic dependency back-edges automatically.`);
      repaired = true;
    }

    // 6. Verify Kahn sort succeeds; if not, apply Linear Chain Fallback
    const kahnSorted = PlanValidator.testKahnSort(normalizedTasks);
    if (!kahnSorted.success) {
      warnings.push('Unresolvable cycle structure remaining. Applied linear sequence fallback.');
      repaired = true;
      for (let i = 0; i < normalizedTasks.length; i++) {
        normalizedTasks[i].dependencies = i === 0 ? [] : [normalizedTasks[i - 1].id];
      }
    }

    return {
      valid: !repaired && warnings.length === 0,
      repaired,
      tasks: normalizedTasks,
      warnings,
    };
  }

  /**
   * Eliminates cycles by detecting back-edges using 3-color DFS (0=WHITE, 1=GRAY, 2=BLACK).
   */
  private static eliminateCycles(tasks: Array<{ id: string; dependencies: string[] }>): { prunedCount: number } {
    let prunedCount = 0;
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const color = new Map<string, number>(); // 0: unvisited, 1: visiting (in stack), 2: finished

    for (const t of tasks) {
      color.set(t.id, 0);
    }

    const dfs = (nodeId: string, pathStack: string[]) => {
      color.set(nodeId, 1);
      const node = taskMap.get(nodeId);
      if (!node) return;

      const validDeps: string[] = [];
      for (const depId of node.dependencies) {
        const depColor = color.get(depId) ?? 0;
        if (depColor === 1) {
          // Back-edge detected! (nodeId depends on ancestor depId which is currently in stack)
          prunedCount++;
          // Skip adding this depId to break the cycle
          continue;
        }

        if (depColor === 0) {
          dfs(depId, [...pathStack, depId]);
        }
        validDeps.push(depId);
      }

      node.dependencies = validDeps;
      color.set(nodeId, 2);
    };

    for (const t of tasks) {
      if (color.get(t.id) === 0) {
        dfs(t.id, [t.id]);
      }
    }

    return { prunedCount };
  }

  /**
   * Tests if the graph admits a topological sort via Kahn's algorithm.
   */
  public static testKahnSort(tasks: Array<{ id: string; dependencies: string[] }>): { success: boolean; order: string[] } {
    const taskIds = tasks.map(t => t.id);
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};

    for (const id of taskIds) {
      inDegree[id] = 0;
      adj[id] = [];
    }

    for (const t of tasks) {
      for (const depId of t.dependencies) {
        if (adj[depId]) {
          adj[depId].push(t.id);
          inDegree[t.id] = (inDegree[t.id] || 0) + 1;
        }
      }
    }

    const queue: string[] = [];
    for (const id of taskIds) {
      if (inDegree[id] === 0) {
        queue.push(id);
      }
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      sorted.push(curr);

      for (const child of adj[curr] || []) {
        inDegree[child]--;
        if (inDegree[child] === 0) {
          queue.push(child);
        }
      }
    }

    return {
      success: sorted.length === taskIds.length,
      order: sorted,
    };
  }
}
