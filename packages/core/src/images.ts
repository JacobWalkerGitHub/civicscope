/** Photo formats CivicScope accepts. SVG is excluded: it can carry scripts. */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * Identifies an image by its first bytes rather than trusting a file name or a
 * server's Content-Type header. Returns null for anything that isn't a JPEG, PNG
 * or WebP image.
 */
export function sniffPhotoType(bytes: Uint8Array): PhotoType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * True for addresses a server-side download must never reach: loopback, private
 * networks, link-local (including cloud metadata at 169.254.169.254), carrier-grade
 * NAT, multicast and reserved ranges, for IPv4 and IPv6.
 */
export function isBlockedAddress(address: string): boolean {
  const v4 = address.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (!v6.includes(':')) return true; // Not an IP address at all: refuse.
  if (v6 === '::' || v6 === '::1') return true;
  if (/^::ffff:/.test(v6)) return true; // Mapped forms not caught above (hex notation).
  if (/^f[cd]/.test(v6)) return true; // Unique local fc00::/7
  if (/^fe[89ab]/.test(v6)) return true; // Link-local fe80::/10
  if (/^ff/.test(v6)) return true; // Multicast
  if (/^64:ff9b:/.test(v6)) return true; // NAT64 can reach IPv4 internals
  if (/^2001:(db8|0?:)/.test(v6)) return true; // Documentation and Teredo
  return false;
}
