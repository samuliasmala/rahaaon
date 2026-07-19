import { test as setup } from "@playwright/test";
import { loginAsAdmin, ADMIN_STATE } from "./helpers/auth.js";

/**
 * Log in once and persist the session. Every admin spec reuses this state, so
 * the suite makes a single sign-in call — avoiding better-auth's per-account
 * rate limit that a login-per-test trips.
 */
setup("authenticate as admin", async ({ page }) => {
  await loginAsAdmin(page);
  await page.context().storageState({ path: ADMIN_STATE });
});
