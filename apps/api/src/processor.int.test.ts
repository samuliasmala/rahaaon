import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The background submission processor against a real Postgres: "Käsittele"
 * flips the row to `processing`, the worker runs the (mocked) extraction and
 * either finalizes the row as `processed` or — when the attempt budget is
 * spent — returns it to `new` with `process_error` set for the editor.
 *
 * The LLM extraction is mocked so failures are scriptable; everything else
 * (claiming, leases, backoff, the finalize transaction) is real. Rows are
 * inserted straight into the table — the submit flow has its own coverage —
 * and asserted through a raw SQL client.
 */

vi.mock("./lib/suggestion-ai.js", () => ({ extractArticle: vi.fn() }));

const EXTRACTION = {
  title: "Testiotsikko",
  amountEur: 50_000,
  amountType: "exact" as const,
  amountMaxEur: null,
  entity: "Vantaa",
  category: "Muu" as const,
  sourceName: "Testilehti",
  articlePublishedAt: null,
  summary: "Tiivistelmä.",
  aiNote: "",
  confidence: 90,
};

interface SubmissionView {
  id: string;
  processing: boolean;
  processError: string | null;
}

interface SubmissionRow {
  status: string;
  process_attempts: number;
  process_error: string | null;
  suggestion_id: string | null;
}

let container: StartedPostgreSqlContainer;
let sql: ReturnType<typeof postgres>;
let closeDb: () => Promise<void>;
let queueSubmissionForProcessing: (id: string) => Promise<SubmissionView>;
let listNewSubmissions: () => Promise<SubmissionView[]>;
let rejectSubmission: (id: string) => Promise<void>;
let stopSubmissionProcessor: () => Promise<void>;
let extractArticleMock: ReturnType<typeof vi.fn>;

async function insertSubmission(url: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into url_submission (url) values (${url}) returning id
  `;
  return row!.id;
}

async function submissionById(id: string): Promise<SubmissionRow> {
  const [row] = await sql<SubmissionRow[]>`
    select status, process_attempts, process_error, suggestion_id
    from url_submission where id = ${id}
  `;
  return row!;
}

/** Poll the row until the worker leaves it in the expected status (or time out). */
async function waitForStatus(id: string, expected: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { status } = await submissionById(id);
    if (status === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`submission ${id} stuck in '${status}', expected '${expected}'`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16-chars-long";
  process.env.NODE_ENV = "test";
  // Empty rather than deleted — env.ts treats "" as unset, while loadEnvFile
  // would refill a deleted var from the repo .env.
  process.env.OPENAI_API_KEY = "";
  process.env.S3_ENDPOINT = "";
  process.env.S3_BUCKET = "";
  process.env.S3_ACCESS_KEY_ID = "";
  process.env.S3_SECRET_ACCESS_KEY = "";
  // Fast, deterministic retries: give up after 3 attempts, tiny backoff, and
  // poll frequently so a scheduled retry is picked up within the test budget.
  process.env.PROCESS_MAX_ATTEMPTS = "3";
  process.env.PROCESS_RETRY_BASE_MS = "20";
  process.env.PROCESS_POLL_INTERVAL_MS = "100";

  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
  await migrationClient.end();
  sql = postgres(process.env.DATABASE_URL);

  closeDb = (await import("./db/client.js")).closeDb;
  const repo = await import("./features/submissions/submissions.repo.js");
  queueSubmissionForProcessing = repo.queueSubmissionForProcessing;
  listNewSubmissions = repo.listNewSubmissions;
  rejectSubmission = repo.rejectSubmission;
  extractArticleMock = vi.mocked((await import("./lib/suggestion-ai.js")).extractArticle);

  // server.ts starts the worker in production; the test drives the modules
  // directly, so start it here (the poll loop is what drives retries).
  const processor = await import("./lib/submission-processor.js");
  stopSubmissionProcessor = processor.stopSubmissionProcessor;
  await processor.startSubmissionProcessor();
}, 180_000);

afterAll(async () => {
  await stopSubmissionProcessor?.();
  await closeDb?.();
  await sql?.end();
  await container?.stop();
});

beforeEach(() => {
  extractArticleMock.mockReset();
});

describe("submission processor", () => {
  it("queues the row as processing and finalizes it into a suggestion", async () => {
    extractArticleMock.mockResolvedValue(EXTRACTION);
    const id = await insertSubmission("https://example.invalid/onnistuu");

    const queued = await queueSubmissionForProcessing(id);
    expect(queued.processing).toBe(true);

    await waitForStatus(id, "processed");
    const row = await submissionById(id);
    expect(row.suggestion_id).toBeTruthy();
    expect(row.process_error).toBeNull();

    const [created] = await sql<{ title: string; status: string }[]>`
      select title, status from suggestion where id = ${row.suggestion_id}
    `;
    expect(created?.title).toBe(EXTRACTION.title);
    expect(created?.status).toBe("pending");
  });

  it("retries a transient extraction failure within the attempt budget", async () => {
    extractArticleMock
      .mockRejectedValueOnce(new Error("tilapäinen häiriö"))
      .mockResolvedValue(EXTRACTION);
    const id = await insertSubmission("https://example.invalid/toipuu");

    await queueSubmissionForProcessing(id);
    await waitForStatus(id, "processed");
    expect(extractArticleMock).toHaveBeenCalledTimes(2);
  });

  it("returns an exhausted row to 'new' with the error recorded, retryable by hand", async () => {
    extractArticleMock.mockRejectedValue(new Error("AI-käsittely epäonnistui"));
    const id = await insertSubmission("https://example.invalid/kaatuu");

    await queueSubmissionForProcessing(id);
    await waitForStatus(id, "new");

    const failed = await submissionById(id);
    expect(failed.process_error).toBe("AI-käsittely epäonnistui");
    expect(failed.process_attempts).toBe(3);
    expect(failed.suggestion_id).toBeNull();

    // The Ehdotusjono view carries the failure to the admin UI.
    const listed = (await listNewSubmissions()).find((s) => s.id === id);
    expect(listed?.processing).toBe(false);
    expect(listed?.processError).toBe("AI-käsittely epäonnistui");

    // A new "Käsittele" resets the budget and the error — and can now succeed.
    extractArticleMock.mockReset();
    extractArticleMock.mockResolvedValue(EXTRACTION);
    const requeued = await queueSubmissionForProcessing(id);
    expect(requeued.processing).toBe(true);
    expect(requeued.processError).toBeNull();
    await waitForStatus(id, "processed");
    expect((await submissionById(id)).process_error).toBeNull();
  });

  it("only queues rows that are still 'new'", async () => {
    extractArticleMock.mockResolvedValue(EXTRACTION);
    const id = await insertSubmission("https://example.invalid/kerran");

    await queueSubmissionForProcessing(id);
    await expect(queueSubmissionForProcessing(id)).rejects.toThrow("Ehdotusta ei löytynyt");
  });

  it("rejecting mid-run cancels: the late extraction is discarded", async () => {
    // Block the extraction on a gate so the reject reliably lands mid-attempt.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    extractArticleMock.mockImplementation(async () => {
      await gate;
      return EXTRACTION;
    });
    const url = "https://example.invalid/peruttu";
    const id = await insertSubmission(url);
    await queueSubmissionForProcessing(id);

    // Wait until the worker has claimed the row and is inside the extraction.
    const deadline = Date.now() + 5_000;
    while (extractArticleMock.mock.calls.length === 0) {
      if (Date.now() > deadline) throw new Error("worker never claimed the row");
      await new Promise((r) => setTimeout(r, 20));
    }

    await rejectSubmission(id);
    release();
    // Let the worker run its finalize attempt against the now-rejected row.
    await new Promise((r) => setTimeout(r, 300));

    const row = await submissionById(id);
    expect(row.status).toBe("rejected");
    expect(row.suggestion_id).toBeNull();
    const created = await sql<{ id: string }[]>`select id from suggestion where url = ${url}`;
    expect(created.length).toBe(0);
  });
});
