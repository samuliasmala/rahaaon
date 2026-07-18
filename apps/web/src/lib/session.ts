import { getApiMe } from "../api/auth/auth.js";
import { type Me } from "../api/model/index.js";
import type { QueryClient } from "@tanstack/react-query";

export type CurrentUser = Me;

/** Shared cache key/fn for the current principal. */
export const meQueryOptions = {
  queryKey: ["me"] as const,
  queryFn: fetchMe,
  // Long enough that hopping between routes doesn't refetch on every navigation
  // (beforeLoad + hover-preload would otherwise hit /api/me constantly).
  staleTime: 60_000,
};

/**
 * Resolve the current principal for route guards. Uses fetchQuery, not
 * ensureQueryData: within staleTime a cached answer is reused, but an
 * invalidated or stale entry is fetched again. ensureQueryData would return the
 * login page's cached anonymous `null` forever — it only fetches when the cache
 * is empty — bouncing the post-login redirect back to /login.
 */
export function ensureMe(qc: QueryClient): Promise<Me | null> {
  return qc.fetchQuery(meQueryOptions);
}

/** Invalidate the cached principal after login / logout. */
export function invalidateMe(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: ["me"] });
}

/**
 * Fetch the current principal, or null if the session can't be confirmed (used
 * by route guards). Anonymous is a normal 200-with-null answer from /api/me
 * (not a 401), so public pages probe the session without console noise. Any
 * failure — a 5xx or the API being unreachable — is still treated as "not
 * signed in": a guard can't trust a session it can't verify, so it safely
 * degrades to the login screen.
 */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await getApiMe();
  } catch {
    return null;
  }
}
