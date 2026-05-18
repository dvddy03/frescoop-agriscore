import { describe, it, expect } from 'vitest';
import { createToken, verifyToken, checkRateLimit } from '../../server/lib.js';

const TEST_SECRET = 'test-secret-for-unit-tests-32chars!';

describe('Token system', () => {
  it('creates and verifies a valid token', () => {
    const token = createToken('user-1', 'admin', TEST_SECRET);
    const payload = verifyToken(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload.uid).toBe('user-1');
    expect(payload.role).toBe('admin');
  });

  it('rejects token with wrong secret', () => {
    const token = createToken('user-1', 'admin', TEST_SECRET);
    const payload = verifyToken(token, 'wrong-secret');
    expect(payload).toBeNull();
  });

  it('rejects expired token', () => {
    const token = createToken('user-1', 'admin', TEST_SECRET, -1000);
    const payload = verifyToken(token, TEST_SECRET);
    expect(payload).toBeNull();
  });

  it('rejects null/empty/malformed tokens', () => {
    expect(verifyToken(null, TEST_SECRET)).toBeNull();
    expect(verifyToken('', TEST_SECRET)).toBeNull();
    expect(verifyToken('not-a-token', TEST_SECRET)).toBeNull();
    expect(verifyToken('abc.def', TEST_SECRET)).toBeNull();
  });

  it('rejects tampered payload', () => {
    const token = createToken('user-1', 'admin', TEST_SECRET);
    const [payload, sig] = token.split('.');
    const tampered = Buffer.from('{"uid":"hacker","role":"admin","exp":99999999999999}').toString('base64url');
    expect(verifyToken(tampered + '.' + sig, TEST_SECRET)).toBeNull();
  });
});

describe('Rate limiter', () => {
  it('allows requests under limit', () => {
    const buckets = new Map();
    for (let i = 0; i < 120; i++) {
      expect(checkRateLimit(buckets, '1.2.3.4', false)).toBe(true);
    }
  });

  it('blocks requests over limit', () => {
    const buckets = new Map();
    for (let i = 0; i < 120; i++) {
      checkRateLimit(buckets, '1.2.3.4', false);
    }
    expect(checkRateLimit(buckets, '1.2.3.4', false)).toBe(false);
  });

  it('has stricter limit for auth endpoints', () => {
    const buckets = new Map();
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(buckets, '1.2.3.4', true)).toBe(true);
    }
    expect(checkRateLimit(buckets, '1.2.3.4', true)).toBe(false);
  });

  it('tracks different IPs separately', () => {
    const buckets = new Map();
    for (let i = 0; i < 10; i++) {
      checkRateLimit(buckets, '1.1.1.1', true);
    }
    expect(checkRateLimit(buckets, '1.1.1.1', true)).toBe(false);
    expect(checkRateLimit(buckets, '2.2.2.2', true)).toBe(true);
  });
});
