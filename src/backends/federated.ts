/**
 * Federated Portico peers
 *
 * Connect to other Portico instances for cooperative capacity sharing.
 * Peer requests are forwarded as standard OpenAI-compatible calls
 * with an X-Portico-Peer header identifying the origin.
 *
 * Status: scaffolded for v2 milestone (federation protocol).
 */

import { ChatCompletionRequest, ChatCompletionResponse, BackendConfig } from '../types';
import { v4 as uuid } from 'uuid';

/**
 * Forward a request to a federated Portico peer.
 */
export async function callPeer(
  backend: BackendConfig,
  request: ChatCompletionRequest,
  originInstance?: string
): Promise<ChatCompletionResponse> {
  if (!backend.url) {
    throw new Error(`No URL configured for peer ${backend.name}`);
  }

  const url = `${backend.url}/v1/chat/completions`;
  const body = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Portico-Peer': originInstance || 'unknown',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Peer ${backend.name} ${res.status}: ${text}`);
  }

  return await res.json() as ChatCompletionResponse;
}

/**
 * Discover available models from a Portico peer.
 */
export async function discoverPeerModels(peerUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${peerUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.data || []).map((m: any) => m.id);
  } catch {
    return [];
  }
}

/**
 * Health check a Portico peer.
 */
export async function checkPeerHealth(peerUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${peerUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
