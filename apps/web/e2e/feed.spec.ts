import { test, expect } from "@playwright/test";

/**
 * Public feed smoke: the seeded demo content renders, pagination reveals the
 * tail of the list, and the detail dialog opens/closes. Read-only — no votes
 * or suggestions, so it can't disturb the serially-run admin specs.
 */

const SEEDED_TITLE = "IT-järjestelmä myöhässä neljä vuotta — hinta ehti kolminkertaistua";

test("feed shows the seeded items and running total", async ({ page }) => {
  await page.goto("/");

  // Hero: the running total of recorded waste, in euros.
  await expect(
    page.getByText("Turhaa julkista rahankäyttöä kirjattu tähän mennessä"),
  ).toBeVisible();

  // A known seeded story is on the first page (8 seeded, 6 shown initially).
  await expect(page.getByRole("button", { name: SEEDED_TITLE })).toBeVisible();

  // Pagination: 8 items > page size 6 → "Näytä lisää" reveals the rest.
  const articles = page.locator("article");
  await expect(articles).toHaveCount(6);
  await page.getByRole("button", { name: "Näytä lisää" }).click();
  await expect(articles).toHaveCount(8);
});

test("detail dialog opens from an item row and closes", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: SEEDED_TITLE }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(SEEDED_TITLE)).toBeVisible();

  await dialog.getByRole("button", { name: "Sulje" }).click();
  await expect(dialog).toBeHidden();
});

test("search narrows the feed and reports no matches", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Hae kuntaa tai juttua").fill("ei-varmasti-osumia-xyzzy");
  await expect(page.getByText("Ei osumia haulla", { exact: false })).toBeVisible();
});
