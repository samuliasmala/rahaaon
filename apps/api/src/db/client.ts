import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

/**
 * Long-running Postgres connection pool (postgres.js) + Drizzle. Works against
 * the local `postgres:17` in Docker and a managed Postgres in production.
 */
const queryClient = postgres(env.DATABASE_URL, {
  max: env.isProd ? 20 : 10,
  // Fast-fail when the DB is unreachable so the readiness probe returns promptly.
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;

/** Transaction handle passed to `db.transaction` callbacks. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Close the pool (used by scripts and tests). */
export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}

export { schema };
