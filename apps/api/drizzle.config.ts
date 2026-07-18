import { defineConfig } from "drizzle-kit";

// Read directly from the environment so drizzle-kit CLI works without importing
// the app's validated env (which pulls in more than the CLI needs).
const url = process.env.DATABASE_URL ?? "postgres://rahaaon:rahaaon@localhost:5434/rahaaon";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
