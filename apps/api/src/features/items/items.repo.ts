import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { itemVote, wasteItem } from "../../db/schema/index.js";
import { normalizeAmount } from "../../lib/amount.js";
import { notFound } from "../../lib/http-errors.js";
import type { WasteItemView, patchItemSchema } from "./schemas.js";
import type { z } from "@hono/zod-openapi";

type ItemPatch = z.infer<typeof patchItemSchema>;

/**
 * List feed items with the vote count and the requesting visitor's own vote
 * folded in. Votes are rows in `item_vote` (one per visitor), aggregated here —
 * there is no denormalized counter to drift.
 */
export async function listItems(opts: {
  includeHidden: boolean;
  voterId: string | undefined;
}): Promise<WasteItemView[]> {
  const votedExpr = opts.voterId
    ? sql<boolean>`coalesce(bool_or(${itemVote.voterId} = ${opts.voterId}), false)`
    : sql<boolean>`false`;

  const rows = await db
    .select({
      id: wasteItem.id,
      title: wasteItem.title,
      amountEur: wasteItem.amountEur,
      amountType: wasteItem.amountType,
      amountMaxEur: wasteItem.amountMaxEur,
      entity: wasteItem.entity,
      category: wasteItem.category,
      sourceName: wasteItem.sourceName,
      sourceUrl: wasteItem.sourceUrl,
      summary: wasteItem.summary,
      quote: wasteItem.quote,
      hidden: wasteItem.hidden,
      publishedAt: wasteItem.publishedAt,
      articlePublishedAt: wasteItem.articlePublishedAt,
      votes: count(itemVote.voterId),
      voted: votedExpr,
    })
    .from(wasteItem)
    .leftJoin(itemVote, eq(itemVote.itemId, wasteItem.id))
    .where(opts.includeHidden ? undefined : eq(wasteItem.hidden, false))
    .groupBy(wasteItem.id)
    .orderBy(desc(wasteItem.publishedAt));

  return rows.map((r) => ({ ...r, publishedAt: r.publishedAt.toISOString() }));
}

/** Toggle the visitor's vote on an item; returns the new count and vote state. */
export async function toggleVote(
  itemId: string,
  voterId: string,
): Promise<{ votes: number; voted: boolean }> {
  return db.transaction(async (tx) => {
    const item = await tx
      .select({ id: wasteItem.id })
      .from(wasteItem)
      .where(and(eq(wasteItem.id, itemId), eq(wasteItem.hidden, false)))
      .limit(1);
    if (item.length === 0) throw notFound("Juttua ei löytynyt");

    const deleted = await tx
      .delete(itemVote)
      .where(and(eq(itemVote.itemId, itemId), eq(itemVote.voterId, voterId)))
      .returning({ itemId: itemVote.itemId });

    let voted = false;
    if (deleted.length === 0) {
      await tx.insert(itemVote).values({ itemId, voterId });
      voted = true;
    }

    const [row] = await tx
      .select({ votes: count() })
      .from(itemVote)
      .where(eq(itemVote.itemId, itemId));
    return { votes: row?.votes ?? 0, voted };
  });
}

/**
 * Admin: apply editorial edits to a published item, hiding/restoring included.
 * As with suggestion edits, the amount invariant (unknown ⟺ 0, upper bound
 * above the lower one) is re-established against the merged row, so a partial
 * patch can't store a contradiction.
 */
export async function updateItem(itemId: string, patch: ItemPatch): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(wasteItem)
      .where(eq(wasteItem.id, itemId))
      .limit(1)
      .for("update");
    if (!current) throw notFound("Juttua ei löytynyt");

    const amount = normalizeAmount({
      amountEur: patch.amountEur ?? current.amountEur,
      amountType: patch.amountType ?? current.amountType,
      // ?? would swallow an explicit null (= "clear the range").
      amountMaxEur: patch.amountMaxEur !== undefined ? patch.amountMaxEur : current.amountMaxEur,
    });
    await tx
      .update(wasteItem)
      .set({ ...patch, ...amount })
      .where(eq(wasteItem.id, itemId));
  });
}
