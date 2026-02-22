/**
 * Local model backends — Ollama, vLLM, llama.cpp
 *
 * All expose OpenAI-compatible APIs (or close to it).
 * Portico normalizes responses to the OpenAI format.
 */

import { ChatCompletionRequest, ChatCompletionResponse, BackendConfig, ChatMessage } from '../types';
import { v4 as uuid } from 'uuid';

/**
 * Call an Ollama instance.
 * Ollama exposes /api/chat (native) and /v1/chat/completions (OpenAI-compat).
 * We use the OpenAI-compatible endpoint for consistency.
 */
export async function callOllama(
  backend: BackendConfig,
  request: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const model = request.model || backend.models[0];
  if (!model) throw new Error(`No model specified and backend ${backend.name} has no default`);

  const url = `${backend.url}/v1/chat/completions`;
  const body = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000), // local models can be slow
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama ${res.status}: ${text}`);
  }

  const data = await res.json() as any;

  return {
    id: data.id || `portico-${uuid()}`,
    object: 'chat.completion',
    created: data.created || Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: data.choices || [],
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Call an OpenAI-compatible local server (vLLM, llama.cpp, etc.)
 */
export async function callOpenAICompatible(
  backend: BackendConfig,
  request: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const model = request.model || backend.models[0] || 'default';
  const url = `${backend.url}/v1/chat/completions`;
  const body = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${backend.name} ${res.status}: ${text}`);
  }

  const data = await res.json() as any;

  return {
    id: data.id || `portico-${uuid()}`,
    object: 'chat.completion',
    created: data.created || Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: data.choices || [],
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Health check for a local backend.
 */
export async function checkLocalHealth(backend: BackendConfig): Promise<boolean> {
  try {
    const url = backend.type === 'ollama'
      ? `${backend.url}/api/tags`
      : `${backend.url}/v1/models`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Discover models from an Ollama instance.
 */
export async function discoverOllamaModels(url: string): Promise<string[]> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.models || []).map((m: any) => m.name);
  } catch {
    return [];
  }
}
