import { test, expect } from "@playwright/test";

/**
 * Public feed smoke: the seeded demo content renders, pagination reveals the
 * tail of the list, and the detail dialog opens/closes. Read-only — no votes
 * or suggestions, so it can't disturb the serially-run admin specs.
 */

const SEEDED_TITLE = "IT-järjestelmä myöhässä neljä vuotta — hinta ehti kolminkertaistua";

/** Feed page size (apps/web/src/routes/index.tsx); "Näytä lisää" adds one more. */
const PAGE_SIZE = 6;

test("feed shows the seeded items and running total", async ({ page, request }) => {
  // The admin specs run before this one (filename order) and leave the items
  // they published behind, so the feed is the seed plus whatever they added.
  // Take the count from the API rather than hard-coding the seed's 8.
  const total = ((await (await request.get("/api/items")).json()) as unknown[]).length;
  expect(total).toBeGreaterThan(PAGE_SIZE);

  await page.goto("/");

  // Hero: the running total of recorded waste, in euros.
  await expect(
    page.getByText("Turhaa julkista rahankäyttöä kirjattu tähän mennessä"),
  ).toBeVisible();

  // A known seeded story is on the first page.
  await expect(page.getByRole("button", { name: SEEDED_TITLE })).toBeVisible();

  // Pagination: more items than fit on a page → "Näytä lisää" reveals the next.
  const articles = page.locator("article");
  await expect(articles).toHaveCount(PAGE_SIZE);
  await page.getByRole("button", { name: "Näytä lisää" }).click();
  await expect(articles).toHaveCount(Math.min(total, 2 * PAGE_SIZE));
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
