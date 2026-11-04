/**
 * Nomin Code: High-Capacity Rate-Limit & Latency Scheduler
 * Coordinates RPM, TPM, and Concurrency quotas with Full Jitter Exponential Backoff,
 * Dual Token Bucket reservation/refund, Leaky Bucket shaper, 3-tier Priority Queue,
 * and AIMD Concurrency Gate.
 * 
 * Reverse-engineered from:
 * - OpenCode packages/core/src/model-retry.ts (RETRY_AFTER_MAX 15 min, 10 retries, 3 timeout retries)
 * - AWS & Effect-TS Full Jitter exponential backoff algorithms
 */

import { RequestPriority, RateLimiterConfig, TokenUsage } from './types.js';

export { RequestPriority };
export type { RateLimiterConfig };

/**
 * Upper bound on provider-requested delays so a malformed or adversarial
 * Retry-After header cannot stall an agent swarm indefinitely.
 * Reverse-engineered from OpenCode's Duration.toMillis("15 minutes").
 */
export const RETRY_AFTER_MAX_MS = 15 * 60 * 1000; // 900,000 ms = 15 minutes

/** Maximum retries for network / transport timeout errors (per OpenCode) */
export const MAX_TIMEOUT_RETRIES = 3;

/** Default base exponential backoff in milliseconds (per OpenCode 2s) */
export const DEFAULT_BASE_BACKOFF_MS = 2000;

/** Default maximum retry attempts (per OpenCode Schedule.recurs(10)) */
export const DEFAULT_MAX_RETRIES = 10;

export interface ScheduledTask<T> {
  readonly id: string;
  readonly priority: RequestPriority;
  readonly promptTokens: number;
  readonly maxTokens: number;
  readonly execute: () => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
  readonly createdAt: number;
  attempt: number;
  timeoutAttempts: number;
  signal?: AbortSignal;
  onTokensUsed?: (usage: TokenUsage) => void;
}

export interface SchedulerMetrics {
  activeConcurrency: number;
  maxConcurrencyLimit: number;
  currentAimdLimit: number;
  rpmTokensAvailable: number;
  tpmTokensAvailable: number;
  queueDepth: {
    critical: number;
    interactive: number;
    background: number;
    total: number;
  };
  totalDispatched: number;
  totalThrottled: number;
  totalRetried: number;
  totalTokensProcessed: number;
}

/**
 * Discrete Token Bucket implementation with continuous time refill and refund capability.
 */
export class TokenBucket {
  private readonly capacity: number;
  private tokens: number;
  private readonly refillRatePerMs: number;
  private lastRefill: number;

  constructor(capacity: number, refillPeriodMs: number = 60000) {
    this.capacity = Math.max(1, capacity);
    this.tokens = this.capacity;
    this.refillRatePerMs = this.capacity / Math.max(1, refillPeriodMs);
    this.lastRefill = Date.now();
  }

  public refill(): void {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.lastRefill);
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerMs);
      this.lastRefill = now;
    }
  }

  public tryConsume(count: number): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  public refund(count: number): void {
    if (count <= 0) return;
    this.refill();
    this.tokens = Math.min(this.capacity, this.tokens + count);
  }

  public getAvailable(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  public getCapacity(): number {
    return this.capacity;
  }

  /**
   * Returns the time in milliseconds until `count` tokens will become available.
   */
  public timeUntilAvailable(count: number): number {
    this.refill();
    if (this.tokens >= count) return 0;
    const deficit = count - this.tokens;
    return Math.ceil(deficit / this.refillRatePerMs);
  }

  public reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}

/**
 * Leaky Bucket Shaper: smooths micro-bursts to avoid triggering edge-firewall DDoS
 * throttles at Cloudflare, Akamai, or NVIDIA API Gateway.
 */
export class LeakyBucketShaper {
  private lastDispatchTimestamp: number = 0;
  private readonly minIntervalMs: number;

  constructor(rpmLimit: number, customIntervalMs?: number) {
    if (customIntervalMs !== undefined && customIntervalMs >= 0) {
      this.minIntervalMs = customIntervalMs;
    } else {
      // 60,000ms / RPM * 0.85 per mathematical spec in deliverable 05
      this.minIntervalMs = Math.max(10, Math.floor((60000 / Math.max(1, rpmLimit)) * 0.85));
    }
  }

  public timeUntilNextSlot(): number {
    const now = Date.now();
    const elapsed = now - this.lastDispatchTimestamp;
    return Math.max(0, this.minIntervalMs - elapsed);
  }

  public markDispatched(): void {
    this.lastDispatchTimestamp = Date.now();
  }
}

/**
 * Additive Increase / Multiplicative Decrease (AIMD) Concurrency Gate.
 * Dynamically modulates active HTTP connection slots based on upstream health.
 */
export class AimdConcurrencyGate {
  private currentLimit: number;
  private readonly minLimit: number;
  private readonly maxLimit: number;
  private activeCount: number = 0;
  private successStreak: number = 0;
  private readonly successWindow: number;

  constructor(maxLimit: number, minLimit: number = 1, successWindow: number = 5) {
    this.maxLimit = Math.max(1, maxLimit);
    this.minLimit = Math.max(1, Math.min(minLimit, this.maxLimit));
    // Start at min(2, maxLimit) to allow fast cold-start probing
    this.currentLimit = Math.min(Math.max(2, this.minLimit), this.maxLimit);
    this.successWindow = Math.max(1, successWindow);
  }

  public canAdmit(): boolean {
    return this.activeCount < this.currentLimit;
  }

  public acquire(): void {
    this.activeCount++;
  }

  public release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  public recordSuccess(): void {
    this.successStreak++;
    if (this.successStreak >= this.successWindow && this.currentLimit < this.maxLimit) {
      this.currentLimit++;
      this.successStreak = 0;
    }
  }

  public recordThrottle(): void {
    // Multiplicative decrease: C <- max(minLimit, floor(C * 0.5))
    this.currentLimit = Math.max(this.minLimit, Math.floor(this.currentLimit * 0.5));
    this.successStreak = 0;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getCurrentLimit(): number {
    return this.currentLimit;
  }

  public getMaxLimit(): number {
    return this.maxLimit;
  }
}

/**
 * Unified Nomin Code Rate-Limiting & Capacity Saturation Scheduler.
 */
export class NominRateLimitScheduler {
  private readonly rpmBucket: TokenBucket;
  private readonly tpmBucket: TokenBucket;
  private readonly leakyShaper: LeakyBucketShaper;
  private readonly aimdGate: AimdConcurrencyGate;

  // 3-tier Priority Queue: CRITICAL (0), INTERACTIVE (1), BACKGROUND (2)
  private readonly queues: Map<RequestPriority, ScheduledTask<any>[]> = new Map([
    [RequestPriority.CRITICAL, []],
    [RequestPriority.INTERACTIVE, []],
    [RequestPriority.BACKGROUND, []],
  ]);

  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxRetries: number;
  private readonly maxTimeoutRetries: number;

  private isProcessing: boolean = false;
  private scheduledTimer: NodeJS.Timeout | null = null;
  private isDestroyed: boolean = false;

  // Telemetry metrics
  private totalDispatchedCount: number = 0;
  private totalThrottledCount: number = 0;
  private totalRetriedCount: number = 0;
  private totalTokensProcessed: number = 0;

  constructor(config: RateLimiterConfig) {
    this.rpmBucket = new TokenBucket(config.rpmLimit, 60000);
    this.tpmBucket = new TokenBucket(config.tpmLimit, 60000);
    this.leakyShaper = new LeakyBucketShaper(config.rpmLimit, config.leakyBucketIntervalMs);
    this.aimdGate = new AimdConcurrencyGate(
      config.maxConcurrency,
      config.minConcurrency ?? 1,
      config.aimdSuccessWindow ?? 5
    );

    this.baseBackoffMs = config.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = Math.min(config.maxBackoffMs ?? RETRY_AFTER_MAX_MS, RETRY_AFTER_MAX_MS);
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxTimeoutRetries = config.maxTimeoutRetries ?? MAX_TIMEOUT_RETRIES;
  }

  /**
   * Enqueues an asynchronous LLM operation under the multi-tier scheduler.
   */
  public schedule<T>(
    execute: () => Promise<T>,
    options: {
      promptTokens?: number;
      maxTokens?: number;
      priority?: RequestPriority;
      signal?: AbortSignal;
      onTokensUsed?: (usage: TokenUsage) => void;
    } = {}
  ): Promise<T> {
    if (this.isDestroyed) {
      return Promise.reject(new Error('NominRateLimitScheduler has been destroyed'));
    }

    const priority = options.priority ?? RequestPriority.BACKGROUND;
    const promptTokens = Math.max(1, options.promptTokens ?? 500);
    const maxTokens = Math.max(1, options.maxTokens ?? 2000);

    return new Promise<T>((resolve, reject) => {
      // Handle pre-aborted signal
      if (options.signal?.aborted) {
        reject(new Error('Operation aborted prior to enqueue'));
        return;
      }

      const task: ScheduledTask<T> = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        priority,
        promptTokens,
        maxTokens,
        execute,
        resolve,
        reject,
        createdAt: Date.now(),
        attempt: 0,
        timeoutAttempts: 0,
        signal: options.signal,
        onTokensUsed: options.onTokensUsed,
      };

      // Set up abort listener to remove from queue if cancelled while waiting
      if (options.signal) {
        const onAbort = () => {
          this.removeTaskFromQueues(task.id);
          reject(new Error('Operation aborted while awaiting rate-limit capacity'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      this.enqueueTask(task);
      this.triggerProcess();
    });
  }

  private enqueueTask<T>(task: ScheduledTask<T>): void {
    const queue = this.queues.get(task.priority) ?? [];
    queue.push(task);
    this.queues.set(task.priority, queue);
  }

  private removeTaskFromQueues(taskId: string): boolean {
    for (const [_priority, queue] of this.queues.entries()) {
      const idx = queue.findIndex(t => t.id === taskId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  private getNextCandidate(): ScheduledTask<any> | null {
    // Check queues strictly by priority: CRITICAL > INTERACTIVE > BACKGROUND
    for (const priority of [RequestPriority.CRITICAL, RequestPriority.INTERACTIVE, RequestPriority.BACKGROUND]) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        return queue[0];
      }
    }
    return null;
  }

  private popNextCandidate(): ScheduledTask<any> | null {
    for (const priority of [RequestPriority.CRITICAL, RequestPriority.INTERACTIVE, RequestPriority.BACKGROUND]) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        return queue.shift()!;
      }
    }
    return null;
  }

  private triggerProcess(): void {
    if (this.scheduledTimer !== null || this.isDestroyed) {
      return;
    }
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = null;
      void this.processQueue();
    }, 0);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isDestroyed) {
      return;
    }
    this.isProcessing = true;

    try {
      while (true) {
        const candidate = this.getNextCandidate();
        if (!candidate) {
          break; // Queues empty
        }

        // Clean out aborted tasks
        if (candidate.signal?.aborted) {
          this.popNextCandidate();
          candidate.reject(new Error('Operation aborted in queue'));
          continue;
        }

        // 1. AIMD Concurrency Gate Check
        if (!this.aimdGate.canAdmit()) {
          // All concurrency slots filled, wait for in-flight tasks to finish
          break;
        }

        // 2. Leaky Bucket Shaper Check (prevent micro-bursts)
        const shaperWaitMs = this.leakyShaper.timeUntilNextSlot();
        if (shaperWaitMs > 0) {
          this.scheduleNextProcess(shaperWaitMs);
          break;
        }

        // 3. RPM Token Bucket Check
        if (!this.rpmBucket.tryConsume(1)) {
          const waitRpmMs = this.rpmBucket.timeUntilAvailable(1);
          this.scheduleNextProcess(Math.max(50, waitRpmMs));
          break;
        }

        // 4. TPM Token Bucket Reservation Check
        // Reserve: promptTokens + maxTokens (estimated completion)
        const reservation = candidate.promptTokens + candidate.maxTokens;
        if (!this.tpmBucket.tryConsume(reservation)) {
          // Rollback RPM consumption since we cannot dispatch
          this.rpmBucket.refund(1);
          const waitTpmMs = this.tpmBucket.timeUntilAvailable(reservation);
          this.scheduleNextProcess(Math.max(100, waitTpmMs));
          break;
        }

        // Successfully allocated all capacity gates!
        const task = this.popNextCandidate()!;
        this.aimdGate.acquire();
        this.leakyShaper.markDispatched();
        this.totalDispatchedCount++;

        // Dispatch asynchronously so the loop can examine next items if concurrency permits
        void this.dispatchTask(task, reservation);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private scheduleNextProcess(delayMs: number): void {
    if (this.scheduledTimer !== null || this.isDestroyed) return;
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = null;
      void this.processQueue();
    }, Math.max(1, Math.min(delayMs, 5000)));
  }

  private async dispatchTask<T>(task: ScheduledTask<T>, reservedTokens: number): Promise<void> {
    try {
      const result = await task.execute();
      const actualTokensUsed: TokenUsage | null = (result as any)?.usage ?? null;

      // Successful completion: notify AIMD controller
      this.aimdGate.recordSuccess();

      // Dynamic token refund protocol:
      // If task provided usage data, refund the exact unused tokens.
      // Otherwise, refund a default 40% buffer of completion reservation.
      if (actualTokensUsed && typeof actualTokensUsed.totalTokens === 'number' && actualTokensUsed.totalTokens > 0) {
        const unused = reservedTokens - actualTokensUsed.totalTokens;
        if (unused > 0) {
          this.tpmBucket.refund(unused);
        }
        this.totalTokensProcessed += actualTokensUsed.totalTokens;
        if (task.onTokensUsed) {
          task.onTokensUsed(actualTokensUsed);
        }
      } else {
        // Fallback refund: 40% of maxTokens
        const refundEstimate = Math.floor(task.maxTokens * 0.4);
        this.tpmBucket.refund(refundEstimate);
        const estimatedTokens = Math.max(1, reservedTokens - refundEstimate);
        this.totalTokensProcessed += estimatedTokens;
        if (task.onTokensUsed) {
          task.onTokensUsed({
            promptTokens: task.promptTokens,
            completionTokens: Math.max(1, task.maxTokens - refundEstimate),
            totalTokens: estimatedTokens,
          });
        }
      }

      this.aimdGate.release();
      task.resolve(result);
    } catch (error: any) {
      this.aimdGate.release();

      // Full refund of reserved tokens on failed turn
      this.tpmBucket.refund(reservedTokens);

      // Check if error is abort
      if (task.signal?.aborted || error?.name === 'AbortError' || /aborted/i.test(error?.message || '')) {
        task.reject(error);
        this.triggerProcess();
        return;
      }

      const isThrottled = this.isRateLimitedError(error);
      const isTransient5xx = this.isTransientServerError(error);
      const isTimeout = this.isTimeoutError(error);

      if (isThrottled) {
        this.totalThrottledCount++;
        // Multiplicative decrease on concurrency
        this.aimdGate.recordThrottle();
      }

      const canRetry = (isThrottled || isTransient5xx || isTimeout) && 
        task.attempt < this.maxRetries &&
        (!isTimeout || task.timeoutAttempts < this.maxTimeoutRetries);

      if (canRetry) {
        task.attempt++;
        this.totalRetriedCount++;
        if (isTimeout) task.timeoutAttempts++;

        const headerDelayMs = this.extractRetryAfterMs(error);
        const backoffMs = this.computeFullJitterBackoff(task.attempt, headerDelayMs);

        // Re-enqueue task after backoff delay
        setTimeout(() => {
          if (!this.isDestroyed) {
            this.enqueueTask(task);
            this.triggerProcess();
          }
        }, backoffMs);
      } else {
        task.reject(error);
      }
    } finally {
      this.triggerProcess();
    }
  }

  /**
   * Computes Full Jitter Exponential Backoff:
   * sleep = min(T_ceiling, max(random(0, min(T_ceiling, base * 2^attempt)), T_header))
   * Bounded at RETRY_AFTER_MAX_MS (15 minutes).
   */
  public computeFullJitterBackoff(attempt: number, headerDelayMs?: number): number {
    const exponential = this.baseBackoffMs * Math.pow(2, attempt);
    const capped = Math.min(this.maxBackoffMs, exponential);
    const jittered = Math.floor(Math.random() * capped);

    if (headerDelayMs !== undefined && headerDelayMs > 0) {
      const boundedHeader = Math.min(this.maxBackoffMs, headerDelayMs);
      return Math.min(this.maxBackoffMs, Math.max(jittered, boundedHeader));
    }

    return Math.max(250, jittered);
  }

  /**
   * Extracts retry delay from standard provider rate-limit response headers:
   * - Retry-After (integer seconds or RFC 1123 HTTP-date)
   * - retry-after-ms
   * - x-ratelimit-reset-requests, x-ratelimit-reset-tokens
   * - x-ratelimit-reset
   */
  public extractRetryAfterMs(error: any): number | undefined {
    const headers = error?.headers ?? error?.response?.headers;
    if (!headers) return undefined;

    const getHeader = (name: string): string | undefined => {
      if (typeof headers.get === 'function') {
        return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
      }
      return headers[name] ?? headers[name.toLowerCase()] ?? undefined;
    };

    // 1. Retry-After header
    const retryAfter = getHeader('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && /^\d+$/.test(retryAfter.trim())) {
        return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, seconds * 1000));
      }
      const parsedDate = Date.parse(retryAfter);
      if (!isNaN(parsedDate)) {
        const diff = parsedDate - Date.now();
        return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, diff));
      }
    }

    // 2. retry-after-ms
    const retryAfterMs = getHeader('retry-after-ms');
    if (retryAfterMs) {
      const ms = parseInt(retryAfterMs, 10);
      if (!isNaN(ms)) {
        return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, ms));
      }
    }

    // 3. x-ratelimit-reset or reset-requests
    const reset = getHeader('x-ratelimit-reset') || 
                  getHeader('x-ratelimit-reset-requests') || 
                  getHeader('x-ratelimit-reset-tokens');
    if (reset) {
      const val = parseFloat(reset);
      if (!isNaN(val)) {
        // If val > 1_000_000_000, treat as Unix epoch timestamp in seconds
        if (val > 1_000_000_000) {
          const diff = Math.floor(val * 1000) - Date.now();
          return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, diff));
        }
        // Otherwise treat as relative delta in seconds
        return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, Math.floor(val * 1000)));
      }
    }

    return undefined;
  }

  private isRateLimitedError(error: any): boolean {
    const status = error?.status ?? error?.statusCode ?? error?.response?.status;
    if (status === 429) return true;
    const msg = String(error?.message ?? '').toLowerCase();
    return msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded');
  }

  private isTransientServerError(error: any): boolean {
    const status = error?.status ?? error?.statusCode ?? error?.response?.status;
    if (status === 500 || status === 502 || status === 503 || status === 504 || status === 529) {
      return true;
    }
    const code = error?.code;
    return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN' || code === 'ENOTFOUND';
  }

  private isTimeoutError(error: any): boolean {
    const status = error?.status ?? error?.statusCode;
    if (status === 408 || status === 504) return true;
    const code = error?.code;
    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return true;
    const msg = String(error?.message ?? '').toLowerCase();
    return msg.includes('timeout') || msg.includes('timed out');
  }

  public getStatus(): SchedulerMetrics {
    const qCrit = this.queues.get(RequestPriority.CRITICAL)?.length ?? 0;
    const qInter = this.queues.get(RequestPriority.INTERACTIVE)?.length ?? 0;
    const qBack = this.queues.get(RequestPriority.BACKGROUND)?.length ?? 0;

    return {
      activeConcurrency: this.aimdGate.getActiveCount(),
      maxConcurrencyLimit: this.aimdGate.getMaxLimit(),
      currentAimdLimit: this.aimdGate.getCurrentLimit(),
      rpmTokensAvailable: this.rpmBucket.getAvailable(),
      tpmTokensAvailable: this.tpmBucket.getAvailable(),
      queueDepth: {
        critical: qCrit,
        interactive: qInter,
        background: qBack,
        total: qCrit + qInter + qBack,
      },
      totalDispatched: this.totalDispatchedCount,
      totalThrottled: this.totalThrottledCount,
      totalRetried: this.totalRetriedCount,
      totalTokensProcessed: this.totalTokensProcessed,
    };
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
    // Reject remaining queued items
    for (const [_priority, queue] of this.queues.entries()) {
      while (queue.length > 0) {
        const item = queue.shift()!;
        item.reject(new Error('Scheduler destroyed'));
      }
    }
  }
}
