import { getConnInfo } from "@hono/node-server/conninfo";
import { createMiddleware } from "hono/factory";
import { env } from "../config/env.js";
import { tooManyRequests } from "../lib/http-errors.js";
import type { AppEnv } from "../lib/context.js";
import type { Context } from "hono";

/**
 * Per-IP fixed-window rate limiting for the anonymous public endpoints. The
 * deploy is a single server (sessions in Postgres, no Redis), so in-memory
 * buckets are sufficient — restarts reset the counters, which is fine for
 * abuse damping. better-auth handles /api/auth/* with its own limiter; this
 * covers everything else.
 */

/**
 * Ranges the reverse-proxy chain lives in — must match better-auth's
 * `trustedProxies` (auth/auth.ts) so both limiters resolve the same client IP.
 */
const TRUSTED_PROXY_CIDRS = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    n = (n << 8) | value;
  }
  return n >>> 0;
}

const TRUSTED_PROXY_MASKS = TRUSTED_PROXY_CIDRS.map((cidr) => {
  const [base = "", bits = "0"] = cidr.split("/");
  return { base: ipv4ToInt(base)!, mask: (~0 << (32 - Number(bits))) >>> 0 };
});

/** Node reports IPv4 peers as v4-mapped IPv6 (`::ffff:1.2.3.4`); unify them. */
function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

function isTrustedProxy(ip: string): boolean {
  if (ip === "::1") return true;
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  // `>>> 0` because `&` yields a signed 32-bit value while `base` is unsigned.
  return TRUSTED_PROXY_MASKS.some(({ base, mask }) => (n & mask) >>> 0 === base);
}

/**
 * Resolves the real client IP from the peer address and `X-Forwarded-For`.
 * XFF is only consulted when the peer itself is a trusted proxy, and hops are
 * walked right to left past trusted ranges: proxies append the genuine socket
 * address, so any client-spoofed entries sit left of the real IP and never win.
 * Exported for tests.
 */
export function resolveClientIp(
  peer: string | undefined,
  forwardedFor: string | undefined,
): string | null {
  const peerIp = normalizeIp(peer);
  if (!peerIp) return null;
  if (!isTrustedProxy(peerIp)) return peerIp;

  const hops = (forwardedFor ?? "")
    .split(",")
    .map((hop) => normalizeIp(hop.trim()))
    .filter((hop): hop is string => !!hop);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i];
    if (hop && !isTrustedProxy(hop)) return hop;
  }
  // The whole chain is inside the trusted network (LAN dev, health checks):
  // the leftmost entry is the original client.
  return hops[0] ?? peerIp;
}

function clientIpKey(c: Context<AppEnv>): string | null {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    // No socket behind the request (e.g. app.request() in tests).
    peer = undefined;
  }
  return resolveClientIp(peer, c.req.header("x-forwarded-for"));
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Hard cap on tracked IPs per limiter. At the cap, expired buckets are swept
 * first and then the oldest live ones are dropped — under a flood that only
 * resets counters for the flooding IPs, which merely lets a few extra requests
 * through; memory stays bounded either way.
 */
const MAX_BUCKETS = 10_000;

function evictIfFull(buckets: Map<string, Bucket>, now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export interface RateLimitOptions {
  /** Limiter name for log lines, e.g. "submit". */
  name: string;
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
  /** On in dev/prod; off in tests (mirrors the better-auth limiter). */
  enabled?: boolean;
  /** Bucket key resolver; injectable for tests. `null` skips limiting. */
  keyFn?: (c: Context<AppEnv>) => string | null;
}

/**
 * Creates a per-IP rate-limiting middleware with its own bucket store. When
 * the client IP cannot be resolved the request is let through (fail open): a
 * misconfigured proxy chain must degrade to "no limiting", not 429 the whole
 * site from one shared bucket.
 */
export function rateLimit(options: RateLimitOptions) {
  const { name, windowMs, max } = options;
  const enabled = options.enabled ?? !env.isTest;
  const keyFn = options.keyFn ?? clientIpKey;
  const buckets = new Map<string, Bucket>();

  return createMiddleware<AppEnv>(async (c, next) => {
    if (!enabled) return next();

    const key = keyFn(c);
    if (key === null) {
      c.get("logger")?.warn({ limiter: name }, "rate limiter could not resolve client ip");
      return next();
    }

    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      evictIfFull(buckets, now);
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    if (bucket.count > max) {
      c.get("logger")?.warn({ limiter: name, key }, "rate limit exceeded");
      c.header("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      throw tooManyRequests();
    }

    await next();
  });
}
