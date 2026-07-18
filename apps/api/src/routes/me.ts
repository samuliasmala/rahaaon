import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "../lib/openapi.js";
import { optionalAuth } from "../middleware/auth.js";

const meSchema = z
  .object({
    user: z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
    }),
  })
  .openapi("Me");

export const meRoutes = createRouter();

meRoutes.openapi(
  createRoute({
    method: "get",
    path: "/me",
    summary: "Current editorial user, or null when not signed in",
    tags: ["Auth"],
    middleware: [optionalAuth] as const,
    responses: {
      200: {
        description: "Current principal, or null for anonymous visitors",
        // Union (not .nullable()) so the Me component itself stays non-null in
        // the OpenAPI doc — only this response is `Me | null`.
        content: { "application/json": { schema: z.union([meSchema, z.null()]) } },
      },
    },
  }),
  (c) => {
    // Anonymous is a valid answer, not an error: public pages probe this
    // endpoint to decide whether to show admin affordances, and a 401 would be
    // console noise in every visitor's browser.
    const user = c.get("user");
    if (!user) return c.json(null, 200);
    return c.json({ user }, 200);
  },
);
