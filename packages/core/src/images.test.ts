import { describe, expect, it } from 'vitest';
import { isBlockedAddress, sniffPhotoType } from './images';

describe('sniffPhotoType', () => {
  it('recognizes JPEG, PNG and WebP by their first bytes', () => {
    expect(sniffPhotoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffPhotoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe('image/png');
    expect(sniffPhotoType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
  });

  it('rejects everything else, including SVG and HTML posing as images', () => {
    expect(sniffPhotoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffPhotoType(Buffer.from('<!doctype html>'))).toBeNull();
    expect(sniffPhotoType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffPhotoType(new Uint8Array())).toBeNull();
  });
});

describe('isBlockedAddress', () => {
  it('blocks private, loopback, link-local and metadata addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
      'localhost',
    ]) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const a of ['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(a), a).toBe(false);
    }
  });
});
