import { createRoute, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { createRouter, errorResponse } from "../lib/openapi.js";

const healthSchema = z.object({ status: z.literal("ok") }).openapi("Health");

const readySchema = z
  .object({ status: z.enum(["ok", "degraded"]), db: z.enum(["up", "down"]) })
  .openapi("Readiness");

export const healthRoutes = createRouter();

healthRoutes.openapi(
  createRoute({
    method: "get",
    path: "/health",
    summary: "Liveness probe",
    tags: ["System"],
    responses: {
      200: {
        description: "Service is up",
        content: { "application/json": { schema: healthSchema } },
      },
      500: errorResponse("Palvelinvirhe"),
    },
  }),
  (c) => c.json({ status: "ok" as const }, 200),
);

healthRoutes.openapi(
  createRoute({
    method: "get",
    path: "/health/ready",
    summary: "Readiness probe (checks the database)",
    tags: ["System"],
    responses: {
      200: {
        description: "Service and dependencies are ready",
        content: { "application/json": { schema: readySchema } },
      },
      503: {
        description: "A dependency is unavailable",
        content: { "application/json": { schema: readySchema } },
      },
    },
  }),
  async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ status: "ok" as const, db: "up" as const }, 200);
    } catch (err) {
      c.get("logger").error({ err }, "readiness db check failed");
      return c.json({ status: "degraded" as const, db: "down" as const }, 503);
    }
  },
);
