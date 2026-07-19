import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDb } from "./db/client.js";
import { failStalePendingArchives } from "./lib/article-archive.js";
import { logger } from "./lib/logger.js";

const app = createApp();

// Archives stranded at 'pending' by a restart mid-archive get closed out.
// Fire-and-forget: a failure here must not stop the server from serving.
void failStalePendingArchives().catch((err: Error) => {
  logger.error({ err: err.message }, "stale-archive sweep failed");
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, url: `http://localhost:${info.port}` }, "api listening");
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  // Force-exit if graceful close hangs on keep-alive sockets.
  const force = setTimeout(() => {
    logger.warn("forced shutdown after timeout");
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(() => {
    void closeDb().finally(() => {
      clearTimeout(force);
      process.exit(0);
    });
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal));
}
