import { z } from "@hono/zod-openapi";

export const submitUrlSchema = z.object({ url: z.url().max(2000) }).openapi("SubmitUrl");

/** The google-like result card shown to the reader before they confirm. */
export const pagePreviewSchema = z
  .object({
    url: z.string(),
    siteName: z.string(),
    title: z.string(),
    description: z.string(),
    fetched: z.boolean(),
  })
  .openapi("PagePreview");

/** A reader-submitted link waiting in the admin Ehdotusjono. */
export const urlSubmissionSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    title: z.string(),
    description: z.string(),
    siteName: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi("UrlSubmission");

export type UrlSubmissionView = z.infer<typeof urlSubmissionSchema>;
