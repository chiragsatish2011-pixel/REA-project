/**
 * Nomin Code: Pre-Validation Model Verification Engine
 * Verifies that a model endpoint is active, alive, and functional before accepting it into the pool.
 * Measures Time-to-First-Token (TTFT), tool-calling support, and reasoning token delivery.
 * Catches HTTP 410 Gone immediately, marks model RETIRED, and prevents silent switching.
 */

import { NominHttpClient } from './client.js';
import { ToolDefinition } from './types.js';
import { ErrorClassifier, ClassifiedError } from './error-classifier.js';
import { NominLogger } from './logger.js';

export interface ModelValidationResult {
  ok: boolean;
  modelId: string;
  providerId: string;
  ttftMs: number;
  supportsTools: boolean;
  supportsReasoning: boolean;
  error?: ClassifiedError;
}

export class ModelValidator {
  /**
   * Runs a fast 3-step verification ping before allowing a model to be activated:
   * 1. Basic completion (verifies model is alive and not HTTP 410/404)
   * 2. Streaming completion & TTFT measurement
   * 3. Tool-call capability probe
   */
  public static async validateModel(
    client: NominHttpClient,
    modelId: string,
    options: { timeoutMs?: number } = {}
  ): Promise<ModelValidationResult> {
    const providerId = client.getConfig().id || client.getProviderType();
    const timeoutMs = options.timeoutMs ?? 20000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    NominLogger.info(`Starting pre-validation check for [${providerId}] ${modelId}...`);

    let ttftMs = 0;
    let supportsReasoning = false;
    let supportsTools = false;

    try {
      // 1. Basic Completion & Streaming TTFT Probe
      const startTime = Date.now();
      let firstTokenTime: number | null = null;
      let textReceived = '';

      const stream = client.chatStream({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with the word OK' }],
        maxTokens: 16,
        temperature: 0.1,
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        if (firstTokenTime === null && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')) {
          firstTokenTime = Date.now();
          ttftMs = firstTokenTime - startTime;
        }

        if (chunk.type === 'reasoning-delta' && chunk.text.trim().length > 0) {
          supportsReasoning = true;
        } else if (chunk.type === 'text-delta') {
          textReceived += chunk.text;
        }
      }

      if (firstTokenTime === null) {
        ttftMs = Date.now() - startTime;
      }

      // If we got this far, the model is ALIVE and accepted requests!
      NominLogger.info(`Basic completion passed for ${modelId} (TTFT: ${ttftMs}ms, reasoning: ${supportsReasoning})`);

      // 2. Quick Tool-Calling Test
      try {
        const dummyTool: ToolDefinition = {
          type: 'function',
          function: {
            name: 'probe_test',
            description: 'Connectivity test',
            parameters: {
              type: 'object',
              properties: { test: { type: 'boolean' } },
            },
          },
        };

        const toolResponse = await client.chat({
          model: modelId,
          messages: [{ role: 'user', content: 'test tool capabilities' }],
          tools: [dummyTool],
          maxTokens: 10,
          temperature: 0.1,
          signal: controller.signal,
        });

        // If provider accepted tools parameter without 400 Bad Request, tools are supported
        if (toolResponse && toolResponse.choices) {
          supportsTools = true;
        }
      } catch (toolErr) {
        // Many models don't support native tools — this is NOT a failure of the model,
        // it just means supportsTools = false
        supportsTools = false;
        NominLogger.debug(`Tool calling probe was rejected by ${modelId}: ${(toolErr as Error).message}`);
      }

      clearTimeout(timeoutId);

      return {
        ok: true,
        modelId,
        providerId,
        ttftMs,
        supportsTools,
        supportsReasoning,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      // Classify error (410 Gone, 401 Unauthorized, 404 Not Found, 429, 5xx)
      const classified = ErrorClassifier.classify(err, {
        modelId,
        providerId,
        endpointUrl: client.getBaseURL(),
      });

      NominLogger.error(`Pre-validation failed for [${providerId}] ${modelId}`, {
        category: classified.category,
        statusCode: classified.statusCode,
        detail: classified.providerDetail,
      });

      return {
        ok: false,
        modelId,
        providerId,
        ttftMs: 0,
        supportsTools: false,
        supportsReasoning: false,
        error: classified,
      };
    }
  }
}
