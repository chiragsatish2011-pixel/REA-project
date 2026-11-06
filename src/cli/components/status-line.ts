/**
 * Reusable Slim Status Line (OpenCode & Claude Code standard)
 * Displays left cyan/blue accent bar '▌', mode badge, model, provider, tokens, and reasoning effort.
 */

import { ThemeManager } from '../theme.js';
import { RequestGateway } from '../../provider/request-gateway.js';

export interface StatusLineProps {
  providerName: string;
  activeModel?: string;
  reasoningEffort?: string;
  permissionMode?: 'normal' | 'auto-accept' | 'plan';
  workspaceDir: string;
  gitBranch?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  rpmLimit?: number;
  tpmLimit?: number;
  isStreaming?: boolean;
  includeBar?: boolean;
  compactEffort?: boolean;
  gatewayStatus?: string;
}

export class StatusLine {
  public static render(props: StatusLineProps): string {
    const c = ThemeManager.getColors();
    const parts: string[] = [];

    // Mode badge (OpenCode signature: Build / Auto / Plan)
    const mode = props.permissionMode || 'normal';
    if (mode === 'plan') {
      parts.push(`${c.warning}${c.bold}PLAN MODE${c.reset}`);
    } else if (mode === 'auto-accept') {
      parts.push(`${c.success}${c.bold}AUTO-ACCEPT${c.reset}`);
    } else {
      parts.push(`${c.accent}${c.bold}Build${c.reset}`);
    }

    // Model & Provider: Model [PROVIDER] (or clean title-case in composer dock)
    const prov = props.providerName.toUpperCase();
    const hasModel = Boolean(props.activeModel && props.activeModel !== 'undefined' && props.activeModel !== 'none');

    if (props.compactEffort && hasModel) {
      // OpenCode signature clean model format: Nemotron 3 Ultra 550B A55B Nvidia
      const rawModel = props.activeModel!;
      let modelClean = rawModel;
      let vendorClean = props.providerName;
      if (rawModel.includes('/')) {
        const [v, r] = rawModel.split('/', 2);
        modelClean = r;
        vendorClean = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
      }
      const words = modelClean.split(/[-_]/).map(w => {
        if (w === w.toUpperCase()) return w;
        if (/\d/.test(w)) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      });
      const cleanModelName = words.join(' ');
      parts.push(`${c.bold}${c.text}${cleanModelName}${c.reset} ${c.secondary}${vendorClean}${c.reset}`);
    } else {
      const modelStr = hasModel
        ? `${c.bold}${c.text}${props.activeModel}${c.reset}`
        : `${c.secondary}(no model - run /model)${c.reset}`;
      parts.push(`${modelStr} ${c.secondary}[${prov}]${c.reset}`);
    }

    // Token / cost telemetry
    const totalTok = props.totalTokens || (props.promptTokens || 0) + (props.completionTokens || 0);
    if (totalTok > 0) {
      const tokStr = totalTok >= 1000 ? `${(totalTok / 1000).toFixed(1)}k tok` : `${totalTok} tok`;
      const costStr = props.estimatedCostUsd ? ` ($${props.estimatedCostUsd.toFixed(3)})` : '';
      parts.push(`${c.secondary}${tokStr}${costStr}${c.reset}`);
    }

    // Reasoning effort
    if (props.reasoningEffort && props.reasoningEffort !== 'off') {
      const isMax = props.reasoningEffort === 'max';
      const effortColor = isMax ? c.amber : c.info;
      const effortLabel = props.compactEffort ? props.reasoningEffort : `effort:${props.reasoningEffort}`;
      parts.push(`${effortColor}${effortLabel}${c.reset}`);
    }

    // Live gateway rate-limit state (e.g. "RPM 31/40 · queued 1")
    const gw = RequestGateway.getInstance();
    if (props.rpmLimit && props.rpmLimit > 0) {
      gw.setRpmLimit(props.providerName, props.activeModel || 'all', props.rpmLimit);
    }
    const gatewaySummary = gw.getStatusSummary(props.providerName, props.activeModel);
    const gatewayText = props.gatewayStatus || (gatewaySummary ? gatewaySummary.formatted : undefined);

    if (gatewayText) {
      parts.push(`${c.secondary}${gatewayText}${c.reset}`);
    } else if (props.rpmLimit && !props.compactEffort) {
      parts.push(`${c.secondary}${props.rpmLimit} rpm${c.reset}`);
    }

    // Render with OpenCode left accent bar '│' or clean inline string
    const bar = c.bar || c.accent;
    const prefix = props.includeBar === false ? '' : `  ${bar}│${c.reset} `;
    return `${prefix}${parts.join(` ${c.secondary}·${c.reset} `)}`;
  }
}
