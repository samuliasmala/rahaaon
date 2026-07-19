import { describe, expect, it } from "vitest";

/**
 * Unit tests for the hand-rolled HTML→Markdown pass. The converter exists
 * because a library converter measured multi-second synchronous stalls on
 * adversarial input — so besides correctness, this suite pins the linear-time
 * guarantee with a generous wall-clock bound.
 */

// env.ts (imported transitively) demands DATABASE_URL at module load; give a
// throwaway value so the pure functions can be tested without a database.
process.env.DATABASE_URL ??= "postgres://unit:unit@localhost:5432/unit";
const { htmlToMarkdown } = await import("./page-preview.js");

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs and emphasis", () => {
    const md = htmlToMarkdown(
      "<h1>Otsikko</h1><p>Ensimmäinen <strong>tärkeä</strong> kappale.</p><p>Toinen <em>kappale</em>.</p>",
    );
    expect(md).toBe("# Otsikko\n\nEnsimmäinen **tärkeä** kappale.\n\nToinen *kappale*.");
  });

  it("keeps absolute links and drops relative ones to plain text", () => {
    const md = htmlToMarkdown(
      '<p>Katso <a href="https://example.com/juttu?a=1&amp;b=2">koko juttu</a> tai <a href="/etusivu">etusivu</a>.</p>',
    );
    expect(md).toBe("Katso [koko juttu](https://example.com/juttu?a=1&b=2) tai etusivu.");
  });

  it("renders unordered and ordered lists", () => {
    const md = htmlToMarkdown("<ul><li>eka</li><li>toka</li></ul><ol><li>yksi</li></ol>");
    expect(md).toBe("- eka\n\n- toka\n\n1. yksi");
  });

  it("marks blockquotes", () => {
    expect(htmlToMarkdown("<blockquote><p>Sitaatti.</p></blockquote>")).toBe("> Sitaatti.");
  });

  it("strips scripts, styles and comments entirely", () => {
    const md = htmlToMarkdown(
      "<script>var secret = 1;</script><style>.a{}</style><!-- piilossa --><p>Näkyvä.</p>",
    );
    expect(md).toBe("Näkyvä.");
  });

  it("drops empty links and links that wrap block elements, keeping the text", () => {
    const md = htmlToMarkdown(
      '<a href="https://example.com"></a><a href="https://example.com/kortti"><h3>Kortti</h3><p>kuvaus</p></a>',
    );
    expect(md).toBe("### Kortti\n\nkuvaus");
  });

  it("does not glue words together across block tags", () => {
    expect(htmlToMarkdown("<div>eka</div><div>toka</div>")).toBe("eka\n\ntoka");
    expect(htmlToMarkdown("bo<b>ld</b>")).toBe("bo**ld**");
  });

  it("decodes entities", () => {
    expect(htmlToMarkdown("<p>A &amp; B &lt;C&gt; &#8211; ok</p>")).toBe("A & B <C> – ok");
  });

  it("stays fast on adversarial input (linear-time guarantee)", () => {
    const unclosedScripts = "<script".repeat(65_536); // 512 KB of openers
    const linkStorm = '<a href="https://e.com/x">l</a>'.repeat(16_384); // ~512 KB, sequential
    // Nested never-closed links with text: every link stays on the openLinks
    // stack until the final flush — the case where a tail-materializing
    // closeLink went quadratic (measured 22 s before the O(1) content index).
    const nestedLinks = '<a href="https://e.com/x">z'.repeat(19_418); // ~512 KB
    // Same, but with no text at all: every link unwinds via the truncation path.
    const nestedEmptyLinks = '<a href="https://e.com/x">'.repeat(20_164); // ~512 KB
    const start = performance.now();
    htmlToMarkdown(unclosedScripts);
    htmlToMarkdown(linkStorm);
    htmlToMarkdown(nestedLinks);
    htmlToMarkdown(nestedEmptyLinks);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
