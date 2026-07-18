import { randomUUID } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { env } from "../config/env.js";
import type { AppEnv } from "../lib/context.js";

const VISITOR_COOKIE = "rahaaon_visitor";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Accept only ids we could have issued; a tampered cookie gets replaced. */
const VISITOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads the anonymous visitor id used to key votes, without setting a cookie —
 * pure readers (the feed) shouldn't hand a cookie to every visitor.
 */
export const readVisitor = createMiddleware<AppEnv>(async (c, next) => {
  const id = getCookie(c, VISITOR_COOKIE);
  if (id && VISITOR_ID_RE.test(id)) c.set("visitorId", id);
  await next();
});

/**
 * Ensures the request has a visitor id, minting the cookie on first use (i.e.
 * the first vote). HttpOnly: the id is not identity, just a stable random key,
 * and script access would only help spoofing.
 */
export const ensureVisitor = createMiddleware<AppEnv>(async (c, next) => {
  const existing = getCookie(c, VISITOR_COOKIE);
  if (existing && VISITOR_ID_RE.test(existing)) {
    c.set("visitorId", existing);
  } else {
    const id = randomUUID();
    setCookie(c, VISITOR_COOKIE, id, {
      httpOnly: true,
      sameSite: "Lax",
      secure: env.isProd,
      path: "/",
      maxAge: ONE_YEAR_S,
    });
    c.set("visitorId", id);
  }
  await next();
});
