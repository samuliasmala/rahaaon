import postgres from "postgres";

/**
 * Drop and recreate the throwaway database the E2E suite runs against, so a
 * `pnpm test:e2e` never touches the database local development lives in.
 *
 * Takes the target from `DATABASE_URL` (the Playwright config derives it from
 * the configured one by appending `_e2e`) and connects to the `postgres`
 * maintenance database on the same server to do the DDL. `db:reset-e2e` chains
 * the usual migrate + seed after this, leaving a fully seeded, deterministic
 * database behind — which also means the previous run's database survives
 * until the next run, so a failure can still be inspected.
 */

/** Databases this is allowed to drop: the suffix the E2E config appends. */
const REQUIRED_SUFFIX = "_e2e";

/**
 * This script is destructive by design, so refuse anything that doesn't look
 * like the disposable E2E database: the name must carry the `_e2e` suffix, and
 * the server must be local — a `.env` that has drifted toward a remote/
 * production database can't be dropped by `pnpm test:e2e`. Set
 * E2E_ALLOW_REMOTE_DB=1 to override the host check intentionally.
 */
function parseTarget(): { url: URL; name: string } {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set — nothing to reset.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL — refusing to reset.");
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name.endsWith(REQUIRED_SUFFIX)) {
    throw new Error(
      `Refusing to drop database "${name}": only names ending in ` +
        `"${REQUIRED_SUFFIX}" are treated as disposable E2E databases.`,
    );
  }

  const local = new Set(["localhost", "127.0.0.1", "::1", "db", "postgres"]);
  if (process.env.E2E_ALLOW_REMOTE_DB !== "1" && !local.has(url.hostname)) {
    throw new Error(
      `Refusing to drop a database on non-local host "${url.hostname}". ` +
        `Set E2E_ALLOW_REMOTE_DB=1 to override.`,
    );
  }

  return { url, name };
}

async function main() {
  const { url, name } = parseTarget();

  // DDL can't run while connected to the database being dropped, so go through
  // the maintenance database initdb always creates on the same server.
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  // onnotice: the first run's "database does not exist, skipping" NOTICE is
  // printed as a stack-like blob by the driver's default handler, which reads
  // as a failure in the Playwright webServer log. Nothing here needs notices.
  const sql = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });

  try {
    // FORCE (Postgres 13+) terminates leftover connections — an API server from
    // an aborted run would otherwise block the drop.
    await sql`drop database if exists ${sql(name)} with (force)`;
    await sql`create database ${sql(name)}`;
    console.log(`[e2e-db] recreated ${name}`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error("[e2e-db] reset failed:", err);
  process.exit(1);
});
