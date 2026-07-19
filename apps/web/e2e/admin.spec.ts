import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL } from "./helpers/auth.js";

/**
 * Editorial admin flows, using the session persisted by auth.setup.ts. Tests
 * run serially against the per-run seed (2 submissions, 3 suggestions, 8
 * items), and the later tests build on the state the earlier ones leave.
 */

test("admin page shows the seeded queues and the tabs switch", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Ylläpito" })).toBeVisible();
  await expect(page.getByText(`Kirjautunut: ${ADMIN_EMAIL}`)).toBeVisible();

  // Seed creates 2 url submissions, 3 queued suggestions and 8 published items.
  await expect(page.getByRole("tab", { name: "Ehdotusjono (2)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tekoälyn käsittelemät (3)" })).toBeVisible();
  await page.getByRole("tab", { name: "Julkaistut (8)" }).click();
  await expect(page.getByRole("tab", { name: "Julkaistut (8)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

/**
 * Current count from a tab labelled "Name (N)". Tabs render "(0)" until their
 * query resolves, so poll past that initial state — every call site here reads
 * a queue the seed guarantees to be non-empty.
 */
async function tabCount(page: Page, name: string): Promise<number> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name} \\(\\d+\\)$`) });
  let count = 0;
  await expect
    .poll(async () => {
      count = Number(/\((\d+)\)/.exec(await tab.innerText())![1]);
      return count;
    })
    .toBeGreaterThan(0);
  return count;
}

// The two tests below mutate shared DB state, so they assert count *deltas*
// rather than absolute seed counts — a CI retry (which doesn't reseed) then
// starts from whatever the failed attempt left behind instead of cascading.

test("the suggest flow works from the admin view", async ({ page }) => {
  await page.goto("/admin");
  const before = await tabCount(page, "Ehdotusjono");

  await page.getByRole("button", { name: "Ehdota kohde" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // A page the API server can always fetch: the web app itself.
  await dialog.getByRole("textbox").fill("http://127.0.0.1:5174/");
  await dialog.getByRole("button", { name: "Lähetä tekoälyn luettavaksi" }).click();

  // The google-like preview card shows the fetched page metadata.
  await expect(dialog.getByText("Rahaa on. — turhan julkisen rahankäytön seuranta")).toBeVisible();
  await dialog.getByRole("button", { name: "Vahvista ja lähetä jonoon" }).click();
  await expect(dialog.getByText("Kiitos! Ehdotus on jonossa.")).toBeVisible();
  await dialog.getByRole("button", { name: "Selvä" }).click();
  await expect(dialog).toBeHidden();

  // The new link landed in the Ehdotusjono.
  await expect(page.getByRole("tab", { name: `Ehdotusjono (${before + 1})` })).toBeVisible();
});

test("processing a submission moves it to the AI queue", async ({ page }) => {
  await page.goto("/admin");
  const submissionsBefore = await tabCount(page, "Ehdotusjono");
  const queueBefore = await tabCount(page, "Tekoälyn käsittelemät");

  // Process the newest submission, whichever it is.
  const firstCard = page.locator("section").first();
  const url = await firstCard.getByRole("link").innerText();
  await firstCard.getByRole("button", { name: "Käsittele" }).click();

  await expect(
    page.getByRole("tab", { name: `Ehdotusjono (${submissionsBefore - 1})` }),
  ).toBeVisible();
  const queueTabName = `Tekoälyn käsittelemät (${queueBefore + 1})`;
  await expect(page.getByRole("tab", { name: queueTabName })).toBeVisible();

  // The processed entry now sits in the AI queue with its source link intact.
  await page.getByRole("tab", { name: queueTabName }).click();
  await expect(page.getByRole("link", { name: url }).first()).toBeVisible();
});

test.describe("logged out", () => {
  // Fresh session without the persisted admin state.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("visitor is redirected from /admin to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
  });
});
