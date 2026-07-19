import { expect, type Page } from "@playwright/test";

/** Seeded editorial account (see apps/api/src/db/seed.ts). */
export const ADMIN_EMAIL = "toimitus@rahaaon.fi";
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "rahaaon-dev";

/** Path to the saved admin session (produced by auth.setup.ts). */
export const ADMIN_STATE = "e2e/.auth/admin.json";

/** Log in through the real login form and land on the admin page. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Sähköposti").fill(ADMIN_EMAIL);
  await page.getByLabel("Salasana").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Kirjaudu", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
}
