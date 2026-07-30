import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { fetchPageText } from "./page-preview.js";
import { getTextObject } from "./s3.js";
import { extractArticle } from "./suggestion-ai.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { suggestion, urlSubmission, wasteItem } from "../db/schema/index.js";

/**
 * Background processing of Ehdotusjono entries: the editor's "Käsittele" only
 * flips the row to `processing` and returns — the extraction (text retrieval +
 * LLM call, easily tens of seconds) runs here, off the request. The admin UI
 * shows the persisted `processing` state (it survives a page refresh) and polls
 * until the entry moves on to the AI queue.
 *
 * Same durable-queue design as the archive worker (lib/article-archive.ts): a
 * row with `status = 'processing'` is outstanding work. The worker claims due
 * rows (`FOR UPDATE SKIP LOCKED` + a lease), runs the extraction and either
 * finalizes the row as `processed` or retries with backoff — until the attempt
 * budget is spent, when the row returns to `new` with `process_error` set so
 * the editor sees what happened and can retry by hand. "Käsittele" kicks an
 * immediate drain; the periodic poll picks up retries and rows a crash left
 * mid-lease.
 */

/** Max concurrent extractions per drain cycle — LLM calls are slow and paid. */
const BATCH_SIZE = 2;
/** How long a claimed row is hidden from other workers; must exceed one extraction attempt. */
const LEASE_MS = 5 * 60_000;
/** Cap on the exponential backoff between retries. */
const MAX_BACKOFF_MS = 10 * 60_000;
/**
 * Hard cap on one attempt (text retrieval + LLM call), safely under LEASE_MS.
 * The drain loop is single-flighted and awaits the whole batch, so without
 * this a hung request would stall the entire processor — no other rows would
 * ever be claimed again.
 */
const ATTEMPT_TIMEOUT_MS = 4 * 60_000;

type SubmissionRow = typeof urlSubmission.$inferSelect;

/** Backoff before the next attempt, doubling per attempt up to the cap. */
function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, env.PROCESS_RETRY_BASE_MS * 2 ** (attempts - 1));
}

/**
 * Claim up to a batch of due `processing` rows: lock them with SKIP LOCKED,
 * bump the attempt counter, and set a short lease (a future `next_attempt_at`)
 * so a concurrent worker — or this one on the next tick — skips them until the
 * lease expires. Returns the rows with their post-increment attempt number.
 */
async function claimBatch(): Promise<{ row: SubmissionRow; attempts: number }[]> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(urlSubmission)
      .where(
        and(
          eq(urlSubmission.status, "processing"),
          or(
            isNull(urlSubmission.processNextAttemptAt),
            lte(urlSubmission.processNextAttemptAt, now),
          ),
        ),
      )
      // Fresh clicks (null) first, then oldest-due retries.
      .orderBy(sql`${urlSubmission.processNextAttemptAt} asc nulls first`)
      .limit(BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return [];

    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    await tx
      .update(urlSubmission)
      .set({
        processAttempts: sql`${urlSubmission.processAttempts} + 1`,
        processNextAttemptAt: leaseUntil,
      })
      .where(
        inArray(
          urlSubmission.id,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((row) => ({ row, attempts: row.processAttempts + 1 }));
  });
}

/**
 * The article text for the extraction: the submit-time S3 archive when one
 * exists (the page as the reader saw it — no second download), otherwise one
 * live fetch attempt (pre-archive rows, failed archives, archiving disabled).
 */
async function pageTextFor(entry: SubmissionRow): Promise<string> {
  if (entry.archiveTextKey) {
    try {
      return await getTextObject(entry.archiveTextKey);
    } catch (err) {
      logger.warn(
        { id: entry.id, key: entry.archiveTextKey, err: (err as Error).message },
        "archived text unavailable, falling back to live fetch",
      );
    }
  }
  return (await fetchPageText(entry.url)).text;
}

/**
 * Finalize a successful extraction, in one transaction: insert the pending
 * suggestion and mark the submission `processed` — or, on a reprocess run
 * (the row already carries a suggestion_id), overwrite the existing
 * suggestion's AI fields in place, and the published feed item too when the
 * suggestion has been approved. Guarded on the row still being `processing` —
 * if an attempt outlived its lease and a duplicate attempt finalized first,
 * the late result is discarded (only the extra LLM call was wasted).
 */
async function finalize(
  entry: SubmissionRow,
  extraction: Awaited<ReturnType<typeof extractArticle>>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: urlSubmission.id })
      .from(urlSubmission)
      .where(and(eq(urlSubmission.id, entry.id), eq(urlSubmission.status, "processing")))
      .limit(1)
      .for("update");
    if (!locked) {
      logger.warn({ id: entry.id }, "submission no longer processing, discarding extraction");
      return;
    }

    let suggestionId = entry.suggestionId;
    if (suggestionId) {
      // Reprocess: replace the AI-drafted fields on the existing row. A
      // suggestion rejected (or deleted) mid-run keeps its verdict — the
      // extraction is discarded and only the submission's processing state is
      // cleared below.
      const [current] = await tx
        .select({ status: suggestion.status, publishedItemId: suggestion.publishedItemId })
        .from(suggestion)
        .where(eq(suggestion.id, suggestionId))
        .limit(1)
        .for("update");
      if (current && current.status !== "rejected") {
        await tx.update(suggestion).set(extraction).where(eq(suggestion.id, suggestionId));
        if (current.status === "approved" && current.publishedItemId) {
          // The suggestion is live on the feed — carry the redraft onto the
          // item (same fields approval copies; aiNote/confidence stay
          // queue-side and publishedAt/hidden/votes are editorial state).
          const { aiNote: _note, confidence: _conf, ...itemFields } = extraction;
          await tx
            .update(wasteItem)
            .set(itemFields)
            .where(eq(wasteItem.id, current.publishedItemId));
        }
      } else {
        logger.warn(
          { id: entry.id, suggestionId },
          "suggestion gone or rejected mid-reprocess, discarding extraction",
        );
      }
    } else {
      const [created] = await tx
        .insert(suggestion)
        // articleTitle is submit-time metadata, not AI output — copied here
        // once and left alone on reprocess so an editor's fix survives.
        .values({ url: entry.url, articleTitle: entry.title.slice(0, 300), ...extraction })
        .returning({ id: suggestion.id });
      suggestionId = created!.id;
    }

    await tx
      .update(urlSubmission)
      .set({
        status: "processed",
        processedAt: new Date(),
        suggestionId,
        processNextAttemptAt: null,
        processError: null,
      })
      .where(eq(urlSubmission.id, entry.id));
  });
}

/**
 * Give up: return the row to where the editor can see the failure note and
 * retry (or reject) — the Ehdotusjono for a first run, `processed` for a
 * reprocess (the queue card / published row surfaces the error). Conditional
 * on the row still being `processing`, like {@link finalize}.
 */
async function markFailed(entry: SubmissionRow, message: string): Promise<void> {
  await db
    .update(urlSubmission)
    .set({
      status: entry.suggestionId ? "processed" : "new",
      processNextAttemptAt: null,
      processError: message,
    })
    .where(and(eq(urlSubmission.id, entry.id), eq(urlSubmission.status, "processing")));
}

/** Push the next attempt into the future (backoff). Conditional as above. */
async function scheduleRetry(id: string, retryAt: Date): Promise<void> {
  await db
    .update(urlSubmission)
    .set({ processNextAttemptAt: retryAt })
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.status, "processing")));
}

/**
 * One extraction attempt for a claimed row: fetch the text, run the LLM, and
 * either finalize or retry with backoff until the attempt budget is spent —
 * then return the row to `new` with the error recorded. Never throws; the
 * worker treats every row independently.
 */
/** Reject with a (Finnish, editor-visible) timeout error if `work` outlives the attempt cap. */
async function withAttemptTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("AI-käsittely aikakatkaistiin — yritä uudelleen")),
      ATTEMPT_TIMEOUT_MS,
    );
    timer.unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function processRow(row: SubmissionRow, attempts: number): Promise<void> {
  try {
    const extraction = await withAttemptTimeout(
      (async () =>
        extractArticle(
          row.url,
          { title: row.title, description: row.description, siteName: row.siteName },
          await pageTextFor(row),
          row.processInstructions,
        ))(),
    );
    await finalize(row, extraction);
  } catch (err) {
    // A config error (LLM key missing) fails all attempts identically, but the
    // budget is small enough that special-casing it isn't worth the branch.
    const message = (err as Error).message;
    if (attempts >= env.PROCESS_MAX_ATTEMPTS) {
      logger.warn(
        { submissionId: row.id, url: row.url, attempts, err: message },
        "processing giving up",
      );
      await markFailed(row, message).catch((e: unknown) =>
        logger.error(
          { submissionId: row.id, err: (e as Error).message },
          "failed to record processing failure",
        ),
      );
    } else {
      const retryAt = new Date(Date.now() + backoffMs(attempts));
      logger.debug(
        { submissionId: row.id, url: row.url, attempts, err: message },
        "processing attempt failed, retrying",
      );
      await scheduleRetry(row.id, retryAt).catch((e: unknown) =>
        logger.error(
          { submissionId: row.id, err: (e as Error).message },
          "failed to reschedule processing",
        ),
      );
    }
  }
}

let draining: Promise<void> | null = null;
let rerun = false;
let pollTimer: NodeJS.Timeout | null = null;
let stopped = false;

/** Claim and process due rows in batches until none remain (or shutdown). */
async function drain(): Promise<void> {
  for (;;) {
    if (stopped) return;
    let batch: { row: SubmissionRow; attempts: number }[];
    try {
      batch = await claimBatch();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "processor claim failed");
      return;
    }
    if (batch.length === 0) return;
    await Promise.all(batch.map((b) => processRow(b.row, b.attempts)));
  }
}

/**
 * Run a drain, single-flighted so the "Käsittele" kick and the poll tick never
 * overlap. A kick that arrives while a drain is running flags a re-run, so a
 * row queued just as the current drain finishes gets picked up immediately
 * instead of waiting for the next poll.
 */
export function runProcessorOnce(): Promise<void> {
  if (stopped) return Promise.resolve();
  if (draining) {
    rerun = true;
    return draining;
  }
  draining = (async () => {
    do {
      rerun = false;
      await drain();
    } while (rerun && !stopped);
  })().finally(() => {
    draining = null;
  });
  return draining;
}

/**
 * Start the background worker: poll on an interval and kick an initial drain.
 * Recovery of rows a crash stranded is lease-based, exactly like the archive
 * worker — see {@link startArchiveWorker} in lib/article-archive.ts for why.
 */
export async function startSubmissionProcessor(): Promise<void> {
  stopped = false;
  pollTimer = setInterval(() => void runProcessorOnce(), env.PROCESS_POLL_INTERVAL_MS);
  pollTimer.unref(); // don't keep the process alive for the poll alone
  await runProcessorOnce();
}

/** Stop polling and wait for the current drain, so the DB pool can close cleanly. */
export async function stopSubmissionProcessor(): Promise<void> {
  stopped = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (draining) await draining.catch(() => {});
}
