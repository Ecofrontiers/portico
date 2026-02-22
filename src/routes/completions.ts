/**
 * OpenAI-compatible chat completions endpoint.
 * POST /v1/chat/completions
 *
 * This is the single API that all applications talk to.
 * Portico handles privacy classification, backend selection,
 * and response normalization transparently.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { ChatCompletionRequest, BackendConfig } from '../types';
import { classifyPrivacy } from '../privacy/router';
import { routeRequest, RoutingError } from '../routing/engine';
import { callOllama, callOpenAICompatible } from '../backends/local';
import { callRemote } from '../backends/remote';
import { callPeer } from '../backends/federated';
import { streamRequest } from '../streaming';

const router = Router();

// Backend registry — populated by index.ts at startup
let backends: BackendConfig[] = [];

export function setBackends(b: BackendConfig[]): void {
  backends = b;
}

router.post('/v1/chat/completions', async (req: Request, res: Response) => {
  const requestId = uuid();
  const startTime = Date.now();

  try {
    const body = req.body as ChatCompletionRequest;

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({
        error: { message: 'messages array is required', type: 'invalid_request_error' },
      });
    }

    // Step 1: Privacy classification
    const privacy = classifyPrivacy(
      req.headers as Record<string, string | string[] | undefined>,
      body.messages
    );

    // Step 2: Route to best backend
    let routing;
    try {
      routing = routeRequest(backends, privacy, body);
    } catch (err) {
      if (err instanceof RoutingError) {
        const status = err.code === 'LOCAL_ONLY_NO_BACKEND' ? 503 : 502;
        return res.status(status).json({
          error: {
            message: err.message,
            type: 'routing_error',
            code: err.code,
            privacy: err.privacy.classification,
          },
        });
      }
      throw err;
    }

    // Portico response headers (set before streaming or non-streaming)
    res.set('X-Portico-Request-Id', requestId);
    res.set('X-Portico-Backend', routing.backend.name);
    res.set('X-Portico-Tier', routing.backend.tier);
    res.set('X-Portico-Privacy', routing.privacyClass);

    // Step 3: Stream or call the selected backend
    if (body.stream) {
      console.log(
        `[${requestId.slice(0, 8)}] STREAM ${routing.backend.name} (${routing.backend.tier}) ` +
        `model=${routing.model} privacy=${routing.privacyClass}`
      );

      await streamRequest(routing.backend, { ...body, model: routing.model }, res);
      return;
    }

    const response = await callBackend(routing.backend, {
      ...body,
      model: routing.model,
    });

    // Attach Portico metadata
    response.portico = {
      backend: routing.backend.name,
      tier: routing.backend.tier,
      privacyClass: routing.privacyClass,
      carbonIntensity: routing.carbonIntensity,
      routingReason: routing.reason,
    };

    const elapsed = Date.now() - startTime;
    res.set('X-Portico-Latency', `${elapsed}ms`);

    console.log(
      `[${requestId.slice(0, 8)}] ${routing.backend.name} (${routing.backend.tier}) ` +
      `model=${routing.model} privacy=${routing.privacyClass} ${elapsed}ms`
    );

    return res.json(response);
  } catch (err: any) {
    console.error(`[${requestId.slice(0, 8)}] Error:`, err.message);
    return res.status(500).json({
      error: {
        message: 'Internal gateway error',
        type: 'gateway_error',
        request_id: requestId,
      },
    });
  }
});

// Model listing endpoint (for client discovery)
router.get('/v1/models', (_req: Request, res: Response) => {
  const models = backends
    .filter(b => b.healthy)
    .flatMap(b => b.models.map(m => ({
      id: m,
      object: 'model',
      owned_by: b.name,
      portico: { backend: b.name, tier: b.tier },
    })));

  res.json({ object: 'list', data: models });
});

/**
 * Dispatch to the correct backend caller.
 */
async function callBackend(backend: BackendConfig, request: ChatCompletionRequest) {
  switch (backend.type) {
    case 'ollama':
      return callOllama(backend, request);

    case 'openai-compatible':
      return callOpenAICompatible(backend, request);

    case 'openai':
    case 'anthropic':
    case 'mistral':
      return callRemote(backend, request);

    case 'portico-peer':
      return callPeer(backend, request);

    default:
      throw new Error(`Unknown backend type: ${backend.type}`);
  }
}

export default router;
