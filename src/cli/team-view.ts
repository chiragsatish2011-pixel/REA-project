/**
 * Nomin Code: Multi-Agent Swarm Team View
 * Calm horizontal role bar for 2 to 5 agents, shared message feed, and focus selection.
 */

import { ThemeManager } from './theme.js';
import { FooterHints } from './components/footer-hints.js';

export interface AgentStatus {
  role: 'architect' | 'coder' | 'tester' | 'reviewer' | 'verifier' | string;
  model: string;
  state: 'idle' | 'running' | 'waiting' | 'passed' | 'failed';
  currentTask?: string;
}

export class TeamView {
  public static renderRoleBar(agents: AgentStatus[], focusedIndex: number = 0): string[] {
    const c = ThemeManager.getColors();
    const lines: string[] = [];

    const pills = agents.map((agent, idx) => {
      const isFocused = idx === focusedIndex;
      let stateColor = c.secondary;
      if (agent.state === 'running') stateColor = c.warning;
      if (agent.state === 'passed') stateColor = c.success;
      if (agent.state === 'failed') stateColor = c.error;

      const numStr = `[${idx + 1}]`;
      const roleStr = agent.role.toUpperCase();
      const statusStr = `(${agent.state})`;

      if (isFocused) {
        return `${c.accent}${c.bold}❯ ${numStr} ${roleStr} ${stateColor}${statusStr}${c.reset}`;
      }
      return `${c.secondary}${numStr} ${roleStr} ${stateColor}${statusStr}${c.reset}`;
    });

    lines.push(`  ${pills.join(`  ${c.border}│${c.reset}  `)}`);

    // Show task description of the focused agent if active
    const focused = agents[focusedIndex];
    if (focused && focused.currentTask) {
      lines.push(`  ${c.secondary}Active Task (${focused.role}):${c.reset} ${c.text}${focused.currentTask}${c.reset}`);
    }

    return lines;
  }
}
