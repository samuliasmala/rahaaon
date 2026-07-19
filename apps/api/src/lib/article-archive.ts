import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { fetchPageText } from "./page-preview.js";
import { putTextObject, s3Configured } from "./s3.js";
import { db } from "../db/client.js";
import { urlSubmission } from "../db/schema/index.js";

/**
 * Submit-time page archive: capture the article text once, right after the
 * reader submits, and keep it in S3 — processing later reads the archive
 * instead of re-fetching a page that may have changed or died by then. Runs
 * fire-and-forget after the submission row is created; failures only mark the
 * row (`archive_status`), never surface to the submitter.
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

/**
 * The submit endpoint is anonymous and unthrottled (accepted MVP posture), so
 * the background fetch + S3 write it spawns must not amplify a submission
 * flood into unbounded outbound connections. Excess jobs queue in-process;
 * queued entries are just id+url, so memory stays negligible.
 */
const MAX_CONCURRENT_ARCHIVES = 4;
let running = 0;
const queue: (() => void)[] = [];

async function withArchiveSlot(job: () => Promise<void>): Promise<void> {
  if (running >= MAX_CONCURRENT_ARCHIVES) {
    await new Promise<void>((release) => queue.push(release));
  }
  running++;
  try {
    await job();
  } finally {
    running--;
    queue.shift()?.();
  }
}

/** New archives are Markdown; rows from the plain-text era keep `.txt` keys. */
export function archiveKeyFor(submissionId: string): string {
  return `archive/submissions/${submissionId}.md`;
}

/** Pure classification of a fetch result, exported for tests. */
export function classifyArchive(fetched: boolean, text: string): "ok" | "paywalled" | "failed" {
  if (!fetched) return "failed";
  return contentLength(text) < PAYWALL_TEXT_THRESHOLD ? "paywalled" : "ok";
}

/**
 * Archiving is in-process, so a restart mid-archive strands rows at
 * `pending` (with processing unaffected — it falls back to a live fetch, but
 * the admin UI would show "Arkistoidaan…" forever). Any `pending` row at boot
 * is by definition stale; mark them failed. A row that races this sweep gets
 * its real status written by its own archive job moments later — harmless.
 */
export async function failStalePendingArchives(): Promise<void> {
  const stale = await db
    .update(urlSubmission)
    .set({ archiveStatus: "failed" })
    .where(eq(urlSubmission.archiveStatus, "pending"))
    .returning({ id: urlSubmission.id });
  if (stale.length > 0) {
    logger.warn({ count: stale.length }, "marked stale pending archives as failed");
  }
}

/**
 * Fetch, store and mark — never throws. The text is uploaded even for
 * `paywalled` pages (the editor can see what little was visible); `failed`
 * covers both unreadable pages and S3 errors.
 */
export async function archiveSubmission(submissionId: string, url: string): Promise<void> {
  return withArchiveSlot(() => doArchive(submissionId, url));
}

async function doArchive(submissionId: string, url: string): Promise<void> {
  let status: "ok" | "paywalled" | "failed" = "failed";
  let textKey: string | null = null;
  try {
    const { fetched, text } = await fetchPageText(url);
    status = classifyArchive(fetched, text);
    if (text) {
      const key = archiveKeyFor(submissionId);
      await putTextObject(key, text);
      textKey = key;
    }
  } catch (err) {
    logger.warn({ submissionId, url, err: (err as Error).message }, "submission archive failed");
    status = "failed";
    textKey = null;
  }

  try {
    await db
      .update(urlSubmission)
      .set({ archiveStatus: status, archiveTextKey: textKey })
      .where(eq(urlSubmission.id, submissionId));
  } catch (err) {
    logger.error({ submissionId, err: (err as Error).message }, "failed to record archive status");
  }
}
