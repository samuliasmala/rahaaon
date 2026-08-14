import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { logger } from "./logger.js";
import { ntfyConfigured, publishNtfy, type NtfyMessage } from "./ntfy.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { suggestion, urlSubmission } from "../db/schema/index.js";

/**
 * Editorial push notifications: tell the editor when a reader's link lands in
 * the Ehdotusjono, then keep nudging while anything is still waiting.
 *
 * Arrivals are claimed off the table, not off an in-process event: a row with
 * `notified_at IS NULL` is an unannounced arrival, so a submission that landed
 * while the API was down still gets announced at boot, and two replicas can
 * never announce the same row twice — the claiming UPDATE is the mutual
 * exclusion. Announcing is deliberately at-most-once: a failed push is logged
 * and dropped rather than retried, because the reminder below already covers a
 * missed arrival (the row is, by definition, still in the queue).
 *
 * The reminder repeats every NOTIFY_REMINDER_INTERVAL_MS for as long as the
 * admin badge is non-empty, counting exactly what the badge counts (see
 * apps/web/src/components/layout/header.tsx): unprocessed reader links plus
 * pending AI-queue entries. Its clock lives in memory and restarts with the
 * process, so a deploy costs at most one skipped nudge — and every push sent
 * resets it, so an arrival and a reminder never land seconds apart.
 */

/** Whether push notifications are configured at all. */
export const notifierEnabled = ntfyConfigured;

/** A reader link that has not been announced yet. */
export interface Arrival {
  url: string;
  title: string;
  siteName: string;
}

/** What the admin badge shows, split into its two halves. */
export interface QueueCounts {
  /** Reader links still sitting in the Ehdotusjono. */
  submissions: number;
  /** AI-processed entries waiting for an editor's verdict. */
  suggestions: number;
  total: number;
}

/**
 * Claim every unannounced arrival in one statement, oldest first. A concurrent
 * worker's UPDATE re-evaluates this WHERE after ours commits, sees the rows
 * already stamped, and claims nothing — no explicit locking needed.
 */
async function claimArrivals(): Promise<Arrival[]> {
  const rows = await db
    .update(urlSubmission)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        eq(urlSubmission.status, "new"),
        isNull(urlSubmission.suggestionId),
        isNull(urlSubmission.notifiedAt),
      ),
    )
    .returning({
      url: urlSubmission.url,
      title: urlSubmission.title,
      siteName: urlSubmission.siteName,
      createdAt: urlSubmission.createdAt,
    });
  // RETURNING has no order of its own; sort so the message lists arrivals in
  // the order they came in (and so the tests can assert on it).
  return rows
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(({ url, title, siteName }) => ({ url, title, siteName }));
}

/** The badge's two counts. Kept in this module so the copy can't drift from it. */
async function pendingCounts(): Promise<QueueCounts> {
  const [subs, sugg] = await Promise.all([
    db
      .select({ n: count() })
      .from(urlSubmission)
      .where(
        and(
          inArray(urlSubmission.status, ["new", "processing"]),
          isNull(urlSubmission.suggestionId),
        ),
      ),
    db.select({ n: count() }).from(suggestion).where(eq(suggestion.status, "pending")),
  ]);
  const submissions = subs[0]?.n ?? 0;
  const suggestions = sugg[0]?.n ?? 0;
  return { submissions, suggestions, total: submissions + suggestions };
}

/** Finnish count phrase: "1 kohde" / "3 kohdetta". */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** How many arrivals are named before the message just counts the rest. */
const MAX_LISTED = 3;

/** One arrival as a line: where it's from, and what the reader linked to. */
function arrivalLine(a: Arrival): string {
  const label = a.title.trim() || a.url;
  const source = a.siteName.trim();
  return source ? `${source}: ${label}` : label;
}

/** The push for links that just arrived. Pure — exported for the unit tests. */
export function arrivalMessage(arrivals: Arrival[], counts: QueueCounts): NtfyMessage {
  const lines = arrivals.slice(0, MAX_LISTED).map(arrivalLine);
  const rest = arrivals.length - lines.length;
  if (rest > 0) lines.push(`…ja ${plural(rest, "muu", "muuta")}.`);
  lines.push(`Jonossa ${plural(counts.total, "kohde", "kohdetta")}.`);
  return {
    title: arrivals.length === 1 ? "Uusi ehdotus" : `${arrivals.length} uutta ehdotusta`,
    message: lines.join("\n"),
    priority: 4,
    tags: ["inbox_tray"],
  };
}

/** The hourly nudge while the badge is non-empty. Pure — exported for the unit tests. */
export function reminderMessage(counts: QueueCounts): NtfyMessage {
  return {
    title: "Ylläpitojono odottaa",
    message:
      `${plural(counts.total, "kohde", "kohdetta")} odottaa käsittelyä: ` +
      `${plural(counts.submissions, "ehdotus", "ehdotusta")} jonossa, ` +
      `${plural(counts.suggestions, "AI-tiivistelmä", "AI-tiivistelmää")} tarkistettavana.`,
    priority: 3,
    tags: ["hourglass"],
  };
}

let pollTimer: NodeJS.Timeout | null = null;
let stopped = false;
let running: Promise<void> | null = null;
let rerun = false;
/** Earliest time the next reminder may go out; pushed forward by every push and by an empty queue. */
let nextReminderAt = 0;

/** Publish, and restart the reminder clock — anything sent counts as a nudge. */
async function send(msg: NtfyMessage): Promise<void> {
  await publishNtfy({ ...msg, click: new URL("/admin", env.APP_URL).toString() });
  nextReminderAt = Date.now() + env.NOTIFY_REMINDER_INTERVAL_MS;
}

/** One pass: announce what arrived, otherwise nudge if the queue has gone stale. */
async function tick(): Promise<void> {
  const arrivals = await claimArrivals();
  const counts = await pendingCounts();
  if (arrivals.length > 0) {
    await send(arrivalMessage(arrivals, counts));
    return;
  }
  if (counts.total === 0) {
    // Nothing waiting. Hold the clock a full interval out so whatever lands
    // next gets its own grace period instead of inheriting a stale countdown.
    nextReminderAt = Date.now() + env.NOTIFY_REMINDER_INTERVAL_MS;
    return;
  }
  if (Date.now() >= nextReminderAt) await send(reminderMessage(counts));
}

/**
 * Run one pass, single-flighted so the submit kick and the poll tick never
 * overlap. A kick that arrives mid-pass flags a re-run, so a row inserted just
 * as the current pass finished is announced immediately rather than at the next
 * poll. Never rejects: a failed push must not take down the timer.
 */
export function runQueueNotifierOnce(): Promise<void> {
  if (!notifierEnabled || stopped) return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      try {
        await tick();
      } catch (err) {
        logger.error({ err: (err as Error).message }, "queue notification failed");
      }
    } while (rerun && !stopped);
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Start the notifier: poll on an interval and run an initial pass, which
 * announces anything that arrived while the process was down. The reminder
 * clock starts at a full interval so a restart never nudges on boot.
 */
export async function startQueueNotifier(): Promise<void> {
  if (!notifierEnabled) return;
  stopped = false;
  nextReminderAt = Date.now() + env.NOTIFY_REMINDER_INTERVAL_MS;
  pollTimer = setInterval(() => void runQueueNotifierOnce(), env.NOTIFY_POLL_INTERVAL_MS);
  pollTimer.unref(); // don't keep the process alive for the poll alone
  await runQueueNotifierOnce();
}

/** Stop polling and wait for the pass in flight, so the DB pool can close cleanly. */
export async function stopQueueNotifier(): Promise<void> {
  stopped = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (running) await running.catch(() => {});
}
