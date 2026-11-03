import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

// Use the repository's root .env in development (Next.js only reads apps/web/.env).
// Variables already set in the environment win.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const isProduction = process.env.NODE_ENV === 'production';

/*
 * Content Security Policy. Scripts and styles come only from this site. Next.js still
 * needs inline scripts for hydration, so 'unsafe-inline' stays until pages move to
 * per-request nonces; the rest (no plugins, no framing, forms and <base> only to this
 * site) still blocks the common injection routes. Development adds 'unsafe-eval' for
 * hot reload.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  // HTTPS only, for two years. Browsers ignore this header on plain-http development.
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@civicscope/core', '@civicscope/db', '@civicscope/auth', '@civicscope/cms'],
  // Native and driver packages load from node_modules at runtime instead of being bundled.
  serverExternalPackages: ['@node-rs/argon2', 'mysql2'],
  // Produces a self-contained server for the ECS container image.
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    // Room for a 5 MB candidate photo plus the form fields around it.
    serverActions: { bodySizeLimit: '6mb' },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Photos send their own stricter policy (sandboxed, nothing allowed), which this
      // one would replace.
      { source: '/((?!photos/).*)', headers: [{ key: 'Content-Security-Policy', value: csp }] },
      {
        // The admin area must never appear in search results or be cached by a CDN.
        source: '/admin/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
