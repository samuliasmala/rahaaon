import { defineConfig, devices } from "@playwright/test";
import { loadRepoEnv } from "./e2e/helpers/env.js";

// Share the API's config with the test process (SEED_ADMIN_PASSWORD for the
// login helper, DATABASE_URL for global-setup migrate/seed). Runs in the main
// process before workers fork.
loadRepoEnv();

// E2E must never call the real LLM API: blank the key so the API server the
// run starts falls back to the offline mock extraction. Blanked here (not just
// in the webServer env below) so no process in the E2E tree ever sees it.
process.env.OPENAI_API_KEY = "";

// Dedicated E2E ports so the run never collides with (or reuses) the normal
// dev servers on 5174/3001 — those may be running with a real OPENAI_API_KEY.
const API_PORT = 3101;
const WEB_PORT = 5274;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

/**
 * E2E config. `globalSetup` reseeds the DB to a deterministic state; fresh API
 * and web dev servers are started on dedicated ports for every run (never
 * reused, so their env is always the one set below). Admin specs share seeded
 * state, so everything runs serially (one worker) in filename order.
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
    baseURL: WEB_URL,
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
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        // better-auth baseURL + OpenAPI server URL must match the port the
        // server actually listens on (requests arrive via the Vite proxy with
        // the target host).
        API_URL,
        // CORS + auth trustedOrigins for the E2E web origin.
        APP_URL: WEB_URL,
        // Force the offline mock extraction — E2E never calls the real LLM.
        OPENAI_API_KEY: "",
      },
    },
    {
      // No `--` separator: pnpm forwards script args as-is, and vite would
      // treat everything after a literal `--` as positional.
      command: `pnpm --filter @rahaaon/web dev --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_PROXY_TARGET: API_URL,
      },
    },
  ],
});
