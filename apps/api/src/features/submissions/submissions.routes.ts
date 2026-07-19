import { createRoute, z } from "@hono/zod-openapi";
import { pagePreviewSchema, submitUrlSchema, urlSubmissionSchema } from "./schemas.js";
import { createSubmission, listNewSubmissions, processSubmission } from "./submissions.repo.js";
import { commonErrorResponses, createRouter } from "../../lib/openapi.js";
import { fetchPagePreview } from "../../lib/page-preview.js";
import { requireAuth } from "../../middleware/auth.js";

const idParam = z.object({ id: z.uuid() });

// NOTE: the two public endpoints below are anonymous and unthrottled (accepted
// MVP scope — same posture as the voting endpoint). If junk floods the
// Ehdotusjono or the preview fetcher gets abused, add rate limiting here first.
export const submissionRoutes = createRouter();

submissionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/submissions/preview",
    summary: "Fetch the google-like page preview for a link, without submitting anything",
    tags: ["Submissions"],
    request: { body: { content: { "application/json": { schema: submitUrlSchema } } } },
    responses: {
      200: {
        description: "Page metadata for the confirmation card",
        content: { "application/json": { schema: pagePreviewSchema } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const { url } = c.req.valid("json");
    return c.json(await fetchPagePreview(url), 200);
  },
);

submissionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/submissions",
    summary: "Submit a confirmed link to the Ehdotusjono (anonymous)",
    tags: ["Submissions"],
    request: { body: { content: { "application/json": { schema: submitUrlSchema } } } },
    responses: {
      201: {
        description: "Queued for editorial processing",
        content: { "application/json": { schema: z.object({ id: z.uuid() }) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const { url } = c.req.valid("json");
    const created = await createSubmission(url);
    return c.json({ id: created.id }, 201);
  },
);

submissionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/admin/submissions",
    summary: "The Ehdotusjono: unprocessed reader links, newest first",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: "New submissions",
        content: { "application/json": { schema: z.array(urlSubmissionSchema) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const rows = await listNewSubmissions();
    return c.json(rows, 200);
  },
);

submissionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/submissions/{id}/process",
    summary: "Send a submission to the AI queue (creates a pending suggestion)",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: { params: idParam },
    responses: {
      200: {
        description: "Moved to the AI queue",
        content: { "application/json": { schema: z.object({ suggestionId: z.uuid() }) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const result = await processSubmission(c.req.valid("param").id);
    return c.json(result, 200);
  },
);
