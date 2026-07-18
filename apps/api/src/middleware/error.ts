import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { AppError, type ErrorResponse } from "../lib/http-errors.js";
import type { AppEnv } from "../lib/context.js";
import type { Context } from "hono";

/**
 * Central error handler (registered via `app.onError`). Maps every thrown error
 * to the consistent `{ error: { code, message, details?, requestId } }` envelope:
 *   - AppError        → its status/code
 *   - ZodError        → 422 validation_error with field issues
 *   - HTTPException   → its status
 *   - anything else   → 500 internal_error (details hidden from the client)
 */
export function onError(err: Error, c: Context<AppEnv>): Response {
  const requestId = c.get("requestId");
  const log = c.get("logger") ?? console;

  const appError = normalize(err);

  if (appError.status >= 500) {
    log.error({ err, code: appError.code }, "unhandled error");
  } else {
    log.warn({ code: appError.code, message: appError.message }, "request error");
  }

  const body: ErrorResponse = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
  return c.json(body, appError.status);
}

function normalize(err: Error): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(422, "validation_error", "Virheellinen syöte", {
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof HTTPException) {
    return new AppError(err.status, statusToCode(err.status), err.message || "Virhe");
  }
  return new AppError(500, "internal_error", "Palvelinvirhe");
}

function statusToCode(status: number): AppError["code"] {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "unprocessable";
    case 429:
      return "rate_limited";
    default:
      return "internal_error";
  }
}
