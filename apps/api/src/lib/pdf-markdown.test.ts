import { describe, expect, it } from "vitest";
import { buildPdf, type FixtureLine } from "./pdf-fixture.js";

/**
 * Unit tests for the PDF→Markdown pass. A PDF states no structure, so every
 * block boundary here is inferred from geometry (see lib/pdf-markdown.ts) —
 * these fixtures set the geometry that the real documents produce: wrapped
 * lines reaching the same right margin, a paragraph's last line falling short
 * of it, headings in a font of their own, running heads in the margin band.
 */

// env.ts (imported transitively) demands DATABASE_URL at module load; give a
// throwaway value so the pure functions can be tested without a database.
process.env.DATABASE_URL ??= "postgres://unit:unit@localhost:5432/unit";
const { pdfToMarkdown } = await import("./pdf-markdown.js");

/** Body lines of one wrapped paragraph: equal length, so equal right edge. */
const WRAP_A = "Kaupunki maksoi konsulttiyhtiolle 250 000 euron palkkion selvityksesta, joka";
const WRAP_B = "kertoi mita kaupungin oma virkakunta oli jo aiemmin todennut raportissaan.";
/** Clearly short of the margin — a paragraph's closing line. */
const TAIL = "Rahat jaivat kayttamatta.";

/** Single-spaced body lines: 11pt text on ~13.4pt leading. */
const wrapped = (texts: string[], top: number, extra: Partial<FixtureLine> = {}): FixtureLine[] =>
  texts.map((text, i) => ({ text, y: top - i * 13.4, ...extra }));

const markdownOf = async (pages: FixtureLine[][], meta?: Parameters<typeof buildPdf>[1]) =>
  (await pdfToMarkdown(buildPdf(pages, meta))).markdown;

describe("pdfToMarkdown block structure", () => {
  it("joins a wrapped paragraph into one block and starts a new one after it", async () => {
    const md = await markdownOf([
      [
        ...wrapped([WRAP_A, WRAP_B, TAIL], 600),
        // 27pt below the closing line: paragraph spacing, not line spacing.
        ...wrapped([WRAP_A, TAIL], 533),
      ],
    ]);
    expect(md).toBe(`${WRAP_A} ${WRAP_B} ${TAIL}\n\n${WRAP_A} ${TAIL}`);
  });

  it("splits paragraphs that extra leading separates even at full width", async () => {
    const md = await markdownOf([[...wrapped([WRAP_A], 600), ...wrapped([WRAP_B], 570)]]);
    expect(md).toBe(`${WRAP_A}\n\n${WRAP_B}`);
  });

  it("marks a larger line as the title and a bold body-size line as a heading", async () => {
    const md = await markdownOf([
      [
        { text: "Tarkastuslautakunnan arvio", y: 640, size: 18, font: "bold" },
        { text: "1. Havainnot", y: 600, font: "bold" },
        ...wrapped([WRAP_A, TAIL], 570),
      ],
    ]);
    expect(md).toBe(`# Tarkastuslautakunnan arvio\n\n## 1. Havainnot\n\n${WRAP_A} ${TAIL}`);
  });

  it("promotes the first heading to the title level when nothing is larger", async () => {
    // Public-sector PDFs set the document title in the same bold body size as
    // their section heads; the archive still deserves one top-level title.
    const md = await markdownOf([
      [
        { text: "Yritystukineuvottelukunnan lausunto", y: 640, font: "bold" },
        { text: "1. Havainnot", y: 600, font: "bold" },
        ...wrapped([WRAP_A, TAIL], 570),
      ],
    ]);
    expect(md.split("\n\n").slice(0, 2)).toEqual([
      "# Yritystukineuvottelukunnan lausunto",
      "## 1. Havainnot",
    ]);
  });

  it("keeps a wholly bold paragraph as prose instead of a stack of headings", async () => {
    // The verdict at the end of a lausunto is typically set in bold; per-line
    // heading detection shredded it, which also hid it from the prose measure.
    const md = await markdownOf([[...wrapped([WRAP_A, WRAP_B, TAIL], 600, { font: "bold" })]]);
    expect(md).toBe(`${WRAP_A} ${WRAP_B} ${TAIL}`);
  });

  it("rewrites bullet glyphs as Markdown list items", async () => {
    const md = await markdownOf([
      [
        { text: " Ensimmainen kohta", y: 600 },
        { text: " Toinen kohta", y: 580 },
      ],
    ]);
    expect(md).toBe("- Ensimmainen kohta\n\n- Toinen kohta");
  });

  it("keeps a footnote marker inside the sentence it follows", async () => {
    // A raised, smaller run must not break the line — and so the paragraph — in
    // three around every footnote reference.
    const md = await markdownOf([
      [
        { text: WRAP_A, y: 600 },
        { text: "1", y: 604, size: 7, x: 400 },
        { text: TAIL, y: 586.6 },
      ],
    ]);
    expect(md).toBe(`${WRAP_A}1 ${TAIL}`);
  });
});

describe("pdfToMarkdown running heads and feet", () => {
  const header = (text: string): FixtureLine => ({ text, y: 800, x: 480, size: 10 });

  it("drops a repeating header and a letterless page number", async () => {
    const md = await markdownOf([
      [
        header("LAUSUNTO 12.2.2026"),
        { text: "1/3", y: 40, x: 300, size: 10 },
        ...wrapped([WRAP_A, TAIL], 600),
      ],
      [
        header("LAUSUNTO 12.2.2026"),
        { text: "2/3", y: 40, x: 300, size: 10 },
        ...wrapped([WRAP_B, TAIL], 600),
      ],
      [
        header("LAUSUNTO 12.2.2026"),
        { text: "3/3", y: 40, x: 300, size: 10 },
        ...wrapped([WRAP_A, TAIL], 600),
      ],
    ]);
    expect(md).not.toContain("LAUSUNTO");
    expect(md).not.toContain("/3");
    expect(md).toContain(WRAP_A);
  });

  it("keeps a numbers-only line in the body, where it is a table row", async () => {
    // In this app the numbers are the story — the letterless rule stays in the
    // margin bands.
    const md = await markdownOf([
      [...wrapped([WRAP_A, TAIL], 600), { text: "35 000 000", y: 500 }],
      [...wrapped([WRAP_B, TAIL], 600), { text: "43 000 000", y: 500 }],
    ]);
    expect(md).toContain("35 000 000");
    expect(md).toContain("43 000 000");
  });

  it("keeps a one-page document's header, having nothing to compare it against", async () => {
    const md = await markdownOf([[header("Kaupunginhallitus"), ...wrapped([WRAP_A, TAIL], 600)]]);
    expect(md).toContain("Kaupunginhallitus");
  });
});

describe("pdfToMarkdown hyphenation", () => {
  const join = async (first: string, second: string) => {
    const md = await markdownOf([
      [
        { text: first, y: 600 },
        { text: second, y: 586.6 },
      ],
    ]);
    return md;
  };

  it("rejoins a word justification split across lines", async () => {
    expect(await join("Selvitys kertoo kaupungin eko-", "logisesta verkostosta.")).toBe(
      "Selvitys kertoo kaupungin ekologisesta verkostosta.",
    );
  });

  it("keeps the hyphen when a conjunction follows the elided compound", async () => {
    expect(await join("Rahat menivat liikunta-", "ja kulttuuritiloihin.")).toBe(
      "Rahat menivat liikunta- ja kulttuuritiloihin.",
    );
  });

  it("keeps the hyphen where Finnish spelling needs it, between twin vowels", async () => {
    expect(await join("Hanke alkoi korona-", "aikana keväällä.")).toBe(
      "Hanke alkoi korona-aikana keväällä.",
    );
  });

  it("keeps the hyphen before a capital, which hyphenation never breaks into", async () => {
    expect(await join("Lento saapui Helsinki-", "Vantaalle illalla.")).toBe(
      "Lento saapui Helsinki-Vantaalle illalla.",
    );
  });
});

describe("pdfToMarkdown metadata", () => {
  it("reads the title and subject the document carries", async () => {
    const extract = await pdfToMarkdown(
      buildPdf([[...wrapped([WRAP_A, TAIL], 600)]], {
        title: "Tarkastuslautakunnan arvio 2026",
        subject: "Tiivistelma\r\narviosta ja sen eko-\r\nlogisista vaikutuksista.",
      }),
    );
    expect(extract.title).toBe("Tarkastuslautakunnan arvio 2026");
    // Unwrapped the same way body text is, hyphenation included.
    expect(extract.subject).toBe("Tiivistelma arviosta ja sen ekologisista vaikutuksista.");
  });

  it("unwraps the file name Word leaves in the title", async () => {
    const extract = await pdfToMarkdown(
      buildPdf([[...wrapped([WRAP_A, TAIL], 600)]], {
        title: "Microsoft Word - lausunto_valmis.docx",
      }),
    );
    expect(extract.title).toBe("lausunto_valmis");
  });

  it("falls back to the document's first heading", async () => {
    const extract = await pdfToMarkdown(
      buildPdf([
        [
          { text: "Kaupungin tilinpaatos", y: 640, size: 18, font: "bold" },
          ...wrapped([WRAP_A, TAIL], 600),
        ],
      ]),
    );
    expect(extract.title).toBe("Kaupungin tilinpaatos");
  });

  it("returns no text for a PDF with no text layer, as a scan has none", async () => {
    const extract = await pdfToMarkdown(buildPdf([[]], { title: "Skannattu liite" }));
    expect(extract.markdown).toBe("");
    expect(extract.title).toBe("Skannattu liite");
  });

  it("rejects bytes that are not a PDF at all", async () => {
    await expect(pdfToMarkdown(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

describe("pdfToMarkdown concurrency", () => {
  it("serializes overlapping parses without mixing their documents", async () => {
    const docs = [WRAP_A, WRAP_B, TAIL].map((text) => buildPdf([[{ text, y: 600 }]]));
    const results = await Promise.all(docs.map((bytes) => pdfToMarkdown(bytes)));
    expect(results.map((r) => r.markdown)).toEqual([WRAP_A, WRAP_B, TAIL]);
  });
});
