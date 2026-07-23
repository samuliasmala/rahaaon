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
const { extractArticleMarkdown, htmlToMarkdown, isAccessibleForFree, isPrivateAddress } =
  await import("./page-preview.js");

describe("isPrivateAddress (SSRF guard classification)", () => {
  // map→toEqual (rather than expect-with-message) so a failure names the IP in
  // the diff while satisfying the vitest/valid-expect lint rule.
  const flags = (ips: string[]) => ips.map((ip) => ({ ip, private: isPrivateAddress(ip) }));
  const allPrivate = (ips: string[], isPrivate: boolean) =>
    ips.map((ip) => ({ ip, private: isPrivate }));

  it("flags private, loopback, link-local and reserved IPv4", () => {
    const ips = [
      "0.0.0.0",
      "10.0.0.5",
      "127.0.0.1",
      "100.64.0.1", // CGNAT
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "198.18.0.1", // benchmarking
      "224.0.0.1", // multicast
      "255.255.255.255", // broadcast
    ];
    expect(flags(ips)).toEqual(allPrivate(ips, true));
  });

  it("allows public IPv4", () => {
    const ips = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1"];
    expect(flags(ips)).toEqual(allPrivate(ips, false));
  });

  it("flags non-global-unicast IPv6, including v4-mapped loopback in every form", () => {
    const ips = [
      "::1", // loopback
      "::", // unspecified
      "fd00::1", // ULA
      "fe80::1", // link-local
      "ff02::1", // multicast
      "::ffff:127.0.0.1", // v4-mapped loopback, dotted
      "::ffff:7f00:1", // v4-mapped loopback, hex (what URL normalises brackets to)
      "::ffff:10.0.0.1", // v4-mapped private
      "::ffff:a9fe:a9fe", // v4-mapped 169.254.169.254, hex
      "2002:a9fe:a9fe::", // 6to4 tunnelling 169.254.169.254
      "2002:7f00:1::", // 6to4 tunnelling 127.0.0.1
      "2001:0:1::1", // Teredo
      "2001::5", // Teredo, compressed second hextet
    ];
    expect(flags(ips)).toEqual(allPrivate(ips, true));
  });

  it("allows global-unicast IPv6 (2000::/3)", () => {
    // 2001:4860:… (Google DNS) is NOT Teredo — its second hextet is non-zero.
    const ips = ["2606:2800:220:1:248:1893:25c8:1946", "2001:4860:4860::8888"];
    expect(flags(ips)).toEqual(allPrivate(ips, false));
  });
});

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

describe("extractArticleMarkdown", () => {
  const NAV = '<nav><ul><li><a href="https://e.fi/a">Etusivu</a></li><li>Uutiset</li></ul></nav>';
  const STORY = "<article><h1>Otsikko</h1><p>Leipäteksti kertoo asian.</p></article>";

  it("keeps the story <article> and drops surrounding nav/footer", () => {
    const md = extractArticleMarkdown(`<body>${NAV}${STORY}<footer>Käyttöehdot</footer></body>`);
    expect(md).toBe("# Otsikko\n\nLeipäteksti kertoo asian.");
  });

  it("prefers the h1-bearing <article> over a larger teaser-list <article>", () => {
    // News pages carry sibling <article> teaser lists that can out-measure a
    // short story; the headline h1 marks the story element.
    const teasers = `<article><h2>Luetuimmat</h2><p>${"Nosto toisesta jutusta. ".repeat(20)}</p></article>`;
    const md = extractArticleMarkdown(`${teasers}${STORY}${teasers}`);
    expect(md).toBe("# Otsikko\n\nLeipäteksti kertoo asian.");
  });

  it("takes the most content when no candidate has an h1", () => {
    const md = extractArticleMarkdown(
      "<article><p>lyhyt</p></article><article><p>selvästi pidempi kappale tässä</p></article>",
    );
    expect(md).toBe("selvästi pidempi kappale tässä");
  });

  it("falls back to <main>, then to the whole page", () => {
    expect(extractArticleMarkdown(`${NAV}<main><p>Sisältö.</p></main>`)).toBe("Sisältö.");
    expect(extractArticleMarkdown(`${NAV}<p>Sisältö.</p>`)).toContain("Etusivu");
  });

  it("captures a nested <article> once, inside its outermost element", () => {
    const md = extractArticleMarkdown(
      "<article><h1>Ulompi</h1><article><p>sisempi</p></article></article><p>ohi</p>",
    );
    expect(md).toBe("# Ulompi\n\nsisempi");
  });

  it("ignores an unclosed <article> and tag-name lookalikes", () => {
    // Unclosed story element: no candidate — degrade to the whole page.
    expect(extractArticleMarkdown(`${NAV}<article><p>katkennut`)).toContain("Etusivu");
    // "mainonta" in prose and longer tag names must not register as <main>.
    const md = extractArticleMarkdown("<p>mainonta</p><maintag>ei</maintag><main>kyllä</main>");
    expect(md).toBe("kyllä");
  });

  it("is not fooled by markup inside scripts or comments", () => {
    const md = extractArticleMarkdown(
      `<script>var s = "<article><h1>Feikki</h1>";</script><!-- <article>myös feikki</article> -->${STORY}`,
    );
    expect(md).toBe("# Otsikko\n\nLeipäteksti kertoo asian.");
  });

  it("handles uppercase tags and attributes on the element", () => {
    const md = extractArticleMarkdown(
      '<ARTICLE data-testid="news-template" class="a"><h1>Iso</h1><p>teksti</p></ARTICLE>',
    );
    expect(md).toBe("# Iso\n\nteksti");
  });

  it("stays fast on adversarial input (linear-time guarantee)", () => {
    const openerStorm = "<article ".repeat(58_254); // ~512 KB of unclosed openers
    const nearMisses = "<articleish></articleish>".repeat(20_480); // boundary-check rejects
    const deepNest = "<article>".repeat(29_127) + "</article>".repeat(29_127); // ~512 KB
    const start = performance.now();
    extractArticleMarkdown(openerStorm);
    extractArticleMarkdown(nearMisses);
    extractArticleMarkdown(deepNest);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("isAccessibleForFree (schema.org paywall marking)", () => {
  const ldJson = (json: string) => `<script type="application/ld+json">${json}</script>`;
  // The shape Sanoma pages carry: the article-level flag, plus Google's
  // paywall-section markup — a nested WebPageElement whose flag is false
  // even on free articles.
  const sanomaLike = (free: boolean) =>
    ldJson(
      JSON.stringify([
        {
          "@type": "NewsArticle",
          isAccessibleForFree: free,
          hasPart: { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: ".w" },
        },
      ]),
    );

  it("reads the article node's flag, not the WebPageElement paywall-part decoy", () => {
    expect(isAccessibleForFree(`<html><head>${sanomaLike(true)}</head>x</html>`)).toBe(true);
    expect(isAccessibleForFree(`<html><head>${sanomaLike(false)}</head>x</html>`)).toBe(false);
  });

  it("returns null when no article node states the flag", () => {
    expect(isAccessibleForFree("<p>ei metadataa</p>")).toBeNull();
    expect(isAccessibleForFree(ldJson('{"@type":"NewsArticle","headline":"x"}'))).toBeNull();
    // The paywalled-section part alone says nothing about the article itself.
    expect(
      isAccessibleForFree(ldJson('{"@type":"WebPageElement","isAccessibleForFree":false}')),
    ).toBeNull();
    expect(isAccessibleForFree(ldJson("{broken json"))).toBeNull();
  });

  it("finds the article under @graph and accepts array types and string flags", () => {
    const html = ldJson(
      '{"@graph":[{"@type":"WebSite"},{"@type":["ReportageNewsArticle"],"isAccessibleForFree":"False"}]}',
    );
    expect(isAccessibleForFree(html)).toBe(false);
  });

  it("ignores lookalike data outside application/ld+json scripts", () => {
    expect(
      isAccessibleForFree(
        '<script>var s = {"@type":"NewsArticle","isAccessibleForFree":false};</script>',
      ),
    ).toBeNull();
  });
});
