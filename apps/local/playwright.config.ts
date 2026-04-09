import { defineConfig, devices } from '@playwright/test';

const e2eHost = process.env.E2E_HOST || '127.0.0.1';
const e2ePort = Number(process.env.E2E_PORT || 3100);
const e2eBaseUrl = `http://${e2eHost}:${e2ePort}`;

/**
 * Playwright E2E test configuration for the AGX local board workspace
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  
  // Run tests in files in parallel
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI for stability
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list']
  ],
  
  // Shared settings for all the projects
  use: {
    // Base URL to use in tests
    baseURL: e2eBaseUrl,
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run local dev server before starting the tests
  webServer: {
    command: `npm run dev -- --hostname ${e2eHost} --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
