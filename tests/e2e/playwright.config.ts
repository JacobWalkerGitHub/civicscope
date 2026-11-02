import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * Run through `pnpm test:e2e`, which starts a disposable MySQL database, creates the
 * test users and passes DATABASE_URL to the app server started below.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @civicscope/web exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
  },
});
