// --- Privacy Classification ---

export type PrivacyClass = 'local-only' | 'local-preferred' | 'remote-ok';

export interface PrivacyDecision {
  classification: PrivacyClass;
  method: 'header' | 'pattern' | 'default';
  detail: string;
}

// --- Carbon Scoring ---

export interface EnergyData {
  zone: string;
  carbonIntensity: number;     // gCO2eq/kWh
  renewablePercent: number;    // 0-100
  pricePerKwh: number;         // $/kWh estimate
  source: string;
  lastUpdated: Date;
}

// --- Backend Definitions ---

export type BackendType = 'ollama' | 'openai' | 'anthropic' | 'mistral' | 'openai-compatible' | 'portico-peer';
export type BackendTier = 'local' | 'remote' | 'federated';

export interface BackendConfig {
  name: string;
  type: BackendType;
  tier: BackendTier;
  url?: string;
  models: string[];
  priority?: number;
  healthy: boolean;
  lastChecked: Date;
}

// --- Routing ---

export interface RoutingDecision {
  backend: BackendConfig;
  model: string;
  reason: string;
  privacyClass: PrivacyClass;
  carbonIntensity?: number;
}

// --- OpenAI-compatible API ---

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  // Portico extensions
  portico?: {
    backend: string;
    tier: BackendTier;
    privacyClass: PrivacyClass;
    carbonIntensity?: number;
    routingReason: string;
  };
}

// --- Configuration ---

export interface PorticoConfig {
  server: {
    port: number;
    host: string;
  };
  auth: {
    enabled: boolean;
    keys: string[];
  };
  privacy: {
    default: PrivacyClass;
    patterns: {
      enabled: boolean;
      custom?: Array<{ name: string; regex: string }>;
    };
  };
  backends: {
    local: Array<{
      name: string;
      type: BackendType;
      url: string;
      models: string[];
      priority?: number;
    }>;
    remote: Array<{
      name: string;
      type: BackendType;
      models: string[];
    }>;
    federated?: Array<{
      name: string;
      url: string;
      trust: PrivacyClass;
    }>;
  };
  carbon: {
    enabled: boolean;
    provider?: string;
    zone?: string;
    poll_interval?: number;
  };
  logging: {
    level: string;
    file?: string;
  };
}
