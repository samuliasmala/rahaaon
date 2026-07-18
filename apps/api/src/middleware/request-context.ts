import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { logger } from "../lib/logger.js";
import type { AppEnv } from "../lib/context.js";

/**
 * Assigns each request a request id (honouring an inbound `x-request-id`),
 * attaches a child logger, echoes the id back, and writes one structured access
 * log line per request with method, path, status and duration.
 */
/** Accept an inbound request id only if it's short and safe; else generate one. */
function resolveRequestId(inbound: string | undefined): string {
  if (inbound && /^[\w.-]{1,128}$/.test(inbound)) return inbound;
  return randomUUID();
}

export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = resolveRequestId(c.req.header("x-request-id"));
  const reqLogger = logger.child({ requestId });
  c.set("requestId", requestId);
  c.set("logger", reqLogger);
  c.header("x-request-id", requestId);

  const start = performance.now();
  await next();
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  reqLogger.info(
    { method: c.req.method, path: c.req.path, status: c.res.status, durationMs },
    "request",
  );
});
