import { createAuthClient } from "better-auth/react";

/**
 * better-auth browser client. Same-origin (the Vite proxy / edge forwards
 * `/api/*` to the API), so the session cookie is shared automatically.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export const { signIn, signOut } = authClient;
