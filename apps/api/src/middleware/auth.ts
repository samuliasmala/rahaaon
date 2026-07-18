import { createMiddleware } from "hono/factory";
import { auth } from "../auth/auth.js";
import { unauthorized } from "../lib/http-errors.js";
import type { AppEnv } from "../lib/context.js";

async function resolveSession(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}

/**
 * Authenticates the request from the better-auth session cookie and sets `user`.
 * 401 if there is no valid session. Any signed-in user is editorial staff —
 * accounts only exist for the team (sign-up is disabled).
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await resolveSession(c.req.raw.headers);
  if (!user) throw unauthorized();
  c.set("user", user);
  await next();
});

/**
 * Like {@link requireAuth} but tolerates anonymous requests: sets `user` when a
 * valid session exists and otherwise leaves it unset, so the handler can answer
 * differently for signed-out visitors instead of failing with 401 (used by /me,
 * which the frontend probes on public pages).
 */
export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await resolveSession(c.req.raw.headers);
  if (user) c.set("user", user);
  await next();
});
