import { describe, expect, it } from 'vitest';
import { databaseUrlFromEnv } from './client';

describe('databaseUrlFromEnv', () => {
  it('prefers DATABASE_URL', () => {
    expect(databaseUrlFromEnv({ DATABASE_URL: 'mysql://a:b@h/d', DB_HOST: 'x' })).toBe(
      'mysql://a:b@h/d',
    );
  });

  it('builds a URL from separate fields, escaping the password', () => {
    const url = databaseUrlFromEnv({
      DB_HOST: 'db.example.internal',
      DB_NAME: 'civicscope',
      DB_USER: 'civicscope_app',
      DB_PASSWORD: 'p@ss/w:rd#1',
      DB_TLS: 'true',
    })!;
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('db.example.internal');
    expect(parsed.port).toBe('3306');
    expect(decodeURIComponent(parsed.password)).toBe('p@ss/w:rd#1');
    expect(parsed.searchParams.get('ssl')).toBe('{"rejectUnauthorized":true}');
  });

  it('returns null when nothing is set', () => {
    expect(databaseUrlFromEnv({})).toBeNull();
    expect(databaseUrlFromEnv({ DB_HOST: 'h' })).toBeNull();
  });
});
