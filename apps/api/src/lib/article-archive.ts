import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { fetchPageText } from "./page-preview.js";
import { putTextObject, s3Configured } from "./s3.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { urlSubmission } from "../db/schema/index.js";

/**
 * Submit-time page archive: capture the article text once, right after the
 * reader submits, and keep it in S3 — processing later reads the archive
 * instead of re-fetching a page that may have changed or died by then.
 *
 * The queue is the `url_submission` table itself, not process memory: a row
 * with `archive_status = 'pending'` is outstanding work. A background worker
 * claims due rows (`FOR UPDATE SKIP LOCKED`), archives them, and either marks a
 * terminal status or reschedules with backoff. Submitting kicks an immediate
 * drain so the common case is still prompt; a periodic poll picks up retries and
 * any rows a crash left stranded. Because the work list is durable, a restart
 * mid-archive resumes instead of losing the capture — and the `SKIP LOCKED`
 * claim stays correct if the API is ever run as more than one replica.
 */

/**
 * Below this much page text we assume a paywall or consent wall ate the
 * article: even short news items exceed this once page furniture (nav,
 * cookie banners, related links) is included. Measured on the Markdown with
 * link targets removed — URLs would otherwise inflate a link-heavy but
 * content-free page past any threshold.
 */
const PAYWALL_TEXT_THRESHOLD = 600;

function contentLength(markdown: string): number {
  return markdown.replace(/\]\([^)]*\)/g, "]").length;
}

/** Whether submissions should attempt archiving at all. */
export const archiveEnabled = s3Configured;

/** Max outbound archive fetches per drain cycle — bounds amplification of a submission flood. */
const BATCH_SIZE = 4;
/** How long a claimed row is hidden from other workers; must exceed one archive attempt. */
const LEASE_MS = 2 * 60_000;
/** Cap on the exponential backoff between retries. */
const MAX_BACKOFF_MS = 60 * 60_000;

/** New archives are Markdown; rows from the plain-text era keep `.txt` keys. */
export function archiveKeyFor(submissionId: string): string {
  return `archive/submissions/${submissionId}.md`;
}

/**
 * Key for editor-pasted text, deliberately distinct from {@link archiveKeyFor}.
 * A manual paste and a worker attempt racing on the same row therefore write
 * different objects; the DB's `archive_text_key` — set under the `pending` guard
 * — decides which one the reader gets, so neither can clobber the other in S3.
 */
export function manualArchiveKeyFor(submissionId: string): string {
  return `archive/submissions/${submissionId}-manual.md`;
}

/** Pure classification of a fetch result, exported for tests. */
export function classifyArchive(fetched: boolean, text: string): "ok" | "paywalled" | "failed" {
  if (!fetched) return "failed";
  return contentLength(text) < PAYWALL_TEXT_THRESHOLD ? "paywalled" : "ok";
}

/** Backoff before the next attempt, doubling per attempt up to the cap. */
function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, env.ARCHIVE_RETRY_BASE_MS * 2 ** (attempts - 1));
}

/**
 * Claim up to a batch of due `pending` rows: lock them with SKIP LOCKED, bump
 * the attempt counter, and set a short lease (a future `next_attempt_at`) so a
 * concurrent worker — or this one on the next tick — skips them until the lease
 * expires. Returns the rows with their post-increment attempt number.
 */
async function claimBatch(): Promise<{ id: string; url: string; attempts: number }[]> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: urlSubmission.id,
        url: urlSubmission.url,
        attempts: urlSubmission.archiveAttempts,
      })
      .from(urlSubmission)
      .where(
        and(
          eq(urlSubmission.archiveStatus, "pending"),
          or(
            isNull(urlSubmission.archiveNextAttemptAt),
            lte(urlSubmission.archiveNextAttemptAt, now),
          ),
        ),
      )
      // Fresh submissions (null) first, then oldest-due retries.
      .orderBy(sql`${urlSubmission.archiveNextAttemptAt} asc nulls first`)
      .limit(BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return [];

    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    await tx
      .update(urlSubmission)
      .set({
        archiveAttempts: sql`${urlSubmission.archiveAttempts} + 1`,
        archiveNextAttemptAt: leaseUntil,
      })
      .where(
        inArray(
          urlSubmission.id,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => ({ id: r.id, url: r.url, attempts: r.attempts + 1 }));
  });
}

/**
 * Write a terminal status. Conditional on the row still being `pending`, so an
 * editor's manual paste (which sets `ok`) wins the row: the guard protects the
 * status/key columns, and the distinct manual S3 key (see
 * {@link manualArchiveKeyFor}) protects the object.
 */
async function markTerminal(
  id: string,
  status: "ok" | "paywalled" | "failed",
  textKey: string | null,
): Promise<void> {
  await db
    .update(urlSubmission)
    .set({ archiveStatus: status, archiveTextKey: textKey, archiveNextAttemptAt: null })
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.archiveStatus, "pending")));
}

/** Push the next attempt into the future (backoff). Conditional as above. */
async function scheduleRetry(id: string, retryAt: Date): Promise<void> {
  await db
    .update(urlSubmission)
    .set({ archiveNextAttemptAt: retryAt })
    .where(and(eq(urlSubmission.id, id), eq(urlSubmission.archiveStatus, "pending")));
}

/**
 * One archive attempt for a claimed row: fetch, store any text, and either
 * finalize (ok/paywalled) or, on an unreadable page or an S3/DB error, retry
 * with backoff until the attempt budget is spent — then give up as `failed`.
 * Never throws; the worker treats every row independently.
 */
async function archiveRow(id: string, url: string, attempts: number): Promise<void> {
  try {
    const { fetched, text } = await fetchPageText(url);
    const status = classifyArchive(fetched, text);
    if (status !== "failed") {
      // ok / paywalled: store what we got (paywalled pages carry a little text)
      // and finish. A throw here (S3 down) falls through to the retry path.
      const key = text ? archiveKeyFor(id) : null;
      if (key) await putTextObject(key, text);
      await markTerminal(id, status, key);
      return;
    }
    throw new Error("page not fetched"); // unify unreadable pages with the retry path
  } catch (err) {
    const message = (err as Error).message;
    if (attempts >= env.ARCHIVE_MAX_ATTEMPTS) {
      logger.warn({ submissionId: id, url, attempts, err: message }, "archive giving up");
      await markTerminal(id, "failed", null).catch((e: unknown) =>
        logger.error(
          { submissionId: id, err: (e as Error).message },
          "failed to record archive failure",
        ),
      );
    } else {
      const retryAt = new Date(Date.now() + backoffMs(attempts));
      logger.debug(
        { submissionId: id, url, attempts, err: message },
        "archive attempt failed, retrying",
      );
      await scheduleRetry(id, retryAt).catch((e: unknown) =>
        logger.error(
          { submissionId: id, err: (e as Error).message },
          "failed to reschedule archive",
        ),
      );
    }
  }
}

let draining: Promise<void> | null = null;
let rerun = false;
let pollTimer: NodeJS.Timeout | null = null;
let stopped = false;

/** Claim and archive due rows in batches until none remain (or shutdown). */
async function drain(): Promise<void> {
  for (;;) {
    if (stopped) return;
    let batch: { id: string; url: string; attempts: number }[];
    try {
      batch = await claimBatch();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "archive claim failed");
      return;
    }
    if (batch.length === 0) return;
    await Promise.all(batch.map((r) => archiveRow(r.id, r.url, r.attempts)));
  }
}

/**
 * Run a drain, single-flighted so the submit kick and the poll tick never
 * overlap. A kick that arrives while a drain is running flags a re-run, so a
 * row inserted just as the current drain finishes gets picked up immediately
 * instead of waiting for the next poll. Safe to call when archiving is disabled
 * or the worker is stopping.
 */
export function runArchiveOnce(): Promise<void> {
  if (!archiveEnabled || stopped) return Promise.resolve();
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
 * Idempotent-ish — call once at boot.
 *
 * Recovery of rows a crash stranded is intentionally lease-based, not a boot
 * sweep: fresh (`null`) and backoff-due rows are claimable at once and get
 * picked up by the initial drain, while a row that was actively leased when the
 * process died stays hidden only until its lease (LEASE_MS) expires. That keeps
 * startup correct even if more than one replica ever runs — a booting replica
 * must not yank a lease another replica is mid-archive on. (A graceful restart
 * drains in-flight work first via {@link stopArchiveWorker}, so a leftover lease
 * only happens on a hard crash.)
 */
export async function startArchiveWorker(): Promise<void> {
  if (!archiveEnabled) return;
  stopped = false;
  pollTimer = setInterval(() => void runArchiveOnce(), env.ARCHIVE_POLL_INTERVAL_MS);
  pollTimer.unref(); // don't keep the process alive for the poll alone
  await runArchiveOnce();
}

/** Stop polling and wait for the current drain, so the DB pool can close cleanly. */
export async function stopArchiveWorker(): Promise<void> {
  stopped = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (draining) await draining.catch(() => {});
}
