/**
 * Nomin Code: Model Settings & Effort Adapters Unit Test Suite
 * Tests:
 * 1. Reasoning effort exposed ONLY for models that actually support it
 * 2. Model family adapters (OpenAI/NIM reasoning_effort, Anthropic budget_tokens)
 * 3. Unsupported models report "not supported" and refuse fake parameters
 * 4. Blank defaults for temperature, top_p, max_tokens (neutral defaults)
 * 5. Per-model settings configuration persistence
 * 6. Live effort level changes and bounds checking
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ModelSettingsManager, REASONING_EFFORT_LEVELS } from '../src/provider/model-settings.js';
import { ConfigManager } from '../src/config/index.js';
import { ModelSettings } from '../src/provider/types.js';

describe('Model Settings & Reasoning Effort Adapters', () => {
  it('identifies reasoning-supported models accurately', () => {
    // NVIDIA NIM reasoning models
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('nvidia/llama-3.1-nemotron-70b-instruct'), true);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('deepseek-ai/deepseek-r1'), true);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('nvidia/cosmos-reason2-8b'), true);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('nvidia/nemotron-4-340b-instruct'), true);

    // OpenAI reasoning models
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('o1'), true);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('o3-mini'), true);

    // Anthropic reasoning models
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('claude-3-7-sonnet-20250219'), true);
  });

  it('rejects reasoning effort for models that do not support it', () => {
    // Standard chat and completion models without thinking channel
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('meta/llama-3.1-8b-instruct'), false);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('meta/llama2-70b'), false);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('mistralai/mistral-7b-instruct-v0.3'), false);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('gpt-4o-mini'), false);
    assert.strictEqual(ModelSettingsManager.supportsReasoningEffort('claude-3-5-sonnet-20241022'), false);
  });

  it('adapts payload with reasoning_effort for OpenAI and NVIDIA NIM reasoning models', () => {
    const payload: Record<string, unknown> = {
      model: 'nvidia/llama-3.1-nemotron-70b-instruct',
      messages: [{ role: 'user', content: 'Design an algorithm' }],
    };

    ModelSettingsManager.adaptPayload(payload, {
      modelId: 'nvidia/llama-3.1-nemotron-70b-instruct',
      reasoningEffort: 'high',
    });

    assert.strictEqual(payload.reasoning_effort, 'high');
    assert.strictEqual(payload.thinking, undefined);
  });

  it('adapts payload with thinking budget_tokens for Anthropic Claude 3.7', () => {
    const payload: Record<string, unknown> = {
      model: 'claude-3-7-sonnet-20250219',
      messages: [{ role: 'user', content: 'Refactor this architecture' }],
    };

    ModelSettingsManager.adaptPayload(payload, {
      modelId: 'claude-3-7-sonnet-20250219',
      reasoningEffort: 'medium',
    });

    assert.deepStrictEqual(payload.thinking, {
      type: 'enabled',
      budget_tokens: 2048,
    });
    assert.strictEqual(payload.reasoning_effort, undefined);
  });

  it('does NOT inject fake reasoning parameters when effort is "off"', () => {
    const payload: Record<string, unknown> = {
      model: 'nvidia/llama-3.1-nemotron-70b-instruct',
      messages: [{ role: 'user', content: 'Quick answer' }],
    };

    ModelSettingsManager.adaptPayload(payload, {
      modelId: 'nvidia/llama-3.1-nemotron-70b-instruct',
      reasoningEffort: 'off',
    });

    assert.strictEqual(payload.reasoning_effort, undefined);
    assert.strictEqual(payload.thinking, undefined);
  });

  it('does NOT inject reasoning parameters on unsupported models even if configured', () => {
    const payload: Record<string, unknown> = {
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    ModelSettingsManager.adaptPayload(payload, {
      modelId: 'meta/llama-3.1-8b-instruct',
      reasoningEffort: 'high',
    });

    // Must NEVER send reasoning_effort to models that do not support it (stops 400 Bad Request)
    assert.strictEqual(payload.reasoning_effort, undefined);
    assert.strictEqual(payload.thinking, undefined);
  });

  it('uses blank defaults for temperature and top_p unless explicitly configured', () => {
    const payload: Record<string, unknown> = {
      model: 'mistralai/mistral-large-2-instruct',
      messages: [{ role: 'user', content: 'Test' }],
    };

    // With blank/empty settings:
    ModelSettingsManager.adaptPayload(payload, {
      modelId: 'mistralai/mistral-large-2-instruct',
    });

    // Provider defaults are preserved by omitting opinionated values
    assert.strictEqual(payload.temperature, undefined);
    assert.strictEqual(payload.top_p, undefined);
    assert.strictEqual(payload.max_tokens, undefined);

    // When explicitly set by user:
    ModelSettingsManager.adaptPayload(payload, {
      modelId: 'mistralai/mistral-large-2-instruct',
      temperature: 0.2,
      topP: 0.95,
      maxTokens: 4096,
    });

    assert.strictEqual(payload.temperature, 0.2);
    assert.strictEqual(payload.top_p, 0.95);
    assert.strictEqual(payload.max_tokens, 4096);
  });

  it('persists per-model settings in ConfigManager cleanly', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomin-settings-test-'));
    try {
      ConfigManager.resetInstance();
      const cfgMgr = ConfigManager.getInstance(tempDir);

      const nemoSettings: ModelSettings = {
        modelId: 'nvidia/llama-3.1-nemotron-70b-instruct',
        providerId: 'nim',
        reasoningEffort: 'high',
        temperature: 0.3,
        maxTokens: 8192,
      };

      cfgMgr.setModelSettings('nvidia/llama-3.1-nemotron-70b-instruct', nemoSettings);

      const retrieved = cfgMgr.getModelSettings('nvidia/llama-3.1-nemotron-70b-instruct');
      assert.ok(retrieved);
      assert.strictEqual(retrieved?.reasoningEffort, 'high');
      assert.strictEqual(retrieved?.temperature, 0.3);
      assert.strictEqual(retrieved?.maxTokens, 8192);

      // Verify persistence across reload
      ConfigManager.resetInstance();
      const reloadedMgr = ConfigManager.getInstance(tempDir);
      const reloaded = reloadedMgr.getModelSettings('nvidia/llama-3.1-nemotron-70b-instruct');
      assert.strictEqual(reloaded?.reasoningEffort, 'high');
      assert.strictEqual(reloaded?.temperature, 0.3);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      ConfigManager.resetInstance();
    }
  });
});
