import { createRoute, z } from "@hono/zod-openapi";
import {
  pagePreviewSchema,
  rejectedUrlSubmissionSchema,
  submitUrlSchema,
  urlSubmissionSchema,
} from "./schemas.js";
import {
  createSubmission,
  getSubmissionArchiveText,
  listNewSubmissions,
  listRejectedSubmissions,
  queueSubmissionForProcessing,
  rejectSubmission,
  restoreSubmission,
  saveSubmissionArchiveText,
} from "./submissions.repo.js";
import { commonErrorResponses, createRouter, errorResponse } from "../../lib/openapi.js";
import { fetchPagePreview } from "../../lib/page-preview.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

const idParam = z.object({ id: z.uuid() });

// The two public endpoints below are anonymous; per-IP rate limits keep the
// preview fetcher from being used as a fetch proxy and junk from flooding the
// Ehdotusjono. Both stay well above any honest submitter's pace.
const previewLimit = rateLimit({ name: "preview", windowMs: 60_000, max: 10 });
const submitLimit = rateLimit({ name: "submit", windowMs: 60_000, max: 5 });
const submitDailyLimit = rateLimit({
  name: "submit-daily",
  windowMs: 24 * 60 * 60 * 1000,
  max: 50,
});

export const submissionRoutes = createRouter();

submissionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/submissions/preview",
    summary: "Fetch the google-like page preview for a link, without submitting anything",
    tags: ["Submissions"],
    middleware: [previewLimit] as const,
    request: { body: { content: { "application/json": { schema: submitUrlSchema } } } },
    responses: {
      200: {
        description: "Page metadata for the confirmation card",
        content: { "application/json": { schema: pagePreviewSchema } },
      },
      429: errorResponse("Liikaa pyyntöjä"),
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
    middleware: [submitLimit, submitDailyLimit] as const,
    request: { body: { content: { "application/json": { schema: submitUrlSchema } } } },
    responses: {
      201: {
        description: "Queued for editorial processing",
        content: { "application/json": { schema: z.object({ id: z.uuid() }) } },
      },
      429: errorResponse("Liikaa pyyntöjä"),
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
    summary: "Queue a submission for AI processing (runs in the background)",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: { params: idParam },
    responses: {
      202: {
        description:
          "Queued — the entry returns with processing: true until the extraction finishes",
        content: { "application/json": { schema: urlSubmissionSchema } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const queued = await queueSubmissionForProcessing(c.req.valid("param").id);
    return c.json(queued, 202);
  },
);

submissionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/admin/submissions/{id}/archive/text",
    summary: "The page text (Markdown) archived at submit time",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: {
      params: idParam,
      // ?download=1 adds the attachment disposition; without it the text is
      // served inline for the in-app viewer/editor.
      query: z.object({ download: z.string().optional() }),
    },
    responses: {
      200: {
        description: "The archived text",
        content: { "text/markdown": { schema: z.string() } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { download } = c.req.valid("query");
    const { text, filename } = await getSubmissionArchiveText(id);
    const type = filename.endsWith(".md") ? "text/markdown" : "text/plain";
    c.header("Content-Type", `${type}; charset=utf-8`);
    if (download === "1") c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.body(text, 200);
  },
);

submissionRoutes.openapi(
  createRoute({
    method: "put",
    path: "/admin/submissions/{id}/archive/text",
    summary: "Save a manually edited archive text (e.g. a pasted paywalled article)",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: {
      params: idParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ text: z.string().min(1).max(200_000) }).openapi("ArchiveTextEdit"),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Saved",
        content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { text } = c.req.valid("json");
    await saveSubmissionArchiveText(id, text);
    return c.json({ ok: true as const }, 200);
  },
);

submissionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/submissions/{id}/reject",
    summary: "Reject a link out of the Ehdotusjono",
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
    await rejectSubmission(c.req.valid("param").id);
    return c.json({ ok: true as const }, 200);
  },
);

submissionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/admin/submissions/rejected",
    summary: "The rejected-links archive, newest rejection first",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    responses: {
      200: {
        description: "Rejected links",
        content: { "application/json": { schema: z.array(rejectedUrlSubmissionSchema) } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const rows = await listRejectedSubmissions();
    return c.json(rows, 200);
  },
);

submissionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/submissions/{id}/restore",
    summary: "Restore a rejected link back to the Ehdotusjono",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: { params: idParam },
    responses: {
      200: {
        description: "Back in the queue",
        content: { "application/json": { schema: urlSubmissionSchema } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const restored = await restoreSubmission(c.req.valid("param").id);
    return c.json(restored, 200);
  },
);
