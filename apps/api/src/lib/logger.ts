import { pino, type Logger } from "pino";
import { env } from "../config/env.js";

/**
 * Root Pino logger. Pretty-prints in dev, structured JSON in prod. A child
 * logger with a request id is attached per request by the request-context
 * middleware.
 */
export const logger: Logger = pino({
  level: env.isTest ? "silent" : (process.env.LOG_LEVEL ?? (env.isProd ? "info" : "debug")),
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
    remove: true,
  },
  // Pretty transport only in local dev (pino-pretty is a devDependency); prod and
  // test use plain JSON so a --prod install never fails to resolve the transport.
  ...(env.isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export type { Logger };
