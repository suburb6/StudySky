import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: '4173',
      HOST: '127.0.0.1',
      ORIGIN: 'http://127.0.0.1:4173',
      DATABASE_URL:
        process.env.DATABASE_URL || 'postgresql://studysky:studysky@127.0.0.1:5432/studysky_test',
      STORAGE_ROOT: process.env.STORAGE_ROOT || './data/e2e-uploads',
      DISABLE_BACKGROUND_JOBS: process.env.DISABLE_BACKGROUND_JOBS || 'true'
    }
  }
});
