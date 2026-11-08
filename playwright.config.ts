import { defineConfig, devices } from '@playwright/test';

// Local runs use the system Chrome; CI installs Playwright's Chromium.
const executablePath = process.env.PLAYWRIGHT_CHROME ?? (process.env.CI ? undefined : '/usr/bin/google-chrome');
const launchOptions = { executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
const live = !!process.env.PLOPS_E2E_LIVE;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: live ? ['**/*.spec.ts'] : ['**/demo.spec.ts'],
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { launchOptions, screenshot: 'only-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: 'node scripts/serve-subpath.mjs 4317 /playotic-plops/ dist', url: 'http://localhost:4317/playotic-plops/', reuseExistingServer: true },
    ...(live
      ? [
          { command: 'node scripts/serve-subpath.mjs 4318 /playotic-plops/ dist-live', url: 'http://localhost:4318/playotic-plops/', reuseExistingServer: true },
          { command: 'node scripts/local-backend.mjs 54321', port: 54321, reuseExistingServer: true, env: { PLOPS_DB_URL: process.env.PLOPS_DB_URL ?? '', ALLOWED_ORIGINS: 'http://localhost:4318', PLOPS_FAKE_CENSUS: '1' } },
        ]
      : []),
  ],
});
