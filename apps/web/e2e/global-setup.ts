import { execSync } from "node:child_process";
import path from "node:path";
import { loadRepoEnv } from "./helpers/env.js";

/**
 * Reset the database to a known state before the E2E run: apply migrations and
 * re-run the (idempotent) demo seed, which wipes the content tables and
 * re-inserts the demo items + the editorial user. Every run therefore starts
 * from the same 8 items / 3 queued suggestions, so the specs are deterministic
 * regardless of prior runs. Runs against the same DATABASE_URL the dev servers
 * use (from .env).
 */
export default function globalSetup(): void {
  loadRepoEnv();
  assertLocalDatabase();
  const repoRoot = path.resolve(process.cwd(), "../..");
  const run = (cmd: string) => execSync(cmd, { cwd: repoRoot, stdio: "inherit", env: process.env });
  run("pnpm --filter @rahaaon/api db:migrate");
  run("pnpm --filter @rahaaon/api db:seed");
}

/**
 * The seed is destructive (wipes content tables + the admin user). Refuse to
 * run unless DATABASE_URL points at a local host, so a `.env` that has drifted
 * toward a remote/production database can't be wiped by `pnpm test:e2e`. Set
 * E2E_ALLOW_REMOTE_DB=1 to override intentionally.
 */
function assertLocalDatabase(): void {
  if (process.env.E2E_ALLOW_REMOTE_DB === "1") return;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — refusing to seed for E2E.");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: cannot verify it is local.`);
  }
  const local = new Set(["localhost", "127.0.0.1", "::1", "db", "postgres"]);
  if (!local.has(host)) {
    throw new Error(
      `Refusing to migrate/seed a non-local database (host "${host}"). E2E is ` +
        `destructive. Set E2E_ALLOW_REMOTE_DB=1 to override.`,
    );
  }
}
