/**
 * @file request-gateway.ts
 * @description Nomin Code Universal Request Gateway.
 * Single chokepoint for all LLM model requests across the entire application.
 * 
 * Features:
 * - Singleton pattern: RequestGateway.getInstance()
 * - Token bucket per (provider, key, model) with configurable RPM per model
 * - Adaptive learning from response rate-limit headers (x-ratelimit-limit-requests, etc.)
 * - Strict 4-tier Priority Queue:
 *     - LIVE_TURN (Priority 0): User's live interactive turn
 *     - TOOL_CONTINUATION (Priority 1): Agent tool continuation
 *     - VERIFIER (Priority 2): Verification & DoD proof checking
 *     - BACKGROUND (Priority 3): Probes, summarization, speculative tasks
 * - Mathematical invariant: Never exceed RPM limit in any rolling 60-second window.
 *   Maintains rolling timestamp log and delays dispatch until a rolling slot opens up.
 * - Live status state: getStatusSummary(provider, model) -> { currentCalls60s, rpmLimit, queued, circuitState, formatted }
 * - Circuit breaker: CLOSED -> OPEN -> HALF_OPEN
 * - Integration with RequestLedger for audit logging
 * 
 * Zero external dependencies (pure Node.js).
 */

import { TokenBucket } from './rate-limiter.js';
import { RequestLedger } from './request-ledger.js';
import { ModelSettingsManager } from './model-settings.js';

export enum GatewayPriority {
  LIVE_TURN = 0,
  TOOL_CONTINUATION = 1,
  VERIFIER = 2,
  BACKGROUND = 3,
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface PriorityQueueDepth {
  liveTurn: number;
  toolContinuation: number;
  verifier: number;
  background: number;
}

export interface GatewayStatusSummary {
  currentCalls60s: number;
  rpmLimit: number;
  queued: number;
  circuitState: CircuitBreakerState;
  formatted: string;
}

export interface GatewayScheduleOptions {
  provider: string;
  model?: string;
  apiKey?: string;
  priority?: GatewayPriority | number;
  signal?: AbortSignal;
  purpose?: string;
  fastFailIfCircuitOpen?: boolean;
}

interface QueuedItem<T> {
  id: string;
  priority: GatewayPriority;
  createdAt: number;
  execute?: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  signal?: AbortSignal;
}

export interface ModelBucket {
  key: string;
  provider: string;
  apiKeyMask: string;
  model: string;
  rpmLimit: number;
  dispatchTimestamps: number[];
  tokenBucket: TokenBucket;
  queue: QueuedItem<any>[];
  circuitState: CircuitBreakerState;
  consecutiveFailures: number;
  circuitOpenedAt: number;
  cooldownUntil: number;
  isProcessing: boolean;
  processTimer?: NodeJS.Timeout;
}

export class RequestGateway {
  private static instance: RequestGateway | null = null;
  private readonly buckets: Map<string, ModelBucket> = new Map();
  private readonly configuredRpmLimits: Map<string, number> = new Map();
  private defaultRpm: number = 60;
  private rollingWindowMs: number = 60000;
  private circuitCooldownMs: number = 30000;
  private failureThreshold: number = 5;
  private virtualTimeOffset: number = 0;
  private customTimeFn?: () => number;

  private constructor() {}

  public now(): number {
    if (this.customTimeFn) return this.customTimeFn();
    return Date.now() + this.virtualTimeOffset;
  }

  public setTimeProvider(fn: () => number): void {
    this.customTimeFn = fn;
  }

  public advanceTime(ms: number): void {
    this.virtualTimeOffset += ms;
    for (const bucket of this.buckets.values()) {
      void this.processBucket(bucket);
    }
  }

  public setCircuitCooldownMs(ms: number): void {
    if (ms > 0) this.circuitCooldownMs = ms;
  }

  public setFailureThreshold(threshold: number): void {
    if (threshold > 0) this.failureThreshold = threshold;
  }

  public setRollingWindowMs(windowMs: number): void {
    if (windowMs > 0) {
      this.rollingWindowMs = windowMs;
      for (const bucket of this.buckets.values()) {
        bucket.tokenBucket = new TokenBucket(bucket.rpmLimit, this.rollingWindowMs);
      }
    }
  }

  public static getInstance(): RequestGateway {
    if (!RequestGateway.instance) {
      RequestGateway.instance = new RequestGateway();
    }
    return RequestGateway.instance;
  }

  /**
   * Resets the singleton instance (useful for clean unit testing isolation).
   */
  public static resetInstance(): void {
    if (RequestGateway.instance) {
      for (const bucket of RequestGateway.instance.buckets.values()) {
        if (bucket.processTimer) {
          clearTimeout(bucket.processTimer);
        }
      }
      RequestGateway.instance.buckets.clear();
      RequestGateway.instance.configuredRpmLimits.clear();
      RequestGateway.instance.virtualTimeOffset = 0;
      RequestGateway.instance.customTimeFn = undefined;
    }
    RequestGateway.instance = null;
  }

  /**
   * Configures default RPM limit when no specific model or provider setting is present.
   */
  public setDefaultRpm(rpm: number): void {
    if (rpm > 0) {
      this.defaultRpm = Math.floor(rpm);
    }
  }

  /**
   * Explicitly sets or overrides the RPM limit for a given provider and model.
   * Saved per model in memory without hardcoding fixed limits.
   */
  public setRpmLimit(provider: string, model: string, rpm: number): void {
    if (rpm <= 0) return;
    const cleanRpm = Math.floor(rpm);
    const configKey = this.buildConfigKey(provider, model);
    this.configuredRpmLimits.set(configKey, cleanRpm);

    // Update any existing buckets matching this provider and model
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.provider.toLowerCase() === provider.toLowerCase() &&
          bucket.model.toLowerCase() === (model || 'all').toLowerCase()) {
        bucket.rpmLimit = cleanRpm;
        bucket.tokenBucket = new TokenBucket(cleanRpm, this.rollingWindowMs);
      }
    }
  }

  /**
   * Gets the active RPM limit for a given provider and model.
   */
  public getRpmLimit(provider: string, model?: string): number {
    const configKey = this.buildConfigKey(provider, model || 'all');
    if (this.configuredRpmLimits.has(configKey)) {
      return this.configuredRpmLimits.get(configKey)!;
    }

    const providerKey = this.buildConfigKey(provider, 'all');
    if (this.configuredRpmLimits.has(providerKey)) {
      return this.configuredRpmLimits.get(providerKey)!;
    }

    return this.defaultRpm;
  }

  /**
   * Parses and learns dynamically from HTTP response rate-limit headers.
   * Inspects standard OpenAI, Anthropic, NVIDIA NIM, and Cloudflare rate limit headers.
   */
  public learnFromHeaders(
    provider: string,
    model: string,
    headers?: Record<string, string | string[] | undefined>,
    apiKey?: string
  ): void {
    if (!headers) return;

    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined && v !== null) {
        normalized[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      }
    }

    // Inspect request limit headers
    const limitHeader =
      normalized['x-ratelimit-limit-requests'] ||
      normalized['ratelimit-limit-requests'] ||
      normalized['x-ratelimit-limit'] ||
      normalized['ratelimit-limit'];

    if (limitHeader) {
      const parsedLimit = parseInt(limitHeader, 10);
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        this.setRpmLimit(provider, model, parsedLimit);
      }
    }

    // Handle Retry-After / Rate Limit trip
    const retryAfter = normalized['retry-after-ms'] || normalized['retry-after'];
    if (retryAfter) {
      const waitMs = normalized['retry-after-ms']
        ? parseInt(retryAfter, 10)
        : parseInt(retryAfter, 10) * 1000;
      if (Number.isFinite(waitMs) && waitMs > 0) {
        const bucket = this.getOrCreateBucket(provider, apiKey, model);
        bucket.circuitState = 'OPEN';
        bucket.circuitOpenedAt = this.now();
        bucket.cooldownUntil = this.now() + Math.min(waitMs, 60000);
      }
    }
  }

  /**
   * Records a request failure (e.g. 429 Too Many Requests or 5xx server error).
   * Trips circuit breaker when threshold is met.
   */
  public recordFailure(provider: string, model?: string, statusCode?: number, apiKey?: string): void {
    const bucket = this.getOrCreateBucket(provider, apiKey, model);
    const isCircuitFailure = statusCode === 429 || (typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600);
    if (isCircuitFailure) {
      bucket.consecutiveFailures++;
      if (bucket.consecutiveFailures >= this.failureThreshold) {
        bucket.circuitState = 'OPEN';
        bucket.circuitOpenedAt = this.now();
        bucket.cooldownUntil = this.now() + this.circuitCooldownMs;
      }
    }
  }

  /**
   * Records a successful request response, resetting failure counter and closing circuit.
   */
  public recordSuccess(provider: string, model?: string, apiKey?: string): void {
    const bucket = this.getOrCreateBucket(provider, apiKey, model);
    bucket.consecutiveFailures = 0;
    bucket.circuitState = 'CLOSED';
    bucket.circuitOpenedAt = 0;
    bucket.cooldownUntil = 0;
  }

  public isCircuitOpen(provider: string, model?: string, apiKey?: string): boolean {
    const bucket = this.findMatchingBucket(provider, model, apiKey);
    if (!bucket) return false;
    const now = this.now();
    if (bucket.circuitState === 'OPEN') {
      if (now >= bucket.cooldownUntil) {
        bucket.circuitState = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  public getConsecutiveFailures(provider: string, model?: string, apiKey?: string): number {
    const bucket = this.findMatchingBucket(provider, model, apiKey);
    return bucket ? bucket.consecutiveFailures : 0;
  }

  public resetCircuit(provider: string, model?: string, apiKey?: string): void {
    const bucket = this.findMatchingBucket(provider, model, apiKey);
    if (bucket) {
      bucket.consecutiveFailures = 0;
      bucket.circuitState = 'CLOSED';
      bucket.circuitOpenedAt = 0;
      bucket.cooldownUntil = 0;
    }
  }

  /**
   * Main scheduling chokepoint: executes an asynchronous request through the priority queue
   * and token bucket rate limiter.
   */
  public async schedule<T>(
    task: () => Promise<T>,
    options: GatewayScheduleOptions
  ): Promise<T> {
    const bucket = this.getOrCreateBucket(options.provider, options.apiKey, options.model);
    const priority = this.normalizePriority(options.priority);

    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        return reject(new Error('Request aborted before queuing in gateway'));
      }

      if (options.fastFailIfCircuitOpen && bucket.circuitState === 'OPEN' && this.now() < bucket.cooldownUntil) {
        const remainingSec = Math.ceil((bucket.cooldownUntil - this.now()) / 1000);
        return reject(new Error(`Circuit breaker is OPEN for ${bucket.provider}/${bucket.model} (cooling down for ${remainingSec}s)`));
      }

      const item: QueuedItem<T> = {
        id: `gw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        priority,
        createdAt: Date.now(),
        execute: task,
        resolve,
        reject,
        signal: options.signal,
      };

      this.enqueue(bucket, item);
      void this.processBucket(bucket);
    });
  }

  /**
   * Acquires a dispatch slot for streaming requests (chatStream).
   * Waits in the priority queue and strictly adheres to the rolling 60s rate limit window.
   * Returns a release function to be called when the stream finishes or errors.
   */
  public async acquireSlot(options: GatewayScheduleOptions): Promise<() => void> {
    const bucket = this.getOrCreateBucket(options.provider, options.apiKey, options.model);
    const priority = this.normalizePriority(options.priority);

    return new Promise<() => void>((resolve, reject) => {
      if (options.signal?.aborted) {
        return reject(new Error('Request aborted before slot acquisition'));
      }

      const item: QueuedItem<() => void> = {
        id: `gw_slot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        priority,
        createdAt: Date.now(),
        resolve: () => {
          let released = false;
          resolve(() => {
            if (!released) {
              released = true;
              void this.processBucket(bucket);
            }
          });
        },
        reject,
        signal: options.signal,
      };

      this.enqueue(bucket, item);
      void this.processBucket(bucket);
    });
  }

  /**
   * Live status summary per (provider, model).
   * e.g. { currentCalls60s: 31, rpmLimit: 40, queued: 1, circuitState: 'CLOSED', formatted: 'RPM 31/40 · queued 1' }
   */
  public getStatusSummary(provider: string, model?: string, apiKey?: string): GatewayStatusSummary {
    const bucket = this.findMatchingBucket(provider, model, apiKey);
    const now = this.now();
    const rpmLimit = bucket ? bucket.rpmLimit : this.getRpmLimit(provider, model);

    if (!bucket) {
      return {
        currentCalls60s: 0,
        rpmLimit,
        queued: 0,
        circuitState: 'CLOSED',
        formatted: `RPM 0/${rpmLimit} · queued 0`,
      };
    }

    // Clean rolling window timestamps
    this.pruneOldTimestamps(bucket, now);

    const currentCalls60s = bucket.dispatchTimestamps.length;
    const queued = bucket.queue.length;
    const circuitState = this.computeEffectiveCircuitState(bucket, now);

    const formatted = `RPM ${currentCalls60s}/${rpmLimit} · queued ${queued}`;
    return {
      currentCalls60s,
      rpmLimit,
      queued,
      circuitState,
      formatted,
    };
  }

  /**
   * Formats status summary directly as string (e.g. "RPM 31/40 · queued 1").
   */
  public formatStatus(provider: string, model?: string, apiKey?: string): string {
    return this.getStatusSummary(provider, model, apiKey).formatted;
  }

  /**
   * Returns current priority queue depths (LIVE_TURN, TOOL_CONTINUATION, VERIFIER, BACKGROUND).
   */
  public getPriorityQueueDepth(provider?: string, model?: string, apiKey?: string): PriorityQueueDepth {
    const depth: PriorityQueueDepth = {
      liveTurn: 0,
      toolContinuation: 0,
      verifier: 0,
      background: 0,
    };

    if (provider) {
      const bucket = this.findMatchingBucket(provider, model, apiKey);
      if (bucket) {
        for (const item of bucket.queue) {
          if (item.priority === GatewayPriority.LIVE_TURN) depth.liveTurn++;
          else if (item.priority === GatewayPriority.TOOL_CONTINUATION) depth.toolContinuation++;
          else if (item.priority === GatewayPriority.VERIFIER) depth.verifier++;
          else depth.background++;
        }
      }
      return depth;
    }

    for (const bucket of this.buckets.values()) {
      for (const item of bucket.queue) {
        if (item.priority === GatewayPriority.LIVE_TURN) depth.liveTurn++;
        else if (item.priority === GatewayPriority.TOOL_CONTINUATION) depth.toolContinuation++;
        else if (item.priority === GatewayPriority.VERIFIER) depth.verifier++;
        else depth.background++;
      }
    }
    return depth;
  }

  /**
   * Returns effective circuit breaker state ('CLOSED' | 'OPEN' | 'HALF_OPEN').
   */
  public getCircuitState(provider?: string, model?: string, apiKey?: string): CircuitBreakerState {
    const now = this.now();
    if (provider) {
      const bucket = this.findMatchingBucket(provider, model, apiKey);
      if (!bucket) return 'CLOSED';
      return this.computeEffectiveCircuitState(bucket, now);
    }

    let state: CircuitBreakerState = 'CLOSED';
    for (const bucket of this.buckets.values()) {
      const s = this.computeEffectiveCircuitState(bucket, now);
      if (s === 'OPEN') return 'OPEN';
      if (s === 'HALF_OPEN') state = 'HALF_OPEN';
    }
    return state;
  }

  /**
   * Dispatches the next available request from the priority queue
   * strictly honoring the rolling 60-second window invariant.
   */
  private async processBucket(bucket: ModelBucket): Promise<void> {
    if (bucket.isProcessing) return;
    bucket.isProcessing = true;

    try {
      while (bucket.queue.length > 0) {
        const now = this.now();

        // 1. Prune timestamps outside rolling 60s window
        this.pruneOldTimestamps(bucket, now);

        // 2. Check Circuit Breaker
        if (bucket.circuitState === 'OPEN') {
          if (now >= bucket.cooldownUntil) {
            bucket.circuitState = 'HALF_OPEN';
          } else {
            const waitMs = Math.max(50, bucket.cooldownUntil - now);
            this.scheduleNextProcess(bucket, waitMs);
            break;
          }
        }

        // 3. Strictly enforce Rolling 60s Window:
        // Never exceed rpmLimit in any rolling 60-second window.
        if (bucket.dispatchTimestamps.length >= bucket.rpmLimit) {
          const oldestTimestamp = bucket.dispatchTimestamps[0];
          const delayUntilSlotOpens = Math.max(10, (oldestTimestamp + this.rollingWindowMs) - now + 2);
          this.scheduleNextProcess(bucket, delayUntilSlotOpens);
          break;
        }

        // 4. Dequeue highest priority item (LIVE_TURN=0 first, then TOOL_CONTINUATION=1, etc.)
        const item = bucket.queue.shift();
        if (!item) break;

        if (item.signal?.aborted) {
          item.reject(new Error('Request aborted before execution'));
          continue;
        }

        // 5. Record dispatch timestamp in rolling 60-second log
        bucket.dispatchTimestamps.push(this.now());
        bucket.tokenBucket.tryConsume(1);

        // 6. Execute task
        if (item.execute) {
          const startTime = Date.now();
          try {
            const result = await item.execute();
            const latencyMs = Date.now() - startTime;
            this.recordSuccess(bucket.provider, bucket.model);
            item.resolve(result);
          } catch (err: any) {
            const statusCode = err?.status ?? err?.statusCode;
            this.recordFailure(bucket.provider, bucket.model, statusCode);
            item.reject(err);
          }
        } else {
          // Slot reservation mode (for streaming)
          item.resolve(undefined as any);
        }
      }
    } finally {
      bucket.isProcessing = false;
    }
  }

  private scheduleNextProcess(bucket: ModelBucket, delayMs: number): void {
    if (bucket.processTimer) {
      clearTimeout(bucket.processTimer);
    }
    bucket.processTimer = setTimeout(() => {
      bucket.processTimer = undefined;
      void this.processBucket(bucket);
    }, delayMs);
  }

  private pruneOldTimestamps(bucket: ModelBucket, now: number): void {
    const cutoff = now - this.rollingWindowMs;
    while (bucket.dispatchTimestamps.length > 0 && bucket.dispatchTimestamps[0] <= cutoff) {
      bucket.dispatchTimestamps.shift();
    }
  }

  private enqueue(bucket: ModelBucket, item: QueuedItem<any>): void {
    // Insert in sorted order: lowest priority number first (0 > 1 > 2 > 3), then earliest createdAt
    let insertIndex = bucket.queue.length;
    for (let i = 0; i < bucket.queue.length; i++) {
      const q = bucket.queue[i];
      if (item.priority < q.priority) {
        insertIndex = i;
        break;
      } else if (item.priority === q.priority && item.createdAt < q.createdAt) {
        insertIndex = i;
        break;
      }
    }
    bucket.queue.splice(insertIndex, 0, item);
  }

  private normalizePriority(priority?: GatewayPriority | number): GatewayPriority {
    if (priority === undefined || priority === null) {
      return GatewayPriority.BACKGROUND;
    }
    if (typeof priority === 'number') {
      if (priority <= 0) return GatewayPriority.LIVE_TURN;
      if (priority === 1) return GatewayPriority.TOOL_CONTINUATION;
      if (priority === 2) return GatewayPriority.VERIFIER;
      return GatewayPriority.BACKGROUND;
    }
    return GatewayPriority.BACKGROUND;
  }

  private computeEffectiveCircuitState(bucket: ModelBucket, now: number): CircuitBreakerState {
    if (bucket.circuitState === 'OPEN' && now >= bucket.cooldownUntil) {
      return 'HALF_OPEN';
    }
    return bucket.circuitState;
  }

  private getOrCreateBucket(provider: string, apiKey?: string, model?: string): ModelBucket {
    const cleanProvider = (provider || 'default').toLowerCase().trim();
    const cleanModel = (model || 'all').toLowerCase().trim();
    const keyMask = apiKey ? apiKey.trim().slice(-4) : 'none';
    const bucketKey = `${cleanProvider}::${keyMask}::${cleanModel}`;

    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      const rpmLimit = this.getRpmLimit(cleanProvider, cleanModel);
      bucket = {
        key: bucketKey,
        provider: cleanProvider,
        apiKeyMask: keyMask,
        model: cleanModel,
        rpmLimit,
        dispatchTimestamps: [],
        tokenBucket: new TokenBucket(rpmLimit, this.rollingWindowMs),
        queue: [],
        circuitState: 'CLOSED',
        consecutiveFailures: 0,
        circuitOpenedAt: 0,
        cooldownUntil: 0,
        isProcessing: false,
      };
      this.buckets.set(bucketKey, bucket);
    }
    return bucket;
  }

  private findMatchingBucket(provider: string, model?: string, apiKey?: string): ModelBucket | undefined {
    const cleanProvider = (provider || 'default').toLowerCase().trim();
    const cleanModel = (model || 'all').toLowerCase().trim();
    const keyMask = apiKey ? apiKey.trim().slice(-4) : undefined;

    if (keyMask) {
      const exactKey = `${cleanProvider}::${keyMask}::${cleanModel}`;
      if (this.buckets.has(exactKey)) return this.buckets.get(exactKey);
    }

    // Match by provider and model prefix
    for (const bucket of this.buckets.values()) {
      if (bucket.provider === cleanProvider) {
        if (!model || bucket.model === cleanModel || bucket.model === 'all') {
          return bucket;
        }
      }
    }
    return undefined;
  }

  private buildConfigKey(provider: string, model: string): string {
    return `${provider.toLowerCase().trim()}::${(model || 'all').toLowerCase().trim()}`;
  }
}
