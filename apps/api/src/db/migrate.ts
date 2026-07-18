import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../config/env.js";

/**
 * Apply pending SQL migrations from ./drizzle. Uses a dedicated single connection
 * (max: 1) so the migrator runs cleanly, then exits.
 */
async function main() {
  const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
  const dbm = drizzle(migrationClient);
  console.log("[db] applying migrations…");
  await migrate(dbm, { migrationsFolder: "./drizzle" });
  console.log("[db] migrations applied");
  await migrationClient.end();
}

main().catch((err: unknown) => {
  console.error("[db] migration failed:", err);
  process.exit(1);
});
