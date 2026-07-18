import type { Logger } from "pino";

/** Authenticated request principal (an editorial user). Set by the auth middleware. */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
}

/** Hono context variables available on `c.var` / `c.get(...)`. */
export interface AppVariables {
  requestId: string;
  logger: Logger;
  user?: RequestUser;
  /** Anonymous visitor id from the vote cookie (set lazily on first vote). */
  visitorId?: string;
}

/** Hono environment binding for the whole app. */
export interface AppEnv {
  Variables: AppVariables;
}
