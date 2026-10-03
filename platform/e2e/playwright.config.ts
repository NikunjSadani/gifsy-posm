import { defineConfig, devices } from '@playwright/test';

/**
 * POSM end-to-end regression harness (go-live smoke).
 *
 * Runs against a RUNNING stack (does not spin one up) so it works unchanged against local dev and a
 * deployed env. Point it with env vars:
 *   E2E_BASE_URL       frontend base URL           (default http://localhost:3000)
 *   E2E_PASSWORD       shared seed login password  (default Password123 — local/staging only)
 *   E2E_EMAIL_DOMAIN   seed login email domain     (default kwality.in)
 *
 * Serial (workers:1) on purpose: the specs share the tenant's seeded data and a couple mutate it
 * (create/deactivate a POSM type), so parallel runs would race. Each spec logs in fresh.
 */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './specs',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The field capture flow reads geolocation; granting it here is harmless for the other specs.
    permissions: ['geolocation'],
    geolocation: { latitude: 19.07, longitude: 72.87 },
  },
  // Use the system Chrome (`channel: 'chrome'`) rather than Playwright's bundled Chromium — no
  // 195 MB browser download to depend on, and Playwright still launches it in an isolated profile.
  // Swap to bundled Chromium by removing `channel` once `npx playwright install chromium` has run.
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
