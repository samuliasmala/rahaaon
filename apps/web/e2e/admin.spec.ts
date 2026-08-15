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

  // Seed: 2 url submissions, 3 queued suggestions, 1+1 rejected, 8 published items.
  await expect(page.getByRole("tab", { name: "Ehdotusjono (2)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Julkaisujono (3)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Hylätyt (2)" })).toBeVisible();
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

  // A page the API server can always fetch: the E2E web server itself.
  await dialog.getByRole("textbox").fill("http://127.0.0.1:5274/");
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

test("resubmitting the same link is caught at the preview step", async ({ page }) => {
  await page.goto("/admin");
  const before = await tabCount(page, "Ehdotusjono");

  // The link the previous test submitted, in the shape a share sheet produces:
  // a trailing campaign parameter over the same page.
  await page.getByRole("button", { name: "Ehdota kohde" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("http://127.0.0.1:5274/?utm_source=whatsapp");
  await dialog.getByRole("button", { name: "Lähetä tekoälyn luettavaksi" }).click();

  await expect(dialog.getByText("Tämä linkki odottaa jo toimituksen käsittelyä.")).toBeVisible();

  // Sending it anyway is harmless: absorbed into the existing entry, so the
  // reader gets the usual thank-you and the queue count does not move.
  await dialog.getByRole("button", { name: "Vahvista ja lähetä jonoon" }).click();
  await expect(dialog.getByText("Kiitos! Ehdotus on jonossa.")).toBeVisible();
  await dialog.getByRole("button", { name: "Selvä" }).click();

  await expect(page.getByRole("tab", { name: `Ehdotusjono (${before})` })).toBeVisible();
});

test("processing a submission moves it to the Julkaisujono", async ({ page }) => {
  await page.goto("/admin");
  const submissionsBefore = await tabCount(page, "Ehdotusjono");
  const queueBefore = await tabCount(page, "Julkaisujono");

  // Process the newest submission, whichever it is. The name filter keeps
  // the locator on the source URL — cards with archived text also carry a
  // "Lataa" download link. Exact match: the card also has the split button's
  // "Käsittele ohjeiden kanssa" chevron.
  const firstCard = page.locator("section").first();
  const url = await firstCard.getByRole("link", { name: /^http/ }).innerText();
  await firstCard.getByRole("button", { name: "Käsittele", exact: true }).click();

  // The extraction runs in the background: the card locks into "Käsitellään…"
  // and the view polls until the entry moves on. The E2E API runs without an
  // OPENAI_API_KEY (playwright.config.ts blanks it), so this is always the
  // offline mock — the generous timeouts just cover slow CI.
  await expect(firstCard.getByRole("button", { name: "Käsitellään…" })).toBeVisible();

  await expect(
    page.getByRole("tab", { name: `Ehdotusjono (${submissionsBefore - 1})` }),
  ).toBeVisible({ timeout: 60_000 });
  const queueTabName = `Julkaisujono (${queueBefore + 1})`;
  await expect(page.getByRole("tab", { name: queueTabName })).toBeVisible({ timeout: 10_000 });

  // The processed entry now sits in the Julkaisujono with its source link intact.
  await page.getByRole("tab", { name: queueTabName }).click();
  await expect(page.getByRole("link", { name: url }).first()).toBeVisible();
});

test("processing with editor instructions via the split button", async ({ page }) => {
  await page.goto("/admin");
  const submissionsBefore = await tabCount(page, "Ehdotusjono");
  const queueBefore = await tabCount(page, "Julkaisujono");

  // The chevron half of the split button opens the instructions dialog.
  const firstCard = page.locator("section").first();
  await firstCard.getByRole("button", { name: "Käsittele ohjeiden kanssa" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill("Poimi hankkeen kokonaiskustannus.");
  await dialog.getByRole("button", { name: "Käsittele", exact: true }).click();
  await expect(dialog).toBeHidden();

  // From here the flow matches a plain "Käsittele": the card locks and the
  // entry moves on to the Julkaisujono when the background extraction finishes.
  await expect(firstCard.getByRole("button", { name: "Käsitellään…" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: `Ehdotusjono (${submissionsBefore - 1})` }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("tab", { name: `Julkaisujono (${queueBefore + 1})` })).toBeVisible({
    timeout: 10_000,
  });
});

test("reprocessing a queue entry runs through the instructions dialog", async ({ page }) => {
  await page.goto("/admin");
  const queueCount = await tabCount(page, "Julkaisujono");
  await page.getByRole("tab", { name: `Julkaisujono (${queueCount})` }).click();

  // Newest first: the entry the previous test processed from a reader link —
  // it has a source submission, so the reprocess action is available.
  const card = page.locator("section").first();
  await card.getByRole("button", { name: "Käsittele uudelleen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill("Käytä artikkelin ylärajaa.");
  await dialog.getByRole("button", { name: "Käsittele uudelleen" }).click();
  await expect(dialog).toBeHidden();

  // The success toast proves the run was accepted (a 409/500 would toast the
  // failure instead) — the run itself happens in the background.
  await expect(page.getByText("Tekoälykäsittely aloitettu")).toBeVisible();

  // Without asserting the transient "Tekoäly käsittelee…" state (an offline
  // mock finishes near-instantly), wait for the card to settle back to an
  // actionable reprocess button with no failure note.
  await expect(card.getByRole("button", { name: "Käsittele uudelleen" })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(card.getByText("Tekoälykäsittely epäonnistui", { exact: false })).toBeHidden();
});

test("rejecting and restoring a suggestion round-trips through Hylätyt", async ({ page }) => {
  await page.goto("/admin");
  const queueBefore = await tabCount(page, "Julkaisujono");
  const rejectedBefore = await tabCount(page, "Hylätyt");

  // Reject the newest queue entry.
  await page.getByRole("tab", { name: `Julkaisujono (${queueBefore})` }).click();
  const queueCard = page.locator("section").first();
  const url = await queueCard.getByRole("link", { name: /^http/ }).innerText();
  await queueCard.getByRole("button", { name: "Hylkää" }).click();

  const rejectedTabName = `Hylätyt (${rejectedBefore + 1})`;
  await expect(page.getByRole("tab", { name: rejectedTabName })).toBeVisible();
  await expect(page.getByRole("tab", { name: `Julkaisujono (${queueBefore - 1})` })).toBeVisible();

  // Restore it from the archive (newest rejection first) …
  await page.getByRole("tab", { name: rejectedTabName }).click();
  const rejectedCard = page.locator("section").first();
  await expect(rejectedCard.getByRole("link", { name: url })).toBeVisible();
  await rejectedCard.getByRole("button", { name: "Palauta jonoon" }).click();

  // … and both queues are back where they started.
  await expect(page.getByRole("tab", { name: `Hylätyt (${rejectedBefore})` })).toBeVisible();
  await expect(page.getByRole("tab", { name: `Julkaisujono (${queueBefore})` })).toBeVisible();
});

test("rejecting and restoring a link round-trips through Hylätyt", async ({ page }) => {
  await page.goto("/admin");
  const submissionsBefore = await tabCount(page, "Ehdotusjono");
  const rejectedBefore = await tabCount(page, "Hylätyt");

  // Reject the newest link in the Ehdotusjono.
  const submissionCard = page.locator("section").first();
  const url = await submissionCard.getByRole("link", { name: /^http/ }).innerText();
  await submissionCard.getByRole("button", { name: "Hylkää" }).click();

  const rejectedTabName = `Hylätyt (${rejectedBefore + 1})`;
  await expect(page.getByRole("tab", { name: rejectedTabName })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: `Ehdotusjono (${submissionsBefore - 1})` }),
  ).toBeVisible();

  // Restore it from the merged archive (newest rejection first) …
  await page.getByRole("tab", { name: rejectedTabName }).click();
  const rejectedCard = page.locator("section").first();
  await expect(rejectedCard.getByText("Hylätty linkki")).toBeVisible();
  await expect(rejectedCard.getByRole("link", { name: url })).toBeVisible();
  await rejectedCard.getByRole("button", { name: "Palauta jonoon" }).click();

  // … and both queues are back where they started.
  await expect(page.getByRole("tab", { name: `Hylätyt (${rejectedBefore})` })).toBeVisible();
  await expect(page.getByRole("tab", { name: `Ehdotusjono (${submissionsBefore})` })).toBeVisible();
});

test("skipping the Julkaisujonos a blank card the editor fills in by hand", async ({ page }) => {
  await page.goto("/admin");
  const submissionsBefore = await tabCount(page, "Ehdotusjono");
  const queueBefore = await tabCount(page, "Julkaisujono");
  const publishedBefore = await tabCount(page, "Julkaistut");

  const submissionCard = page.locator("section").first();
  const url = await submissionCard.getByRole("link", { name: /^http/ }).innerText();
  await submissionCard.getByRole("button", { name: "Ohita tekoäly" }).click();

  // Nothing runs in the background: the entry is in the Julkaisujono at once.
  await expect(page.getByText("Siirretty julkaisujonoon ilman tekoälyä")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: `Ehdotusjono (${submissionsBefore - 1})` }),
  ).toBeVisible();
  const queueTabName = `Julkaisujono (${queueBefore + 1})`;
  await page.getByRole("tab", { name: queueTabName }).click();

  // Newest first: the entry just skipped. No AI readouts, and blank fields.
  const queueCard = page.locator("section").first();
  await expect(queueCard.getByRole("link", { name: url })).toBeVisible();
  await expect(queueCard.getByText("Ehdotus ilman tekoälykäsittelyä")).toBeVisible();
  await expect(queueCard.getByText(/AI-varmuus/)).toBeHidden();
  await expect(queueCard.getByText("Tekoälyn huomiot")).toBeHidden();
  await expect(queueCard.getByLabel("Otsikko", { exact: true })).toHaveValue("");

  // Publishing as is names the fields that are missing …
  await queueCard.getByRole("button", { name: "Hyväksy ja julkaise" }).click();
  await expect(queueCard.getByText("Otsikko puuttuu")).toBeVisible();
  await expect(queueCard.getByText("Tiivistelmä puuttuu")).toBeVisible();
  await expect(queueCard.getByText("Taho puuttuu")).toBeVisible();
  await expect(page.getByRole("tab", { name: queueTabName })).toBeVisible();

  // … and once they are filled in by hand, the card publishes like any other.
  const title = `Käsin kirjoitettu tapaus ${Date.now()}`;
  await queueCard.getByLabel("Otsikko", { exact: true }).fill(title);
  await queueCard.getByLabel("Tiivistelmä", { exact: true }).fill("Toimituksen oma tiivistelmä.");
  await queueCard.getByLabel("Taho").fill("Testikunta");
  await queueCard.getByRole("button", { name: "Hyväksy ja julkaise" }).click();

  await expect(page.getByText("Julkaistu etusivulle")).toBeVisible();
  await expect(page.getByRole("tab", { name: `Julkaisujono (${queueBefore})` })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: `Julkaistut (${publishedBefore + 1})` }),
  ).toBeVisible();
});

test("editing a published item from the inline editor updates the row", async ({ page }) => {
  await page.goto("/admin");
  const count = await tabCount(page, "Julkaistut");
  await page.getByRole("tab", { name: `Julkaistut (${count})` }).click();

  // Open the inline editor on the newest row. Exact match — rows with an
  // archive also have a "Näytä / muokkaa" button, which substring-matches.
  await page.getByRole("button", { name: "Muokkaa", exact: true }).first().click();
  const entityInput = page.getByLabel("Taho");
  await expect(entityInput).toBeVisible();

  // Unique per attempt — a CI retry doesn't reseed, so a fixed value could
  // pass on leftovers from the failed attempt without the save working.
  const entity = `Testivirasto ${Date.now()}`;
  await entityInput.fill(entity);
  await page.getByRole("button", { name: "Tallenna" }).click();

  // Saving closes the editor and the row shows the new value.
  await expect(entityInput).toBeHidden();
  await expect(page.getByText(entity)).toBeVisible();

  // Peruuta discards edits after confirming: the row keeps the saved value.
  await page.getByRole("button", { name: "Muokkaa", exact: true }).first().click();
  await entityInput.fill("Hylättävä muutos");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Peruuta" }).click();
  await expect(entityInput).toBeHidden();
  await expect(page.getByText(entity)).toBeVisible();
  await expect(page.getByText("Hylättävä muutos")).toBeHidden();
});

test("previewing a published item opens the reader's own detail dialog", async ({ page }) => {
  await page.goto("/admin");
  const count = await tabCount(page, "Julkaistut");
  await page.getByRole("tab", { name: `Julkaistut (${count})` }).click();

  // Read the row's title first, so the assertions below prove the modal shows
  // *this* item — whichever row happens to be newest at this point.
  const preview = page.getByRole("button", { name: "Näytä juttu etusivun näkymässä" }).first();
  const row = preview.locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
  const title = (await row.locator("span").first().innerText()).trim();

  await preview.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The feed's view, not an admin variant: headline, AI-summary card, vote button.
  await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
  await expect(dialog.getByText("Tekoälyn tiivistelmä · toimituksen tarkistama")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Tämä on turhaa/ })).toBeVisible();

  await dialog.getByRole("button", { name: "Sulje" }).click();
  await expect(dialog).toBeHidden();
});

test.describe("logged out", () => {
  // Fresh session without the persisted admin state.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("visitor is redirected from /admin to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
  });
});
