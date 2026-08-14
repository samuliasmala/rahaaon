import { createServer, type Server } from "node:http";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The editorial queue notifier against a real Postgres, with a stub ntfy server
 * standing in for the phone: a reader's link is announced exactly once (the
 * claim is a DB write, so a restart can't replay it), a burst collapses into one
 * push, and a queue left sitting is nudged again every reminder interval until
 * it is empty.
 *
 * The notifier is driven by hand rather than by its poll timer — every
 * assertion is about what a single pass does, and the timer would only add
 * flakiness. The reminder interval is squeezed to a few hundred milliseconds so
 * the "still waiting" path is testable without waiting an hour.
 */

const TOPIC = "rahaaon-notifier-test";
const APP = "https://test.rahaa-on.fi";
const REMINDER_MS = 300;

interface Published {
  topic: string;
  title: string;
  message: string;
  priority?: number;
  tags?: string[];
  click?: string;
}

let container: StartedPostgreSqlContainer;
let sql: ReturnType<typeof postgres>;
let ntfyServer: Server;
let closeDb: () => Promise<void>;
let runQueueNotifierOnce: () => Promise<void>;
let stopQueueNotifier: () => Promise<void>;

/** Everything the stub ntfy server has been handed, oldest first. */
let published: Published[] = [];
/** When set, the stub fails the next publish with this status (then clears). */
let failNextWith: number | null = null;

const arrivals = (): Published[] => published.filter((p) => p.title.includes("ehdotus"));
const reminders = (): Published[] => published.filter((p) => p.title === "Ylläpitojono odottaa");

async function insertSubmission(
  url: string,
  { title = "", siteName = "", status = "new" } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into url_submission (url, title, site_name, status)
    values (${url}, ${title}, ${siteName}, ${status}::url_submission_status)
    returning id
  `;
  return row!.id;
}

/** A pending AI-queue entry — the badge's other half, which reminders must count. */
async function insertPendingSuggestion(url: string): Promise<void> {
  await sql`
    insert into suggestion (url, title, amount_eur, entity, category, source_name, summary, confidence)
    values (${url}, 'Testikohde', 50000, 'Vantaa', 'Muu', 'Testilehti', 'Tiivistelmä.', 90)
  `;
}

async function notifiedAt(id: string): Promise<Date | null> {
  const [row] = await sql<{ notified_at: Date | null }[]>`
    select notified_at from url_submission where id = ${id}
  `;
  return row!.notified_at;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  // The stub must be listening before env is read: NTFY_SERVER carries its port,
  // and config/env.ts parses the environment once, at import.
  ntfyServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (failNextWith !== null) {
        res.statusCode = failNextWith;
        failNextWith = null;
        res.end("nope");
        return;
      }
      published.push(JSON.parse(Buffer.concat(chunks).toString()) as Published);
      res.statusCode = 200;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => ntfyServer.listen(0, "127.0.0.1", resolve));
  const { port } = ntfyServer.address() as { port: number };

  container = await new PostgreSqlContainer("postgres:17").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16-chars-long";
  process.env.NODE_ENV = "test";
  process.env.APP_URL = APP;
  process.env.NTFY_SERVER = `http://127.0.0.1:${port}`;
  process.env.NTFY_TOPIC = TOPIC;
  // Empty rather than deleted — env.ts treats "" as unset, while loadEnvFile
  // would refill a deleted var from the repo .env.
  process.env.NTFY_TOKEN = "";
  process.env.OPENAI_API_KEY = "";
  process.env.S3_ENDPOINT = "";
  process.env.S3_BUCKET = "";
  process.env.S3_ACCESS_KEY_ID = "";
  process.env.S3_SECRET_ACCESS_KEY = "";
  process.env.NOTIFY_REMINDER_INTERVAL_MS = String(REMINDER_MS);

  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
  await migrationClient.end();
  sql = postgres(process.env.DATABASE_URL);

  closeDb = (await import("./db/client.js")).closeDb;
  const notifier = await import("./lib/queue-notifier.js");
  runQueueNotifierOnce = notifier.runQueueNotifierOnce;
  stopQueueNotifier = notifier.stopQueueNotifier;
  // Without this every assertion below would pass vacuously: a disabled
  // notifier does nothing at all, quietly.
  if (!notifier.notifierEnabled) throw new Error("notifier disabled — NTFY_TOPIC did not take");
}, 180_000);

afterAll(async () => {
  await stopQueueNotifier?.();
  await closeDb?.();
  await sql?.end();
  await container?.stop();
  await new Promise<void>((resolve) => ntfyServer?.close(() => resolve()));
});

beforeEach(async () => {
  await sql`truncate url_submission, suggestion restart identity cascade`;
  failNextWith = null;
  // One pass over an empty queue: sends nothing, but parks the reminder clock a
  // full interval out so each test starts from the same place.
  await runQueueNotifierOnce();
  published = [];
});

describe("queue notifier", () => {
  it("announces a new reader link once and never again", async () => {
    const id = await insertSubmission("https://example.invalid/kahvinkeitin", {
      title: "Kaupunki osti kultaisen kahvinkeittimen",
      siteName: "Testilehti",
    });

    await runQueueNotifierOnce();
    expect(arrivals()).toHaveLength(1);
    const [push] = arrivals();
    expect(push).toMatchObject({
      topic: TOPIC,
      title: "Uusi ehdotus",
      click: `${APP}/admin`,
      priority: 4,
    });
    expect(push!.message).toContain("Kaupunki osti kultaisen kahvinkeittimen");
    expect(push!.message).toContain("Jonossa 1 kohde.");
    // The claim is persisted, which is what makes the announcement single-shot.
    expect(await notifiedAt(id)).toBeInstanceOf(Date);

    await runQueueNotifierOnce();
    expect(arrivals()).toHaveLength(1);
  });

  it("collapses a burst of arrivals into one push", async () => {
    await insertSubmission("https://example.invalid/eka", { title: "Eka", siteName: "Testilehti" });
    await insertSubmission("https://example.invalid/toka", {
      title: "Toka",
      siteName: "Testilehti",
    });

    await runQueueNotifierOnce();
    expect(arrivals()).toHaveLength(1);
    expect(arrivals()[0]).toMatchObject({ title: "2 uutta ehdotusta" });
    expect(arrivals()[0]!.message).toContain("Jonossa 2 kohdetta.");
  });

  it("leaves rows the editor has already moved on alone", async () => {
    await insertSubmission("https://example.invalid/kesken", { status: "processing" });
    await insertSubmission("https://example.invalid/hylatty", { status: "rejected" });

    await runQueueNotifierOnce();
    expect(arrivals()).toHaveLength(0);
  });

  it("stays quiet for a link the editor added themselves", async () => {
    // The capture tool's fallback: the editor found the article, so pushing
    // "uusi ehdotus" back at them would announce their own click. The row is
    // queued work all the same, so the reminder still counts it.
    const { createSubmission } = await import("./features/submissions/submissions.repo.js");
    await createSubmission("https://example.invalid/toimittajan-oma", { announce: false });

    await runQueueNotifierOnce();
    expect(published).toHaveLength(0);

    await wait(REMINDER_MS + 150);
    await runQueueNotifierOnce();
    expect(reminders()[0]!.message).toContain("1 ehdotus jonossa");
  });

  it("drops an announcement the push server refused, rather than replaying it", async () => {
    const id = await insertSubmission("https://example.invalid/palvelin-nurin", { title: "Juttu" });
    failNextWith = 500;

    // A refused push must not escape the pass — the poll timer runs on this.
    await expect(runQueueNotifierOnce()).resolves.toBeUndefined();
    expect(published).toHaveLength(0);
    // Claimed all the same: the reminder below is what covers a missed arrival.
    expect(await notifiedAt(id)).toBeInstanceOf(Date);
  });

  it("nudges while anything is waiting and goes quiet once the queue is empty", async () => {
    // The AI-queue half of the badge, with no arrival to announce.
    await insertPendingSuggestion("https://example.invalid/ai-jonossa");

    await runQueueNotifierOnce();
    expect(reminders()).toHaveLength(0); // clock not due yet

    await wait(REMINDER_MS + 150);
    await runQueueNotifierOnce();
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]).toMatchObject({ title: "Ylläpitojono odottaa", priority: 3 });
    expect(reminders()[0]!.message).toBe(
      "1 kohde odottaa käsittelyä: 0 ehdotusta jonossa, 1 AI-tiivistelmä tarkistettavana.",
    );

    // Sending resets the clock, so an immediate second pass stays silent.
    await runQueueNotifierOnce();
    expect(reminders()).toHaveLength(1);

    // Empty the queue and the nudging stops, however long it sits.
    await sql`delete from suggestion`;
    await wait(REMINDER_MS + 150);
    await runQueueNotifierOnce();
    expect(reminders()).toHaveLength(1);
  });

  it("counts both halves of the badge in the nudge", async () => {
    await insertSubmission("https://example.invalid/jonossa", { title: "Jonossa" });
    await insertPendingSuggestion("https://example.invalid/ai-jonossa");
    // Announce the arrival first so the next pass is a pure reminder.
    await runQueueNotifierOnce();
    expect(arrivals()).toHaveLength(1);

    await wait(REMINDER_MS + 150);
    await runQueueNotifierOnce();
    expect(reminders()[0]!.message).toBe(
      "2 kohdetta odottaa käsittelyä: 1 ehdotus jonossa, 1 AI-tiivistelmä tarkistettavana.",
    );
  });
});
