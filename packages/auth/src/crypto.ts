import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encrypts small secrets (authenticator-app keys) at rest with AES-256-GCM.
 *
 * The key comes from AUTH_ENCRYPTION_KEY: 32 random bytes, base64-encoded
 * (generate one with `openssl rand -base64 32`). Production refuses to start
 * without it. In development and tests a fixed key is used so nothing extra has to
 * be set up; data encrypted with it is not protected.
 */
const DEV_KEY = createHash('sha256').update('civicscope-development-only-key').digest();

function key(): Buffer {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32');
    }
    return DEV_KEY;
  }
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    throw new Error('AUTH_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  }
  return decoded;
}

/** Returns "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognized encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
