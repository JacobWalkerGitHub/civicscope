import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';
import { base32Decode, base32Encode, otpauthUrl, totpCode, totpStep, verifyTotp } from './totp';

// RFC 6238 appendix B test secret (ASCII "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(totpCode(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
    }
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from('any bytes at all, even odd lengths!');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('accepts the current code and one step of drift, and never the same step twice', () => {
    const now = new Date(1_700_000_000_000);
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('builds an authenticator link', () => {
    expect(otpauthUrl('a@b.test', 'ABC')).toBe(
      'otpauth://totp/CivicScope%3Aa%40b.test?secret=ABC&issuer=CivicScope&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('secret encryption', () => {
  it('round-trips and detects tampering', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(stored)).toBe('JBSWY3DPEHPK3PXP');
    const parts = stored.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });
});
