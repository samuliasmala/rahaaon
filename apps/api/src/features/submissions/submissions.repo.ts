import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import { urlSubmission } from "../../db/schema/index.js";
import {
  archiveEnabled,
  effectiveArchiveStatus,
  manualArchiveKeyFor,
  runArchiveOnce,
} from "../../lib/article-archive.js";
import { conflict, notFound, unavailable } from "../../lib/http-errors.js";
import { logger } from "../../lib/logger.js";
import { fetchPagePreview } from "../../lib/page-preview.js";
import { getTextObject, putTextObject } from "../../lib/s3.js";
import { runProcessorOnce } from "../../lib/submission-processor.js";
import type { ArchiveRefView, RejectedUrlSubmissionView, UrlSubmissionView } from "./schemas.js";

type SubmissionRow = typeof urlSubmission.$inferSelect;

/**
 * The archive pointer other admin views (AI queue, published items) carry so
 * their cards can open the submission-scoped archive viewer. A never-archived
 * row surfaces as a `missing` ref when archiving is available (the card can
 * offer re-archiving) but as null when it isn't — with S3 unconfigured the gap
 * is expected on every row, and a "disabled" pill on processed entries would
 * be pure noise (the Ehdotusjono cards already announce it via UrlSubmission's
 * own archiveStatus).
 */
export function toArchiveRef(
  row: Pick<SubmissionRow, "id" | "archiveStatus" | "archiveTextKey">,
): ArchiveRefView | null {
  if (!row.archiveStatus && !archiveEnabled) return null;
  return {
    submissionId: row.id,
    archiveStatus: effectiveArchiveStatus(row.archiveStatus, archiveEnabled),
    hasArchivedText: row.archiveTextKey !== null,
  };
}

function toView(row: SubmissionRow): UrlSubmissionView {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    siteName: row.siteName,
    createdAt: row.createdAt.toISOString(),
    archiveStatus: effectiveArchiveStatus(row.archiveStatus, archiveEnabled),
    hasArchivedText: row.archiveTextKey !== null,
    processing: row.status === "processing",
    processError: row.processError,
  };
}

/**
 * Store a confirmed reader link in the Ehdotusjono. The page metadata is
 * captured server-side (normally straight from the preview cache — the reader
 * just confirmed it) so the admin list can show what was submitted. The page
 * text archive runs fire-and-forget after the response — the submitter never
 * waits on (or hears about) it; the row's archive_status tells the admin.
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
      ...(archiveEnabled ? { archiveStatus: "pending" as const } : {}),
    })
    .returning();
  // The row is now a 'pending' work item; kick an immediate drain so archiving
  // starts right away (the periodic poll would otherwise pick it up shortly).
  if (archiveEnabled) void runArchiveOnce();
  return toView(row!);
}

/**
 * The admin Ehdotusjono: unprocessed reader links, newest first. Rows the
 * background processor is working on stay in the list (`processing: true`) so
 * the queue card can show a persistent "Käsitellään…" state.
 */
export async function listNewSubmissions(): Promise<UrlSubmissionView[]> {
  const rows = await db
    .select()
    .from(urlSubmission)
    .where(inArray(urlSubmission.status, ["new", "processing"]))
    .orderBy(desc(urlSubmission.createdAt));
  return rows.map(toView);
}

/**
 * Reject a link out of the queue (kept in the rejected archive). Also allowed
 * mid-processing — it doubles as the editor's way to cancel a run (the worker
 * discards a finished extraction for a row that is no longer `processing`),
 * and the escape hatch should the worker be down and the row stuck.
 */
export async function rejectSubmission(id: string): Promise<void> {
  const updated = await db
    .update(urlSubmission)
    .set({
      status: "rejected",
      processedAt: new Date(),
      processNextAttemptAt: null,
      processError: null,
    })
    .where(and(eq(urlSubmission.id, id), inArray(urlSubmission.status, ["new", "processing"])))
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
    // A pre-rejection processing failure is stale context by now — clear it.
    .set({ status: "new", processedAt: null, processError: null })
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "rejected")))
    .returning();
  if (!row) throw notFound("Ehdotusta ei löytynyt");
  return toView(row);
}

/**
 * The archived page text for the admin download/view. Works for any status —
 * the rejected archive keeps its captured text too. The filename extension
 * follows the stored key (new archives are .md, plain-text-era rows .txt).
 */
export async function getSubmissionArchiveText(
  id: string,
): Promise<{ text: string; filename: string }> {
  const [row] = await db
    .select({ key: urlSubmission.archiveTextKey })
    .from(urlSubmission)
    .where(eq(urlSubmission.id, id))
    .limit(1);
  if (!row?.key) throw notFound("Arkistoitua tekstiä ei ole");
  try {
    const text = await getTextObject(row.key);
    return { text, filename: `ehdotus-${id}${row.key.endsWith(".md") ? ".md" : ".txt"}` };
  } catch (err) {
    logger.error({ id, key: row.key, err: (err as Error).message }, "archive read failed");
    throw unavailable("Arkiston lukeminen epäonnistui — yritä hetken kuluttua uudelleen");
  }
}

/**
 * Manual archive edit: the editor pastes/fixes the article text (e.g. the
 * full body of a paywalled story). Overwrites or creates the S3 object and
 * marks the archive usable — after this, processing reads the edited text.
 */
export async function saveSubmissionArchiveText(id: string, text: string): Promise<void> {
  if (!archiveEnabled) throw unavailable("Arkistointi ei ole käytössä (S3 puuttuu)");
  const [row] = await db
    .select({ key: urlSubmission.archiveTextKey })
    .from(urlSubmission)
    .where(eq(urlSubmission.id, id))
    .limit(1);
  if (!row) throw notFound("Ehdotusta ei löytynyt");

  // Reuse the existing key when re-editing a terminal row; otherwise use the
  // manual key, which the worker never writes — so a paste that races an
  // in-flight worker attempt on a 'pending' row can't be clobbered in S3.
  const key = row.key ?? manualArchiveKeyFor(id);
  try {
    await putTextObject(key, text);
  } catch (err) {
    logger.error({ id, key, err: (err as Error).message }, "archive write failed");
    throw unavailable("Arkiston tallennus epäonnistui — yritä hetken kuluttua uudelleen");
  }
  await db
    .update(urlSubmission)
    .set({ archiveStatus: "ok", archiveTextKey: key })
    .where(eq(urlSubmission.id, id));
}

/**
 * Re-run the page archive for a row whose capture never succeeded — `failed`,
 * or never attempted (the `missing` view status). Resets the attempt budget,
 * marks the row as pending work and kicks the worker. The conditional update
 * is the guard: a retry can't clobber a good archive (ok/paywalled) or
 * double-kick a pending one — those come back 409.
 */
export async function retrySubmissionArchive(id: string): Promise<UrlSubmissionView> {
  if (!archiveEnabled) throw unavailable("Arkistointi ei ole käytössä (S3 puuttuu)");
  const [row] = await db
    .update(urlSubmission)
    // The eligible states never carry a text key; nulling it here makes that
    // an enforced invariant rather than an assumption — a fresh 'pending' row
    // must not report hasArchivedText.
    .set({
      archiveStatus: "pending",
      archiveTextKey: null,
      archiveAttempts: 0,
      archiveNextAttemptAt: null,
    })
    .where(
      and(
        eq(urlSubmission.id, id),
        or(eq(urlSubmission.archiveStatus, "failed"), isNull(urlSubmission.archiveStatus)),
      ),
    )
    .returning();
  if (!row) {
    const exists = await db
      .select({ id: urlSubmission.id })
      .from(urlSubmission)
      .where(eq(urlSubmission.id, id))
      .limit(1);
    if (exists.length === 0) throw notFound("Ehdotusta ei löytynyt");
    throw conflict("Arkisto on jo olemassa tai arkistointi on käynnissä");
  }
  // The row is now a 'pending' work item; kick an immediate drain as on submit.
  void runArchiveOnce();
  return toView(row);
}

/**
 * Send a submission onward to the AI queue: flip it to `processing` and kick
 * the background processor (lib/submission-processor.ts), which runs the
 * extraction and finalizes the row off the request. The conditional update is
 * the concurrency guard — a second click (or a reject that raced this) finds a
 * non-'new' status and 404s.
 */
export async function queueSubmissionForProcessing(id: string): Promise<UrlSubmissionView> {
  const [row] = await db
    .update(urlSubmission)
    .set({
      status: "processing",
      processAttempts: 0,
      processNextAttemptAt: null,
      processError: null,
    })
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "new")))
    .returning();
  if (!row) throw notFound("Ehdotusta ei löytynyt");
  // The row is now claimable work; kick an immediate drain so the extraction
  // starts right away (the periodic poll would otherwise pick it up shortly).
  void runProcessorOnce();
  return toView(row);
}
