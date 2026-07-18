import { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Application errors carry an HTTP status and a stable machine-readable `code`,
 * so the frontend can branch on `code` rather than parse messages. All errors
 * surface through the central error handler as a consistent JSON envelope.
 */
export type ErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "rate_limited"
  | "internal_error";

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: ContentfulStatusCode, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Kirjautuminen vaaditaan") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "Ei käyttöoikeutta") => new AppError(403, "forbidden", message);
export const notFound = (message = "Ei löytynyt") => new AppError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, "unprocessable", message, details);

/** The JSON error envelope returned to clients (and described in the OpenAPI doc). */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string().openapi({ example: "Ei löytynyt" }),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .openapi("ErrorResponse");

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
