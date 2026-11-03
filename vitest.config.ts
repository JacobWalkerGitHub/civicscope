import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'infra/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.integration.test.ts'],
          // Starting a MySQL container can take a while on a cold CI runner.
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
