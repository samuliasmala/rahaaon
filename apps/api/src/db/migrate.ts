import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { urlSubmission, wasteItem } from "./schema/index.js";
import { env } from "../config/env.js";
import { normalizeUrl } from "../lib/url.js";

type Db = ReturnType<typeof drizzle>;

/**
 * Fill `url_key` on rows that predate duplicate detection. The normalization
 * (lib/url.ts) is far past what SQL can express, so it can't ride along in the
 * migration file and lives here instead — right after the schema change that
 * adds the column, on the one command every deploy already runs.
 *
 * Idempotent by construction: only the "" default is selected, so a second run
 * finds nothing. That also makes it self-healing — a row somehow written
 * without a key picks one up on the next deploy. A round trip per row is fine
 * for a one-time pass over tables this size.
 */
async function backfillUrlKeys(dbm: Db): Promise<void> {
  const tables = [
    { label: "url_submission", table: urlSubmission, urlColumn: urlSubmission.url },
    { label: "waste_item", table: wasteItem, urlColumn: wasteItem.sourceUrl },
  ] as const;

  for (const { label, table, urlColumn } of tables) {
    const rows = await dbm
      .select({ id: table.id, url: urlColumn })
      .from(table)
      .where(eq(table.urlKey, ""));
    if (rows.length === 0) continue;

    await dbm.transaction(async (tx) => {
      for (const row of rows) {
        await tx
          .update(table)
          .set({ urlKey: normalizeUrl(row.url) })
          .where(eq(table.id, row.id));
      }
    });
    console.log(`[db] backfilled url_key on ${rows.length} ${label} row(s)`);
  }
}

/**
 * Apply pending SQL migrations from ./drizzle, then run the data backfills the
 * SQL can't express. Uses a dedicated single connection (max: 1) so the
 * migrator runs cleanly, then exits.
 */
async function main() {
  const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
  const dbm = drizzle(migrationClient);
  console.log("[db] applying migrations…");
  await migrate(dbm, { migrationsFolder: "./drizzle" });
  console.log("[db] migrations applied");
  await backfillUrlKeys(dbm);
  await migrationClient.end();
}

main().catch((err: unknown) => {
  console.error("[db] migration failed:", err);
  process.exit(1);
});
