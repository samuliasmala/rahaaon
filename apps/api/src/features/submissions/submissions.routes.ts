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
  processSubmission,
  rejectSubmission,
  restoreSubmission,
} from "./submissions.repo.js";
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

submissionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/admin/submissions/{id}/archive/text",
    summary: "Download the page text archived at submit time",
    tags: ["Admin"],
    middleware: [requireAuth] as const,
    request: { params: idParam },
    responses: {
      200: {
        description: "The archived text, as a file attachment",
        content: { "text/plain": { schema: z.string() } },
      },
      ...commonErrorResponses,
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const text = await getSubmissionArchiveText(id);
    c.header("Content-Disposition", `attachment; filename="ehdotus-${id}.txt"`);
    return c.text(text, 200);
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
