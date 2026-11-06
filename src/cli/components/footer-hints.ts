/**
 * Reusable Footer Hint Bar (OpenCode standard)
 * Displays '~' on the left, keybinding hints in the middle/right, and version number.
 */

import { ThemeManager } from '../theme.js';

export interface KeyHint {
  key: string;
  label: string;
}

export class FooterHints {
  public static render(
    hints: KeyHint[],
    leftContext: string = '~',
    version?: string,
    tokensContext?: { usedTokens: number; maxTokens?: number },
    isBusy: boolean = false
  ): string {
    const c = ThemeManager.getColors();
    const parts = hints.map(h => `${c.bold}${c.text}${h.key}${c.reset} ${c.secondary}${h.label}${c.reset}`);
    const hintsStr = parts.join('   ');

    const termWidth = process.stdout.columns || 80;

    let leftSide = '';
    if (isBusy) {
      // OpenCode signature gradient progress blocks: ■■■■■■■■ esc interrupt
      const grad = '\x1b[38;2;30;60;120m■\x1b[38;2;45;85;160m■\x1b[38;2;60;110;200m■\x1b[38;2;88;166;255m■\x1b[38;2;120;190;255m■';
      leftSide = `${grad}${c.reset} ${c.secondary}esc interrupt${c.reset}`;
    } else {
      leftSide = `${c.secondary}${leftContext}${c.reset}`;
    }

    let tokenUsageStr = '';
    let plainTokenUsage = '';
    if (tokensContext && tokensContext.usedTokens > 0) {
      const k = (tokensContext.usedTokens / 1000).toFixed(1);
      const max = tokensContext.maxTokens || 128000;
      const pct = Math.max(1, Math.round((tokensContext.usedTokens / max) * 100));
      tokenUsageStr = `${c.secondary}${k}K (${pct}%)${c.reset}   `;
      plainTokenUsage = `${k}K (${pct}%)   `;
    }

    const versionStr = version ? `   ${c.secondary}${version}${c.reset}` : '';
    const plainVersion = version ? `   ${version}` : '';

    const plainLeft = isBusy ? '■■■■■ esc interrupt' : leftContext;
    const plainRight = plainTokenUsage + hints.map(h => `${h.key} ${h.label}`).join('   ') + plainVersion;

    const padCount = Math.max(4, termWidth - plainLeft.length - plainRight.length - 4);
    const padding = ' '.repeat(padCount);

    return `  ${leftSide}${padding}${tokenUsageStr}${hintsStr}${versionStr}`;
  }
}
