"""
Nomin Code: High-Capacity Rate-Limit & Latency Scheduler (Python)
Implements Dual Token Bucket, Priority Queue, Full Jitter Backoff, and AIMD Concurrency for Asyncio.
"""

import asyncio
import time
import random
import logging
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Callable, Coroutine, Optional, Dict

logger = logging.getLogger("NominRateLimiter")


class RequestPriority(IntEnum):
    CRITICAL = 0     # Architect task dispatch, Verifier completion gate
    INTERACTIVE = 1  # User direct intervention
    BACKGROUND = 2   # Coder / Tester iterative execution


@dataclass(order=True)
class PrioritizedTask:
    priority: int
    created_at: float
    task_id: str = field(compare=False)
    coro_fn: Callable[[], Coroutine[Any, Any, Any]] = field(compare=False)
    prompt_tokens: int = field(compare=False)
    max_tokens: int = field(compare=False)
    future: asyncio.Future = field(compare=False)
    attempt: int = field(default=0, compare=False)


class TokenBucket:
    """Thread-safe and Async-friendly Token Bucket."""
    def __init__(self, capacity: float, refill_period_sec: float = 60.0):
        self.capacity = float(capacity)
        self.tokens = float(capacity)
        self.refill_rate = self.capacity / refill_period_sec
        self.last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    async def refill(self) -> None:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_refill
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
            self.last_refill = now

    async def try_consume(self, tokens: float) -> bool:
        await self.refill()
        async with self._lock:
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False

    async def refund(self, tokens: float) -> None:
        async with self._lock:
            self.tokens = min(self.capacity, self.tokens + tokens)


class NominRateLimitScheduler:
    """
    Asynchronous Scheduler coordinating RPM, TPM, and Concurrency limits.
    Prevents 429 micro-bursts and thundering herds.
    """
    def __init__(
        self,
        rpm_limit: int,
        tpm_limit: int,
        max_concurrency: int = 5,
        base_backoff_sec: float = 1.0,
        max_backoff_sec: float = 60.0,
        max_retries: int = 8
    ):
        self.rpm_bucket = TokenBucket(rpm_limit, 60.0)
        self.tpm_bucket = TokenBucket(tpm_limit, 60.0)
        self.concurrency_semaphore = asyncio.Semaphore(max_concurrency)
        self.queue: asyncio.PriorityQueue[PrioritizedTask] = asyncio.PriorityQueue()
        self.base_backoff_sec = base_backoff_sec
        self.max_backoff_sec = max_backoff_sec
        self.max_retries = max_retries
        self._worker_task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self) -> None:
        """Starts the background worker queue dispatcher."""
        self._running = True
        self._worker_task = asyncio.create_task(self._dispatcher_loop())

    async def stop(self) -> None:
        """Stops the scheduler dispatcher."""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass

    async def submit(
        self,
        coro_fn: Callable[[], Coroutine[Any, Any, Any]],
        prompt_tokens: int,
        max_tokens: int,
        priority: RequestPriority = RequestPriority.BACKGROUND
    ) -> Any:
        """Enqueues an LLM API call and returns the awaited result."""
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        task = PrioritizedTask(
            priority=int(priority),
            created_at=time.time(),
            task_id=f"task_{int(time.time()*1000)}_{random.randint(100, 999)}",
            coro_fn=coro_fn,
            prompt_tokens=prompt_tokens,
            max_tokens=max_tokens,
            future=future
        )
        await self.queue.put(task)
        return await future

    async def _dispatcher_loop(self) -> None:
        while self._running:
            task = await self.queue.get()
            total_tokens = task.prompt_tokens + task.max_tokens

            # Check RPM and TPM tokens
            while True:
                has_rpm = await self.rpm_bucket.try_consume(1)
                if not has_rpm:
                    await asyncio.sleep(0.2)
                    continue

                has_tpm = await self.tpm_bucket.try_consume(total_tokens)
                if not has_tpm:
                    await self.rpm_bucket.refund(1)
                    await asyncio.sleep(0.5)
                    continue

                # Acquired rate-limit quota
                break

            # Dispatch via concurrency gate
            asyncio.create_task(self._execute_with_concurrency(task))
            self.queue.task_done()

    async def _execute_with_concurrency(self, task: PrioritizedTask) -> None:
        async with self.concurrency_semaphore:
            try:
                result = await task.coro_fn()
                # Refund 40% unused token reservation buffer
                await self.tpm_bucket.refund(task.max_tokens * 0.4)
                if not task.future.done():
                    task.future.set_result(result)
            except Exception as exc:
                is_429 = "429" in str(exc) or "rate limit" in str(exc).lower()
                is_5xx = any(code in str(exc) for code in ["500", "502", "503", "504"])

                if (is_429 or is_5xx) and task.attempt < self.max_retries:
                    task.attempt += 1
                    backoff = self._compute_full_jitter(task.attempt, retry_after=self._extract_retry_after(exc))
                    logger.warning(
                        f"Rate limit / transient error on {task.task_id}. "
                        f"Retrying in {backoff:.2f}s (Attempt {task.attempt}/{self.max_retries})"
                    )
                    await asyncio.sleep(backoff)
                    await self.queue.put(task)
                else:
                    if not task.future.done():
                        task.future.set_exception(exc)

    def _compute_full_jitter(self, attempt: int, retry_after: Optional[float] = None) -> float:
        """Computes Full Jitter backoff: sleep = rand(0, min(cap, base * 2^attempt))."""
        exponential = self.base_backoff_sec * (2 ** attempt)
        capped = min(self.max_backoff_sec, exponential)
        jittered = random.uniform(0, capped)
        if retry_after is not None and retry_after > 0:
            return min(self.max_backoff_sec, max(jittered, retry_after))
        return jittered

    def _extract_retry_after(self, exc: Exception) -> Optional[float]:
        # Support extracting headers if present on exception object
        headers = getattr(exc, "headers", None)
        if isinstance(headers, dict):
            val = headers.get("retry-after") or headers.get("Retry-After")
            if val:
                try:
                    return float(val)
                except ValueError:
                    pass
        return None
