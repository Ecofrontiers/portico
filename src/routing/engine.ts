/**
 * Route Engine
 *
 * Final routing decision. Combines privacy classification with
 * carbon-optimal backend selection.
 *
 * Binary enforcement: if classified local-only, NEVER routes to remote.
 * Returns an error instead of violating the privacy constraint.
 *
 * Ecofrontiers SARL, AGPL-3.0
 */

import { BackendConfig, PrivacyDecision, RoutingDecision, ChatCompletionRequest } from '../types';
import { scoreBackend } from '../scoring/carbon';

/**
 * Select the best backend for a request.
 *
 * @param backends - All registered backends
 * @param privacy - The privacy classification for this request
 * @param request - The chat completion request (for model matching)
 * @returns The routing decision, or throws if no backend can serve the request
 */
export function routeRequest(
  backends: BackendConfig[],
  privacy: PrivacyDecision,
  request: ChatCompletionRequest
): RoutingDecision {
  const requestedModel = request.model;

  // Filter backends by privacy constraint
  let eligible = filterByPrivacy(backends, privacy);

  // Filter to healthy backends only
  eligible = eligible.filter(b => b.healthy);

  if (eligible.length === 0) {
    // If local-only and no local backends are healthy, return a clear error
    if (privacy.classification === 'local-only') {
      throw new RoutingError(
        'No healthy local backends available. Query classified as local-only — refusing to route to remote.',
        'LOCAL_ONLY_NO_BACKEND',
        privacy
      );
    }
    throw new RoutingError(
      'No healthy backends available.',
      'NO_BACKEND',
      privacy
    );
  }

  // If a specific model was requested, prefer backends that have it
  if (requestedModel) {
    const withModel = eligible.filter(b =>
      b.models.includes(requestedModel) || b.models.length === 0
    );
    if (withModel.length > 0) {
      eligible = withModel;
    }
    // If no backend explicitly lists the model, try all eligible
    // (some backends accept any model name)
  }

  // Score each backend (lower = better)
  const scored = eligible.map(b => ({
    backend: b,
    score: scoreBackend(b),
  }));
  scored.sort((a, b) => a.score - b.score);

  const best = scored[0];
  const model = requestedModel || best.backend.models[0] || 'default';

  return {
    backend: best.backend,
    model,
    reason: buildReason(best.backend, best.score, privacy, scored.length),
    privacyClass: privacy.classification,
    carbonIntensity: undefined, // populated by carbon scorer if enabled
  };
}

/**
 * Filter backends by privacy classification.
 */
function filterByPrivacy(
  backends: BackendConfig[],
  privacy: PrivacyDecision
): BackendConfig[] {
  switch (privacy.classification) {
    case 'local-only':
      // Only local backends. Never remote, never federated.
      return backends.filter(b => b.tier === 'local');

    case 'local-preferred':
      // All backends, but local ones are scored higher (handled in scoring)
      return backends;

    case 'remote-ok':
      // All backends equally eligible
      return backends;

    default:
      return backends;
  }
}

function buildReason(
  backend: BackendConfig,
  score: number,
  privacy: PrivacyDecision,
  candidateCount: number
): string {
  const parts = [
    `${backend.name} (${backend.tier})`,
    `privacy: ${privacy.classification} via ${privacy.method}`,
    `score: ${score}`,
    `${candidateCount} candidates`,
  ];
  return parts.join(' · ');
}

// --- Error type ---

export class RoutingError extends Error {
  code: string;
  privacy: PrivacyDecision;

  constructor(message: string, code: string, privacy: PrivacyDecision) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
    this.privacy = privacy;
  }
}
