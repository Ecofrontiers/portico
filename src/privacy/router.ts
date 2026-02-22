/**
 * Privacy Router
 *
 * Classifies every query before it touches any backend.
 * Three classification methods (in priority order):
 *
 * 1. Header annotation — X-Portico-Privacy: local-only | local-preferred | remote-ok
 * 2. Regex pattern matching — PII detection forces local-only
 * 3. Configurable default policy — from portico.yml
 *
 * Output: a PrivacyDecision with the classification and reason.
 */

import { PrivacyClass, PrivacyDecision, ChatMessage } from '../types';
import { config } from '../config';
import { detectPii } from './patterns';

const VALID_CLASSES: PrivacyClass[] = ['local-only', 'local-preferred', 'remote-ok'];

/**
 * Classify a request's privacy level.
 */
export function classifyPrivacy(
  headers: Record<string, string | string[] | undefined>,
  messages: ChatMessage[]
): PrivacyDecision {
  // Method 1: Explicit header annotation (strongest signal)
  const headerValue = headers['x-portico-privacy'];
  if (headerValue) {
    const normalized = (Array.isArray(headerValue) ? headerValue[0] : headerValue)
      .toLowerCase()
      .trim() as PrivacyClass;
    if (VALID_CLASSES.includes(normalized)) {
      return {
        classification: normalized,
        method: 'header',
        detail: `X-Portico-Privacy: ${normalized}`,
      };
    }
  }

  // Method 2: PII pattern matching (content inspection)
  if (config.privacy.patterns.enabled) {
    const allText = messages.map(m => m.content).join(' ');
    const match = detectPii(allText, config.privacy.patterns.custom);
    if (match) {
      return {
        classification: 'local-only',
        method: 'pattern',
        detail: `PII detected: ${match.name} (${match.description})`,
      };
    }
  }

  // Method 3: Default policy
  return {
    classification: config.privacy.default,
    method: 'default',
    detail: `Default policy: ${config.privacy.default}`,
  };
}
