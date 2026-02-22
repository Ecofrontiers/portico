import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest, RoutingError } from '../src/routing/engine';
import { BackendConfig, PrivacyDecision, ChatCompletionRequest } from '../src/types';

function makeBackend(overrides: Partial<BackendConfig>): BackendConfig {
  return {
    name: 'test',
    type: 'ollama',
    tier: 'local',
    url: 'http://localhost:11434',
    models: ['llama3.2'],
    priority: 1,
    healthy: true,
    lastChecked: new Date(),
    ...overrides,
  };
}

const localBackend = makeBackend({ name: 'ollama', tier: 'local', models: ['llama3.2', 'mistral'] });
const remoteBackend = makeBackend({ name: 'openai', type: 'openai', tier: 'remote', models: ['gpt-4o'], priority: 10 });
const allBackends = [localBackend, remoteBackend];

const simpleRequest: ChatCompletionRequest = {
  messages: [{ role: 'user', content: 'Hello' }],
};

describe('Route Engine', () => {
  it('routes to local when privacy is local-only', () => {
    const privacy: PrivacyDecision = {
      classification: 'local-only',
      method: 'pattern',
      detail: 'PII detected',
    };
    const result = routeRequest(allBackends, privacy, simpleRequest);
    assert.equal(result.backend.tier, 'local');
    assert.equal(result.privacyClass, 'local-only');
  });

  it('throws when local-only but no local backends are healthy', () => {
    const unhealthyLocal = makeBackend({ name: 'ollama', healthy: false });
    const privacy: PrivacyDecision = {
      classification: 'local-only',
      method: 'header',
      detail: 'explicit',
    };
    assert.throws(
      () => routeRequest([unhealthyLocal, remoteBackend], privacy, simpleRequest),
      (err: any) => err instanceof RoutingError && err.code === 'LOCAL_ONLY_NO_BACKEND'
    );
  });

  it('prefers local when privacy is local-preferred', () => {
    const privacy: PrivacyDecision = {
      classification: 'local-preferred',
      method: 'default',
      detail: 'default',
    };
    const result = routeRequest(allBackends, privacy, simpleRequest);
    // Local should be preferred due to lower score
    assert.equal(result.backend.tier, 'local');
  });

  it('routes to remote when model is only available remotely', () => {
    const privacy: PrivacyDecision = {
      classification: 'remote-ok',
      method: 'header',
      detail: 'explicit',
    };
    const request: ChatCompletionRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const result = routeRequest(allBackends, privacy, request);
    assert.equal(result.backend.name, 'openai');
    assert.equal(result.model, 'gpt-4o');
  });

  it('falls back to any eligible backend if model is not listed', () => {
    const privacy: PrivacyDecision = {
      classification: 'remote-ok',
      method: 'default',
      detail: 'default',
    };
    const request: ChatCompletionRequest = {
      model: 'unknown-model',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    // Should not throw — backends with empty model lists accept anything
    const result = routeRequest(allBackends, privacy, request);
    assert.ok(result.backend);
  });

  it('skips unhealthy backends', () => {
    const unhealthyLocal = makeBackend({ name: 'ollama', healthy: false });
    const healthyRemote = makeBackend({ name: 'openai', type: 'openai', tier: 'remote', healthy: true, priority: 10 });
    const privacy: PrivacyDecision = {
      classification: 'local-preferred',
      method: 'default',
      detail: 'default',
    };
    const result = routeRequest([unhealthyLocal, healthyRemote], privacy, simpleRequest);
    assert.equal(result.backend.name, 'openai');
  });

  it('throws when no backends are available', () => {
    const privacy: PrivacyDecision = {
      classification: 'remote-ok',
      method: 'default',
      detail: 'default',
    };
    assert.throws(
      () => routeRequest([], privacy, simpleRequest),
      (err: any) => err instanceof RoutingError && err.code === 'NO_BACKEND'
    );
  });
});
