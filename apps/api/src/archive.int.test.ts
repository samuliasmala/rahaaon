import { createServer, type Server } from "node:http";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";

/**
 * The article-archive flow against real Postgres + MinIO: submitting a link
 * captures the page text to S3 (fire-and-forget), the admin list reports the
 * archive status (ok / paywalled / failed), the text downloads through the
 * admin endpoint, and processing consumes the archive. Articles are served by
 * a local HTTP server (the test env skips the SSRF guard, so localhost works).
 */

const EDITOR_EMAIL = "editor@rahaaon.fi";
const EDITOR_PASSWORD = "password123";

const ARTICLE_MARKER = "Kaupunki osti kultaisen kahvinkeittimen";
const ARTICLE_HTML = `<html><head><title>Testijuttu</title>
<meta property="og:title" content="Testijuttu kahvinkeittimestä">
<meta property="og:description" content="Kuvaus."></head>
<body><script>var ignored = true;</script><h1>${ARTICLE_MARKER}</h1>
<p>${"Pitkä uutisteksti jossa riittää sisältöä arkistoitavaksi. ".repeat(30)}</p>
</body></html>`;
const THIN_HTML = `<html><head><title>Maksumuuri</title></head>
<body><p>Tilaajille.</p></body></html>`;
// A page that declares its paywall the way Sanoma sites do — schema.org
// isAccessibleForFree on the NewsArticle node plus Google's WebPageElement
// paywall-section markup — while still serving a teaser long enough to sail
// past the length threshold.
const MARKED_PAYWALLED_HTML = `<html><head><title>Merkitty maksulliseksi</title>
<script type="application/ld+json">${JSON.stringify({
  "@type": "NewsArticle",
  isAccessibleForFree: false,
  hasPart: { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: ".paywall" },
})}</script></head>
<body><article><h1>Pitkä esikatselu maksumuurin edellä</h1>
<p>${"Esikatselutekstiä joka ylittää pituusrajan reilusti. ".repeat(30)}</p></article></body></html>`;

let dbContainer: StartedPostgreSqlContainer;
let minio: StartedTestContainer;
let articleServer: Server;
let articleBase: string;
let app: Hono;
let closeDb: () => Promise<void>;
let startArchiveWorker: () => Promise<void>;
let stopArchiveWorker: () => Promise<void>;
let editorCookie: string;

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Poll the admin list until the fire-and-forget archive lands (or time out). */
async function waitForArchive(
  submissionId: string,
  timeoutMs = 15_000,
): Promise<{ archiveStatus: string | null; hasArchivedText: boolean }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.request("/api/admin/submissions", {
      headers: { cookie: editorCookie },
    });
    const list = (await res.json()) as {
      id: string;
      archiveStatus: string | null;
      hasArchivedText: boolean;
    }[];
    const entry = list.find((s) => s.id === submissionId);
    if (!entry) throw new Error(`submission ${submissionId} disappeared from the queue`);
    if (entry.archiveStatus !== "pending") return entry;
    if (Date.now() > deadline) throw new Error("archive did not finish in time");
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function submit(path: string): Promise<string> {
  const res = await app.request("/api/submissions", json({ url: `${articleBase}${path}` }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeAll(async () => {
  [dbContainer, minio] = await Promise.all([
    new PostgreSqlContainer("postgres:17").start(),
    new GenericContainer("minio/minio:latest")
      .withCommand(["server", "/data"])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
      .start(),
  ]);

  const s3Endpoint = `http://127.0.0.1:${minio.getMappedPort(9000)}`;
  process.env.DATABASE_URL = dbContainer.getConnectionUri();
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16-chars-long";
  process.env.NODE_ENV = "test";
  process.env.S3_ENDPOINT = s3Endpoint;
  process.env.S3_BUCKET = "archive-test";
  process.env.S3_ACCESS_KEY_ID = "minioadmin";
  process.env.S3_SECRET_ACCESS_KEY = "minioadmin";
  // Stay on the mock extraction. "" rather than delete — loadEnvFile refills
  // deleted vars from the repo .env but leaves present-and-empty ones alone.
  process.env.OPENAI_API_KEY = "";
  // Fast, deterministic archive retries: give up after 3 attempts, tiny backoff,
  // and poll frequently so a scheduled retry is picked up within the test budget.
  process.env.ARCHIVE_MAX_ATTEMPTS = "3";
  process.env.ARCHIVE_RETRY_BASE_MS = "20";
  process.env.ARCHIVE_POLL_INTERVAL_MS = "100";

  await new S3Client({
    endpoint: s3Endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  }).send(new CreateBucketCommand({ Bucket: "archive-test" }));

  // Fails the first two requests, then serves the article — exercises retry.
  let flakyHits = 0;
  // Fails the whole 3-attempt archive budget (row ends 'failed'), then serves
  // the article — exercises the admin's manual re-archive. 4 failing hits, not
  // 3: submitting fetches the page once for the preview before archiving runs.
  let recoveringHits = 0;
  articleServer = createServer((req, res) => {
    if (req.url?.startsWith("/recovering")) {
      recoveringHits += 1;
      if (recoveringHits <= 4) {
        res.statusCode = 503;
        res.end("temporarily unavailable");
      } else {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(ARTICLE_HTML);
      }
    } else if (req.url?.startsWith("/article")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(ARTICLE_HTML);
    } else if (req.url?.startsWith("/thin")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(THIN_HTML);
    } else if (req.url?.startsWith("/marked-paywalled")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(MARKED_PAYWALLED_HTML);
    } else if (req.url?.startsWith("/flaky")) {
      flakyHits += 1;
      if (flakyHits < 3) {
        res.statusCode = 503;
        res.end("temporarily unavailable");
      } else {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(ARTICLE_HTML);
      }
    } else if (req.url?.startsWith("/truncated-gzip")) {
      // Claims gzip, sends a partial stream, then resets the socket — the
      // decode-path hang regression. Must end as "failed", not hang forever.
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("content-encoding", "gzip");
      res.write(Buffer.from([0x1f, 0x8b, 0x08, 0x00])); // gzip magic, then die
      res.destroy();
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((r) => articleServer.listen(0, r));
  articleBase = `http://127.0.0.1:${(articleServer.address() as { port: number }).port}`;

  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
  await migrationClient.end();

  const appMod = await import("./app.js");
  app = appMod.createApp() as unknown as Hono;
  const clientMod = await import("./db/client.js");
  closeDb = clientMod.closeDb;

  // server.ts starts the worker in production; the test drives app.js directly,
  // so start it here (the poll loop is what drives retries).
  const archiveMod = await import("./lib/article-archive.js");
  startArchiveWorker = archiveMod.startArchiveWorker;
  stopArchiveWorker = archiveMod.stopArchiveWorker;
  await startArchiveWorker();

  const { auth } = await import("./auth/auth.js");
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(EDITOR_PASSWORD);
  const editor = await ctx.internalAdapter.createUser({
    name: "Editor",
    email: EDITOR_EMAIL,
    emailVerified: true,
  });
  await ctx.internalAdapter.linkAccount({
    userId: editor.id,
    providerId: "credential",
    accountId: editor.id,
    password: passwordHash,
  });

  const signIn = await app.request(
    "/api/auth/sign-in/email",
    json({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD }),
  );
  if (signIn.status !== 200) {
    throw new Error(`editor sign-in failed in setup: ${signIn.status} ${await signIn.text()}`);
  }
  editorCookie = signIn.headers.getSetCookie().join("; ");
}, 240_000);

afterAll(async () => {
  await stopArchiveWorker?.();
  await closeDb?.();
  await new Promise((r) => articleServer?.close(r));
  await Promise.all([dbContainer?.stop(), minio?.stop()]);
});

describe("article archive", () => {
  it("archives a readable page and serves the text download", async () => {
    const id = await submit("/article");

    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("ok");
    expect(entry.hasArchivedText).toBe(true);

    // Inline for the in-app viewer by default…
    const inline = await app.request(`/api/admin/submissions/${id}/archive/text`, {
      headers: { cookie: editorCookie },
    });
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-disposition")).toBeNull();
    const text = await inline.text();
    expect(text).toContain(`# ${ARTICLE_MARKER}`); // Markdown, not stripped text
    expect(text).not.toContain("ignored"); // scripts are stripped

    // …attachment with ?download=1.
    const download = await app.request(`/api/admin/submissions/${id}/archive/text?download=1`, {
      headers: { cookie: editorCookie },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(`ehdotus-${id}.md`);

    // Processing consumes the archive (and must not depend on a live page).
    // It runs in the background — wait for the entry to leave the queue.
    const processed = await app.request(`/api/admin/submissions/${id}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(processed.status).toBe(202);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const listRes = await app.request("/api/admin/submissions", {
        headers: { cookie: editorCookie },
      });
      const ids = ((await listRes.json()) as { id: string }[]).map((s) => s.id);
      if (!ids.includes(id)) break;
      if (Date.now() > deadline) throw new Error("processing did not finish in time");
      await new Promise((r) => setTimeout(r, 100));
    }

    // The download still works for processed rows.
    const after = await app.request(`/api/admin/submissions/${id}/archive/text`, {
      headers: { cookie: editorCookie },
    });
    expect(after.status).toBe(200);
  });

  it("retries a transient failure and eventually archives", async () => {
    // /flaky 503s twice, then serves the article — within the 3-attempt budget.
    const id = await submit("/flaky");
    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("ok");
    expect(entry.hasArchivedText).toBe(true);
  });

  it("marks a truncated compressed body failed instead of hanging", async () => {
    // Pre-fix this hangs the archive job forever (status stuck 'pending') and
    // waitForArchive times out; with pipeline-based decode it errors promptly.
    const id = await submit("/truncated-gzip");
    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("failed");
    expect(entry.hasArchivedText).toBe(false);
  });

  it("flags a thin page as paywalled but keeps what it got", async () => {
    const id = await submit("/thin");
    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("paywalled");
    expect(entry.hasArchivedText).toBe(true);
  });

  it("trusts the page's own paywall marking even when the teaser is long", async () => {
    const id = await submit("/marked-paywalled");
    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("paywalled");
    expect(entry.hasArchivedText).toBe(true);
  });

  it("marks an unreadable page failed, with no download", async () => {
    const id = await submit("/missing");
    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("failed");
    expect(entry.hasArchivedText).toBe(false);

    const download = await app.request(`/api/admin/submissions/${id}/archive/text`, {
      headers: { cookie: editorCookie },
    });
    expect(download.status).toBe(404);
  });

  it("accepts a manually pasted text for a failed archive", async () => {
    const id = await submit("/missing");
    await waitForArchive(id);

    const pasted = "# Käsin liitetty juttu\n\nMaksumuurin takaa kopioitu leipäteksti.";
    const save = await app.request(`/api/admin/submissions/${id}/archive/text`, {
      method: "PUT",
      headers: { cookie: editorCookie, "content-type": "application/json" },
      body: JSON.stringify({ text: pasted }),
    });
    expect(save.status).toBe(200);

    const list = await app.request("/api/admin/submissions", {
      headers: { cookie: editorCookie },
    });
    const entry = ((await list.json()) as { id: string; archiveStatus: string }[]).find(
      (s) => s.id === id,
    );
    expect(entry?.archiveStatus).toBe("ok");

    const read = await app.request(`/api/admin/submissions/${id}/archive/text`, {
      headers: { cookie: editorCookie },
    });
    expect(await read.text()).toBe(pasted);
  });

  it("re-archives a failed capture on demand", async () => {
    // /recovering eats the whole 3-attempt budget before serving the article.
    const id = await submit("/recovering");
    const failed = await waitForArchive(id);
    expect(failed.archiveStatus).toBe("failed");

    const retry = await app.request(`/api/admin/submissions/${id}/archive/retry`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(retry.status).toBe(202);
    expect(((await retry.json()) as { archiveStatus: string }).archiveStatus).toBe("pending");

    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("ok");
    expect(entry.hasArchivedText).toBe(true);
  });

  it("refuses to re-archive a row whose archive succeeded", async () => {
    const id = await submit("/article?ref=retry-conflict");
    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("ok");

    const retry = await app.request(`/api/admin/submissions/${id}/archive/retry`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(retry.status).toBe(409);
  });

  it("reports a never-archived row as missing and archives it on retry", async () => {
    const id = await submit("/article?ref=missing");
    await waitForArchive(id);

    // Rewind the row to the pre-feature shape: no stored status, no text key —
    // what a row submitted while S3 was unconfigured looks like.
    const { db } = await import("./db/client.js");
    const { urlSubmission } = await import("./db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    await db
      .update(urlSubmission)
      .set({ archiveStatus: null, archiveTextKey: null, archiveAttempts: 0 })
      .where(eq(urlSubmission.id, id));

    const listRes = await app.request("/api/admin/submissions", {
      headers: { cookie: editorCookie },
    });
    const listed = ((await listRes.json()) as { id: string; archiveStatus: string }[]).find(
      (s) => s.id === id,
    );
    expect(listed?.archiveStatus).toBe("missing");

    const retry = await app.request(`/api/admin/submissions/${id}/archive/retry`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(retry.status).toBe(202);

    const entry = await waitForArchive(id);
    expect(entry.archiveStatus).toBe("ok");
    expect(entry.hasArchivedText).toBe(true);
  });

  it("carries the archive ref through the AI queue to the published item", async () => {
    const id = await submit("/article?ref=chain");
    const archived = await waitForArchive(id);
    expect(archived.archiveStatus).toBe("ok");

    const processed = await app.request(`/api/admin/submissions/${id}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(processed.status).toBe(202);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const listRes = await app.request("/api/admin/submissions", {
        headers: { cookie: editorCookie },
      });
      const ids = ((await listRes.json()) as { id: string }[]).map((s) => s.id);
      if (!ids.includes(id)) break;
      if (Date.now() > deadline) throw new Error("processing did not finish in time");
      await new Promise((r) => setTimeout(r, 100));
    }

    // The queue entry points back at the submission's archive…
    const expectedRef = { submissionId: id, archiveStatus: "ok", hasArchivedText: true };
    const queueRes = await app.request("/api/admin/suggestions", {
      headers: { cookie: editorCookie },
    });
    const queue = (await queueRes.json()) as {
      id: string;
      url: string;
      archive: typeof expectedRef | null;
    }[];
    // Located by url, not by the ref under test — a ref pointing at the wrong
    // submission must fail as a wrong value, not as "entry not found".
    const entry = queue.find((s) => s.url === `${articleBase}/article?ref=chain`);
    expect(entry?.archive).toEqual(expectedRef);

    // …and after approval the published item carries the same ref, while the
    // public feed stays free of it (the ref names a submission id).
    const approve = await app.request(`/api/admin/suggestions/${entry!.id}/approve`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(approve.status).toBe(200);
    const { itemId } = (await approve.json()) as { itemId: string };

    const itemsRes = await app.request("/api/admin/items", {
      headers: { cookie: editorCookie },
    });
    const items = (await itemsRes.json()) as { id: string; archive: typeof expectedRef | null }[];
    expect(items.find((i) => i.id === itemId)?.archive).toEqual(expectedRef);

    const publicRes = await app.request("/api/items");
    const publicItems = (await publicRes.json()) as Record<string, unknown>[];
    const publicItem = publicItems.find((i) => i.id === itemId);
    expect(publicItem).toBeDefined();
    expect(publicItem).not.toHaveProperty("archive");
  });

  it("requires auth for the archive download", async () => {
    const res = await app.request(
      "/api/admin/submissions/00000000-0000-0000-0000-000000000000/archive/text",
    );
    expect(res.status).toBe(401);
  });
});
