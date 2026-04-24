import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Instigenie E2E journeys.
 *
 * Runs against the local dev stack — API on :4000, web on :3000. The tests
 * assume both are already up (docker-compose + pnpm dev in apps/api and
 * apps/web). They do NOT start or stop servers.
 *
 * Headless by default. `pnpm test:headed` to watch a run.
 */
export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // serial — tests share the dev org + create real DB rows
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
