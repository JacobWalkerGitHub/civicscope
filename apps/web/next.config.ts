import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@civicscope/core'],
  // Produces a self-contained server for the ECS container image.
  output: 'standalone',
};

export default nextConfig;
