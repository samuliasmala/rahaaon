import fs from "node:fs";
import path from "node:path";

/**
 * Load the repo-root `.env` into `process.env` (without overriding anything
 * already set) so the E2E process shares the exact config the API server runs
 * with — notably `SEED_ADMIN_PASSWORD`, needed to log in as the seeded
 * editorial user. Called at config load (main process) so worker processes
 * inherit the values.
 */
export function loadRepoEnv(): void {
  const envPath = path.resolve(process.cwd(), "../../.env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip matched surrounding quotes, matching Node's process.loadEnvFile (which
    // the API uses) so a quoted secret parses identically in both processes.
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.at(-1) === val[0]) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
