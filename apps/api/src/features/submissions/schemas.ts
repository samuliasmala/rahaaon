import { z } from "@hono/zod-openapi";

/**
 * A submitted link. Scheme is restricted to http(s): `z.url()` alone accepts
 * `javascript:`, `data:`, `file:` … and the raw value is later rendered as an
 * `href` (admin queue and, once approved, the public feed), where a
 * `javascript:` URL is an XSS vector. The fetcher already refuses non-http(s),
 * but validation is the right layer to reject it — and the only one that also
 * keeps such links out of the database.
 */
export const submitUrlSchema = z
  .object({
    url: z
      .url()
      .max(2000)
      .refine((value) => /^https?:$/.test(new URL(value).protocol), {
        message: "Vain http- ja https-osoitteet kelpaavat",
      }),
  })
  .openapi("SubmitUrl");

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
    /**
     * Outcome of the submit-time page archive; null when archiving was never
     * attempted (S3 not configured / pre-feature rows).
     */
    archiveStatus: z.enum(["pending", "ok", "paywalled", "failed"]).nullable(),
    /** True when archived page text exists — the archive/text download works. */
    hasArchivedText: z.boolean(),
    /**
     * True while the background AI extraction runs for this entry. The queue
     * card renders these rows locked ("Käsitellään…") and the admin view polls
     * until the entry moves to the AI queue.
     */
    processing: z.boolean(),
    /** Why the last processing run failed (attempts exhausted); null otherwise. */
    processError: z.string().nullable(),
  })
  .openapi("UrlSubmission");

export type UrlSubmissionView = z.infer<typeof urlSubmissionSchema>;

/**
 * A pointer from a queue entry / published item back to the submission whose
 * page archive it came from — enough for the admin UI to render the archive
 * pill and open the shared viewer/editor (the archive endpoints stay
 * submission-scoped). Null on the parent when the entry didn't come from a
 * submission (seeded rows) or archiving was never attempted.
 */
export const archiveRefSchema = z
  .object({
    submissionId: z.uuid(),
    archiveStatus: z.enum(["pending", "ok", "paywalled", "failed"]),
    /** True when archived page text exists — the archive/text endpoints work. */
    hasArchivedText: z.boolean(),
  })
  .openapi("ArchiveRef");

export type ArchiveRefView = z.infer<typeof archiveRefSchema>;

/** A rejected link in the admin archive; `rejectedAt` drives the "Hylätty … sitten" label. */
export const rejectedUrlSubmissionSchema = urlSubmissionSchema
  .extend({ rejectedAt: z.iso.datetime() })
  .openapi("RejectedUrlSubmission");

export type RejectedUrlSubmissionView = z.infer<typeof rejectedUrlSubmissionSchema>;
