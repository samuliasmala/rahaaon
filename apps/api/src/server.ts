import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDb } from "./db/client.js";
import { startArchiveWorker, stopArchiveWorker } from "./lib/article-archive.js";
import { logger } from "./lib/logger.js";
import { startSubmissionProcessor, stopSubmissionProcessor } from "./lib/submission-processor.js";

const app = createApp();

// Background workers (archive capture + submission processing): they resume
// rows a restart stranded and poll for retries. Fire-and-forget start: a
// failure here must not stop the server from serving.
void startArchiveWorker().catch((err: Error) => {
  logger.error({ err: err.message }, "archive worker failed to start");
});
void startSubmissionProcessor().catch((err: Error) => {
  logger.error({ err: err.message }, "submission processor failed to start");
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
    // Stop the workers (and let their in-flight drains finish) before closing
    // the pool, so a mid-drain query doesn't hit a closed connection.
    void Promise.all([stopArchiveWorker(), stopSubmissionProcessor()])
      .then(() => closeDb())
      .finally(() => {
        clearTimeout(force);
        process.exit(0);
      });
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal));
}
