import { createRoute, z } from "@hono/zod-openapi";
import { listAdminItems, listItems, reprocessItem, toggleVote, updateItem } from "./items.repo.js";
import {
  adminWasteItemSchema,
  generateKeywordsRequestSchema,
  generatedKeywordsSchema,
  patchItemSchema,
  voteResultSchema,
  wasteItemSchema,
} from "./schemas.js";
import { generateKeywords } from "../../lib/keyword-ai.js";
import { commonErrorResponses, createRouter, errorResponse } from "../../lib/openapi.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { ensureVisitor, readVisitor } from "../../middleware/visitor.js";
import { instructionsOrNull, processRequestSchema } from "../submissions/schemas.js";

const idParam = z.object({ id: z.uuid() });

// Voting is anonymous (visitor cookie); a per-IP limit damps scripted vote
// flipping without getting in the way of a reader toggling through the feed.
const voteLimit = rateLimit({ name: "vote", windowMs: 60_000, max: 30 });

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
    middleware: [voteLimit, ensureVisitor] as const,
    request: { params: idParam },
    responses: {
      200: {
        description: "New vote count and the visitor's vote state",
        content: { "application/json": { schema: voteResultSchema } },
      },
      429: errorResponse("Liikaa pyyntöjä"),
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
        content: { "application/json": { schema: z.array(adminWasteItemSchema) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const items = await listAdminItems({ voterId: c.get("visitorId") });
    return c.json(items, 200);
  },
);

itemRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/admin/items/{id}",
    summary: "Apply editorial edits to a published item, hiding/restoring included",
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
    await updateItem(c.req.valid("param").id, c.req.valid("json"));
    return c.json({ ok: true as const }, 200);
  },
);

itemRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/items/{id}/reprocess",
    summary:
      "Re-run the AI extraction for a published item, optionally with editor instructions; the redraft lands on the live item",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: {
      params: idParam,
      body: { content: { "application/json": { schema: processRequestSchema } } },
    },
    responses: {
      202: {
        description: "Queued — the admin listing reports reprocessing: true until the run finishes",
        content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      },
      409: errorResponse("Uudelleenkäsittely ei ole mahdollinen tai on jo käynnissä"),
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const { instructions } = c.req.valid("json");
    await reprocessItem(c.req.valid("param").id, instructionsOrNull(instructions));
    return c.json({ ok: true as const }, 202);
  },
);

// Serves both editors: suggestions get keywords at extraction time, but items
// published before the feature (and redrafts) need them generated on demand.
// Works from the request body, not a stored row, so the editor's unsaved
// draft is what gets keyworded — and one route covers items and suggestions.
itemRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/keywords/generate",
    summary: "Draft search keywords with AI from the given case content",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: {
      body: { content: { "application/json": { schema: generateKeywordsRequestSchema } } },
    },
    responses: {
      200: {
        description: "Drafted keywords — not saved until the editor saves the form",
        content: { "application/json": { schema: generatedKeywordsSchema } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const keywords = await generateKeywords(c.req.valid("json"));
    return c.json({ keywords }, 200);
  },
);
