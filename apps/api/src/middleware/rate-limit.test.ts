import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onError } from "./error.js";
import { rateLimit, resolveClientIp } from "./rate-limit.js";
import type { AppEnv } from "../lib/context.js";

describe("resolveClientIp", () => {
  it("uses the peer address when the peer is not a trusted proxy", () => {
    expect(resolveClientIp("85.76.1.2", "9.9.9.9")).toBe("85.76.1.2");
  });

  it("normalizes v4-mapped IPv6 peers", () => {
    expect(resolveClientIp("::ffff:85.76.1.2", undefined)).toBe("85.76.1.2");
  });

  it("resolves the client through a trusted proxy chain", () => {
    // Caddy behind docker: XFF is "client, <docker hop>".
    expect(resolveClientIp("172.18.0.5", "85.76.1.2, 172.18.0.2")).toBe("85.76.1.2");
  });

  it("ignores client-spoofed XFF entries left of the real IP", () => {
    expect(resolveClientIp("10.0.0.1", "1.1.1.1, 8.8.8.8")).toBe("8.8.8.8");
  });

  it("falls back to the leftmost hop when the whole chain is trusted", () => {
    expect(resolveClientIp("127.0.0.1", "192.168.1.7, 172.18.0.2")).toBe("192.168.1.7");
  });

  it("uses the trusted peer itself when there is no XFF", () => {
    expect(resolveClientIp("127.0.0.1", undefined)).toBe("127.0.0.1");
  });

  it("returns null when the peer is unknown", () => {
    expect(resolveClientIp(undefined, "85.76.1.2")).toBeNull();
  });
});

describe("rateLimit middleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.onError(onError);
    app.use(
      "/limited",
      rateLimit({
        name: "test",
        windowMs: 60_000,
        max: 2,
        enabled: true,
        keyFn: (c) => c.req.header("x-test-ip") ?? null,
      }),
    );
    app.get("/limited", (c) => c.json({ ok: true }));
    return app;
  }

  const asIp = (ip: string) => ({ headers: { "x-test-ip": ip } });

  it("allows up to max requests, then returns the 429 envelope with Retry-After", async () => {
    const app = buildApp();
    expect((await app.request("/limited", asIp("a"))).status).toBe(200);
    expect((await app.request("/limited", asIp("a"))).status).toBe(200);

    const limited = await app.request("/limited", asIp("a"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await limited.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  it("keeps separate buckets per key", async () => {
    const app = buildApp();
    await app.request("/limited", asIp("a"));
    await app.request("/limited", asIp("a"));
    expect((await app.request("/limited", asIp("a"))).status).toBe(429);
    expect((await app.request("/limited", asIp("b"))).status).toBe(200);
  });

  it("resets the bucket after the window passes", async () => {
    const app = buildApp();
    await app.request("/limited", asIp("a"));
    await app.request("/limited", asIp("a"));
    expect((await app.request("/limited", asIp("a"))).status).toBe(429);

    vi.advanceTimersByTime(61_000);
    expect((await app.request("/limited", asIp("a"))).status).toBe(200);
  });

  it("fails open when the key cannot be resolved", async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/limited")).status).toBe(200);
    }
  });

  it("does nothing when disabled", async () => {
    const app = new Hono<AppEnv>();
    app.onError(onError);
    app.use(
      "/limited",
      rateLimit({ name: "off", windowMs: 60_000, max: 1, enabled: false, keyFn: () => "a" }),
    );
    app.get("/limited", (c) => c.json({ ok: true }));
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/limited")).status).toBe(200);
    }
  });
});
