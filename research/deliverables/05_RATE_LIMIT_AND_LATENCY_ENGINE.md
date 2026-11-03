# Rate-Limit & Latency Runtime: Full Capacity Saturation Engine

> **Engineering Objective**: Maximize throughput across any LLM provider (NVIDIA NIM, OpenAI-compatible, Anthropic, vLLM) by operating at 98–100% of allowed RPM, TPM, and concurrency quotas without triggering catastrophic 429 thrashing, while driving Time-To-First-Token (TTFT) and total task completion latency to physical limits.

---

## 1. Mathematical Design of the Scheduler

Operating at maximum provider capacity requires coordinating three independent constraint dimensions:
1. **Request Rate (RPM)**: Bounded by provider request quotas over a 60-second rolling window.
2. **Token Rate (TPM)**: Bounded by prompt tokens + maximum allowed completion tokens.
3. **Concurrency ($C$)**: Active concurrent HTTP connections accepted by the endpoint before TCP drops or HTTP 429 rejections occur.

```mermaid
flowchart LR
    AgentTask[Agent Request (Role: Architect/Coder/Tester)] --> PQueue[Prioritized Request Queue\n(CRITICAL > INTERACTIVE > BACKGROUND)]
    
    subgraph Rate-Limit Governor
        PQueue --> TokenBucketReq[RPM Token Bucket\n(Tokens = Requests)]
        TokenBucketReq --> TokenBucketTokens[TPM Token Bucket\n(Tokens = Prompt + Reserve)]
        TokenBucketTokens --> LeakyBucket[Leaky Bucket Shaper\n(Smooths Micro-Spikes)]
        LeakyBucket --> AIMDConcurrency[AIMD Concurrency Gate\n(Active Slots: C_active <= C_max)]
    end
    
    AIMDConcurrency --> HTTPDispatcher[HTTP/2 Connection Pool\n(Keep-Alive + Speculative SSE)]
    HTTPDispatcher --> NIMEndpoint[NVIDIA NIM / LLM API]
    
    NIMEndpoint -->|HTTP 429 / Retry-After| FeedbackEngine[Adaptive Feedback Controller]
    FeedbackEngine -->|Backoff & Jitter| AIMDConcurrency
    FeedbackEngine -->|Refill Rate Penalty| TokenBucketTokens
```

### 1.1 Dual Token Bucket + Leaky Bucket Formulation
The scheduler maintains two discrete token buckets per provider/key pair:
- **RPM Bucket ($B_{req}$)**:
  $$\text{capacity} = \text{RPM}_{\max}, \quad \text{refill\_rate} = \frac{\text{RPM}_{\max}}{60} \text{ req/sec}$$
- **TPM Bucket ($B_{tok}$)**:
  $$\text{capacity} = \text{TPM}_{\max}, \quad \text{refill\_rate} = \frac{\text{TPM}_{\max}}{60} \text{ tokens/sec}$$
- **Reservation Protocol**:
  When request $R_i$ arrives with prompt length $P_i$ and requested `max_tokens` $M_i$:
  1. The scheduler reserves $P_i + \min(M_i, \text{EstimatedCompletion})$ tokens from $B_{tok}$.
  2. If insufficient tokens are available, $R_i$ sleeps in the priority queue until refill accumulates.
  3. Upon stream completion, any unused tokens from the reservation are immediately refunded to $B_{tok}$.

### 1.2 Leaky Bucket Shaper
To avoid bursting 15 requests in the first second of a minute and getting throttled by upstream edge firewalls (Cloudflare / Akamai / NVIDIA API Gateway), a **Leaky Bucket** regulates request dispatch:
$$\Delta t_{\min} = \frac{60}{\text{RPM}_{\max}} \times 0.85$$
Ensuring requests are evenly spaced across the time window.

### 1.3 Additive Increase / Multiplicative Decrease (AIMD) Concurrency
Similar to TCP congestion control, the active concurrency cap $C$ is adjusted dynamically:
- **On Success**: $C \leftarrow \min(C + 1, C_{\max})$ after every $K$ successful completions.
- **On HTTP 429 or Throttling**:
  $$C \leftarrow \max(1, \lfloor C \times 0.5 \rfloor)$$

---

## 2. Retry Logic: Full Jitter Exponential Backoff

When a 429 or 503 error occurs, standard fixed or simple exponential backoff leads to **thundering herd** re-collisions. Nomin Code implements **Full Jitter Exponential Backoff**, mathematically proven by AWS and Effect-TS to minimize queue contention:

$$t_{\text{sleep}} = \text{random}\left(0, \, \min\left(T_{\text{ceiling}}, \, T_{\text{base}} \times 2^{\text{attempt}}\right)\right)$$

### 2.1 Provider Header Parsing
The scheduler inspects response headers before computing backoff:
1. `Retry-After` (integer seconds or HTTP-date).
2. `x-ratelimit-reset-requests` or `x-ratelimit-reset-tokens`.
3. `retry-after-ms`.
4. If a header specifies a delay $T_{\text{header}}$, the actual sleep is:
   $$t_{\text{actual}} = \min\left(T_{\text{ceiling}}, \, \max(t_{\text{sleep}}, \, T_{\text{header}})\right)$$
   Bounded by `RETRY_AFTER_MAX = 15 minutes` (derived from OpenCode's `model-retry.ts`) to prevent broken servers from locking an agent indefinitely.

---

## 3. NVIDIA NIM Specifics & Operational Quirks

When deploying Nomin Code against **NVIDIA NIM** (hosted at `integrate.api.nvidia.com` or self-hosted via TensorRT-LLM/vLLM containers):

| Model Name on NIM | Context Window | Native Tool Calling | Reasoning Tokens / CoT | Optimal Agent Role |
| :--- | :--- | :--- | :--- | :--- |
| `deepseek-ai/deepseek-r1` | 128,000 | Inferred via CoT / JSON | Native `<think>` tags streamed in delta | Lead Architect & Verifier Gate |
| `deepseek-ai/deepseek-v3` | 128,000 | Native Function Calling | Fast token generation | Implementation Coder |
| `qwen/qwen2.5-coder-32b-instruct`| 32,768 | Native Function Calling | High-precision FIM & syntax | Implementation Coder & Tester |
| `meta/llama-3.3-70b-instruct` | 128,000 | Native Function Calling | Strong structured JSON compliance | Lead Architect & Reviewer |
| `meta/llama-3.1-8b-instruct` | 128,000 | Native Function Calling | Ultra-low TTFT (~150ms) | Fast Tester & Linter Observer |

### NIM Throttling Headers & Quirks
- **Error Status**: NIM returns `HTTP 429 Too Many Requests` on both RPM and TPM exhaustion.
- **Key Header**: Returns `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, and `retry-after`.
- **Reasoning Stream Quirk**: On `deepseek-ai/deepseek-r1`, reasoning tokens are delivered inside `delta.reasoning_content` (or `<think>` chunks) rather than standard `delta.content`. The Nomin Code stream parser separates reasoning tokens from code blocks so that reasoning is replayed to the model but omitted from production files.

---

## 4. Latency Engineering: Pushing Limits

1. **Speculative Tool-Call Execution**:
   - The stream parser monitors incoming tokens for tool-call JSON chunks (`input_json_delta`).
   - If the tool is a read-only idempotent operation (e.g., `read_file` or `grep`), execution begins *before the LLM closes the JSON block*, pre-fetching file contents so results are ready instantaneously upon turn end.
2. **KV-Cache Optimization & Prompt Ordering**:
   - High-cache-hit structure: Fixed System Prompt $\to$ Repository Skeleton $\to$ Historical Context $\to$ Volatile User Turn.
   - Preserves identical prefix bytes across turns, achieving up to 90% prompt cache read hits on DeepSeek and Claude.
3. **HTTP/2 Connection Multiplexing**:
   - Reuses warm TCP and TLS sessions across all 4+ agents, eliminating 200–300ms handshakes per turn.
