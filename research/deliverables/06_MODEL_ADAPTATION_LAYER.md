# Model-Adaptation Layer: Universal Runtime Adapter & Capability Probing

> **Engineering Objective**: Ensure Nomin Code can bind to **any** model family dynamically at runtime, normalizing disparate tool-calling dialects, reasoning tokens, prompt delimiters, and context envelopes without requiring code changes.

---

## 1. Automated Model Capability Probe (The 5-Second Profiler)

When Nomin Code encounters an unprofiled model endpoint (e.g., a custom vLLM deployment, new NIM microservice, or local Ollama model), it executes a zero-latency **3-Step Capability Probe** before initializing the agent swarm:

```mermaid
flowchart TD
    ProbeStart[New Endpoint Discovered] --> Probe1[Probe 1: Native Function Calling\n(Send dummy tool definition)]
    
    Probe1 -->|HTTP 200 with tool_calls| CapNative[Flag: NATIVE_TOOL_CALLING = True]
    Probe1 -->|HTTP 400 / Invalid param| CapXML[Flag: NATIVE_TOOL_CALLING = False\nFallback: XML/ReAct Extraction]
    
    CapNative --> Probe2[Probe 2: Reasoning Token Channel\n(Prompt with mathematical proof)]
    CapXML --> Probe2
    
    Probe2 -->|reasoning_content field / think tags| CapCoT[Flag: REASONING_REPLAY_REQUIRED = True]
    Probe2 -->|Standard delta content| CapStandard[Flag: REASONING_REPLAY_REQUIRED = False]
    
    CapCoT --> Probe3[Probe 3: FIM & Grammar Support\n(Prefix/Suffix test)]
    CapStandard --> Probe3
    
    Probe3 --> ProfileBuilt[Generated Model Profile in .nomin/models.json]
```

### Probe Execution Algorithm
```python
async def probe_model_capabilities(client, model_name: str) -> ModelProfile:
    profile = ModelProfile(model_name=model_name)
    
    # Probe 1: Function Calling
    test_tool = {
        "type": "function",
        "function": {
            "name": "probe_check",
            "description": "ping",
            "parameters": {"type": "object", "properties": {"val": {"type": "integer"}}}
        }
    }
    try:
        resp = await client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": "Call probe_check with val=42"}],
            tools=[test_tool],
            tool_choice="auto",
            max_tokens=50
        )
        if resp.choices[0].message.tool_calls:
            profile.tool_call_mode = "NATIVE_OPENAI"
        else:
            profile.tool_call_mode = "TEXT_XML_EMBEDDED"
    except Exception:
        profile.tool_call_mode = "TEXT_XML_EMBEDDED"

    # Probe 2: Reasoning Token Stream Check
    try:
        stream = await client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": "Is 10007 prime? Think first."}],
            stream=True,
            max_tokens=60
        )
        saw_reasoning = False
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if hasattr(delta, "reasoning_content") and delta.reasoning_content:
                saw_reasoning = True
                profile.reasoning_channel = "DELTA_REASONING_FIELD"
                break
            if delta.content and "<think>" in delta.content:
                saw_reasoning = True
                profile.reasoning_channel = "TAGGED_CONTENT"
                break
        if not saw_reasoning:
            profile.reasoning_channel = "NONE"
    except Exception:
        profile.reasoning_channel = "NONE"

    return profile
```

---

## 2. Per-Family Adaptation Profiles

### 2.1 DeepSeek Family (`DeepSeek-V3`, `DeepSeek-R1`)
- **Dialect**: OpenAI-compatible wire format with specific reasoning channel.
- **Reasoning Handling** (`[VERIFIED]` from `deepseek-harness/packages/llm/llm-deepseek`):
  - On streaming: Reasoning arrives in `delta.reasoning_content` (or `<think>` tokens).
  - On turn serialization: Previous assistant turns must replay the reasoning block:
    ```json
    {
      "role": "assistant",
      "content": "Final answer...",
      "reasoning_content": "Chain of thought history..."
    }
    ```
    Omitting reasoning history degrades subsequent multi-turn problem-solving quality.
- **Sampling Parameters**:
  - `DeepSeek-R1`: `temperature: 0.6`, `top_p: 0.95` (Anthropic/DeepSeek recommended).
  - `DeepSeek-V3`: `temperature: 0.0`, `max_tokens: 8192`.

### 2.2 Qwen Family (`Qwen2.5-Coder-7B / 14B / 32B`)
- **Dialect**: ChatML native `<|im_start|>` / `<|im_end|>`. Highly robust function calling.
- **Tool-Call Quirks**:
  - Qwen models occasionally emit JSON arguments with trailing commas or unescaped single quotes.
  - **Repair Policy**: The adapter intercepts raw tool-call strings and applies an automated JSON repair pipeline:
    `clean_json = re.sub(r",\s*([\]}])", r"\1", raw_arguments)`
- **Fill-In-the-Middle (FIM)**:
  - Supports native FIM tokens: `<|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>`. The Nomin Code editor leverages FIM for localized single-line edits.
- **Sampling Parameters**: `temperature: 0.1`, `presence_penalty: 0.0`, `frequency_penalty: 0.0`.

### 2.3 Meta Llama Family (`Llama-3.1 / 3.3 70B & 8B`)
- **Dialect**: Native OpenAI JSON function calling with strict schema adhesion.
- **Tool-Call Quirks**:
  - Llama 3 models follow tool instructions strictly if definitions are provided in the system prompt rather than solely in the API payload.
- **Context Handling**:
  - Native 128K context window. Employs RoPE scaling; attention accuracy degrades slightly beyond 64K tokens, requiring proactive compaction triggered at 48K tokens.

### 2.4 Zhipu GLM Family (`GLM-4`, `ZCode`)
- **Dialect**: Supports CogView and CodeGeex function definitions.
- **Adaptation**:
  - Requires explicit tool return role `"tool"` with `tool_call_id`.
  - For long-context models, supports up to 1M token windows with prefix caching.

### 2.5 Moonshot Kimi Family (`Kimi-k1.5`, `kimi-code`)
- **Dialect**: ACP/KAP protocol compliance.
- **Adaptation**:
  - Handles ultra-long contexts with sub-turn chunking.
  - Excellent Chinese/English dual-language code generation.

### 2.6 Local Open-Source Models (vLLM / Ollama / llama.cpp)
- **Dialect**: Standard OpenAI `/v1/chat/completions`.
- **Adaptation**:
  - Often lacks server-side context caching.
  - Concurrency is bounded by local GPU VRAM. Concurrency cap is set to a strict fixed integer (e.g., `concurrency = 2` on single GPU).
  - Activates aggressive prompt compaction (maintaining max 16K context).

---

## 3. Context-Size-Aware Strategy Matrix

| Context Window Range | Example Models | Compaction Trigger | RepoMap Budget | Retrieval Policy |
| :--- | :--- | :--- | :--- | :--- |
| **Small (16K – 32K)** | `Qwen2.5-Coder-32B` (Standard), Local 8B | 70% (~22K tokens) | 1,024 tokens | Windowed line reads (100 lines max), aggressive AST pruning |
| **Medium (64K – 128K)** | `DeepSeek-V3/R1`, `Llama-3.3-70B`, NIM | 85% (~100K tokens)| 3,072 tokens | Multi-file skeleton reads, medium diff context |
| **Large (200K – 1M+)** | Claude 3.5 Sonnet, Gemini 1.5/2.0, Kimi | 85% (~800K tokens)| 8,192 tokens | Full module contexts, complete test execution logs retained |
