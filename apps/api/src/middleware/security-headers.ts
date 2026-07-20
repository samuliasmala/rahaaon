import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/context.js";

/**
 * Baseline security response headers set by the API itself, so the protection
 * does not depend on the reverse proxy in front of it. In production the host
 * Caddy adds its own (broader) set for the web app, but the Vite dev proxy adds
 * nothing, and a future deployment might front the API differently.
 *
 * - `X-Content-Type-Options: nosniff` matters most for the archive-text
 *   endpoint, which serves attacker-derived content inline as `text/markdown`;
 *   without it a browser could sniff it to `text/html` and execute it.
 * - The API returns only JSON and plain text, so a locked-down CSP is a safe,
 *   meaningful floor for anyone who navigates straight to an API URL. The one
 *   exception is the Swagger UI page (`/api/docs`), which loads its own assets
 *   and would break under `default-src 'none'`.
 */
const STRICT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const DOCS_PATH = "/api/docs";

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  if (c.req.path !== DOCS_PATH) c.header("Content-Security-Policy", STRICT_CSP);
});
