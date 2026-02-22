/**
 * PII detection patterns for the Privacy Router.
 *
 * When a message matches any pattern, the query is classified as `local-only`
 * regardless of other settings. This ensures sensitive data never leaves the
 * local network.
 */

export interface PiiPattern {
  name: string;
  regex: RegExp;
  description: string;
}

// Ordered most-specific first to avoid greedy matches
export const BUILTIN_PATTERNS: PiiPattern[] = [
  {
    name: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    description: 'Email addresses',
  },
  {
    name: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/,
    description: 'US Social Security Numbers',
  },
  {
    name: 'iban',
    regex: /\b[A-Z]{2}\d{2}[\s]?[\dA-Z]{4}[\s]?(?:[\dA-Z]{4}[\s]?){2,7}[\dA-Z]{1,4}\b/,
    description: 'IBAN (International Bank Account Numbers)',
  },
  {
    name: 'credit-card',
    regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{2,7}\b/,
    description: 'Credit card numbers (Visa, MC, Amex, Discover)',
  },
  {
    name: 'ip-address',
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/,
    description: 'IPv4 addresses',
  },
  {
    name: 'eu-id',
    regex: /\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[.\s]?\d{3}[.\s]?\d{3}[.\s]?\d{2}\b/,
    description: 'European national ID patterns (French NIR, etc.)',
  },
  {
    name: 'phone',
    regex: /(?<![.\d])(?:\+\d{1,3}[\s.-])?\(?\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![.\d])|(?<![.\d])\+\d{1,3}[\s.-]\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![.\d])/,
    description: 'Phone numbers (international formats)',
  },
];

/**
 * Test a string against all PII patterns.
 * Returns the first matching pattern, or null if clean.
 */
export function detectPii(
  text: string,
  extraPatterns?: Array<{ name: string; regex: string }>
): PiiPattern | null {
  // Check built-in patterns
  for (const pattern of BUILTIN_PATTERNS) {
    if (pattern.regex.test(text)) return pattern;
  }

  // Check custom patterns
  if (extraPatterns) {
    for (const custom of extraPatterns) {
      try {
        const re = new RegExp(custom.regex);
        if (re.test(text)) {
          return { name: custom.name, regex: re, description: `Custom: ${custom.name}` };
        }
      } catch {
        // Invalid regex in config — skip
      }
    }
  }

  return null;
}
