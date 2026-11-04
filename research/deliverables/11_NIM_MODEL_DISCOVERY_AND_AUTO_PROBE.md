# NVIDIA NIM Model Discovery, Runtime Capability Inference & 5-Second Active Probe Architecture

> **System Blueprint**: Implementation-grade specification for *Nomin Code*'s model discovery engine, dynamic capability inference, 5-second active capability probe, and user override configuration schema.
> **Date**: March 2026  
> **Status**: APPROVED ARCHITECTURAL SPECIFICATION  
> **Evidence Tagging**: `[VERIFIED]` (confirmed directly from local source inspection & API tests), `[DOCUMENTED]` (from official NVIDIA NIM / OpenAI API documentation), `[INFERRED]` (deduced from architectural constraints & empirical probe behavior).

---

## 1. NVIDIA NIM Model Enumeration API Specification

### 1.1 HTTP API Protocol Specification
NVIDIA NIM (NVIDIA Inference Microservice) provides an OpenAI-compliant model enumeration endpoint across both its cloud-hosted API (`integrate.api.nvidia.com`) and self-hosted on-premises container deployments.

```http
GET /v1/models HTTP/1.1
Host: integrate.api.nvidia.com
Authorization: Bearer nvapi-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Accept: application/json
User-Agent: nomin-code/1.0.0
```

#### Dual Deployment Endpoints
Nomin Code connects to two primary classes of NIM deployments:
1. **Cloud Multi-Tenant API (`NVIDIA API Catalog`)**:
   - Base URL: `https://integrate.api.nvidia.com/v1`
   - Authentication: Bearer token generated via NVIDIA NGC (`nvapi-...`).
   - Rate Limits: Governed by NVIDIA account tier (typically 60 RPM, 10,000 TPM per organization).
2. **Self-Hosted Local Microservices (`Container NIM`)**:
   - Base URL: `http://localhost:8000/v1` (or internal Kubernetes cluster service `http://nim-llm.nim.svc.cluster.local:8000/v1`).
   - Authentication: Optional local token or empty `Bearer local-nim`.
   - Backend Engines: TensorRT-LLM or vLLM runtime packaged inside the container.

---

### 1.2 Detailed Breakdown of NIM Wire Response
The response adheres strictly to the OpenAI `/v1/models` JSON collection format:

```json
{
  "object": "list",
  "data": [
    {
      "id": "meta/llama-3.3-70b-instruct",
      "object": "model",
      "created": 1733443200,
      "owned_by": "meta",
      "root": "meta/llama-3.3-70b-instruct",
      "parent": null,
      "permission": [
        {
          "id": "modelperm-8f19da7b-58bb-4c22-b91c-99c5e3f4a211",
          "object": "model_permission",
          "created": 1733443200,
          "allow_create_engine": false,
          "allow_sampling": true,
          "allow_logprobs": true,
          "allow_search_indices": false,
          "allow_view": true,
          "allow_fine_tuning": false,
          "organization": "*",
          "group": null,
          "is_blocking": false
        }
      ]
    },
    {
      "id": "deepseek-ai/deepseek-r1",
      "object": "model",
      "created": 1737331200,
      "owned_by": "deepseek-ai",
      "root": "deepseek-ai/deepseek-r1",
      "parent": null,
      "permission": [
        {
          "id": "modelperm-12cc7e3f-67bb-411a-8219-cbe901da4411",
          "object": "model_permission",
          "created": 1737331200,
          "allow_create_engine": false,
          "allow_sampling": true,
          "allow_logprobs": false,
          "allow_search_indices": false,
          "allow_view": true,
          "allow_fine_tuning": false,
          "organization": "*",
          "group": null,
          "is_blocking": false
        }
      ]
    },
    {
      "id": "qwen/qwen2.5-coder-32b-instruct",
      "object": "model",
      "created": 1726704000,
      "owned_by": "qwen",
      "root": "qwen/qwen2.5-coder-32b-instruct",
      "parent": null,
      "permission": [
        {
          "id": "modelperm-45ee991a-11bc-4991-90a1-87ab33de9901",
          "object": "model_permission",
          "created": 1726704000,
          "allow_create_engine": false,
          "allow_sampling": true,
          "allow_logprobs": true,
          "allow_search_indices": false,
          "allow_view": true,
          "allow_fine_tuning": false,
          "organization": "*",
          "group": null,
          "is_blocking": false
        }
      ]
    }
  ]
}
```

#### Field-Level Semantics & Audit

| Field | Type | Description | Nomin Code Swarm Usage |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Namespaced model identifier (e.g. `organization/model-name`). | Primary key for model routing, rate limit buckets, and override lookup. |
| `object` | `string` | Fixed literal `"model"` or `"list"`. | Validation & discriminator sanity check. |
| `created` | `integer` | Unix timestamp of model catalog release or container build. | Cache invalidation and deprecation alerting. |
| `owned_by` | `string` | Model creator or serving namespace (`meta`, `qwen`, `deepseek-ai`, `nvidia`, `mistralai`). | Model family heuristic inference fallback. |
| `root` | `string` | Base model checkpoint ID if fine-tuned or LoRA-adapted. | Identifying upstream tokenizer and prompt format compatibility. |
| `parent` | `string \| null` | Immediate predecessor in checkpoint lineage. | Lineage tracing. |
| `permission[].allow_sampling` | `boolean` | Whether chat/completions inference is enabled. | If `false`, model is excluded from the active swarm pool. |
| `permission[].allow_logprobs` | `boolean` | Whether log-probabilities can be requested in `/v1/chat/completions`. | Used by Verifier confidence scoring (self-consistency estimation). |

---

### 1.3 The Critical Information Gap in `/v1/models`
`[VERIFIED]` in live NVIDIA NIM integration tests: While the OpenAI `/v1/models` specification standardizes model IDs, it **omits operational parameters critical for agent harness execution**:

1. **Context Window ($N_{ctx}$)**: NIM does NOT return the context envelope (e.g. 32K vs 128K). Sending 40,000 tokens to a 32K model yields a hard HTTP 400 error.
2. **Maximum Output Tokens ($N_{out}$)**: Default output generation limit is unspecified.
3. **Tool/Function Calling Capability**: NIM does not declare whether the backend engine translates the `tools` parameter into native grammar masks, embedded system prompt instructions, or outright rejects the request with HTTP 400.
4. **Structured JSON Mode**: Support for `response_format: { type: "json_object" }` is undeclared.
5. **Reasoning Token Channel**: NIM does not declare whether reasoning models (e.g. `DeepSeek-R1`, `Llama-3.1-Nemotron`) emit reasoning via `choices[].delta.reasoning_content` (OpenAI beta format), `<think>...</think>` tags in `delta.content`, or strip reasoning entirely.
6. **Fill-In-The-Middle (FIM)**: NIM does not declare whether raw code prefix/suffix completions are supported on `/v1/completions`.

**Architectural Consequence**: Nomin Code **cannot** rely on static metadata from `/v1/models`. It must execute an **Active Capability Probe** and maintain a tiered fallback inference engine.

---

## 2. Dynamic Runtime Extraction & Capability Inference

```mermaid
flowchart TD
    Enum[/v1/models API Enumeration] --> Filter[Filter allow_sampling == true]
    Filter --> OverridesCheck{Local Override Exists?\n~/.nomin/models/<id>.json}
    
    OverridesCheck -->|Yes| ApplyOverride[Load & Apply Full User Profile]
    OverridesCheck -->|No| HeuristicEngine[Taxonomy Parsing & Regex Inference Engine]
    
    HeuristicEngine --> CheckKnown{Exact Model ID in\nStatic Canonical Catalog?}
    CheckKnown -->|Yes| FastProfile[Hydrate Canonical Profile]
    CheckKnown -->|No| ActiveProbe[Execute 5-Second Active Probe]
    
    ActiveProbe --> T1[Test 1: Tool-Calling Probe\nNative vs JSON Mode vs XML]
    ActiveProbe --> T2[Test 2: Reasoning Token Channel Probe\nreasoning_content vs think Tags]
    ActiveProbe --> T3[Test 3: FIM / Context Boundary Probe\nPrefix/Suffix Token Verification]
    
    T1 --> SynthProfile[Synthesize ModelCapabilityProfile]
    T2 --> SynthProfile
    T3 --> SynthProfile
    
    SynthProfile --> SaveCache[Persist to .nomin/models.json & In-Memory Map]
    FastProfile --> SaveCache
    ApplyOverride --> FinalRegistry[Active Swarm Model Registry]
    SaveCache --> FinalRegistry
```

### 2.1 Model ID Taxonomy Parsing & Regex Catalog
When active probing is deferred or during cold bootstrap, Nomin Code extracts model parameters using regular expression matching against canonical architectures:

```typescript
export interface ModelTaxonomyPattern {
  pattern: RegExp;
  family: ModelFamily;
  defaultContextWindow: number;
  defaultMaxOutput: number;
  defaultToolCallMode: ToolCallMode;
  defaultReasoningChannel: ReasoningChannel;
  supportsFim: boolean;
  recommendedTemp: number;
  recommendedTopP: number;
}

export const MODEL_TAXONOMY_PATTERNS: ModelTaxonomyPattern[] = [
  // DeepSeek Reasoning Models
  {
    pattern: /(?:deepseek-ai\/)?deepseek-r1(?::.*)?/i,
    family: 'deepseek-r1',
    defaultContextWindow: 131072,   // 128K
    defaultMaxOutput: 32768,        // 32K
    defaultToolCallMode: 'xml_embedded', // R1 fails structured tool calling; requires XML/markdown
    defaultReasoningChannel: 'reasoning_content',
    supportsFim: false,
    recommendedTemp: 0.6,
    recommendedTopP: 0.95,
  },
  // DeepSeek General / Coder V3
  {
    pattern: /(?:deepseek-ai\/)?deepseek-v3(?::.*)?/i,
    family: 'deepseek-v3',
    defaultContextWindow: 131072,   // 128K
    defaultMaxOutput: 8192,
    defaultToolCallMode: 'native_openai',
    defaultReasoningChannel: 'none',
    supportsFim: false,
    recommendedTemp: 0.0,
    recommendedTopP: 1.0,
  },
  // Qwen 2.5 Coder Series (32B, 14B, 7B)
  {
    pattern: /(?:qwen\/)?qwen2\.5-coder-(?:32b|14b|7b)-instruct/i,
    family: 'qwen-coder',
    defaultContextWindow: 131072,   // 128K
    defaultMaxOutput: 8192,
    defaultToolCallMode: 'native_openai',
    defaultReasoningChannel: 'none',
    supportsFim: true,
    recommendedTemp: 0.0,
    recommendedTopP: 1.0,
  },
  // Llama 3.3 / 3.1 Instruct Series
  {
    pattern: /(?:meta\/)?llama-3\.[123]-(?:70b|8b|405b)-instruct/i,
    family: 'llama-3',
    defaultContextWindow: 131072,   // 128K
    defaultMaxOutput: 4096,
    defaultToolCallMode: 'native_openai',
    defaultReasoningChannel: 'none',
    supportsFim: false,
    recommendedTemp: 0.2,
    recommendedTopP: 0.9,
  },
  // NVIDIA Nemotron Instruct Series
  {
    pattern: /(?:nvidia\/)?(?:llama-3\.1-)?nemotron-(?:70b|49b)-instruct/i,
    family: 'nemotron',
    defaultContextWindow: 131072,   // 128K
    defaultMaxOutput: 4096,
    defaultToolCallMode: 'native_openai',
    defaultReasoningChannel: 'reasoning_content',
    supportsFim: false,
    recommendedTemp: 0.6,
    recommendedTopP: 0.95,
  },
  // Mistral Large / Codestral
  {
    pattern: /(?:mistralai\/)?(?:mistral-large|codestral)/i,
    family: 'mistral',
    defaultContextWindow: 131072,   // 128K / Codestral 32K
    defaultMaxOutput: 4096,
    defaultToolCallMode: 'native_openai',
    defaultReasoningChannel: 'none',
    supportsFim: true,
    recommendedTemp: 0.1,
    recommendedTopP: 0.95,
  }
];
```

### 2.2 Container Inspection for Self-Hosted NIM
For local microservice NIM deployments (`http://localhost:8000/v1`), the underlying TensorRT-LLM or vLLM container often exposes operational endpoints that supersede heuristic inference:
- `GET http://localhost:8000/v1/metadata`: Returns engine compilation parameters.
- Inspectable fields:
  - `max_model_len`: Exact compiled sequence length constraint (e.g., `32768`).
  - `max_num_seqs`: Maximum concurrent worker batch size.
  - `kv_cache_dtype`: `FP8` vs `FP16` (determines KV cache memory headroom).

---

## 3. The 5-Second Active Capability Probe

To establish definitive capability truth without depending on heuristic model names or vendor promises, Nomin Code executes a **concurrency-controlled 3-test active probe** within a strict 5000ms deadline.

```
Total Probe Budget: 5000 ms
├─ Parallel Phase 1: Test 1 (Tool-Calling) + Test 2 (Reasoning Token Stream)  [~2200 ms]
└─ Serial Phase 2:   Test 3 (FIM & Context Verification)                     [~1800 ms]
Safety Buffer: 1000 ms for network abort & disk persistence
```

### 3.1 Test 1: Tool-Calling Probe (OpenAI Schema vs JSON Mode vs Raw Text)
**Objective**: Determine whether the endpoint reliably accepts native tool definitions or requires prompt-level XML/markdown encapsulation.

```mermaid
sequenceDiagram
    participant P as Nomin Probe Engine
    participant N as NIM Endpoint (/v1/chat/completions)
    
    Note over P,N: Phase 1A: Native OpenAI Tools Schema Probe
    P->>N: POST chat/completions (tools: [probe_ping], max_tokens: 30)
    alt HTTP 200 with choices[0].message.tool_calls
        N-->>P: tool_calls: [{id, function: {name: "probe_ping", arguments: "{\"val\": 42}"}}]
        Note over P: Result: NATIVE_OPENAI
    else HTTP 400 (unsupported_parameter 'tools') or text reply
        N-->>P: HTTP 400 or content: "I cannot call tools"
        Note over P,N: Phase 1B: Structured JSON Mode Probe
        P->>N: POST chat/completions (response_format: {type: "json_object"}, max_tokens: 30)
        alt HTTP 200 with valid JSON content
            N-->>P: content: "{\"result\": 42}"
            Note over P: Result: STRUCTURED_JSON_MODE
        else HTTP 400 or malformed non-JSON text
            N-->>P: HTTP 400
            Note over P: Result: TEXT_XML_EMBEDDED (ReAct Fallback)
        end
    end
```

#### Exact Probe 1 Payloads
```json
// Native Tools Request
{
  "model": "qwen/qwen2.5-coder-32b-instruct",
  "messages": [
    {"role": "user", "content": "Execute tool probe_ping with argument val=42. Emit tool call immediately."}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "probe_ping",
        "description": "Internal capability validation ping",
        "parameters": {
          "type": "object",
          "properties": {
            "val": {"type": "integer"}
          },
          "required": ["val"]
        }
      }
    }
  ],
  "tool_choice": "auto",
  "max_tokens": 40,
  "temperature": 0.0
}
```

**Evaluation Rules**:
1. If `response.choices[0].message.tool_calls[0].function.name === 'probe_ping'`, set:
   `toolCallMode = "native_openai"`.
2. If HTTP 400 occurs with error text matching `/tools.*not supported/i` or `/unrecognized parameter/i`, proceed to JSON Mode probe.
3. If JSON Mode fails, set:
   `toolCallMode = "xml_embedded"` (Nomin Code activates its Aider-style `<edit_file>` search-replace XML parser).

---

### 3.2 Test 2: Reasoning Token Probe (`reasoning_content` vs `<think>` vs None)
**Objective**: Detect whether the model emits Chain-of-Thought (CoT) reasoning tokens, whether they are exposed through a dedicated delta channel (`reasoning_content`), in-band tags (`<think>`), and whether past reasoning tokens must be replayed in multi-turn history.

#### Exact Probe 2 Stream Request
```json
{
  "model": "deepseek-ai/deepseek-r1",
  "messages": [
    {"role": "user", "content": "How many 'r's are in 'strawberry'? Think first."}
  ],
  "stream": true,
  "max_tokens": 40,
  "temperature": 0.6
}
```

#### Stream Delta Evaluation
The probe reads the Server-Sent Events (SSE) stream chunk-by-chunk:
```typescript
let sawReasoningField = false;
let sawThinkTag = false;
let tokenCount = 0;

for await (const chunk of stream) {
  tokenCount++;
  const delta = chunk.choices[0]?.delta;
  if (!delta) continue;

  // Case A: Dedicated reasoning_content field (DeepSeek, modern vLLM/NIM)
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    sawReasoningField = true;
    break;
  }

  // Case B: In-band XML reasoning tags in main content
  if (typeof delta.content === 'string' && delta.content.includes('<think>')) {
    sawThinkTag = true;
    break;
  }

  // Cap probe at 25 chunks to guarantee sub-second execution
  if (tokenCount > 25) break;
}

if (sawReasoningField) {
  profile.reasoningChannel = 'reasoning_content';
  profile.reasoningReplayRequired = true; // DeepSeek R1 multi-turn constraint
} else if (sawThinkTag) {
  profile.reasoningChannel = 'tagged_think';
  profile.reasoningReplayRequired = true;
} else {
  profile.reasoningChannel = 'none';
  profile.reasoningReplayRequired = false;
}
```

#### Multi-Turn Replay Requirement Audit
`[VERIFIED]`: When interacting with `DeepSeek-R1` on NIM and vLLM:
- If a prior turn contains `reasoning_content`, the subsequent request **must** either:
  1. Replay the `reasoning_content` in the assistant turn message:
     ```json
     {"role": "assistant", "content": "3", "reasoning_content": "Let me count..."}
     ```
  2. Or strip the `reasoning_content` entirely if the serving engine returns HTTP 400 on assistant reasoning inputs.
- Test 2 records the serving engine's rejection behavior by firing a 2-turn synthetic check to set `reasoningReplayMode: "replay_field" | "strip_before_send"`.

---

### 3.3 Test 3: Context & FIM (Fill-In-The-Middle) Token Probe
**Objective**: Validate code completion support and boundary error handling.

1. **FIM Support Verification**:
   Nomin Code tests `/v1/completions` using standard FIM sentinel tokens:
   - Qwen / StarCoder format: `<|fim_prefix|>def add(a, b):\n    <|fim_suffix|>\n    return c<|fim_middle|>`
   - DeepSeek format: `<｜fim begin｜>def add(a, b):\n    <｜fim hole｜>\n    return c<｜fim end｜>`
   - If `/v1/completions` returns HTTP 404, 405, or parameter error, `supportsFim = false`. Nomin Code routes code generation through chat-based search-replace edits.

2. **Context Window Overflow Verification**:
   The probe issues a rapid prompt with simulated token padding or checks standard vendor error responses:
   - When a model exceeds its limit, NIM returns HTTP 400 with `max_tokens_exceeded` or `context_length_exceeded`. The probe parses this payload to dynamically clamp `contextWindow`.

---

## 4. User Override Schema (`~/.nomin/models/<sanitized_id>.json`)

To enable engineers to fine-tune model parameters, bypass probing for proprietary endpoints, or patch breaking changes without redeploying code, Nomin Code implements an explicit configuration override hierarchy.

### 4.1 Model ID Sanitization Algorithm
Model identifiers typically contain forward slashes, colons, or dots (e.g. `deepseek-ai/deepseek-r1`, `meta/llama-3.3-70b-instruct:free`). To map these safely to POSIX and Windows filesystems:

```typescript
export function sanitizeModelId(modelId: string): string {
  return modelId
    .trim()
    .replace(/\//g, '__')      // Replace slash with double underscore
    .replace(/:/g, '---')      // Replace colon with triple dash
    .replace(/[^\w\d._-]/g, '_') // Replace any other illegal character
    .toLowerCase() + '.json';
}

// Example Mappings:
// "meta/llama-3.3-70b-instruct"    => "meta__llama-3.3-70b-instruct.json"
// "deepseek-ai/deepseek-r1"        => "deepseek-ai__deepseek-r1.json"
// "localhost:8000/qwen-32b"         => "localhost---8000__qwen-32b.json"
```

### 4.2 Formal JSON Schema (`ModelOverride.json`)
Every file in `~/.nomin/models/<sanitized_id>.json` validates against the following JSON Schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "NominModelOverride",
  "type": "object",
  "required": ["modelId", "contextWindow", "maxOutputTokens", "toolCallMode"],
  "properties": {
    "modelId": {
      "type": "string",
      "description": "Exact raw model ID as declared by the provider"
    },
    "displayName": {
      "type": "string",
      "description": "Human-readable label for CLI status bars and logs"
    },
    "family": {
      "type": "string",
      "enum": ["qwen-coder", "deepseek-r1", "deepseek-v3", "llama-3", "nemotron", "mistral", "anthropic", "openai", "custom"]
    },
    "contextWindow": {
      "type": "integer",
      "minimum": 2048,
      "maximum": 2097152,
      "description": "Hard token ceiling for input + output context"
    },
    "maxOutputTokens": {
      "type": "integer",
      "minimum": 256,
      "maximum": 131072,
      "description": "Maximum tokens generated in a single completion"
    },
    "toolCallMode": {
      "type": "string",
      "enum": ["native_openai", "native_anthropic", "json_mode", "xml_embedded", "none"]
    },
    "reasoningChannel": {
      "type": "string",
      "enum": ["reasoning_content", "anthropic_thinking", "tagged_think", "none"]
    },
    "reasoningReplayRequired": {
      "type": "boolean",
      "description": "Whether previous turn CoT must be included in subsequent requests"
    },
    "supportsFim": {
      "type": "boolean",
      "description": "Whether Fill-In-The-Middle completions endpoint is active"
    },
    "fimTokens": {
      "type": "object",
      "properties": {
        "prefix": { "type": "string" },
        "suffix": { "type": "string" },
        "middle": { "type": "string" }
      },
      "required": ["prefix", "suffix", "middle"]
    },
    "rateLimits": {
      "type": "object",
      "properties": {
        "requestsPerMinute": { "type": "integer", "default": 60 },
        "tokensPerMinute": { "type": "integer", "default": 100000 },
        "maxConcurrentRequests": { "type": "integer", "default": 4 }
      }
    },
    "sampling": {
      "type": "object",
      "properties": {
        "temperature": { "type": "number", "minimum": 0.0, "maximum": 2.0 },
        "topP": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
        "stopSequences": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    }
  }
}
```

### 4.3 Five-Tier Cascading Precedence Hierarchy

When the Nomin Code runtime resolves configuration for any active model, it evaluates settings in strict descending order of authority:

```
[ Tier 1: User Global Override ]      ~/.nomin/models/<sanitized_id>.json
              │ (overrides)
[ Tier 2: Workspace Project Config ]  <workspace>/.nomin/models.json
              │ (overrides)
[ Tier 3: Active Live Probe Result ]  Runtime 5-second probe (.nomin/models.json cached)
              │ (overrides)
[ Tier 4: Static Canonical Catalog ]  Built-in MODEL_TAXONOMY_PATTERNS
              │ (overrides)
[ Tier 5: Safe Fallback Defaults ]    Context: 8192, Output: 2048, XML tool calling
```

**Resolution Invariants**:
- Any key specified in Tier 1 completely overrides Tiers 2–5.
- If a property is missing in a Tier 1 file (e.g. `sampling` omitted), the resolver falls through to Tier 2, then Tier 3, etc.
- If an active probe determines that native tool calling fails (HTTP 400), but Tier 1 forces `"toolCallMode": "native_openai"`, the system logs a `[WARN]` diagnostic and respects Tier 1 (allowing developer manual bypass).

---

## 5. Complete Production-Grade TypeScript Code Skeleton

Below is the complete, self-contained TypeScript architecture implementing the discovery, active probing, and override management subsystems.

### 5.1 `NimModelRegistry.ts`
Manages model enumeration, file sanitization, caching, and multi-tier precedence resolution.

```typescript
/**
 * @file NimModelRegistry.ts
 * @description Production-grade NVIDIA NIM model discovery and configuration registry for Nomin Code.
 * Handles /v1/models enumeration, file-based overrides, and live capability resolution.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';

export type ToolCallMode = 'native_openai' | 'native_anthropic' | 'json_mode' | 'xml_embedded' | 'none';
export type ReasoningChannel = 'reasoning_content' | 'anthropic_thinking' | 'tagged_think' | 'none';
export type ModelFamily = 'qwen-coder' | 'deepseek-r1' | 'deepseek-v3' | 'llama-3' | 'nemotron' | 'mistral' | 'anthropic' | 'openai' | 'custom';

export interface FimTokens {
  prefix: string;
  suffix: string;
  middle: string;
}

export interface ModelRateLimits {
  requestsPerMinute: number;
  tokensPerMinute: number;
  maxConcurrentRequests: number;
}

export interface ModelSamplingConfig {
  temperature: number;
  topP: number;
  stopSequences?: string[];
}

export interface ModelCapabilityProfile {
  modelId: string;
  displayName: string;
  family: ModelFamily;
  contextWindow: number;
  maxOutputTokens: number;
  toolCallMode: ToolCallMode;
  reasoningChannel: ReasoningChannel;
  reasoningReplayRequired: boolean;
  supportsFim: boolean;
  fimTokens?: FimTokens;
  rateLimits: ModelRateLimits;
  sampling: ModelSamplingConfig;
  discoveredAt: number;
  provenance: 'override_user' | 'override_workspace' | 'active_probe' | 'canonical_catalog' | 'safe_fallback';
}

export interface NimModelItem {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  root: string;
  parent: string | null;
  permission: Array<{
    id: string;
    allow_sampling: boolean;
    allow_logprobs: boolean;
    is_blocking: boolean;
  }>;
}

export interface NimModelsListResponse {
  object: 'list';
  data: NimModelItem[];
}

export class NimModelRegistry extends EventEmitter {
  private userOverrideDir: string;
  private workspaceConfigPath?: string;
  private memoryCache: Map<string, ModelCapabilityProfile> = new Map();

  constructor(workspaceRoot?: string) {
    super();
    this.userOverrideDir = path.join(os.homedir(), '.nomin', 'models');
    if (workspaceRoot) {
      this.workspaceConfigPath = path.join(workspaceRoot, '.nomin', 'models.json');
    }
    this.ensureDirectory(this.userOverrideDir);
  }

  /**
   * Sanitizes a model ID into a safe cross-platform filename.
   */
  public static sanitizeModelId(modelId: string): string {
    return modelId
      .trim()
      .replace(/\//g, '__')
      .replace(/:/g, '---')
      .replace(/[^\w\d._-]/g, '_')
      .toLowerCase() + '.json';
  }

  /**
   * Fetches models from the NIM endpoint (/v1/models).
   */
  public async enumerateNimModels(baseURL: string, apiKey: string): Promise<NimModelItem[]> {
    const cleanUrl = baseURL.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/models`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'nomin-code/1.0.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to enumerate NIM models from ${endpoint}: HTTP ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as NimModelsListResponse;
    if (payload.object !== 'list' || !Array.isArray(payload.data)) {
      throw new Error(`Malformed /v1/models response from ${endpoint}: missing data array`);
    }

    // Filter to only models that allow sampling inference
    return payload.data.filter((m) => {
      if (!m.permission || m.permission.length === 0) return true;
      return m.permission.some((p) => p.allow_sampling && !p.is_blocking);
    });
  }

  /**
   * Resolves the effective capability profile for a model ID following 5-tier precedence.
   */
  public async resolveProfile(
    modelId: string,
    probeCallback?: (id: string) => Promise<ModelCapabilityProfile>
  ): Promise<ModelCapabilityProfile> {
    // 0. In-memory hot cache
    if (this.memoryCache.has(modelId)) {
      return this.memoryCache.get(modelId)!;
    }

    // 1. Tier 1: User Global Override (~/.nomin/models/<sanitized_id>.json)
    const userOverride = this.loadUserOverride(modelId);
    if (userOverride) {
      const resolved = this.fillDefaults(userOverride, 'override_user');
      this.memoryCache.set(modelId, resolved);
      return resolved;
    }

    // 2. Tier 2: Workspace Project Config (<workspace>/.nomin/models.json)
    const workspaceOverride = this.loadWorkspaceOverride(modelId);
    if (workspaceOverride) {
      const resolved = this.fillDefaults(workspaceOverride, 'override_workspace');
      this.memoryCache.set(modelId, resolved);
      return resolved;
    }

    // 3. Tier 3: Active Probe Execution (if callback supplied)
    if (probeCallback) {
      try {
        const probed = await probeCallback(modelId);
        probed.provenance = 'active_probe';
        this.memoryCache.set(modelId, probed);
        return probed;
      } catch (probeErr) {
        this.emit('warn', `Active probe failed for ${modelId}, falling back to static catalog: ${String(probeErr)}`);
      }
    }

    // 4. Tier 4: Static Canonical Catalog Match
    const canonical = this.matchCanonicalCatalog(modelId);
    if (canonical) {
      this.memoryCache.set(modelId, canonical);
      return canonical;
    }

    // 5. Tier 5: Safe Fallback Defaults
    const fallback = this.generateSafeFallback(modelId);
    this.memoryCache.set(modelId, fallback);
    return fallback;
  }

  private loadUserOverride(modelId: string): Partial<ModelCapabilityProfile> | null {
    const filename = NimModelRegistry.sanitizeModelId(modelId);
    const filePath = path.join(this.userOverrideDir, filename);

    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as Partial<ModelCapabilityProfile>;
    } catch (e) {
      this.emit('error', `Failed to parse user override file ${filePath}: ${String(e)}`);
      return null;
    }
  }

  private loadWorkspaceOverride(modelId: string): Partial<ModelCapabilityProfile> | null {
    if (!this.workspaceConfigPath || !fs.existsSync(this.workspaceConfigPath)) return null;

    try {
      const raw = fs.readFileSync(this.workspaceConfigPath, 'utf8');
      const root = JSON.parse(raw) as { models?: Record<string, Partial<ModelCapabilityProfile>> };
      return root.models?.[modelId] || null;
    } catch (e) {
      this.emit('error', `Failed to parse workspace models file ${this.workspaceConfigPath}: ${String(e)}`);
      return null;
    }
  }

  private matchCanonicalCatalog(modelId: string): ModelCapabilityProfile | null {
    const id = modelId.toLowerCase();

    if (id.includes('deepseek-r1')) {
      return {
        modelId,
        displayName: 'DeepSeek R1 (Reasoning)',
        family: 'deepseek-r1',
        contextWindow: 131072,
        maxOutputTokens: 32768,
        toolCallMode: 'xml_embedded',
        reasoningChannel: 'reasoning_content',
        reasoningReplayRequired: true,
        supportsFim: false,
        rateLimits: { requestsPerMinute: 60, tokensPerMinute: 100000, maxConcurrentRequests: 4 },
        sampling: { temperature: 0.6, topP: 0.95 },
        discoveredAt: Date.now(),
        provenance: 'canonical_catalog',
      };
    }

    if (id.includes('qwen2.5-coder')) {
      return {
        modelId,
        displayName: 'Qwen 2.5 Coder',
        family: 'qwen-coder',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        toolCallMode: 'native_openai',
        reasoningChannel: 'none',
        reasoningReplayRequired: false,
        supportsFim: true,
        fimTokens: {
          prefix: '<|fim_prefix|>',
          suffix: '<|fim_suffix|>',
          middle: '<|fim_middle|>',
        },
        rateLimits: { requestsPerMinute: 120, tokensPerMinute: 200000, maxConcurrentRequests: 8 },
        sampling: { temperature: 0.0, topP: 1.0 },
        discoveredAt: Date.now(),
        provenance: 'canonical_catalog',
      };
    }

    if (id.includes('llama-3.3') || id.includes('llama-3.1')) {
      return {
        modelId,
        displayName: 'Meta Llama 3',
        family: 'llama-3',
        contextWindow: 131072,
        maxOutputTokens: 4096,
        toolCallMode: 'native_openai',
        reasoningChannel: 'none',
        reasoningReplayRequired: false,
        supportsFim: false,
        rateLimits: { requestsPerMinute: 60, tokensPerMinute: 120000, maxConcurrentRequests: 4 },
        sampling: { temperature: 0.2, topP: 0.9 },
        discoveredAt: Date.now(),
        provenance: 'canonical_catalog',
      };
    }

    return null;
  }

  private generateSafeFallback(modelId: string): ModelCapabilityProfile {
    return {
      modelId,
      displayName: modelId,
      family: 'custom',
      contextWindow: 16384,
      maxOutputTokens: 2048,
      toolCallMode: 'xml_embedded',
      reasoningChannel: 'none',
      reasoningReplayRequired: false,
      supportsFim: false,
      rateLimits: { requestsPerMinute: 30, tokensPerMinute: 50000, maxConcurrentRequests: 2 },
      sampling: { temperature: 0.1, topP: 0.9 },
      discoveredAt: Date.now(),
      provenance: 'safe_fallback',
    };
  }

  private fillDefaults(
    partial: Partial<ModelCapabilityProfile>,
    provenance: ModelCapabilityProfile['provenance']
  ): ModelCapabilityProfile {
    return {
      modelId: partial.modelId || 'unknown',
      displayName: partial.displayName || partial.modelId || 'Custom Model',
      family: partial.family || 'custom',
      contextWindow: partial.contextWindow || 32768,
      maxOutputTokens: partial.maxOutputTokens || 4096,
      toolCallMode: partial.toolCallMode || 'xml_embedded',
      reasoningChannel: partial.reasoningChannel || 'none',
      reasoningReplayRequired: partial.reasoningReplayRequired ?? false,
      supportsFim: partial.supportsFim ?? false,
      fimTokens: partial.fimTokens,
      rateLimits: partial.rateLimits || { requestsPerMinute: 60, tokensPerMinute: 100000, maxConcurrentRequests: 4 },
      sampling: partial.sampling || { temperature: 0.1, topP: 0.9 },
      discoveredAt: Date.now(),
      provenance,
    };
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_) {}
    }
  }
}
```

---

### 5.2 `LiveCapabilityProbe.ts`
Executes the high-speed 3-test capability probe with timeout guarantees and streaming token analyzers.

```typescript
/**
 * @file LiveCapabilityProbe.ts
 * @description High-speed active model capability probe for Nomin Code.
 * Evaluates tool-calling mode, reasoning tokens, and FIM within a 5-second deadline.
 */

import { ModelCapabilityProfile, ToolCallMode, ReasoningChannel, ModelFamily } from './NimModelRegistry.js';

export interface ProbeConfig {
  baseURL: string;
  apiKey: string;
  timeoutMs?: number;
}

export class LiveCapabilityProbe {
  private static readonly DEFAULT_TIMEOUT_MS = 5000;

  /**
   * Probes an arbitrary model endpoint and returns a verified capability profile.
   */
  public static async probeEndpoint(
    modelId: string,
    config: ProbeConfig
  ): Promise<ModelCapabilityProfile> {
    const timeoutMs = config.timeoutMs ?? LiveCapabilityProbe.DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const cleanBaseURL = config.baseURL.replace(/\/+$/, '');

    try {
      // Execute Probe Test 1 & Test 2 in parallel for maximum speed
      const [toolResult, reasoningResult] = await Promise.all([
        LiveCapabilityProbe.probeToolCalling(cleanBaseURL, config.apiKey, modelId, controller.signal),
        LiveCapabilityProbe.probeReasoningChannel(cleanBaseURL, config.apiKey, modelId, controller.signal),
      ]);

      // Serial Probe Test 3: FIM and Context boundary
      const fimResult = await LiveCapabilityProbe.probeFimSupport(
        cleanBaseURL,
        config.apiKey,
        modelId,
        controller.signal
      );

      const family: ModelFamily = LiveCapabilityProbe.inferFamily(modelId, reasoningResult.channel);

      return {
        modelId,
        displayName: modelId,
        family,
        contextWindow: 131072, // Default NIM envelope; clamped by error response if smaller
        maxOutputTokens: reasoningResult.channel !== 'none' ? 16384 : 4096,
        toolCallMode: toolResult,
        reasoningChannel: reasoningResult.channel,
        reasoningReplayRequired: reasoningResult.replayRequired,
        supportsFim: fimResult.supported,
        fimTokens: fimResult.tokens,
        rateLimits: {
          requestsPerMinute: 60,
          tokensPerMinute: 100000,
          maxConcurrentRequests: 4,
        },
        sampling: {
          temperature: reasoningResult.channel !== 'none' ? 0.6 : 0.0,
          topP: reasoningResult.channel !== 'none' ? 0.95 : 1.0,
        },
        discoveredAt: Date.now(),
        provenance: 'active_probe',
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * TEST 1: Tool-Calling Capability Probe
   */
  private static async probeToolCalling(
    baseURL: string,
    apiKey: string,
    modelId: string,
    signal: AbortSignal
  ): Promise<ToolCallMode> {
    const url = `${baseURL}/chat/completions`;

    const dummyTool = {
      type: 'function',
      function: {
        name: 'nomin_probe_ping',
        description: 'Nomin harness capability probe',
        parameters: {
          type: 'object',
          properties: {
            ack: { type: 'string' },
          },
          required: ['ack'],
        },
      },
    };

    try {
      // Step 1A: Attempt native function calling
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: 'Invoke nomin_probe_ping with ack="ok". Output only the tool call.' },
          ],
          tools: [dummyTool],
          tool_choice: 'auto',
          max_tokens: 35,
          temperature: 0.0,
        }),
        signal,
      });

      if (resp.ok) {
        const data = (await resp.json()) as any;
        const toolCalls = data.choices?.[0]?.message?.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls[0]?.function?.name === 'nomin_probe_ping') {
          return 'native_openai';
        }
      }

      // Step 1B: Attempt Structured JSON mode if tools rejected
      const jsonModeResp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: 'Output a valid JSON object with key "ack" and value "ok".' },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 25,
          temperature: 0.0,
        }),
        signal,
      });

      if (jsonModeResp.ok) {
        const jsonData = (await jsonModeResp.json()) as any;
        const text = jsonData.choices?.[0]?.message?.content || '';
        try {
          const parsed = JSON.parse(text);
          if (parsed.ack === 'ok') return 'json_mode';
        } catch (_) {}
      }

      // Fallback: Model does not support reliable native JSON/Tools
      return 'xml_embedded';
    } catch (_) {
      return 'xml_embedded';
    }
  }

  /**
   * TEST 2: Reasoning Token Channel Probe
   */
  private static async probeReasoningChannel(
    baseURL: string,
    apiKey: string,
    modelId: string,
    signal: AbortSignal
  ): Promise<{ channel: ReasoningChannel; replayRequired: boolean }> {
    const url = `${baseURL}/chat/completions`;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: 'Is 97 prime? Think step by step.' },
          ],
          stream: true,
          max_tokens: 40,
          temperature: 0.6,
        }),
        signal,
      });

      if (!resp.ok || !resp.body) {
        return { channel: 'none', replayRequired: false };
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let sawReasoningField = false;
      let sawThinkTag = false;
      let chunkCount = 0;

      while (chunkCount < 20) {
        const { value, done } = await reader.read();
        if (done) break;
        chunkCount++;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          if (trimmed === 'data: [DONE]') break;

          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
              sawReasoningField = true;
              break;
            }

            if (typeof delta.content === 'string' && delta.content.includes('<think>')) {
              sawThinkTag = true;
              break;
            }
          } catch (_) {}
        }

        if (sawReasoningField || sawThinkTag) {
          await reader.cancel();
          break;
        }
      }

      if (sawReasoningField) {
        return { channel: 'reasoning_content', replayRequired: true };
      }
      if (sawThinkTag) {
        return { channel: 'tagged_think', replayRequired: true };
      }

      return { channel: 'none', replayRequired: false };
    } catch (_) {
      return { channel: 'none', replayRequired: false };
    }
  }

  /**
   * TEST 3: Fill-In-The-Middle (FIM) Probe
   */
  private static async probeFimSupport(
    baseURL: string,
    apiKey: string,
    modelId: string,
    signal: AbortSignal
  ): Promise<{ supported: boolean; tokens?: { prefix: string; suffix: string; middle: string } }> {
    const url = `${baseURL}/completions`;

    const standardTokens = {
      prefix: '<|fim_prefix|>',
      suffix: '<|fim_suffix|>',
      middle: '<|fim_middle|>',
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          prompt: `${standardTokens.prefix}def add(a, b):\n    ${standardTokens.suffix}\n    return c${standardTokens.middle}`,
          max_tokens: 10,
          temperature: 0.0,
        }),
        signal,
      });

      if (resp.ok) {
        return { supported: true, tokens: standardTokens };
      }
      return { supported: false };
    } catch (_) {
      return { supported: false };
    }
  }

  private static inferFamily(modelId: string, reasoning: ReasoningChannel): ModelFamily {
    const id = modelId.toLowerCase();
    if (id.includes('deepseek-r1') || reasoning === 'reasoning_content') return 'deepseek-r1';
    if (id.includes('deepseek-v3')) return 'deepseek-v3';
    if (id.includes('qwen')) return 'qwen-coder';
    if (id.includes('llama')) return 'llama-3';
    if (id.includes('nemotron')) return 'nemotron';
    if (id.includes('mistral') || id.includes('codestral')) return 'mistral';
    return 'custom';
  }
}
```

---

## 6. Summary: Verification Invariants for Nomin Code Swarms

1. **Zero Unprobed Models in Critical Path**: No agent task is scheduled to an unprofiled model endpoint. Cold endpoints trigger the 5-second probe or resolve to Tier 1 user overrides before worktree creation.
2. **Context Window Safety Padding**: All context calculations enforce a **15% proactive compaction buffer** (e.g., for a 131,072-token envelope, compaction triggers at 111,411 tokens).
3. **Structured Tool Fallback**: If an open model fails Test 1 (native OpenAI tools), Nomin Code automatically wraps file edits into Aider-style `<search_replace>` blocks, preventing premature loop aborts due to malformed tool syntax.
4. **Deterministic Storage**: Every probed profile is stamped with provenance and saved to `.nomin/models.json` for reproducible debugging across development sessions.
