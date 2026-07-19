import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { suggestion, urlSubmission } from "../../db/schema/index.js";
import { notFound } from "../../lib/http-errors.js";
import { fetchPagePreview } from "../../lib/page-preview.js";
import { extractArticle } from "../../lib/suggestion-ai.js";
import type { RejectedUrlSubmissionView, UrlSubmissionView } from "./schemas.js";

type SubmissionRow = typeof urlSubmission.$inferSelect;

function toView(row: SubmissionRow): UrlSubmissionView {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    siteName: row.siteName,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Store a confirmed reader link in the Ehdotusjono. The page metadata is
 * captured server-side (normally straight from the preview cache — the reader
 * just confirmed it) so the admin list can show what was submitted.
 */
export async function createSubmission(url: string): Promise<UrlSubmissionView> {
  const preview = await fetchPagePreview(url);
  const [row] = await db
    .insert(urlSubmission)
    .values({
      url,
      title: preview.title,
      description: preview.description,
      siteName: preview.siteName,
    })
    .returning();
  return toView(row!);
}

/** The admin Ehdotusjono: unprocessed reader links, newest first. */
export async function listNewSubmissions(): Promise<UrlSubmissionView[]> {
  const rows = await db
    .select()
    .from(urlSubmission)
    .where(eq(urlSubmission.status, "new"))
    .orderBy(desc(urlSubmission.createdAt));
  return rows.map(toView);
}

/** Reject a link out of the queue (kept in the rejected archive). */
export async function rejectSubmission(id: string): Promise<void> {
  const updated = await db
    .update(urlSubmission)
    .set({ status: "rejected", processedAt: new Date() })
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "new")))
    .returning({ id: urlSubmission.id });
  if (updated.length === 0) throw notFound("Ehdotusta ei löytynyt");
}

/** The rejected-links archive, newest rejection first. */
export async function listRejectedSubmissions(): Promise<RejectedUrlSubmissionView[]> {
  const rows = await db
    .select()
    .from(urlSubmission)
    .where(eq(urlSubmission.status, "rejected"))
    .orderBy(desc(urlSubmission.processedAt));
  return rows.map((row) => ({
    ...toView(row),
    // processedAt is always set on reject; the fallback only guards hand-edited rows.
    rejectedAt: (row.processedAt ?? row.createdAt).toISOString(),
  }));
}

/** Put a rejected link back into the Ehdotusjono. */
export async function restoreSubmission(id: string): Promise<UrlSubmissionView> {
  const [row] = await db
    .update(urlSubmission)
    .set({ status: "new", processedAt: null })
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "rejected")))
    .returning();
  if (!row) throw notFound("Ehdotusta ei löytynyt");
  return toView(row);
}

/**
 * Send a submission onward to the AI queue: run the extraction and store the
 * result as a pending suggestion. The submission is kept, marked `processed`
 * and linked to the suggestion it became.
 */
export async function processSubmission(id: string): Promise<{ suggestionId: string }> {
  // The extraction (page fetch + LLM call) can take seconds, so it runs before
  // the transaction — never while holding a row lock and a pool connection. On
  // failure the submission stays 'new' and the editor can retry.
  const [entry] = await db
    .select()
    .from(urlSubmission)
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "new")))
    .limit(1);
  if (!entry) throw notFound("Ehdotusta ei löytynyt");

  const extraction = await extractArticle(entry.url, {
    title: entry.title,
    description: entry.description,
    siteName: entry.siteName,
  });

  return db.transaction(async (tx) => {
    // Row lock + status re-check so two concurrent process calls can't both
    // insert a suggestion; the loser (or a reject that raced the extraction)
    // sees a non-'new' status and 404s, wasting only its LLM call.
    const [locked] = await tx
      .select({ id: urlSubmission.id })
      .from(urlSubmission)
      .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "new")))
      .limit(1)
      .for("update");
    if (!locked) throw notFound("Ehdotusta ei löytynyt");

    const [created] = await tx
      .insert(suggestion)
      .values({ url: entry.url, ...extraction })
      .returning({ id: suggestion.id });

    await tx
      .update(urlSubmission)
      .set({ status: "processed", processedAt: new Date(), suggestionId: created!.id })
      .where(eq(urlSubmission.id, id));

    return { suggestionId: created!.id };
  });
}
