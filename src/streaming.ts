/**
 * SSE Streaming Support
 *
 * Handles streaming responses from all backend types.
 * OpenAI-compatible backends (Ollama, vLLM, OpenAI, Mistral, peers)
 * are piped through directly. Anthropic SSE is converted to
 * OpenAI chunk format on the fly.
 *
 * Ecofrontiers SARL, AGPL-3.0
 */

import { Response } from 'express';
import { ChatCompletionRequest, BackendConfig } from './types';

/**
 * Pipe raw SSE bytes from an upstream fetch response to Express response.
 */
async function pipeSSE(upstream: globalThis.Response, res: Response): Promise<void> {
  if (!upstream.body) throw new Error('No response body for streaming');

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } finally {
    res.end();
  }
}

/**
 * Stream from an OpenAI-compatible endpoint (Ollama, vLLM, OpenAI, Mistral, peers).
 * These all return the same SSE format, so we pipe through directly.
 */
async function streamOpenAICompat(
  url: string,
  body: Record<string, any>,
  headers: Record<string, string>,
  res: Response,
  timeout = 120000
): Promise<void> {
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    throw new Error(`Upstream ${upstream.status}: ${text}`);
  }

  await pipeSSE(upstream, res);
}

/**
 * Stream from Anthropic Messages API, converting to OpenAI SSE chunk format.
 *
 * Anthropic emits: content_block_delta (text), message_delta (stop_reason)
 * We convert to: chat.completion.chunk with delta.content / finish_reason
 */
async function streamAnthropic(
  backend: BackendConfig,
  request: ChatCompletionRequest,
  apiKey: string,
  res: Response
): Promise<void> {
  const model = request.model || backend.models[0];
  const systemMsg = request.messages.find(m => m.role === 'system');
  const conversationMsgs = request.messages.filter(m => m.role !== 'system');

  const body: any = {
    model,
    messages: conversationMsgs.map(m => ({ role: m.role, content: m.content })),
    max_tokens: request.max_tokens || 4096,
    stream: true,
  };
  if (systemMsg) body.system = systemMsg.content;
  if (request.temperature !== undefined) body.temperature = request.temperature;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    throw new Error(`Anthropic ${upstream.status}: ${text}`);
  }
  if (!upstream.body) throw new Error('No response body');

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const id = `portico-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by blank lines)
      while (true) {
        const eventEnd = buffer.indexOf('\n\n');
        if (eventEnd === -1) break;

        const event = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);

        // Find data line in the event
        const dataLine = event.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;

        const data = dataLine.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);

          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const chunk = {
              id,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: { content: parsed.delta.text },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
            const chunk = {
              id,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: parsed.delta.stop_reason === 'end_turn' ? 'stop' : parsed.delta.stop_reason,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        } catch {
          // Skip unparseable events
        }
      }
    }
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// API key resolution (mirrors remote.ts)
function getApiKey(type: string): string | undefined {
  switch (type) {
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
    case 'mistral': return process.env.MISTRAL_API_KEY;
    default: return undefined;
  }
}

/**
 * Stream a request through the selected backend.
 * Sets SSE headers and pipes chunks to the Express response.
 */
export async function streamRequest(
  backend: BackendConfig,
  request: ChatCompletionRequest,
  res: Response
): Promise<void> {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const body = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
  };

  switch (backend.type) {
    case 'ollama':
      return streamOpenAICompat(
        `${backend.url}/v1/chat/completions`, body, {}, res, 120000
      );

    case 'openai-compatible':
      return streamOpenAICompat(
        `${backend.url}/v1/chat/completions`, body, {}, res, 120000
      );

    case 'openai':
    case 'mistral': {
      const apiKey = getApiKey(backend.type);
      if (!apiKey) throw new Error(`No API key for ${backend.name}. Set ${backend.type.toUpperCase()}_API_KEY.`);
      const url = backend.type === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://api.mistral.ai/v1/chat/completions';
      return streamOpenAICompat(url, body, { Authorization: `Bearer ${apiKey}` }, res, 60000);
    }

    case 'anthropic': {
      const apiKey = getApiKey('anthropic');
      if (!apiKey) throw new Error(`No API key for ${backend.name}. Set ANTHROPIC_API_KEY.`);
      return streamAnthropic(backend, request, apiKey, res);
    }

    case 'portico-peer':
      if (!backend.url) throw new Error(`No URL configured for peer ${backend.name}`);
      return streamOpenAICompat(
        `${backend.url}/v1/chat/completions`, body, { 'X-Portico-Peer': 'self' }, res, 60000
      );

    default:
      throw new Error(`Unknown backend type: ${backend.type}`);
  }
}
