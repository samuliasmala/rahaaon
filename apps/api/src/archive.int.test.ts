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

let dbContainer: StartedPostgreSqlContainer;
let minio: StartedTestContainer;
let articleServer: Server;
let articleBase: string;
let app: Hono;
let closeDb: () => Promise<void>;
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

  await new S3Client({
    endpoint: s3Endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
  }).send(new CreateBucketCommand({ Bucket: "archive-test" }));

  articleServer = createServer((req, res) => {
    if (req.url?.startsWith("/article")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(ARTICLE_HTML);
    } else if (req.url?.startsWith("/thin")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(THIN_HTML);
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
    const processed = await app.request(`/api/admin/submissions/${id}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(processed.status).toBe(200);

    // The download still works for processed rows.
    const after = await app.request(`/api/admin/submissions/${id}/archive/text`, {
      headers: { cookie: editorCookie },
    });
    expect(after.status).toBe(200);
  });

  it("flags a thin page as paywalled but keeps what it got", async () => {
    const id = await submit("/thin");
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

  it("requires auth for the archive download", async () => {
    const res = await app.request(
      "/api/admin/submissions/00000000-0000-0000-0000-000000000000/archive/text",
    );
    expect(res.status).toBe(401);
  });
});
