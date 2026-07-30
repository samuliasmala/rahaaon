import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";

/**
 * End-to-end API integration test against a real Postgres 17. The app's DB
 * singleton is bound to the ephemeral container by setting DATABASE_URL before
 * dynamically importing the app (which transitively loads db/client + env).
 * Exercises the full editorial loop: anonymous url submission → Ehdotusjono →
 * process into the AI queue → edit → approve → public feed → votes → hide.
 *
 * Submitted URLs use an unresolvable host (.invalid) so the page-preview fetch
 * fails fast and deterministically — the flow must work regardless.
 */

const EDITOR_EMAIL = "editor@rahaaon.fi";
const EDITOR_PASSWORD = "password123";

let container: StartedPostgreSqlContainer;
let app: Hono;
let closeDb: () => Promise<void>;
let editorCookie: string;

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Poll the Ehdotusjono until the background processor finishes the entry and
 * drops it from the list (or time out). Queuing kicks the worker, so no poll
 * loop is needed — the mock extraction resolves on the first attempt.
 */
async function waitUntilProcessed(submissionId: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.request("/api/admin/submissions", {
      headers: { cookie: editorCookie },
    });
    const list = (await res.json()) as { id: string }[];
    if (!list.some((sub) => sub.id === submissionId)) return;
    if (Date.now() > deadline) throw new Error("processing did not finish in time");
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16-chars-long";
  process.env.NODE_ENV = "test";
  // A developer's .env may carry a real key; the suite must stay on the
  // deterministic mock extraction (no live LLM calls, no cost). Same for the
  // S3 archive — this suite covers the archiving-disabled path (see
  // archive.int.test.ts for the S3-enabled one). Set to "" rather than delete:
  // env.ts treats empty as unset, while loadEnvFile would refill a DELETED var
  // from the repo .env (it only skips vars that are present).
  process.env.OPENAI_API_KEY = "";
  process.env.S3_ENDPOINT = "";
  process.env.S3_BUCKET = "";
  process.env.S3_ACCESS_KEY_ID = "";
  process.env.S3_SECRET_ACCESS_KEY = "";

  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
  await migrationClient.end();

  const appMod = await import("./app.js");
  app = appMod.createApp() as unknown as Hono;
  const clientMod = await import("./db/client.js");
  closeDb = clientMod.closeDb;

  // Sign-up is disabled, so create the editorial user the way the seed does:
  // through better-auth's internal adapter (hashes the password consistently).
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
}, 180_000);

afterAll(async () => {
  await closeDb?.();
  await container?.stop();
});

describe("system + auth", () => {
  it("answers the health probe", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers /api/me with null (200) without a session", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("rejects public sign-up", async () => {
    const res = await app.request(
      "/api/auth/sign-up/email",
      json({ email: "reader@example.fi", password: "password123", name: "Reader" }),
    );
    expect(res.ok).toBe(false);
  });

  it("returns the signed-in editor from /api/me", async () => {
    const res = await app.request("/api/me", { headers: { cookie: editorCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe(EDITOR_EMAIL);
  });

  it("guards admin endpoints with 401", async () => {
    for (const path of ["/api/admin/suggestions", "/api/admin/submissions"]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("unauthorized");
    }
  });
});

describe("security hardening", () => {
  it("rejects non-http(s) URL schemes on submit and preview", async () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
    ]) {
      for (const path of ["/api/submissions", "/api/submissions/preview"]) {
        const res = await app.request(path, json({ url }));
        expect(res.status, `${path} ${url}`).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe("validation_error");
      }
    }
  });

  it("sets baseline security response headers", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("relaxes the CSP only for the Swagger UI page", async () => {
    const res = await app.request("/api/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});

describe("editorial loop", () => {
  let submissionId: string;
  let suggestionId: string;
  let itemId: string;
  let rejectedSuggestionId: string;

  it("answers the page preview with a fallback for an unreachable link", async () => {
    const res = await app.request(
      "/api/submissions/preview",
      json({ url: "https://yle.fi.invalid/a/testijuttu" }),
    );
    expect(res.status).toBe(200);
    const preview = (await res.json()) as { siteName: string; fetched: boolean };
    expect(preview.fetched).toBe(false);
    expect(preview.siteName).toBe("yle.fi.invalid");
  });

  it("accepts an anonymous url submission into the Ehdotusjono", async () => {
    const res = await app.request(
      "/api/submissions",
      json({ url: "https://yle.fi.invalid/a/testijuttu" }),
    );
    expect(res.status).toBe(201);
    submissionId = ((await res.json()) as { id: string }).id;

    const listRes = await app.request("/api/admin/submissions", {
      headers: { cookie: editorCookie },
    });
    const list = (await listRes.json()) as { id: string; url: string; archiveStatus: string }[];
    const entry = list.find((sub) => sub.id === submissionId);
    expect(entry).toBeDefined();
    // No S3 in this suite: the row reports archiving as unavailable…
    expect(entry!.archiveStatus).toBe("disabled");

    // …and a re-archive attempt is refused outright.
    const retry = await app.request(`/api/admin/submissions/${submissionId}/archive/retry`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(retry.status).toBe(503);
  });

  it("queues a submission and the background worker moves it to the AI queue", async () => {
    const res = await app.request(`/api/admin/submissions/${submissionId}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(res.status).toBe(202);
    const queued = (await res.json()) as { id: string; processing: boolean };
    expect(queued.id).toBe(submissionId);
    expect(queued.processing).toBe(true);

    // The extraction runs in the background (the mock, instantly here); the
    // entry stays listed as processing until the worker finalizes it, then
    // leaves the Ehdotusjono.
    await waitUntilProcessed(submissionId);

    const queueRes = await app.request("/api/admin/suggestions", {
      headers: { cookie: editorCookie },
    });
    const queue = (await queueRes.json()) as {
      id: string;
      sourceName: string;
      articlePublishedAt: string | null;
      quote: string;
      keywords: string[];
      url: string;
      archive: unknown;
    }[];
    const entry = queue.find((q) => q.url === "https://yle.fi.invalid/a/testijuttu");
    expect(entry).toBeDefined();
    suggestionId = entry!.id;
    // Archiving is disabled in this suite (no S3), so the archive ref must be
    // an explicit null — not absent, which the client types don't allow.
    expect(entry!.archive).toBeNull();
    expect(entry!.sourceName).toBe("Yle");
    // The mock extraction's fixed article date (real runs: AI-extracted, null when unknown).
    expect(entry!.articlePublishedAt).toBe("2025-11-04");
    // The AI-extracted article quote lands on the suggestion.
    expect(entry!.quote).toContain("Viherseinä");
    // As do the AI-extracted search keywords.
    expect(entry!.keywords).toEqual(["viherseinä", "muovikasvit", "vuokrasopimus"]);

    // Processing is one-shot: a second attempt finds nothing in 'new' state.
    const again = await app.request(`/api/admin/submissions/${submissionId}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(again.status).toBe(404);
  });

  it("normalises a partial patch that breaks the amount invariant", async () => {
    // Only the type flips to 'unknown' — the old figure must not survive to
    // keep counting in the feed total.
    const res = await app.request(`/api/admin/suggestions/${suggestionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({ amountType: "unknown" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { amountEur: number; amountType: string };
    expect(body.amountEur).toBe(0);
    expect(body.amountType).toBe("unknown");
  });

  it("applies editorial edits", async () => {
    const res = await app.request(`/api/admin/suggestions/${suggestionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({
        title: "Muokattu otsikko",
        amountEur: 123_000,
        amountType: "approx",
        amountMaxEur: 180_000,
        articlePublishedAt: "2026-01-15",
        quote: "Muokattu sitaatti, toteaa toimittaja.",
        keywords: ["muokattu avainsana", "toinen"],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      amountEur: number;
      amountType: string;
      amountMaxEur: number | null;
      articlePublishedAt: string | null;
      quote: string;
      keywords: string[];
    };
    expect(body.title).toBe("Muokattu otsikko");
    expect(body.amountEur).toBe(123_000);
    expect(body.amountType).toBe("approx");
    expect(body.amountMaxEur).toBe(180_000);
    expect(body.articlePublishedAt).toBe("2026-01-15");
    expect(body.quote).toBe("Muokattu sitaatti, toteaa toimittaja.");
    expect(body.keywords).toEqual(["muokattu avainsana", "toinen"]);
  });

  it("publishes on approve and the item appears in the public feed", async () => {
    const res = await app.request(`/api/admin/suggestions/${suggestionId}/approve`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(res.status).toBe(200);
    itemId = ((await res.json()) as { itemId: string }).itemId;

    const feed = (await (await app.request("/api/items")).json()) as {
      id: string;
      title: string;
      amountType: string;
      amountMaxEur: number | null;
      articlePublishedAt: string | null;
      quote: string;
      keywords: string[];
      votes: number;
    }[];
    const published = feed.find((i) => i.id === itemId);
    expect(published?.title).toBe("Muokattu otsikko");
    // The amount qualifier travels from the edited suggestion onto the feed item.
    expect(published?.amountType).toBe("approx");
    expect(published?.amountMaxEur).toBe(180_000);
    expect(published?.articlePublishedAt).toBe("2026-01-15");
    // As does the (edited) article quote.
    expect(published?.quote).toBe("Muokattu sitaatti, toteaa toimittaja.");
    // And the (edited) search keywords.
    expect(published?.keywords).toEqual(["muokattu avainsana", "toinen"]);
    expect(published?.votes).toBe(0);

    // Approved entries leave the queue.
    const queueRes = await app.request("/api/admin/suggestions", {
      headers: { cookie: editorCookie },
    });
    const queue = (await queueRes.json()) as { id: string }[];
    expect(queue.map((q) => q.id)).not.toContain(suggestionId);
  });

  it("toggles a visitor vote via the visitor cookie", async () => {
    const first = await app.request(`/api/items/${itemId}/vote`, { method: "POST" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ votes: 1, voted: true });
    const visitorCookie = first.headers.getSetCookie().join("; ");
    expect(visitorCookie).toContain("rahaaon_visitor=");

    const second = await app.request(`/api/items/${itemId}/vote`, {
      method: "POST",
      headers: { cookie: visitorCookie },
    });
    expect(await second.json()).toEqual({ votes: 0, voted: false });
  });

  it("applies editorial edits to a published item", async () => {
    const res = await app.request(`/api/admin/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({
        title: "Julkaistu ja muokattu",
        amountEur: 200_000,
        amountType: "min",
        // Below the new figure — the amount invariant must drop the range.
        amountMaxEur: 150_000,
        entity: "Espoo",
        // "" removes the quote from the feed item.
        quote: "",
        keywords: ["julkaistun avainsana"],
      }),
    });
    expect(res.status).toBe(200);

    const feed = (await (await app.request("/api/items")).json()) as {
      id: string;
      title: string;
      amountEur: number;
      amountType: string;
      amountMaxEur: number | null;
      entity: string;
      quote: string;
      keywords: string[];
    }[];
    const edited = feed.find((i) => i.id === itemId);
    expect(edited?.title).toBe("Julkaistu ja muokattu");
    expect(edited?.amountEur).toBe(200_000);
    expect(edited?.amountType).toBe("min");
    expect(edited?.amountMaxEur).toBeNull();
    expect(edited?.entity).toBe("Espoo");
    expect(edited?.quote).toBe("");
    expect(edited?.keywords).toEqual(["julkaistun avainsana"]);

    // The editor-side keyword cap is enforced, not silently truncated.
    const overCap = await app.request(`/api/admin/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({
        keywords: Array.from({ length: 11 }, (_, i) => `avainsana-${i}`),
      }),
    });
    expect(overCap.status).toBe(422);
  });

  it("drafts keywords with AI from the posted case content", async () => {
    const res = await app.request("/api/admin/keywords/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({
        title: "Testiotsikko kalliista hankkeesta",
        summary: "Hanke maksoi paljon eikä valmistunut.",
        entity: "Espoo",
        category: "Muu",
      }),
    });
    expect(res.status).toBe(200);
    // No API key in this suite: the mock generator drafts from the title.
    expect(await res.json()).toEqual({
      keywords: ["testiotsikko", "kalliista", "hankkeesta"],
    });

    // Drafting is an editorial tool — no anonymous generation.
    const unauth = await app.request("/api/admin/keywords/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Testiotsikko",
        summary: "Tiivistelmä",
        entity: "Espoo",
        category: "Muu",
      }),
    });
    expect(unauth.status).toBe(401);
  });

  it("hides an item from the public feed but keeps it in the admin list", async () => {
    const res = await app.request(`/api/admin/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({ hidden: true }),
    });
    expect(res.status).toBe(200);

    const feed = (await (await app.request("/api/items")).json()) as { id: string }[];
    expect(feed.map((i) => i.id)).not.toContain(itemId);

    const adminRes = await app.request("/api/admin/items", { headers: { cookie: editorCookie } });
    const adminItems = (await adminRes.json()) as { id: string; hidden: boolean }[];
    expect(adminItems.find((i) => i.id === itemId)?.hidden).toBe(true);
  });

  it("a field-only patch leaves the hidden flag alone", async () => {
    // The item is hidden at this point; editing fields must not resurface it.
    const res = await app.request(`/api/admin/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({ summary: "Päivitetty tiivistelmä", articlePublishedAt: null }),
    });
    expect(res.status).toBe(200);

    const adminRes = await app.request("/api/admin/items", { headers: { cookie: editorCookie } });
    const adminItems = (await adminRes.json()) as {
      id: string;
      hidden: boolean;
      summary: string;
      articlePublishedAt: string | null;
    }[];
    const edited = adminItems.find((i) => i.id === itemId);
    expect(edited?.hidden).toBe(true);
    expect(edited?.summary).toBe("Päivitetty tiivistelmä");
    // An explicit null clears the article date rather than being ignored.
    expect(edited?.articlePublishedAt).toBeNull();
  });

  it("rejects a suggestion into the rejected archive", async () => {
    const created = await app.request(
      "/api/submissions",
      json({ url: "https://www.hs.fi.invalid/huono-juttu" }),
    );
    const { id: newSubmissionId } = (await created.json()) as { id: string };
    const processed = await app.request(`/api/admin/submissions/${newSubmissionId}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(processed.status).toBe(202);

    // Wait for the background worker to finish, then pick the suggestion it created.
    await waitUntilProcessed(newSubmissionId);
    const createdQueue = (await (
      await app.request("/api/admin/suggestions", { headers: { cookie: editorCookie } })
    ).json()) as { id: string; url: string }[];
    const id = createdQueue.find((q) => q.url === "https://www.hs.fi.invalid/huono-juttu")!.id;

    const res = await app.request(`/api/admin/suggestions/${id}/reject`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(res.status).toBe(200);

    const queueRes = await app.request("/api/admin/suggestions", {
      headers: { cookie: editorCookie },
    });
    const queue = (await queueRes.json()) as { id: string }[];
    expect(queue.map((q) => q.id)).not.toContain(id);

    const rejectedRes = await app.request("/api/admin/suggestions/rejected", {
      headers: { cookie: editorCookie },
    });
    const rejected = (await rejectedRes.json()) as { id: string; rejectedAt: string }[];
    expect(rejected.map((r) => r.id)).toContain(id);
    expect(rejected.find((r) => r.id === id)?.rejectedAt).toBeTruthy();

    rejectedSuggestionId = id;
  });

  it("rejects and restores a url submission through the archive", async () => {
    const created = await app.request(
      "/api/submissions",
      json({ url: "https://blogi.invalid/mutu-juttu" }),
    );
    const { id } = (await created.json()) as { id: string };

    const rejectRes = await app.request(`/api/admin/submissions/${id}/reject`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(rejectRes.status).toBe(200);

    // Out of the queue, into the archive; a rejected link can't be processed.
    const listAfterReject = (await (
      await app.request("/api/admin/submissions", { headers: { cookie: editorCookie } })
    ).json()) as { id: string }[];
    expect(listAfterReject.map((sub) => sub.id)).not.toContain(id);

    const rejected = (await (
      await app.request("/api/admin/submissions/rejected", { headers: { cookie: editorCookie } })
    ).json()) as { id: string; rejectedAt: string }[];
    expect(rejected.map((r) => r.id)).toContain(id);
    expect(rejected.find((r) => r.id === id)?.rejectedAt).toBeTruthy();

    const processAttempt = await app.request(`/api/admin/submissions/${id}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(processAttempt.status).toBe(404);

    // Restore puts it back into the Ehdotusjono; restore is one-shot.
    const restoreRes = await app.request(`/api/admin/submissions/${id}/restore`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(restoreRes.status).toBe(200);

    const listAfterRestore = (await (
      await app.request("/api/admin/submissions", { headers: { cookie: editorCookie } })
    ).json()) as { id: string }[];
    expect(listAfterRestore.map((sub) => sub.id)).toContain(id);

    const again = await app.request(`/api/admin/submissions/${id}/restore`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(again.status).toBe(404);
  });

  it("restores a rejected suggestion back to the pending queue", async () => {
    const res = await app.request(`/api/admin/suggestions/${rejectedSuggestionId}/restore`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(res.status).toBe(200);

    const queueRes = await app.request("/api/admin/suggestions", {
      headers: { cookie: editorCookie },
    });
    const queue = (await queueRes.json()) as { id: string }[];
    expect(queue.map((q) => q.id)).toContain(rejectedSuggestionId);

    const rejectedRes = await app.request("/api/admin/suggestions/rejected", {
      headers: { cookie: editorCookie },
    });
    const rejected = (await rejectedRes.json()) as { id: string }[];
    expect(rejected.map((r) => r.id)).not.toContain(rejectedSuggestionId);

    // Restore is one-shot: the suggestion is pending again, not rejected.
    const again = await app.request(`/api/admin/suggestions/${rejectedSuggestionId}/restore`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(again.status).toBe(404);
  });
});
