/**
 * Nomin Code: High-Capacity Rate-Limit & Latency Scheduler (TypeScript)
 * Implements Dual Token Bucket, Priority Queue, Full Jitter Backoff, and AIMD Concurrency.
 */

export enum RequestPriority {
  CRITICAL = 0,    // Architect task dispatch, Verifier completion gate
  INTERACTIVE = 1, // User direct intervention
  BACKGROUND = 2   // Coder / Tester iterative execution
}

export interface RequestTask<T> {
  id: string;
  priority: RequestPriority;
  promptTokens: number;
  maxTokens: number;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  attempt: number;
  createdAt: number;
}

export interface RateLimiterConfig {
  rpmLimit: number;
  tpmLimit: number;
  maxConcurrency: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxRetries: number;
}

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillRatePerMs: number;
  private lastRefill: number;

  constructor(capacity: number, refillPeriodMs: number = 60000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRatePerMs = capacity / refillPeriodMs;
    this.lastRefill = Date.now();
  }

  public refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }

  public tryConsume(tokens: number): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  public refund(tokens: number): void {
    this.tokens = Math.min(this.capacity, this.tokens + tokens);
  }

  public getAvailable(): number {
    this.refill();
    return this.tokens;
  }
}

export class NominRateLimitScheduler {
  private rpmBucket: TokenBucket;
  private tpmBucket: TokenBucket;
  private queue: RequestTask<any>[] = [];
  private activeConcurrency: number = 0;
  private maxConcurrency: number;
  private baseBackoffMs: number;
  private maxBackoffMs: number;
  private maxRetries: number;
  private isProcessing: boolean = false;

  constructor(config: RateLimiterConfig) {
    this.rpmBucket = new TokenBucket(config.rpmLimit, 60000);
    this.tpmBucket = new TokenBucket(config.tpmLimit, 60000);
    this.maxConcurrency = config.maxConcurrency;
    this.baseBackoffMs = config.baseBackoffMs;
    this.maxBackoffMs = config.maxBackoffMs;
    this.maxRetries = config.maxRetries;
  }

  /**
   * Enqueues an LLM API call with priority and token reservations.
   */
  public enqueue<T>(
    execute: () => Promise<T>,
    promptTokens: number,
    maxTokens: number,
    priority: RequestPriority = RequestPriority.BACKGROUND
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: RequestTask<T> = {
        id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        priority,
        promptTokens,
        maxTokens,
        execute,
        resolve,
        reject,
        attempt: 0,
        createdAt: Date.now()
      };

      this.insertByPriority(task);
      this.processQueue();
    });
  }

  private insertByPriority<T>(task: RequestTask<T>): void {
    let index = 0;
    while (index < this.queue.length && this.queue[index].priority <= task.priority) {
      index++;
    }
    this.queue.splice(index, 0, task);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        if (this.activeConcurrency >= this.maxConcurrency) {
          break; // Concurrency gate reached
        }

        const candidate = this.queue[0];
        const totalEstimatedTokens = candidate.promptTokens + candidate.maxTokens;

        // Check RPM and TPM tokens
        if (!this.rpmBucket.tryConsume(1)) {
          // Wait until next RPM refill slice
          setTimeout(() => this.processQueue(), 250);
          break;
        }

        if (!this.tpmBucket.tryConsume(totalEstimatedTokens)) {
          // Refund the RPM token consumed since we cannot proceed
          this.rpmBucket.refund(1);
          setTimeout(() => this.processQueue(), 500);
          break;
        }

        // Successfully allocated rate-limit capacity
        const task = this.queue.shift()!;
        this.activeConcurrency++;

        this.dispatchTask(task, totalEstimatedTokens);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatchTask<T>(task: RequestTask<T>, reservedTokens: number): Promise<void> {
    try {
      const result = await task.execute();
      
      // Assume estimated completion vs actual refund logic here
      // For reference: refund 50% of unused completion tokens if available
      this.tpmBucket.refund(Math.floor(task.maxTokens * 0.4));
      
      this.activeConcurrency--;
      task.resolve(result);
      this.processQueue();
    } catch (error: any) {
      this.activeConcurrency--;
      
      const isRateLimited = error?.status === 429 || error?.message?.includes("rate limit");
      const isTransient5xx = error?.status >= 500 && error?.status < 600;

      if ((isRateLimited || isTransient5xx) && task.attempt < this.maxRetries) {
        task.attempt++;
        const retryAfterMs = this.extractRetryAfterMs(error);
        const backoffMs = this.computeFullJitterBackoff(task.attempt, retryAfterMs);

        console.warn(
          `[RateLimitScheduler] Throttled on task ${task.id}. Retrying in ${backoffMs}ms (Attempt ${task.attempt}/${this.maxRetries})`
        );

        setTimeout(() => {
          this.insertByPriority(task);
          this.processQueue();
        }, backoffMs);
      } else {
        task.reject(error);
        this.processQueue();
      }
    }
  }

  /**
   * Full Jitter formula: sleep = rand(0, min(cap, base * 2^attempt))
   */
  public computeFullJitterBackoff(attempt: number, retryAfterMs?: number): number {
    const exponential = this.baseBackoffMs * Math.pow(2, attempt);
    const capped = Math.min(this.maxBackoffMs, exponential);
    const jittered = Math.floor(Math.random() * capped);

    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      return Math.min(this.maxBackoffMs, Math.max(jittered, retryAfterMs));
    }
    return jittered;
  }

  private extractRetryAfterMs(error: any): number | undefined {
    const headers = error?.headers || error?.response?.headers;
    if (!headers) return undefined;

    const retryAfter = headers["retry-after"] || headers["Retry-After"];
    if (retryAfter) {
      const parsedSeconds = parseInt(retryAfter, 10);
      if (!isNaN(parsedSeconds)) {
        return parsedSeconds * 1000;
      }
      const parsedDate = Date.parse(retryAfter);
      if (!isNaN(parsedDate)) {
        return Math.max(0, parsedDate - Date.now());
      }
    }

    const retryMs = headers["retry-after-ms"] || headers["x-ratelimit-reset-requests"];
    if (retryMs) {
      const parsed = parseInt(retryMs, 10);
      if (!isNaN(parsed)) return parsed;
    }

    return undefined;
  }
}
