import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-fetch.js";

/**
 * A 401 from any data query/mutation means the session expired mid-use. Drop to
 * the login screen (unless already there) rather than letting each screen render
 * its own error. /api/me answers anonymous as 200-with-null, so it never trips
 * this — only genuinely authenticated calls do.
 */
function handleAuthError(error: unknown): void {
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    !window.location.pathname.startsWith("/login")
  ) {
    window.location.assign("/login");
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
