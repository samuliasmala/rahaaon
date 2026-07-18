import { createRoute, z } from "@hono/zod-openapi";
import { listItems, setItemHidden, toggleVote } from "./items.repo.js";
import { patchItemSchema, voteResultSchema, wasteItemSchema } from "./schemas.js";
import { commonErrorResponses, createRouter } from "../../lib/openapi.js";
import { requireAuth } from "../../middleware/auth.js";
import { ensureVisitor, readVisitor } from "../../middleware/visitor.js";

const idParam = z.object({ id: z.uuid() });

export const itemRoutes = createRouter();

itemRoutes.openapi(
  createRoute({
    method: "get",
    path: "/items",
    summary: "Published feed items (visible only), newest first",
    tags: ["Items"],
    middleware: [readVisitor] as const,
    responses: {
      200: {
        description: "Items",
        content: { "application/json": { schema: z.array(wasteItemSchema) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const items = await listItems({ includeHidden: false, voterId: c.get("visitorId") });
    return c.json(items, 200);
  },
);

itemRoutes.openapi(
  createRoute({
    method: "post",
    path: "/items/{id}/vote",
    summary: 'Toggle the visitor\'s "this is a waste" vote',
    tags: ["Items"],
    middleware: [ensureVisitor] as const,
    request: { params: idParam },
    responses: {
      200: {
        description: "New vote count and the visitor's vote state",
        content: { "application/json": { schema: voteResultSchema } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const result = await toggleVote(c.req.valid("param").id, c.get("visitorId")!);
    return c.json(result, 200);
  },
);

itemRoutes.openapi(
  createRoute({
    method: "get",
    path: "/admin/items",
    summary: "All published items including hidden ones (editorial)",
    tags: ["Admin"],
    middleware: [requireAuth, readVisitor] as const,
    responses: {
      200: {
        description: "Items",
        content: { "application/json": { schema: z.array(wasteItemSchema) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const items = await listItems({ includeHidden: true, voterId: c.get("visitorId") });
    return c.json(items, 200);
  },
);

itemRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/admin/items/{id}",
    summary: "Hide an item from the feed, or restore it (editorial)",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: {
      params: idParam,
      body: { content: { "application/json": { schema: patchItemSchema } } },
    },
    responses: {
      200: {
        description: "Updated",
        content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    await setItemHidden(c.req.valid("param").id, c.req.valid("json").hidden);
    return c.json({ ok: true as const }, 200);
  },
);
