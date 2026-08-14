import { test, expect } from "@playwright/test";
import { captureArticle } from "../src/lib/capture-bookmarklet.js";

/**
 * The capture tool end to end: the bookmarklet reads an article out of a page
 * the editor is logged in to, and the admin turns that into the row's archive
 * text. Both halves run in a real browser because that is the only place the
 * bookmarklet's constraints exist — DOM extraction, the clipboard, and the
 * `javascript:` source having to stand on its own with no bundler around it.
 *
 * Saving the pasted text is deliberately not asserted here: the archive write
 * needs S3, which the E2E stack doesn't require. That path is covered by the
 * API's archive integration suite.
 */

/** The seeded submission this capture attaches to (see the API's db/seed.ts). */
const SEEDED_ARTICLE_URL = "https://www.hs.fi/kaupunki/valoinstallaatio-sammutettu";

const BODY_TEXT =
  "Kaupunki maksoi valoinstallaatiosta 480 000 euroa, mutta teos on ollut pimeänä maaliskuusta asti.";
const QUOTE_TEXT =
  "Hankinta tehtiin suorahankintana, koska kilpailutus olisi vienyt liikaa aikaa, kertoo kaupungin edustaja.";

/**
 * A news page shaped like the ones this exists for: the story wrapped in
 * <article> among teaser furniture that wears the same tags, a nav and an
 * aside inside the story element, and the lead paragraph repeated in a hidden
 * mobile copy.
 */
const ARTICLE_PAGE = `<!doctype html>
<html lang="fi">
  <head>
    <title>Valoinstallaatio sammutettu — HS</title>
    <meta property="og:title" content="Valoinstallaatio sammui, lasku jäi" />
    <link rel="canonical" href="${SEEDED_ARTICLE_URL}" />
  </head>
  <body>
    <nav><a href="https://www.hs.fi/kaupunki">Kaupunki</a><a href="https://www.hs.fi/politiikka">Politiikka</a></nav>
    <article>
      <h1>Valoinstallaatio sammui, lasku jäi</h1>
      <p class="lead">${BODY_TEXT}</p>
      <p class="lead" hidden>${BODY_TEXT}</p>
      <h2>Mitä hankinnasta tiedetään</h2>
      <p>Teos tilattiin <strong>suorahankintana</strong> ja <a href="https://www.hs.fi/asiakirja">asiakirjojen</a> mukaan summa maksettiin kokonaisuudessaan etukäteen.</p>
      <ul>
        <li>Hankintapäätös tehtiin joulukuussa.</li>
        <li>Takuu päättyi ennen sammumista.</li>
      </ul>
      <blockquote><p>${QUOTE_TEXT}</p></blockquote>
      <p>Kaupungin tilinpäätöksen mukaan installaation vuosittaiset ylläpitokulut olivat 38 000 euroa, eikä summaa ollut varattu talousarvioon lainkaan. Tarkastuslautakunta kiinnitti asiaan huomiota jo viime keväänä, mutta esitys jäi käsittelemättä.</p>
      <p>Teoksen toimittanut yritys on sittemmin asetettu konkurssiin, joten takuukorjauksia ei ole enää kenenkään vastuulla. Kaupunki selvittää nyt, kannattaako installaatio korjata vai purkaa kokonaan.</p>
      <aside><h3>Lue myös</h3><p>Kaupunki osti droneja 200 000 eurolla.</p></aside>
      <footer><p>Kommentit ovat käytössä vain tilaajille.</p></footer>
    </article>
    <article class="teaser"><h2>Muualla verkossa</h2><p>Mainos: tilaa lehti nyt puoleen hintaan ja lue kaikki jutut.</p></article>
    <script>window.__state = { paywall: true };</script>
  </body>
</html>`;

test("the extractor keeps the story and drops the furniture around it", async ({ page }) => {
  await page.setContent(ARTICLE_PAGE);

  // The extractor's own source, evaluated in the page — the same shape the
  // bookmarklet ships it in.
  const article = await page.evaluate<{ title: string; markdown: string }>(
    `(${String(captureArticle)})(document)`,
  );

  expect(article.title).toBe("Valoinstallaatio sammui, lasku jäi");
  const lines = article.markdown.split("\n\n");
  expect(lines).toContain("# Valoinstallaatio sammui, lasku jäi");
  expect(lines).toContain(BODY_TEXT);
  expect(lines).toContain("## Mitä hankinnasta tiedetään");
  expect(lines).toContain("- Hankintapäätös tehtiin joulukuussa.");
  expect(lines).toContain(`> ${QUOTE_TEXT}`);
  // Emphasis and links survive as Markdown.
  expect(article.markdown).toContain("**suorahankintana**");
  expect(article.markdown).toContain("[asiakirjojen](https://www.hs.fi/asiakirja)");

  // The hidden duplicate of the lead is in the markup, not in the capture.
  expect(article.markdown.split(BODY_TEXT).length - 1).toBe(1);
  // Nav, aside teaser, footer note and the neighbouring teaser article are furniture.
  expect(article.markdown).not.toContain("Lue myös");
  expect(article.markdown).not.toContain("droneja");
  expect(article.markdown).not.toContain("vain tilaajille");
  expect(article.markdown).not.toContain("Mainos");
});

test("a captured article lands in the matching submission's archive editor", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // Install the bookmarklet the way the editor does: from the admin's own
  // capture tool, so the source under test is the one the UI hands out.
  await page.goto("/admin");
  await page.getByText("Maksumuurin takaa: kaappaustyökalu").click();
  const bookmarklet = await page
    .getByRole("link", { name: "Kaappaa artikkeli" })
    .getAttribute("href");
  expect(bookmarklet).toMatch(/^javascript:/);
  const source = decodeURIComponent(bookmarklet!.slice("javascript:".length));

  // The publisher's page, served without leaving the machine.
  await page.route(SEEDED_ARTICLE_URL, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: ARTICLE_PAGE }),
  );
  await page.goto(SEEDED_ARTICLE_URL);
  await page.evaluate(source);

  const panel = page.locator("#rahaaon-capture-panel");
  await expect(panel).toContainText("Artikkeli kopioitu leikepöydälle");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(BODY_TEXT);

  // "Avaa Rahaa on" carries the article's canonical address to the admin.
  const [admin] = await Promise.all([
    context.waitForEvent("page"),
    panel.getByRole("link", { name: "Avaa Rahaa on" }).click(),
  ]);
  await admin.bringToFront();
  await expect(admin).toHaveURL(`/admin?kaappaus=${encodeURIComponent(SEEDED_ARTICLE_URL)}`);
  await expect(admin.getByText("Ehdotus löytyi:")).toBeVisible();

  await admin.getByRole("button", { name: "Liitä teksti" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog.getByRole("textbox")).toHaveValue(new RegExp(BODY_TEXT));
});
