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

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16-chars-long";
  process.env.NODE_ENV = "test";

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
    const list = (await listRes.json()) as { id: string; url: string }[];
    expect(list.map((sub) => sub.id)).toContain(submissionId);
  });

  it("processes a submission into the AI queue and drops it from the Ehdotusjono", async () => {
    const res = await app.request(`/api/admin/submissions/${submissionId}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(res.status).toBe(200);
    suggestionId = ((await res.json()) as { suggestionId: string }).suggestionId;

    const queueRes = await app.request("/api/admin/suggestions", {
      headers: { cookie: editorCookie },
    });
    const queue = (await queueRes.json()) as { id: string; sourceName: string; url: string }[];
    expect(queue.map((q) => q.id)).toContain(suggestionId);
    expect(queue.find((q) => q.id === suggestionId)?.sourceName).toBe("Yle");
    expect(queue.find((q) => q.id === suggestionId)?.url).toBe(
      "https://yle.fi.invalid/a/testijuttu",
    );

    const listRes = await app.request("/api/admin/submissions", {
      headers: { cookie: editorCookie },
    });
    const list = (await listRes.json()) as { id: string }[];
    expect(list.map((sub) => sub.id)).not.toContain(submissionId);

    // Processing is one-shot: a second attempt finds nothing in 'new' state.
    const again = await app.request(`/api/admin/submissions/${submissionId}/process`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(again.status).toBe(404);
  });

  it("applies editorial edits", async () => {
    const res = await app.request(`/api/admin/suggestions/${suggestionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({ title: "Muokattu otsikko", amountEur: 123_000 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; amountEur: number };
    expect(body.title).toBe("Muokattu otsikko");
    expect(body.amountEur).toBe(123_000);
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
      votes: number;
    }[];
    const published = feed.find((i) => i.id === itemId);
    expect(published?.title).toBe("Muokattu otsikko");
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
    const { suggestionId: id } = (await processed.json()) as { suggestionId: string };

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
