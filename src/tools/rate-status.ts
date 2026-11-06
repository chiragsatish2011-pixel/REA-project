/**
 * @file rate-status.ts
 * @description Telemetry tool exposing RequestGateway and RequestLedger metrics to the LLM agent.
 * Enables the agent to answer questions about rate limits, throttling, RPM limits, queue depth,
 * and 429 Too Many Requests errors using verifiable real runtime data, never guessing.
 * Zero external dependencies (pure Node.js).
 */

import type { Tool, ToolExecutionContext, ToolParametersSchema, ToolResult } from './types.js';
import { RequestLedger } from '../provider/request-ledger.js';
import { RequestGateway } from '../provider/request-gateway.js';

export class RateStatusTool implements Tool {
  public readonly name = 'rate_status';
  public readonly description =
    'Read-only telemetry tool returning real rate limits, gateway token bucket state, circuit breaker status, and recent call ledger metrics. Use this tool whenever the user asks why requests were throttled, why 429 errors occurred, or about current request rate and RPM limit. Never guess rate status.';

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      windowSeconds: {
        type: 'number',
        description: 'Time window in seconds to query call statistics (default: 60)',
      },
    },
  };

  public async execute(args: Record<string, any>, _context: ToolExecutionContext): Promise<ToolResult> {
    const windowSec = typeof args.windowSeconds === 'number' && args.windowSeconds > 0 ? args.windowSeconds : 60;
    const windowMs = windowSec * 1000;

    const ledger = RequestLedger.getInstance();
    const gateway = RequestGateway.getInstance();

    const callsInWindow = ledger.getCallsInWindow(windowMs);
    const callsByPurpose = ledger.getCallsByPurpose(windowMs);
    const count429InWindow = ledger.get429Count(windowMs);
    const count429AllTime = ledger.get429Count();
    const lastThrottle = ledger.getLastThrottleInfo();

    const queueDepths = gateway.getPriorityQueueDepth();
    const totalQueued = queueDepths.liveTurn + queueDepths.toolContinuation + queueDepths.verifier + queueDepths.background;
    const circuitState = gateway.getCircuitState();

    // Determine active model and provider from recent calls or default
    const recent = ledger.getRecent(1);
    const activeProvider = recent[0]?.provider || 'nvidia-nim';
    const activeModel = recent[0]?.model || 'nvidia/nemotron-3-ultra-550b-a55b';
    const rpmLimit = gateway.getRpmLimit(activeProvider, activeModel);

    const reportLines: string[] = [
      `=== RATE LIMIT & GATEWAY TELEMETRY (Last ${windowSec}s) ===`,
      `Active Provider: ${activeProvider}`,
      `Active Model:    ${activeModel}`,
      `Configured RPM:  ${rpmLimit} requests/minute`,
      `Calls in window: ${callsInWindow.length}/${rpmLimit} (${((callsInWindow.length / (rpmLimit || 1)) * 100).toFixed(0)}% capacity)`,
      `Queue Depth:     ${totalQueued} pending (LiveTurn: ${queueDepths.liveTurn}, ToolContinuation: ${queueDepths.toolContinuation}, Verifier: ${queueDepths.verifier}, Background: ${queueDepths.background})`,
      `Circuit Breaker: ${circuitState}`,
      `429 Rate Limits: ${count429InWindow} in last ${windowSec}s (${count429AllTime} all-time)`,
      ``,
      `--- Calls by Purpose (Last ${windowSec}s) ---`,
      `  • chat:              ${callsByPurpose.chat}`,
      `  • tool-continuation: ${callsByPurpose['tool-continuation']}`,
      `  • router:            ${callsByPurpose.router}`,
      `  • planner:           ${callsByPurpose.planner}`,
      `  • verifier:          ${callsByPurpose.verifier}`,
      `  • probe:             ${callsByPurpose.probe}`,
      `  • summary:           ${callsByPurpose.summary}`,
      `  • title:             ${callsByPurpose.title}`,
    ];

    if (lastThrottle) {
      reportLines.push(
        ``,
        `--- Most Recent Throttling / 429 Event ---`,
        `  • Timestamp:    ${lastThrottle.isoTime}`,
        `  • Status Code:  ${lastThrottle.status}`,
        `  • Model:        ${lastThrottle.model}`,
        `  • Retry-After:  ${lastThrottle.retryAfter !== undefined ? `${lastThrottle.retryAfter}s` : 'None (Upstream throttling)'}`,
        `  • Error Reason: ${lastThrottle.error || 'Too Many Requests'}`
      );
    } else {
      reportLines.push(``, `--- Most Recent Throttling / 429 Event: None recorded ---`);
    }

    const output = reportLines.join('\n');
    return {
      success: true,
      output,
      data: {
        windowSec,
        callsInWindowCount: callsInWindow.length,
        rpmLimit,
        queueDepths,
        totalQueued,
        circuitState,
        count429InWindow,
        count429AllTime,
        callsByPurpose,
        lastThrottle,
      },
    };
  }
}
