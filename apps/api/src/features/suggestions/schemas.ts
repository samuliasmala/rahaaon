import { z } from "@hono/zod-openapi";
import { amountTypeSchema, categorySchema, keywordListSchema } from "../items/schemas.js";
import { archiveRefSchema, reprocessStateFields } from "../submissions/schemas.js";

/** A queue entry as the editorial UI sees it. */
export const suggestionSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    title: z.string(),
    /** Whole euros; a range's lower bound when amountMaxEur is set; 0 when amountType = "unknown". */
    amountEur: z.number().int(),
    amountType: amountTypeSchema,
    /** Range upper bound in whole euros; null when the source gives no range. */
    amountMaxEur: z.number().int().nullable(),
    entity: z.string(),
    category: categorySchema,
    sourceName: z.string(),
    /** The source article's own publication date; null when the AI couldn't find one. */
    articlePublishedAt: z.iso.date().nullable(),
    summary: z.string(),
    /** A direct quote from the article, shown on the feed item; "" when none. */
    quote: z.string(),
    /** Search keywords (AI-extracted, editor-editable); copied to the item on approval. */
    keywords: z.array(z.string()),
    aiNote: z.string(),
    confidence: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .openapi("Suggestion");

export type SuggestionView = z.infer<typeof suggestionSchema>;

/**
 * A queue-listing entry: the suggestion plus the pointer to its source
 * submission's page archive and the submission's reprocess state. Only the
 * listing carries them — mutation responses (patch/restore) stay plain
 * {@link suggestionSchema}, since the client already holds these from the list.
 */
export const suggestionWithArchiveSchema = suggestionSchema
  .extend({ archive: archiveRefSchema.nullable(), ...reprocessStateFields })
  .openapi("SuggestionWithArchive");

export type SuggestionWithArchiveView = z.infer<typeof suggestionWithArchiveSchema>;

/** A rejected entry in the admin archive; `rejectedAt` drives the "Hylätty … sitten" label. */
export const rejectedSuggestionSchema = suggestionSchema
  .extend({ rejectedAt: z.iso.datetime() })
  .openapi("RejectedSuggestion");

export type RejectedSuggestionView = z.infer<typeof rejectedSuggestionSchema>;

/** Editorial edits before publishing; all fields optional. */
export const patchSuggestionSchema = z
  .object({
    title: z.string().min(1).max(300),
    summary: z.string().min(1).max(2000),
    /** "" removes the quote from the feed item. */
    quote: z.string().max(500),
    amountEur: z.number().int().min(0),
    amountType: amountTypeSchema,
    /** Null clears the range; the repo drops a bound that isn't above amountEur. */
    amountMaxEur: z.number().int().min(0).nullable(),
    entity: z.string().min(1).max(120),
    category: categorySchema,
    articlePublishedAt: z.iso.date().nullable(),
    keywords: keywordListSchema,
  })
  .partial()
  .openapi("PatchSuggestion");
