import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Validated environment configuration. Parsed once at import; a misconfigured
 * server fails fast at boot rather than deep in a request. Secrets are optional
 * in dev/test (sensible defaults) but required in production.
 *
 * In non-production, the nearest `.env` (searching upward from cwd to the repo
 * root) is loaded so CLI scripts (migrate/seed) and the dev server pick up local
 * config. Production relies on real environment variables only.
 */

const isProd = process.env.NODE_ENV === "production";

if (!isProd) {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks up from process.cwd(), no user input involved
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  APP_URL: z.string().url().default("http://localhost:5174"),
  API_URL: z.string().url().default("http://localhost:3001"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Secrets: required in production, dev default otherwise.
  AUTH_SECRET: z.string().min(16).optional(),

  /** Password given to the seeded editorial user (db:seed). */
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
});

const DEV_AUTH_SECRET = "dev-only-insecure-auth-secret-0000000000";

function loadEnv() {
  const parsed = rawSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  if (isProd && !env.AUTH_SECRET) {
    throw new Error("Missing required production secrets: AUTH_SECRET");
  }

  return {
    ...env,
    AUTH_SECRET: env.AUTH_SECRET ?? DEV_AUTH_SECRET,
    isProd,
    isDev: env.NODE_ENV === "development",
    isTest: env.NODE_ENV === "test",
  };
}

export type Env = ReturnType<typeof loadEnv>;

export const env: Env = loadEnv();
