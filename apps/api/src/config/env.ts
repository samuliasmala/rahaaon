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

/**
 * The env templates ship `KEY=` lines; loadEnvFile turns those into empty
 * strings, which must mean "unset" — not fail `min()` validation at boot.
 */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  APP_URL: z.string().url().default("http://localhost:5174"),
  API_URL: z.string().url().default("http://localhost:3001"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Secrets: required in production, dev default otherwise.
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),

  /**
   * LLM access for the AI ingestion pipeline (suggestion extraction). Optional:
   * without a key dev/test fall back to the mock extraction; in production the
   * process endpoint returns 503 until the key is configured.
   */
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Model used for article extraction; any OpenAI model id. */
  LLM_MODEL: z.preprocess(emptyToUndefined, z.string().default("gpt-5-mini")),

  /** Password given to the seeded editorial user (db:seed). */
  SEED_ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(8).optional()),

  /**
   * Object storage for the article archive (raw text captured at submit time).
   * The same S3_* values the backup runner uses: R2 in prod, MinIO in the
   * dev/test stacks and local dev. All four must be set for archiving to run —
   * without them submissions simply skip archiving (archive_status stays null).
   */
  // Deliberately not .url(): the var is shared with the backup tooling, and a
  // malformed value should break the optional archive feature at first use,
  // not the whole API at boot.
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
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
