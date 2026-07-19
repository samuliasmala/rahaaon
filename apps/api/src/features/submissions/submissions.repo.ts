import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { suggestion, urlSubmission } from "../../db/schema/index.js";
import { notFound } from "../../lib/http-errors.js";
import { fetchPagePreview } from "../../lib/page-preview.js";
import { extractArticle } from "../../lib/suggestion-ai.js";
import type { UrlSubmissionView } from "./schemas.js";

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

/**
 * Send a submission onward to the AI queue: run the extraction (a mock until
 * the real pipeline exists) and store the result as a pending suggestion. The
 * submission is kept, marked `processed` and linked to the suggestion it became.
 */
export async function processSubmission(id: string): Promise<{ suggestionId: string }> {
  return db.transaction(async (tx) => {
    // Row lock so two concurrent process calls can't both read 'new' and
    // insert duplicate suggestions; the loser sees 'processed' and 404s.
    const [entry] = await tx
      .select()
      .from(urlSubmission)
      .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "new")))
      .limit(1)
      .for("update");
    if (!entry) throw notFound("Ehdotusta ei löytynyt");

    const extraction = extractArticle(entry.url);
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
