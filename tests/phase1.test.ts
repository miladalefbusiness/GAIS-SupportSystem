import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  resolveEffectivePermissions,
} from '../src/core/auth/permissions-catalog.ts';
import { logger } from '../src/core/logging/logger.ts';
import {
  computeKeyedHmac,
  constantTimeEquals,
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '../src/core/security/crypto.ts';
import {
  checkRateLimit,
  resetRateLimitBuckets,
} from '../src/core/security/rate-limit.ts';
import { LocalDiskStorageDriver } from '../src/core/storage/local-storage.ts';
import { formatBytesFa, formatJalaliDate, toPersianDigits } from '../src/lib/jalali.ts';

describe('Phase 1 Core Foundation Tests', () => {
  it('evaluates RBAC effective permissions with deny-by-default and deny override precedence', () => {
    const empty = resolveEffectivePermissions([], []);
    expect(empty).toEqual([]);

    const resolved = resolveEffectivePermissions(
      ['desk:workspace:access', 'desk:tickets:reply'],
      [
        { permissionKey: 'files:workspace:access', effect: 'allow' },
        { permissionKey: 'desk:tickets:reply', effect: 'deny' },
      ]
    );
    expect(resolved).toEqual(['desk:workspace:access', 'files:workspace:access']);

    const superAdmin = SYSTEM_ROLES.find((r) => r.slug === 'super_admin');
    expect(superAdmin?.permissionKeys.length).toBe(PERMISSION_CATALOG.length);
  });

  it('encrypts/decrypts values with AES-256-GCM and computes keyed HMAC deterministically', () => {
    const encKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const ciphertext = encryptSensitiveValue('0012345678', encKey);
    expect(ciphertext).not.toContain('0012345678');
    expect(decryptSensitiveValue(ciphertext, encKey)).toBe('0012345678');

    const tampered = `${ciphertext.slice(0, -2)}AA`;
    expect(() => decryptSensitiveValue(tampered, encKey)).toThrow();

    const h1 = computeKeyedHmac('0012345678', encKey);
    const h2 = computeKeyedHmac('0012345678', encKey);
    expect(constantTimeEquals(h1, h2)).toBe(true);
  });

  it('prevents path traversal and stores/reads files safely in LocalDiskStorageDriver', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'supportdesk-storage-'));
    try {
      const driver = new LocalDiskStorageDriver(tempRoot);
      const health = await driver.healthCheck();
      expect(health.ok).toBe(true);
      expect(health.writable).toBe(true);

      const saved = await driver.put('2026/11/test-object.txt', Buffer.from('hello world'));
      expect(saved.byteSize).toBe(11);
      expect(await driver.exists('2026/11/test-object.txt')).toBe(true);

      await driver.delete('2026/11/test-object.txt');
      expect(await driver.exists('2026/11/test-object.txt')).toBe(false);

      expect(() => driver.resolveSafePath('../../etc/passwd')).toThrow();
      expect(() => driver.resolveSafePath('/etc/shadow')).toThrow();
      expect(() => driver.resolveSafePath('bad key?.txt')).toThrow();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('enforces sliding-window rate limits for login protection', () => {
    resetRateLimitBuckets();
    const key = 'login:127.0.0.1:superadmin';
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
    const blocked = checkRateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('redacts sensitive secrets and PII in structured logs', () => {
    const sanitized = logger.sanitize({
      username: 'superadmin',
      password: 'plain-password',
      apiKey: 'sk-12345',
      nationalId: '0012345678',
      nested: { cookie: 'abc' },
    }) as Record<string, unknown>;

    expect(sanitized.username).toBe('superadmin');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.apiKey).toBe('[REDACTED]');
    expect(sanitized.nationalId).toBe('[REDACTED]');
    expect((sanitized.nested as Record<string, unknown>).cookie).toBe('[REDACTED]');
  });

  it('formats Persian digits, bytes, and Jalali dates cleanly', () => {
    expect(toPersianDigits('2026-01-05')).toBe('۲۰۲۶-۰۱-۰۵');
    expect(formatBytesFa(2048)).toBe('۲.۰ کیلوبایت');
    expect(formatJalaliDate('2026-03-21T10:00:00Z')).not.toBe('—');
  });
});
