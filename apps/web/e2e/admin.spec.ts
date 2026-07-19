import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL } from "./helpers/auth.js";

/**
 * Editorial admin smoke, using the session persisted by auth.setup.ts: the
 * admin page loads with the seeded queue, and the tabs switch.
 */

test("admin page shows the seeded suggestion queue", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
  await expect(page.getByText(`Kirjautunut: ${ADMIN_EMAIL}`)).toBeVisible();

  // Seed creates 3 queued suggestions and 8 published items.
  await expect(page.getByRole("tab", { name: "Ehdotusjono (3)" })).toBeVisible();
  await page.getByRole("tab", { name: "Julkaistut (8)" }).click();
  await expect(page.getByRole("tab", { name: "Julkaistut (8)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test.describe("logged out", () => {
  // Fresh session without the persisted admin state.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("visitor is redirected from /admin to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
  });
});
