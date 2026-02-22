import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import { PorticoConfig, BackendConfig } from './types';

dotenv.config();

const DEFAULT_CONFIG: PorticoConfig = {
  server: { port: 3040, host: '0.0.0.0' },
  auth: { enabled: false, keys: [] },
  privacy: {
    default: 'local-preferred',
    patterns: { enabled: true },
  },
  backends: {
    local: [{
      name: 'ollama',
      type: 'ollama',
      url: 'http://localhost:11434',
      models: [],
    }],
    remote: [],
  },
  carbon: { enabled: false },
  logging: { level: 'info' },
};

function loadYamlConfig(): Partial<PorticoConfig> {
  const configPath = process.env.PORTICO_CONFIG || path.resolve(process.cwd(), 'portico.yml');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return (yaml.load(raw) as Partial<PorticoConfig>) || {};
  } catch {
    console.log(`[config] No config file at ${configPath}, using defaults`);
    return {};
  }
}

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    if (sourceVal === undefined) continue;
    if (
      typeof sourceVal === 'object' &&
      sourceVal !== null &&
      !Array.isArray(sourceVal) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as any, sourceVal as any);
    } else {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

const yamlConfig = loadYamlConfig();
export const config: PorticoConfig = deepMerge(DEFAULT_CONFIG, yamlConfig);

// Apply env overrides
if (process.env.PORT) config.server.port = parseInt(process.env.PORT, 10);
if (process.env.HOST) config.server.host = process.env.HOST;
if (process.env.PORTICO_API_KEYS) {
  config.auth.enabled = true;
  config.auth.keys = process.env.PORTICO_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
}

// Build the flat backend registry from config
export function buildBackendRegistry(): BackendConfig[] {
  const backends: BackendConfig[] = [];

  for (const local of config.backends.local || []) {
    backends.push({
      name: local.name,
      type: local.type,
      tier: 'local',
      url: local.url,
      models: local.models,
      priority: local.priority ?? 1,
      healthy: false, // checked at startup
      lastChecked: new Date(0),
    });
  }

  for (const remote of config.backends.remote || []) {
    backends.push({
      name: remote.name,
      type: remote.type,
      tier: 'remote',
      models: remote.models,
      priority: 10,
      healthy: true, // assume reachable
      lastChecked: new Date(0),
    });
  }

  for (const peer of config.backends.federated || []) {
    backends.push({
      name: peer.name,
      type: 'portico-peer',
      tier: 'federated',
      url: peer.url,
      models: [],
      priority: 5,
      healthy: false,
      lastChecked: new Date(0),
    });
  }

  return backends;
}
