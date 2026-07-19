import { OpenAPIHono } from "@hono/zod-openapi";
import { errorResponseSchema } from "./http-errors.js";
import type { AppEnv } from "./context.js";

/**
 * Factory for every router in the app (root and feature routers). Crucially it
 * sets the `defaultHook` so Zod validation failures are thrown into the central
 * error handler and returned as the consistent envelope — a plain
 * `new OpenAPIHono()` would instead leak the raw validator 400. Always create
 * routers with this.
 */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw result.error;
    },
  });
}

/** A documented error response referencing the shared ErrorResponse component. */
export function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: errorResponseSchema } },
  } as const;
}

/**
 * Standard error responses to spread into a route's `responses`, so the generated
 * OpenAPI doc (and the orval client) carries the typed error envelope.
 */
export const commonErrorResponses = {
  400: errorResponse("Virheellinen pyyntö"),
  401: errorResponse("Kirjautuminen vaaditaan"),
  403: errorResponse("Ei käyttöoikeutta"),
  404: errorResponse("Ei löytynyt"),
  422: errorResponse("Validointivirhe"),
  500: errorResponse("Palvelinvirhe"),
  503: errorResponse("Palvelu ei tilapäisesti käytettävissä"),
} as const;
