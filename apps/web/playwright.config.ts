import { defineConfig, devices } from "@playwright/test";
import { loadRepoEnv } from "./e2e/helpers/env.js";

// Share the API's config with the test process (SEED_ADMIN_PASSWORD for the
// login helper, DATABASE_URL for global-setup migrate/seed). Runs in the main
// process before workers fork.
loadRepoEnv();

/**
 * E2E config. `globalSetup` reseeds the DB to a deterministic state; the API and
 * web dev servers are started (or reused locally) for the run. Admin specs share
 * seeded state, so everything runs serially (one worker) in filename order.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "blob" : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @rahaaon/api dev",
      url: "http://localhost:3001/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @rahaaon/web dev",
      url: "http://localhost:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
