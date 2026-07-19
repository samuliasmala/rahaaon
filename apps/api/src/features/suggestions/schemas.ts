import { z } from "@hono/zod-openapi";
import { categorySchema } from "../items/schemas.js";

/** A queue entry as the editorial UI sees it. */
export const suggestionSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    title: z.string(),
    amountEur: z.number().int(),
    entity: z.string(),
    category: categorySchema,
    sourceName: z.string(),
    summary: z.string(),
    aiNote: z.string(),
    confidence: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .openapi("Suggestion");

export type SuggestionView = z.infer<typeof suggestionSchema>;

/** Editorial edits before publishing; all fields optional. */
export const patchSuggestionSchema = z
  .object({
    title: z.string().min(1).max(300),
    summary: z.string().min(1).max(2000),
    amountEur: z.number().int().min(0),
    entity: z.string().min(1).max(120),
    category: categorySchema,
  })
  .partial()
  .openapi("PatchSuggestion");
