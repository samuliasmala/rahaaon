import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { auth } from "./auth/auth.js";
import { env } from "./config/env.js";
import { itemRoutes } from "./features/items/items.routes.js";
import { suggestionRoutes } from "./features/suggestions/suggestions.routes.js";
import { notFound } from "./lib/http-errors.js";
import { createRouter } from "./lib/openapi.js";
import { onError } from "./middleware/error.js";
import { requestContext } from "./middleware/request-context.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";

/**
 * Builds the API application. Kept separate from the server bootstrap so tests
 * exercise routes via `app.request(...)`.
 */
export function createApp() {
  const app = createRouter();

  app.use("*", requestContext);
  app.use(
    "*",
    cors({
      origin: env.APP_URL,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // better-auth owns all of /api/auth/* (sign-in, sign-out, session…).
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Feature routers (mounted under /api).
  app.route("/api", healthRoutes);
  app.route("/api", meRoutes);
  app.route("/api", itemRoutes);
  app.route("/api", suggestionRoutes);

  // OpenAPI document (consumed by orval to generate the typed web client) + UI.
  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Rahaaon API",
      version: "0.1.0",
      description: "Crowdsourced tracker of wasteful public spending (rahaaon.fi).",
    },
    servers: [{ url: env.API_URL }],
  });
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

  app.notFound(() => {
    throw notFound("Reittiä ei löytynyt");
  });
  app.onError(onError);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
