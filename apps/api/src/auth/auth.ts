import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";

/**
 * better-auth instance: email/password only, for the editorial team. Public
 * sign-up is disabled — accounts are created by the seed script (or manually);
 * readers never need an account. Sessions live in Postgres (the `session`
 * table) — robust for a single-server deploy, no Redis dependency.
 */
export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  baseURL: env.API_URL,
  basePath: "/api/auth",
  // The canonical app origin plus the local Vite origin, so sign-in works both
  // through the published hostname (Caddy) and on localhost.
  trustedOrigins: [...new Set([env.APP_URL, "http://localhost:5174"])],

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // The admin is invite-only: no self-service registration endpoint.
    disableSignUp: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once a day
  },

  advanced: {
    useSecureCookies: env.isProd,
    ipAddress: {
      // Behind a reverse proxy X-Forwarded-For arrives as "client, <docker hop>".
      // better-auth only trusts a multi-value chain when trusted proxy ranges are
      // given — without these it resolves no IP and rate-limits everyone from one
      // shared bucket.
      trustedProxies: ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
    },
  },

  rateLimit: {
    // On in dev/prod; off in tests so repeated sign-ins aren't throttled.
    enabled: !env.isTest,
    window: 60,
    max: 100,
    // Login is the only credential endpoint exposed; keep brute force slow.
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
});

export type Auth = typeof auth;
