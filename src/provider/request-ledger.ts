/**
 * @file request-ledger.ts
 * @description Request Ledger for Nomin Code.
 * Records every outgoing model call with timestamp, purpose, model, status,
 * latency, tokens, and sanitized rate-limit / Retry-After response headers.
 * NEVER stores API keys, Authorization tokens, or sensitive credentials.
 * Zero external dependencies (pure Node.js).
 */

export type RequestPurpose =
  | 'chat'
  | 'tool-continuation'
  | 'router'
  | 'planner'
  | 'verifier'
  | 'title'
  | 'probe'
  | 'summary';

export interface RateLimitHeaders {
  retryAfter?: number | string;
  limitRequests?: string;
  remainingRequests?: string;
  resetRequests?: string;
  limitTokens?: string;
  remainingTokens?: string;
  resetTokens?: string;
  rawHeaders?: Record<string, string>; // Strictly sanitized: values only, never auth keys
}

export interface LedgerEntry {
  id: string;
  timestamp: number;
  isoTime: string;
  purpose: RequestPurpose;
  model: string;
  provider: string;
  status: number; // HTTP status code, or 0 for network/transport error
  latencyMs: number;
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  rateLimitHeaders: RateLimitHeaders;
  error?: string;
  attempt?: number;
  turnId?: string;
}

export interface ThrottleInfo {
  timestamp: number;
  isoTime: string;
  model: string;
  provider: string;
  status: number;
  retryAfter?: number | string;
  error?: string;
  rateLimitHeaders?: RateLimitHeaders;
}

export class RequestLedger {
  private static instance: RequestLedger | null = null;
  private entries: LedgerEntry[] = [];
  private readonly maxEntries: number = 2000;

  private constructor() {}

  public static getInstance(): RequestLedger {
    if (!RequestLedger.instance) {
      RequestLedger.instance = new RequestLedger();
    }
    return RequestLedger.instance;
  }

  /**
   * Sanitizes headers to ensure zero credential or sensitive token leakage.
   * Strictly strips authorization, keys, tokens, and cookies.
   */
  public static sanitizeHeaders(headers?: Record<string, string | string[] | undefined>): Record<string, string> {
    if (!headers) return {};

    const normalized: Record<string, string> = {};
    for (const [key, val] of Object.entries(headers)) {
      if (!val) continue;
      const lower = key.toLowerCase();
      // Strictly ignore authorization, cookie, key headers
      if (
        lower.includes('auth') ||
        lower.includes('key') ||
        lower.includes('cookie') ||
        lower.includes('secret') ||
        lower.includes('bearer')
      ) {
        continue;
      }
      const strVal = Array.isArray(val) ? val.join(', ') : String(val);
      normalized[lower] = strVal;
    }
    return normalized;
  }

  /**
   * Extracts typed rate-limit and retry headers from response.
   */
  public static extractRateLimitHeaders(headers?: Record<string, string | string[] | undefined>): RateLimitHeaders {
    const normalized = RequestLedger.sanitizeHeaders(headers);
    const rateDetails: RateLimitHeaders = {};
    const raw: Record<string, string> = {};

    // 1. Retry-After
    if (normalized['retry-after-ms']) {
      const ms = Number(normalized['retry-after-ms']);
      if (Number.isFinite(ms)) rateDetails.retryAfter = ms;
      raw['retry-after-ms'] = normalized['retry-after-ms'];
    } else if (normalized['retry-after']) {
      const sec = Number(normalized['retry-after']);
      if (Number.isFinite(sec)) {
        rateDetails.retryAfter = sec;
      } else {
        rateDetails.retryAfter = normalized['retry-after'];
      }
      raw['retry-after'] = normalized['retry-after'];
    }

    // 2. Request limits (OpenAI, NIM, Anthropic)
    for (const [k, v] of Object.entries(normalized)) {
      if (k.includes('ratelimit') || k.includes('retry')) {
        raw[k] = v;
        if (k.endsWith('limit-requests') || k.endsWith('requests-limit')) {
          rateDetails.limitRequests = v;
        } else if (k.endsWith('remaining-requests') || k.endsWith('requests-remaining')) {
          rateDetails.remainingRequests = v;
        } else if (k.endsWith('reset-requests') || k.endsWith('requests-reset')) {
          rateDetails.resetRequests = v;
        } else if (k.endsWith('limit-tokens') || k.endsWith('tokens-limit')) {
          rateDetails.limitTokens = v;
        } else if (k.endsWith('remaining-tokens') || k.endsWith('tokens-remaining')) {
          rateDetails.remainingTokens = v;
        } else if (k.endsWith('reset-tokens') || k.endsWith('tokens-reset')) {
          rateDetails.resetTokens = v;
        }
      }
    }

    rateDetails.rawHeaders = raw;
    return rateDetails;
  }

  /**
   * Records an outgoing model call execution.
   */
  public recordCall(entry: Omit<LedgerEntry, 'id' | 'timestamp' | 'isoTime'> & { id?: string; timestamp?: number; isoTime?: string }): LedgerEntry {
    const timestamp = entry.timestamp ?? Date.now();
    const id = entry.id ?? `req_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;
    const fullEntry: LedgerEntry = {
      ...entry,
      id,
      timestamp,
      isoTime: entry.isoTime ?? new Date(timestamp).toISOString(),
      tokens: {
        promptTokens: entry.tokens?.promptTokens ?? 0,
        completionTokens: entry.tokens?.completionTokens ?? 0,
        totalTokens: entry.tokens?.totalTokens ?? 0,
      },
      rateLimitHeaders: entry.rateLimitHeaders ?? {},
    };

    this.entries.push(fullEntry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    return fullEntry;
  }

  /**
   * Alias for recordCall.
   */
  public record(entry: Omit<LedgerEntry, 'id' | 'timestamp' | 'isoTime'> & { id?: string; timestamp?: number; isoTime?: string }): LedgerEntry {
    return this.recordCall(entry);
  }

  /**
   * Returns all model calls dispatched in the last 60 seconds (or since a specific epoch timestamp).
   */
  public getCallsLast60Seconds(since?: number): LedgerEntry[] {
    const cutoff = since ? since - 60000 : Date.now() - 60000;
    return this.entries.filter(e => e.timestamp >= cutoff);
  }

  /**
   * Returns all model calls dispatched within the specified window in milliseconds (default: 60,000ms).
   */
  public getCallsInWindow(windowMs: number = 60000): LedgerEntry[] {
    const cutoff = Date.now() - windowMs;
    return this.entries.filter(e => e.timestamp >= cutoff);
  }

  /**
   * Returns information regarding the most recent 429 or throttle event, or null if none recorded.
   */
  public getLastThrottleInfo(): ThrottleInfo | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.status === 429 || (e.rateLimitHeaders && e.rateLimitHeaders.retryAfter !== undefined)) {
        return {
          timestamp: e.timestamp,
          isoTime: e.isoTime,
          model: e.model,
          provider: e.provider,
          status: e.status,
          retryAfter: e.rateLimitHeaders?.retryAfter,
          error: e.error,
          rateLimitHeaders: e.rateLimitHeaders,
        };
      }
    }
    return null;
  }

  /**
   * Returns call count partitioned by purpose over a time window (default: all time).
   */
  public getCallsByPurpose(windowMs?: number): Record<RequestPurpose, number> {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const counts: Record<RequestPurpose, number> = {
      chat: 0,
      'tool-continuation': 0,
      router: 0,
      planner: 0,
      verifier: 0,
      title: 0,
      probe: 0,
      summary: 0,
    };

    for (const e of this.entries) {
      if (e.timestamp >= cutoff) {
        if (counts[e.purpose] !== undefined) {
          counts[e.purpose]++;
        } else {
          counts[e.purpose] = 1;
        }
      }
    }
    return counts;
  }

  /**
   * Returns the number of HTTP 429 Too Many Requests errors over a time window.
   */
  public get429Count(windowMs?: number): number {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    return this.entries.filter(e => e.timestamp >= cutoff && e.status === 429).length;
  }

  /**
   * Returns the most recent N entries.
   */
  public getRecent(count: number = 20): LedgerEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Returns all recorded entries.
   */
  public getAll(): LedgerEntry[] {
    return [...this.entries];
  }

  /**
   * Clears the ledger.
   */
  public clear(): void {
    this.entries = [];
  }

  /**
   * Formats a clean ASCII summary table of recent calls for telemetry reporting.
   */
  public formatSummaryTable(count: number = 10): string {
    const recent = this.getRecent(count);
    if (recent.length === 0) {
      return '(Request ledger empty: 0 calls recorded)';
    }

    const lines: string[] = [
      'Timestamp (UTC)       | Purpose           | Model                      | Status | Latency | Tokens (P/C/T) | Retry-After',
      '------------------------------------------------------------------------------------------------------------------',
    ];

    for (const r of recent) {
      const timeStr = r.isoTime.slice(11, 23);
      const purposeStr = r.purpose.padEnd(17);
      const modelShort = (r.model.length > 26 ? r.model.slice(0, 23) + '...' : r.model).padEnd(26);
      const statusStr = String(r.status).padEnd(6);
      const latencyStr = `${r.latencyMs}ms`.padEnd(7);
      const tokStr = `${r.tokens.promptTokens}/${r.tokens.completionTokens}/${r.tokens.totalTokens}`.padEnd(14);
      const retryAfter = r.rateLimitHeaders.retryAfter !== undefined ? String(r.rateLimitHeaders.retryAfter) : '-';

      lines.push(`${timeStr}          | ${purposeStr} | ${modelShort} | ${statusStr} | ${latencyStr} | ${tokStr} | ${retryAfter}`);
    }

    return lines.join('\n');
  }
}

export const requestLedger = RequestLedger.getInstance();
