import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import { suggestion, urlSubmission, wasteItem } from "../../db/schema/index.js";
import {
  archiveEnabled,
  effectiveArchiveStatus,
  manualArchiveKeyFor,
  runArchiveOnce,
} from "../../lib/article-archive.js";
import { conflict, notFound, unavailable } from "../../lib/http-errors.js";
import { logger } from "../../lib/logger.js";
import { fetchPagePreview } from "../../lib/page-preview.js";
import { notifierEnabled, runQueueNotifierOnce } from "../../lib/queue-notifier.js";
import { getTextObject, putTextObject } from "../../lib/s3.js";
import { runProcessorOnce } from "../../lib/submission-processor.js";
import { normalizeUrl } from "../../lib/url.js";
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

/**
 * What else the desk already holds for one link, keyed on the normalized URL
 * (lib/url.ts). Drives both ends: the reader is told before confirming, and
 * the editor sees a pill on the Ehdotusjono card.
 */
export interface UrlDuplicate {
  /**
   * A live pipeline entry for this key — a first-run Ehdotusjono row or an
   * entry already in the AI queue. A fresh submit is absorbed into it rather
   * than queueing a second card. Null when nothing live matches.
   */
  activeSubmissionId: string | null;
  activeCount: number;
  /** The newest feed item published from this link; `hidden` items are on it too. */
  publishedItem: { id: string; title: string; hidden: boolean } | null;
  /** Times the desk already said no to this link — submission- or suggestion-side. */
  rejectedCount: number;
}

const NO_DUPLICATE: UrlDuplicate = {
  activeSubmissionId: null,
  activeCount: 0,
  publishedItem: null,
  rejectedCount: 0,
};

/** True when nothing at all is on record for the key — the caller reports null. */
function isEmpty(duplicate: UrlDuplicate): boolean {
  return (
    duplicate.activeCount === 0 && duplicate.publishedItem === null && duplicate.rejectedCount === 0
  );
}

/**
 * What the desk already holds for each of these URL keys. Batched (two queries
 * regardless of input size) because the Ehdotusjono asks for a whole listing at
 * once. Keys absent from the result have nothing on record.
 *
 * Empty keys are dropped up front: "" is the pre-backfill default, so looking
 * one up would match every legacy row at once.
 */
export async function findUrlDuplicates(urlKeys: string[]): Promise<Map<string, UrlDuplicate>> {
  const keys = [...new Set(urlKeys)].filter((key) => key !== "");
  const found = new Map<string, UrlDuplicate>();
  if (keys.length === 0) return found;

  const forKey = (key: string): UrlDuplicate => {
    const existing = found.get(key);
    if (existing) return existing;
    const fresh = { ...NO_DUPLICATE };
    found.set(key, fresh);
    return fresh;
  };

  // Newest first, so the first item seen for a key is the one reported.
  const items = await db
    .select({
      id: wasteItem.id,
      title: wasteItem.title,
      hidden: wasteItem.hidden,
      urlKey: wasteItem.urlKey,
    })
    .from(wasteItem)
    .where(inArray(wasteItem.urlKey, keys))
    .orderBy(desc(wasteItem.publishedAt));
  for (const item of items) {
    const entry = forKey(item.urlKey);
    entry.publishedItem ??= { id: item.id, title: item.title, hidden: item.hidden };
  }

  const entries = await db
    .select({
      urlKey: urlSubmission.urlKey,
      submissionId: urlSubmission.id,
      submissionStatus: urlSubmission.status,
      suggestionId: urlSubmission.suggestionId,
      suggestionStatus: suggestion.status,
    })
    .from(urlSubmission)
    .leftJoin(suggestion, eq(suggestion.id, urlSubmission.suggestionId))
    .where(inArray(urlSubmission.urlKey, keys))
    .orderBy(desc(urlSubmission.createdAt));
  for (const row of entries) {
    const entry = forKey(row.urlKey);
    // "Live" is the same shape listNewSubmissions filters for — a first-run row
    // still awaiting a verdict, or one that became a pending suggestion. A
    // 'processing' row that already carries a suggestion is a reprocess of a
    // settled entry, not a queue occupant, so it doesn't count.
    const firstRun = row.suggestionId === null;
    const active =
      (firstRun && (row.submissionStatus === "new" || row.submissionStatus === "processing")) ||
      row.suggestionStatus === "pending";
    if (active) {
      entry.activeCount += 1;
      entry.activeSubmissionId ??= row.submissionId;
    }
    if (row.submissionStatus === "rejected" || row.suggestionStatus === "rejected") {
      entry.rejectedCount += 1;
    }
  }

  for (const [key, duplicate] of found) {
    if (isEmpty(duplicate)) found.delete(key);
  }
  return found;
}

/** Single-key convenience for the submit and preview paths. */
export async function findUrlDuplicate(urlKey: string): Promise<UrlDuplicate | null> {
  return (await findUrlDuplicates([urlKey])).get(urlKey) ?? null;
}

/**
 * `duplicate` is only filled by {@link listNewSubmissions} — the Ehdotusjono is
 * the one place the pill is rendered, and the client refetches that list after
 * every mutation, so single-entry responses leave it null rather than pay for a
 * lookup nothing reads.
 */
function toView(row: SubmissionRow, duplicate: UrlDuplicate | null = null): UrlSubmissionView {
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
    duplicate: duplicate && {
      activeCount: duplicate.activeCount,
      publishedItemId: duplicate.publishedItem?.id ?? null,
      rejectedCount: duplicate.rejectedCount,
    },
  };
}

/**
 * Store a confirmed reader link in the Ehdotusjono. The page metadata is
 * captured server-side (normally straight from the preview cache — the reader
 * just confirmed it) so the admin list can show what was submitted. The page
 * text archive runs fire-and-forget after the response — the submitter never
 * waits on (or hears about) it; the row's archive_status tells the admin.
 *
 * `announce: false` is for a row the editor added themselves (the capture
 * tool): the arrival push says "a reader sent something", which is not true
 * of a link the editor is looking at, so the row goes in already claimed as
 * announced. It still counts toward the reminder — it is queued work like any
 * other.
 */
export async function createSubmission(
  url: string,
  { announce = true }: { announce?: boolean } = {},
): Promise<{ submission: UrlSubmissionView; duplicate: boolean }> {
  const urlKey = normalizeUrl(url);

  // Absorbed, not refused: the reader was already warned at the preview step,
  // and a second card for one article costs the desk a duplicate AI extraction
  // and a duplicate archive fetch. Rejected entries are deliberately not
  // matched here — the desk can change its mind, and the Ehdotusjono card
  // badges the resubmit so the editor sees the history.
  const existing = await findUrlDuplicate(urlKey);
  if (existing?.activeSubmissionId) {
    const [row] = await db
      .select()
      .from(urlSubmission)
      .where(eq(urlSubmission.id, existing.activeSubmissionId))
      .limit(1);
    if (row) return { submission: toView(row), duplicate: true };
  }

  const preview = await fetchPagePreview(url);
  const [row] = await db
    .insert(urlSubmission)
    .values({
      url,
      urlKey,
      title: preview.title,
      description: preview.description,
      siteName: preview.siteName,
      ...(archiveEnabled ? { archiveStatus: "pending" as const } : {}),
      ...(announce ? {} : { notifiedAt: new Date() }),
    })
    .returning();
  // The row is now a 'pending' work item; kick an immediate drain so archiving
  // starts right away (the periodic poll would otherwise pick it up shortly).
  if (archiveEnabled) void runArchiveOnce();
  // Same idea for the editor's push: announce the arrival now rather than at
  // the notifier's next sweep. Fire-and-forget — the reader is not kept waiting
  // on a notification, and the sweep is the fallback if this drops.
  if (announce && notifierEnabled) void runQueueNotifierOnce();
  return { submission: toView(row!), duplicate: false };
}

/**
 * How many rows for one article the capture lookup pulls before picking. The
 * key already selects a single article, so this only bounds the pathological
 * case (the same link submitted over and over).
 */
const URL_MATCH_CANDIDATES = 50;

/**
 * The submission a captured page belongs to, or null when nobody has submitted
 * that article. The editor captures the page's canonical address while the
 * reader submitted whatever link they were sent, so the match is on the same
 * `url_key` that duplicate detection uses ({@link normalizeUrl}) — one
 * definition of "same article" for the whole desk, and an indexed lookup.
 *
 * A rejected row loses to a live one: capturing text for an article that is
 * both in the queue and in the rejected archive is about the queued one. The
 * pre-backfill empty key matches nothing, or it would match every legacy row.
 */
export async function findSubmissionByUrl(url: string): Promise<UrlSubmissionView | null> {
  const key = normalizeUrl(url);
  if (!key) return null;
  const rows = await db
    .select()
    .from(urlSubmission)
    .where(eq(urlSubmission.urlKey, key))
    .orderBy(desc(urlSubmission.createdAt))
    .limit(URL_MATCH_CANDIDATES);
  const best = rows.find((row) => row.status !== "rejected") ?? rows[0];
  return best ? toView(best) : null;
}

/**
 * The admin Ehdotusjono: unprocessed reader links, newest first. Rows the
 * background processor is working on stay in the list (`processing: true`) so
 * the queue card can show a persistent "Käsitellään…" state. Reprocess runs
 * (`processing` rows that already carry a suggestion_id) belong to the AI
 * queue / published views, not here.
 */
export async function listNewSubmissions(): Promise<UrlSubmissionView[]> {
  const rows = await db
    .select()
    .from(urlSubmission)
    .where(
      and(inArray(urlSubmission.status, ["new", "processing"]), isNull(urlSubmission.suggestionId)),
    )
    .orderBy(desc(urlSubmission.createdAt));

  const duplicates = await findUrlDuplicates(rows.map((row) => row.urlKey));
  return rows.map((row) => {
    const found = duplicates.get(row.urlKey);
    if (!found) return toView(row);
    // Every row in this listing is itself a live entry, so it is in its own
    // activeCount — the pill must count the others.
    const others = { ...found, activeCount: found.activeCount - 1 };
    return toView(row, isEmpty(others) ? null : others);
  });
}

/**
 * Reject a link out of the queue (kept in the rejected archive). Also allowed
 * mid-processing — it doubles as the editor's way to cancel a run (the worker
 * discards a finished extraction for a row that is no longer `processing`),
 * and the escape hatch should the worker be down and the row stuck. First-run
 * rows only (no suggestion_id): a reprocess row isn't the Ehdotusjono's to
 * reject — without this guard a stale tab could reject one mid-reprocess and
 * a later restore would strand it invisible in every list ('new' rows with a
 * suggestion_id are filtered out of {@link listNewSubmissions}).
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
    .where(
      and(
        eq(urlSubmission.id, id),
        inArray(urlSubmission.status, ["new", "processing"]),
        isNull(urlSubmission.suggestionId),
      ),
    )
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
 *
 * `force` widens the eligible states to the settled captures (ok/paywalled),
 * for refetching a page whose archive is stale or mangled. The stored text is
 * discarded up front (the fresh 'pending' row must not report
 * hasArchivedText); a worker success overwrites the S3 object, while a
 * failure leaves it orphaned — acceptable, since the editor asked for the
 * replacement. Even forced, an in-flight 'pending' capture stays off-limits.
 */
export async function retrySubmissionArchive(
  id: string,
  force = false,
): Promise<UrlSubmissionView> {
  if (!archiveEnabled) throw unavailable("Arkistointi ei ole käytössä (S3 puuttuu)");
  // NULL fails both eq and ne in SQL, so "never attempted" needs its own arm.
  const eligible = force
    ? or(ne(urlSubmission.archiveStatus, "pending"), isNull(urlSubmission.archiveStatus))
    : or(eq(urlSubmission.archiveStatus, "failed"), isNull(urlSubmission.archiveStatus));
  const [row] = await db
    .update(urlSubmission)
    .set({
      archiveStatus: "pending",
      archiveTextKey: null,
      archiveAttempts: 0,
      archiveNextAttemptAt: null,
    })
    .where(and(eq(urlSubmission.id, id), eligible))
    .returning();
  if (!row) {
    const exists = await db
      .select({ id: urlSubmission.id })
      .from(urlSubmission)
      .where(eq(urlSubmission.id, id))
      .limit(1);
    if (exists.length === 0) throw notFound("Ehdotusta ei löytynyt");
    throw conflict(
      force ? "Arkistointi on jo käynnissä" : "Arkisto on jo olemassa tai arkistointi on käynnissä",
    );
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
export async function queueSubmissionForProcessing(
  id: string,
  instructions: string | null = null,
): Promise<UrlSubmissionView> {
  const [row] = await db
    .update(urlSubmission)
    .set({
      status: "processing",
      processAttempts: 0,
      processNextAttemptAt: null,
      processError: null,
      processInstructions: instructions,
    })
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "new")))
    .returning();
  if (!row) throw notFound("Ehdotusta ei löytynyt");
  // The row is now claimable work; kick an immediate drain so the extraction
  // starts right away (the periodic poll would otherwise pick it up shortly).
  void runProcessorOnce();
  return toView(row);
}

/**
 * Send a processed submission back through the AI extraction — the reprocess
 * behind the AI queue's and published table's "Käsittele uudelleen". Keyed on
 * the suggestion because that's what the caller holds; the kept suggestion_id
 * is also what routes the worker's finalize into updating the existing
 * suggestion (and its published item) instead of inserting a new one. The
 * conditional update doubles as the guard: only a settled ('processed') source
 * row can be requeued, so a double click comes back 409 — and a suggestion
 * with no source submission (seeded rows) can't be reprocessed at all.
 */
export async function requeueSubmissionForReprocess(
  suggestionId: string,
  instructions: string | null,
): Promise<void> {
  const [row] = await db
    .update(urlSubmission)
    .set({
      status: "processing",
      processAttempts: 0,
      processNextAttemptAt: null,
      processError: null,
      processInstructions: instructions,
    })
    .where(and(eq(urlSubmission.suggestionId, suggestionId), eq(urlSubmission.status, "processed")))
    .returning({ id: urlSubmission.id });
  if (!row) {
    const exists = await db
      .select({ id: urlSubmission.id })
      .from(urlSubmission)
      .where(eq(urlSubmission.suggestionId, suggestionId))
      .limit(1);
    if (exists.length === 0) {
      throw conflict("Uudelleenkäsittely ei onnistu — alkuperäistä linkkiehdotusta ei löydy");
    }
    throw conflict("Tekoälykäsittely on jo käynnissä");
  }
  // As on the first run: the row is claimable work, kick an immediate drain.
  void runProcessorOnce();
}
