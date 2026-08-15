import { defineConfig, devices } from "@playwright/test";
import { loadRepoEnv } from "./e2e/helpers/env.js";

// Share the API's config with the test process (SEED_ADMIN_PASSWORD for the
// login helper, DATABASE_URL as the base the E2E database is derived from).
// Runs in the main process before workers fork.
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
 * The run gets its own database — the configured one with an `_e2e` suffix —
 * dropped, recreated, migrated and seeded by `db:reset-e2e` before the API
 * server starts, so local dev data survives `pnpm test:e2e` and every run
 * starts from the same deterministic seed.
 *
 * The reset can't live in `globalSetup`: Playwright sets up `webServer` (a
 * plugin) *before* global setup, so the database has to exist by the time the
 * API server boots — hence the `&&` in the API command below. Derived here
 * rather than read from the env so the suffix is applied exactly once, and with
 * no side effects, since the config is re-evaluated in worker processes.
 */
const E2E_DATABASE_URL = e2eDatabaseUrl();

function e2eDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set — cannot derive the E2E database.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL — cannot derive the E2E database.");
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name) throw new Error("DATABASE_URL names no database — cannot derive the E2E database.");
  url.pathname = `/${encodeURIComponent(name.endsWith("_e2e") ? name : `${name}_e2e`)}`;
  return url.toString();
}

/**
 * E2E config. Fresh API and web dev servers are started on dedicated ports for
 * every run (never reused, so their env is always the one set below). Admin
 * specs share seeded state, so everything runs serially (one worker) in
 * filename order.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "blob" : "list",
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
      // Recreate + migrate + seed the E2E database first: the server's
      // background workers (archive, processor, notifier) poll from boot, so
      // the schema has to be there before it starts.
      command: "pnpm --filter @rahaaon/api db:reset-e2e && pnpm --filter @rahaaon/api dev",
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        // Applies to both halves of the command. Set explicitly so the server
        // can never open the dev database: config/env.ts loads the repo `.env`
        // via process.loadEnvFile, which leaves already-set vars alone.
        DATABASE_URL: E2E_DATABASE_URL,
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
