/**
 * Remote provider backends — OpenAI, Anthropic, Mistral
 *
 * Each provider has its own API format. Portico normalizes
 * everything to OpenAI-compatible responses.
 */

import { ChatCompletionRequest, ChatCompletionResponse, BackendConfig, ChatMessage } from '../types';
import { v4 as uuid } from 'uuid';

// --- Provider URLs ---

const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
};

// --- API Key resolution ---

function getApiKey(type: string): string | undefined {
  switch (type) {
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
    case 'mistral': return process.env.MISTRAL_API_KEY;
    default: return undefined;
  }
}

// --- OpenAI / Mistral (OpenAI-compatible format) ---

async function callOpenAIFormat(
  backend: BackendConfig,
  request: ChatCompletionRequest,
  url: string,
  apiKey: string
): Promise<ChatCompletionResponse> {
  const model = request.model || backend.models[0];
  const body = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
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

// --- Anthropic (Messages API → OpenAI format) ---

async function callAnthropic(
  backend: BackendConfig,
  request: ChatCompletionRequest,
  apiKey: string
): Promise<ChatCompletionResponse> {
  const model = request.model || backend.models[0];

  // Separate system message from conversation
  const systemMsg = request.messages.find(m => m.role === 'system');
  const conversationMsgs = request.messages.filter(m => m.role !== 'system');

  const body: any = {
    model,
    messages: conversationMsgs.map(m => ({ role: m.role, content: m.content })),
    max_tokens: request.max_tokens || 4096,
  };
  if (systemMsg) body.system = systemMsg.content;
  if (request.temperature !== undefined) body.temperature = request.temperature;

  const res = await fetch(PROVIDER_URLS.anthropic, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }

  const data = await res.json() as any;

  // Convert Anthropic response to OpenAI format
  const content = (data.content || [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('');

  return {
    id: data.id || `portico-${uuid()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: data.stop_reason === 'end_turn' ? 'stop' : (data.stop_reason || 'stop'),
    }],
    usage: {
      prompt_tokens: data.usage?.input_tokens || 0,
      completion_tokens: data.usage?.output_tokens || 0,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
  };
}

// --- Public API ---

/**
 * Call a remote provider. Routes to the correct API format.
 */
export async function callRemote(
  backend: BackendConfig,
  request: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const apiKey = getApiKey(backend.type);
  if (!apiKey) {
    throw new Error(
      `No API key for ${backend.name}. Set ${backend.type.toUpperCase()}_API_KEY in environment.`
    );
  }

  switch (backend.type) {
    case 'anthropic':
      return callAnthropic(backend, request, apiKey);

    case 'openai':
    case 'mistral':
      return callOpenAIFormat(
        backend,
        request,
        PROVIDER_URLS[backend.type],
        apiKey
      );

    default:
      throw new Error(`Unknown remote provider type: ${backend.type}`);
  }
}

/**
 * Check if a remote provider's API key is configured.
 */
export function isRemoteConfigured(backend: BackendConfig): boolean {
  return !!getApiKey(backend.type);
}
