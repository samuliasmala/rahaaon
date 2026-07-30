import { z } from "@hono/zod-openapi";
import { AMOUNT_TYPES, CATEGORIES } from "../../db/schema/content.js";
import { MAX_KEYWORDS, MAX_KEYWORD_LENGTH } from "../../lib/keyword-ai.js";
import { archiveRefSchema, reprocessStateFields } from "../submissions/schemas.js";

export const categorySchema = z.enum(CATEGORIES).openapi("Category");

/** How precise amountEur is; "unknown" items render without a figure. */
export const amountTypeSchema = z.enum(AMOUNT_TYPES).openapi("AmountType");

/** Editor-supplied keyword list — same caps the AI output is normalized to. */
export const keywordListSchema = z
  .array(z.string().min(1).max(MAX_KEYWORD_LENGTH))
  .max(MAX_KEYWORDS);

/** A feed item as clients see it: vote count folded in, dates as ISO strings. */
export const wasteItemSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    /** Whole euros; a range's lower bound when amountMaxEur is set; 0 when amountType = "unknown". */
    amountEur: z.number().int(),
    amountType: amountTypeSchema,
    /** Range upper bound in whole euros; null when the source gives no range. */
    amountMaxEur: z.number().int().nullable(),
    entity: z.string(),
    category: categorySchema,
    sourceName: z.string(),
    sourceUrl: z.string(),
    /** The article's own headline, shown as the source-link text; "" when unknown. */
    articleTitle: z.string(),
    summary: z.string(),
    quote: z.string(),
    /** Search keywords (AI-drafted, editor-editable) — feed the client-side search. */
    keywords: z.array(z.string()),
    hidden: z.boolean(),
    publishedAt: z.iso.datetime(),
    /** The source article's own publication date; null when unknown. */
    articlePublishedAt: z.iso.date().nullable(),
    votes: z.number().int(),
    /** Whether the requesting visitor has voted for this item. */
    voted: z.boolean(),
  })
  .openapi("WasteItem");

export type WasteItemView = z.infer<typeof wasteItemSchema>;

/**
 * The admin listing: a feed item plus the pointer to the page archive of the
 * submission it was published from and that submission's reprocess state.
 * Admin-only — the ref carries a submission id, which the public feed must
 * not leak.
 */
export const adminWasteItemSchema = wasteItemSchema
  .extend({ archive: archiveRefSchema.nullable(), ...reprocessStateFields })
  .openapi("AdminWasteItem");

export type AdminWasteItemView = z.infer<typeof adminWasteItemSchema>;

export const voteResultSchema = z
  .object({ votes: z.number().int(), voted: z.boolean() })
  .openapi("VoteResult");

/** Editorial edits to a published item; all fields optional. */
export const patchItemSchema = z
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
    /** "" = article title unknown; the feed link falls back to generic text. */
    articleTitle: z.string().max(300),
    articlePublishedAt: z.iso.date().nullable(),
    keywords: keywordListSchema,
    hidden: z.boolean(),
  })
  .partial()
  .openapi("PatchItem");

/** What the on-demand keyword generator works from — the editor's current draft. */
export const generateKeywordsRequestSchema = z
  .object({
    title: z.string().min(1).max(300),
    summary: z.string().min(1).max(2000),
    entity: z.string().max(120),
    category: categorySchema,
  })
  .openapi("GenerateKeywordsRequest");

export const generatedKeywordsSchema = z
  .object({ keywords: z.array(z.string()) })
  .openapi("GeneratedKeywords");
