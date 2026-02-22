import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPii, BUILTIN_PATTERNS } from '../src/privacy/patterns';
import { classifyPrivacy } from '../src/privacy/router';

describe('PII Pattern Detection', () => {
  it('detects email addresses', () => {
    const result = detectPii('Please contact john.doe@example.com for details');
    assert.ok(result);
    assert.equal(result.name, 'email');
  });

  it('detects phone numbers', () => {
    const result = detectPii('Call me at +49 170 1234567');
    assert.ok(result);
    assert.equal(result.name, 'phone');
  });

  it('detects US SSN', () => {
    const result = detectPii('My SSN is 123-45-6789');
    assert.ok(result);
    assert.equal(result.name, 'ssn');
  });

  it('detects credit card numbers', () => {
    const result = detectPii('Card: 4111 1111 1111 1111');
    assert.ok(result);
    assert.equal(result.name, 'credit-card');
  });

  it('detects IPv4 addresses', () => {
    const result = detectPii('Server at 192.168.1.100');
    assert.ok(result);
    assert.equal(result.name, 'ip-address');
  });

  it('detects IBAN', () => {
    const result = detectPii('Pay to DE89 3704 0044 0532 0130 00');
    assert.ok(result);
    assert.equal(result.name, 'iban');
  });

  it('returns null for clean text', () => {
    const result = detectPii('What is the weather like today?');
    assert.equal(result, null);
  });

  it('returns null for code snippets without PII', () => {
    const result = detectPii('function add(a: number, b: number) { return a + b; }');
    assert.equal(result, null);
  });

  it('detects custom patterns', () => {
    const result = detectPii('Employee EMP-123456 needs access', [
      { name: 'employee-id', regex: 'EMP-\\d{6}' },
    ]);
    assert.ok(result);
    assert.equal(result.name, 'employee-id');
  });

  it('ignores invalid custom regex', () => {
    const result = detectPii('Some text', [
      { name: 'bad', regex: '[invalid(' },
    ]);
    assert.equal(result, null);
  });
});

describe('Privacy Router', () => {
  it('respects X-Portico-Privacy header', () => {
    const result = classifyPrivacy(
      { 'x-portico-privacy': 'local-only' },
      [{ role: 'user', content: 'Hello' }]
    );
    assert.equal(result.classification, 'local-only');
    assert.equal(result.method, 'header');
  });

  it('forces local-only when PII is detected', () => {
    const result = classifyPrivacy(
      {},
      [{ role: 'user', content: 'Send results to alice@company.com' }]
    );
    assert.equal(result.classification, 'local-only');
    assert.equal(result.method, 'pattern');
  });

  it('uses default policy for clean messages without header', () => {
    const result = classifyPrivacy(
      {},
      [{ role: 'user', content: 'Explain quantum computing' }]
    );
    // Default from config is local-preferred
    assert.equal(result.method, 'default');
  });

  it('header takes priority over PII detection', () => {
    // If the user explicitly says remote-ok, respect that even with PII
    const result = classifyPrivacy(
      { 'x-portico-privacy': 'remote-ok' },
      [{ role: 'user', content: 'My email is test@test.com' }]
    );
    assert.equal(result.classification, 'remote-ok');
    assert.equal(result.method, 'header');
  });
});
