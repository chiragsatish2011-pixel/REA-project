/**
 * Nomin Code: Professional Provider Error Classification Engine
 * Classifies HTTP status codes, extracts provider diagnostics, sanitizes secrets,
 * and generates structured next actions for users and the runtime harness.
 */

import { RedactionEngine } from '../config/keychain.js';
import { NominLogger } from './logger.js';

export type ErrorCategory =
  | 'AUTH_FAILED'       // 401, 403
  | 'NOT_FOUND'         // 404
  | 'MODEL_RETIRED'     // 410
  | 'RATE_LIMITED'      // 429
  | 'BAD_REQUEST'       // 400
  | 'SERVER_ERROR'      // 500, 502, 503, 504
  | 'NETWORK_ERROR'     // ECONNRESET, ETIMEDOUT, ENOTFOUND
  | 'UNKNOWN';

export interface ClassifiedError {
  category: ErrorCategory;
  statusCode?: number;
  code?: string;
  requestId?: string;
  errorSource?: string;
  gatewaySource?: string;
  providerDetail: string;
  sanitizedMessage: string;
  suggestedAction: string;
  isRetryable: boolean;
  retryable: boolean;
  retryAfterMs?: number;
  retryAfterSec?: number;
  isRetired: boolean;
  badParameter?: string;
  modelId?: string;
  providerId?: string;
  rawBody?: string;
}

export class ErrorClassifier {
  /**
   * Classifies any error (NominHttpError, Node Error, or network error) into a structured ClassifiedError.
   */
  public static classify(
    err: unknown,
    context: { modelId?: string; providerId?: string; endpointUrl?: string } = {}
  ): ClassifiedError {
    const errorObj = (err || {}) as Record<string, any>;
    let status = typeof errorObj.status === 'number'
      ? errorObj.status
      : typeof errorObj.statusCode === 'number'
      ? errorObj.statusCode
      : typeof errorObj.response?.status === 'number'
      ? errorObj.response.status
      : undefined;

    const rawMessage: string = errorObj.message || String(err);
    if (!status && typeof rawMessage === 'string') {
      const match = rawMessage.match(/HTTP\s*(\d{3})/i);
      if (match) status = parseInt(match[1], 10);
    }

    const rawHeaders: Record<string, string> = errorObj.headers || errorObj.response?.headers || {};
    const rawBody: string = typeof errorObj.body === 'string'
      ? errorObj.body
      : typeof errorObj.responseBody === 'string'
      ? errorObj.responseBody
      : typeof errorObj.response?.data === 'string'
      ? errorObj.response.data
      : typeof errorObj.response?.data === 'object'
      ? JSON.stringify(errorObj.response.data)
      : '';

    // Extract headers (case-insensitive)
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      headers[k.toLowerCase()] = String(v);
    }

    const requestId =
      headers['x-request-id'] ||
      headers['request-id'] ||
      headers['nv-request-id'] ||
      undefined;

    const errorSource =
      headers['nvcf-error-source'] ||
      headers['x-error-source'] ||
      undefined;

    // Extract retry-after
    let retryAfterMs: number | undefined;
    const retryAfterHeader = headers['retry-after'];
    const retryAfterMsHeader = headers['retry-after-ms'];
    if (retryAfterMsHeader) {
      const parsedMs = parseInt(retryAfterMsHeader, 10);
      if (!isNaN(parsedMs) && parsedMs > 0) retryAfterMs = parsedMs;
    } else if (retryAfterHeader) {
      const parsedSec = parseFloat(retryAfterHeader);
      if (!isNaN(parsedSec) && parsedSec > 0) {
        retryAfterMs = Math.round(parsedSec * 1000);
      } else {
        const parsedDate = Date.parse(retryAfterHeader);
        if (!isNaN(parsedDate)) {
          retryAfterMs = Math.max(0, parsedDate - Date.now());
        }
      }
    }

    // Parse JSON body if present to extract provider detail
    let providerDetail = '';
    let badParameter: string | undefined;

    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody);
        if (typeof parsed.detail === 'string') {
          providerDetail = parsed.detail;
        } else if (parsed.error) {
          if (typeof parsed.error === 'string') {
            providerDetail = parsed.error;
          } else if (typeof parsed.error.message === 'string') {
            providerDetail = parsed.error.message;
            if (parsed.error.param) badParameter = parsed.error.param;
          }
        } else if (typeof parsed.message === 'string') {
          providerDetail = parsed.message;
        } else if (typeof parsed.title === 'string' && parsed.status) {
          providerDetail = `${parsed.title} (HTTP ${parsed.status})`;
        }
      } catch {
        providerDetail = rawBody.slice(0, 300);
      }
    }

    if (!providerDetail) {
      providerDetail = rawMessage;
    }

    // Redact secrets
    providerDetail = RedactionEngine.redact(providerDetail);
    const sanitizedRaw = RedactionEngine.redact(rawMessage);

    let category: ErrorCategory = 'UNKNOWN';
    let suggestedAction = 'Review provider configuration or choose another model.';
    let isRetryable = false;
    let isRetired = false;

    if (status === 401 || status === 403) {
      category = 'AUTH_FAILED';
      suggestedAction =
        `API key is missing, unauthorized, or expired for provider '${context.providerId || 'active provider'}'. ` +
        `Run 'nomin auth' or '/provider key <key>' to update credentials.`;
    } else if (status === 404) {
      category = 'NOT_FOUND';
      const target = context.modelId ? `Model '${context.modelId}'` : 'Requested endpoint';
      suggestedAction = `${target} was not found on provider. Check spelling or use '/models' to pick a live model.`;
    } else if (status === 410) {
      category = 'MODEL_RETIRED';
      isRetired = true;
      suggestedAction =
        `Model '${context.modelId || 'selected'}' has reached its end of life and is retired on the provider. ` +
        `Opening model picker to select an active model.`;
    } else if (status === 429) {
      category = 'RATE_LIMITED';
      isRetryable = true;
      suggestedAction = retryAfterMs
        ? `Rate limit exceeded. System will automatically wait ${(retryAfterMs / 1000).toFixed(1)}s before retry.`
        : `Rate limit quota exceeded. Reduce request concurrency or upgrade provider tier.`;
    } else if (status === 400) {
      category = 'BAD_REQUEST';
      // Detect context length overflow vs bad parameter
      if (/context[_\s-]?length|maximum context|token limit/i.test(providerDetail)) {
        badParameter = 'context_length';
        suggestedAction = `Context window exceeded. Context compaction will be triggered automatically.`;
      } else {
        if (!badParameter) {
          const match = providerDetail.match(/['"`]([a-zA-Z0-9_.-]+)['"`]\s*(?:is not valid|is required|must be)/i);
          if (match) badParameter = match[1];
        }
        suggestedAction = badParameter
          ? `Invalid request parameter '${badParameter}'. Adjust model sampling settings via '/model settings'.`
          : `Invalid request payload sent to provider. Verify parameters via '/model settings'.`;
      }
    } else if (status && status >= 500 && status < 600) {
      category = 'SERVER_ERROR';
      isRetryable = true;
      suggestedAction = `Provider returned temporary server error (HTTP ${status}). Retrying with exponential backoff...`;
    } else if (
      errorObj.code === 'ECONNRESET' ||
      errorObj.code === 'ETIMEDOUT' ||
      errorObj.code === 'ENOTFOUND' ||
      errorObj.code === 'ECONNREFUSED' ||
      errorObj.name === 'AbortError' ||
      /socket hang up|timeout|network error|etimedout|econnreset|fetch failed|aborted by signal|operation was aborted|abort/i.test(rawMessage)
    ) {
      category = 'NETWORK_ERROR';
      isRetryable = true;
      const isAbort = /abort/i.test(rawMessage) || errorObj.name === 'AbortError';
      if (isAbort) {
        providerDetail = 'Provider gateway timed out (upstream server unresponsive)';
        suggestedAction = `Upstream provider timed out before sending tokens. The model may be experiencing heavy server queue congestion or cold-start latency. Try another active model or retry in a moment.`;
      } else {
        suggestedAction = `Network error (${errorObj.code || 'timeout'}). Check internet connection or base URL connectivity.`;
      }
    }

    const classified: ClassifiedError = {
      category,
      statusCode: status,
      code: errorObj.code,
      requestId,
      errorSource,
      gatewaySource: errorSource,
      providerDetail,
      sanitizedMessage: sanitizedRaw,
      suggestedAction,
      isRetryable,
      retryable: isRetryable,
      retryAfterMs,
      retryAfterSec: retryAfterMs ? Math.round(retryAfterMs / 1000) : undefined,
      isRetired,
      badParameter,
      modelId: context.modelId,
      providerId: context.providerId,
      rawBody: RedactionEngine.redact(rawBody),
    };

    // Log complete diagnostic trace to nomin.log
    NominLogger.error(`Provider Error Classified [${category}]`, {
      statusCode: status,
      modelId: context.modelId,
      providerId: context.providerId,
      requestId,
      errorSource,
      providerDetail,
      suggestedAction,
    });

    return classified;
  }

  /**
   * Formats a clean, multi-line professional diagnostic block for display in the terminal.
   */
  public static formatDiagnosticCard(classified: ClassifiedError): string {
    const lines: string[] = [];
    const statusPart = classified.statusCode ? ` [HTTP ${classified.statusCode}]` : '';
    const reqPart = classified.requestId ? ` (Request ID: ${classified.requestId})` : '';

    lines.push(`  ✖ Provider Error:${statusPart}${reqPart}`);
    lines.push(`    Reason: ${classified.providerDetail}`);
    if (classified.errorSource) {
      lines.push(`    Source: ${classified.errorSource}`);
    }
    lines.push(`    Action: ${classified.suggestedAction}`);

    return lines.join('\n');
  }
}
