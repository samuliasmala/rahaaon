import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { suggestion, wasteItem } from "../../db/schema/index.js";
import { normalizeAmount } from "../../lib/amount.js";
import { notFound } from "../../lib/http-errors.js";
import type { RejectedSuggestionView, SuggestionView, patchSuggestionSchema } from "./schemas.js";
import type { z } from "@hono/zod-openapi";

type SuggestionPatch = z.infer<typeof patchSuggestionSchema>;

type SuggestionRow = typeof suggestion.$inferSelect;

function toView(row: SuggestionRow): SuggestionView {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    amountEur: row.amountEur,
    amountType: row.amountType,
    amountMaxEur: row.amountMaxEur,
    entity: row.entity,
    category: row.category,
    sourceName: row.sourceName,
    articlePublishedAt: row.articlePublishedAt,
    summary: row.summary,
    quote: row.quote,
    aiNote: row.aiNote,
    confidence: row.confidence,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The AI queue: pending suggestions, newest first. */
export async function listPendingSuggestions(): Promise<SuggestionView[]> {
  const rows = await db
    .select()
    .from(suggestion)
    .where(eq(suggestion.status, "pending"))
    .orderBy(desc(suggestion.createdAt));
  return rows.map(toView);
}

/**
 * Apply editorial edits to a pending suggestion. The amount invariant
 * (unknown ⟺ 0, upper bound above the lower one) is re-established against the
 * merged row, so a partial patch can't store a contradiction — e.g. switching
 * to 'unknown' while the old figure would otherwise keep counting in the feed
 * total.
 */
export async function updateSuggestion(
  id: string,
  patch: SuggestionPatch,
): Promise<SuggestionView> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.id, id), eq(suggestion.status, "pending")))
      .limit(1)
      .for("update");
    if (!current) throw notFound("Ehdotusta ei löytynyt");

    const amount = normalizeAmount({
      amountEur: patch.amountEur ?? current.amountEur,
      amountType: patch.amountType ?? current.amountType,
      // ?? would swallow an explicit null (= "clear the range").
      amountMaxEur: patch.amountMaxEur !== undefined ? patch.amountMaxEur : current.amountMaxEur,
    });
    const [row] = await tx
      .update(suggestion)
      .set({ ...patch, ...amount })
      .where(eq(suggestion.id, id))
      .returning();
    return toView(row!);
  });
}

/** Publish a pending suggestion as a feed item; returns the new item's id. */
export async function approveSuggestion(id: string): Promise<{ itemId: string }> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.id, id), eq(suggestion.status, "pending")))
      .limit(1);
    if (!entry) throw notFound("Ehdotusta ei löytynyt");

    const [item] = await tx
      .insert(wasteItem)
      .values({
        title: entry.title,
        amountEur: entry.amountEur,
        amountType: entry.amountType,
        amountMaxEur: entry.amountMaxEur,
        entity: entry.entity,
        category: entry.category,
        sourceName: entry.sourceName,
        sourceUrl: entry.url,
        summary: entry.summary,
        articlePublishedAt: entry.articlePublishedAt,
        quote: entry.quote,
      })
      .returning({ id: wasteItem.id });

    await tx
      .update(suggestion)
      .set({ status: "approved", reviewedAt: new Date(), publishedItemId: item!.id })
      .where(eq(suggestion.id, id));

    return { itemId: item!.id };
  });
}

/** Reject a pending suggestion (kept in the rejected archive, dropped from the queue). */
export async function rejectSuggestion(id: string): Promise<void> {
  const updated = await db
    .update(suggestion)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(and(eq(suggestion.id, id), eq(suggestion.status, "pending")))
    .returning({ id: suggestion.id });
  if (updated.length === 0) throw notFound("Ehdotusta ei löytynyt");
}

/** The rejected archive, newest rejection first. */
export async function listRejectedSuggestions(): Promise<RejectedSuggestionView[]> {
  const rows = await db
    .select()
    .from(suggestion)
    .where(eq(suggestion.status, "rejected"))
    .orderBy(desc(suggestion.reviewedAt));
  return rows.map((row) => ({
    ...toView(row),
    // reviewedAt is always set on reject; the fallback only guards hand-edited rows.
    rejectedAt: (row.reviewedAt ?? row.createdAt).toISOString(),
  }));
}

/** Put a rejected suggestion back into the pending queue for a new verdict. */
export async function restoreSuggestion(id: string): Promise<SuggestionView> {
  const [row] = await db
    .update(suggestion)
    .set({ status: "pending", reviewedAt: null })
    .where(and(eq(suggestion.id, id), eq(suggestion.status, "rejected")))
    .returning();
  if (!row) throw notFound("Ehdotusta ei löytynyt");
  return toView(row);
}
