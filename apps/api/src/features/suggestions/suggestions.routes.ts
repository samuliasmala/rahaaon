import { createRoute, z } from "@hono/zod-openapi";
import { patchSuggestionSchema, suggestionSchema } from "./schemas.js";
import {
  approveSuggestion,
  listPendingSuggestions,
  rejectSuggestion,
  updateSuggestion,
} from "./suggestions.repo.js";
import { commonErrorResponses, createRouter } from "../../lib/openapi.js";
import { requireAuth } from "../../middleware/auth.js";

const idParam = z.object({ id: z.uuid() });

export const suggestionRoutes = createRouter();

suggestionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/admin/suggestions",
    summary: "The AI queue: pending suggestions, newest first",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: "Pending suggestions",
        content: { "application/json": { schema: z.array(suggestionSchema) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const rows = await listPendingSuggestions();
    return c.json(rows, 200);
  },
);

suggestionRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/admin/suggestions/{id}",
    summary: "Apply editorial edits to a pending suggestion",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: {
      params: idParam,
      body: { content: { "application/json": { schema: patchSuggestionSchema } } },
    },
    responses: {
      200: {
        description: "Updated suggestion",
        content: { "application/json": { schema: suggestionSchema } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const updated = await updateSuggestion(c.req.valid("param").id, c.req.valid("json"));
    return c.json(updated, 200);
  },
);

suggestionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/suggestions/{id}/approve",
    summary: "Publish a pending suggestion to the feed",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: { params: idParam },
    responses: {
      200: {
        description: "Published",
        content: { "application/json": { schema: z.object({ itemId: z.uuid() }) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const result = await approveSuggestion(c.req.valid("param").id);
    return c.json(result, 200);
  },
);

suggestionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/suggestions/{id}/reject",
    summary: "Reject a pending suggestion",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: { params: idParam },
    responses: {
      200: {
        description: "Rejected",
        content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    await rejectSuggestion(c.req.valid("param").id);
    return c.json({ ok: true as const }, 200);
  },
);
