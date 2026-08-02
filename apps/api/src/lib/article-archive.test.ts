import { describe, expect, it } from "vitest";

/**
 * Unit tests for the pure archive classification: the schema.org paywall
 * marking beats the length heuristic when it says paywalled; marked-free and
 * unmarked pages fall back to the length check.
 */

// env.ts (imported transitively) demands DATABASE_URL at module load; give a
// throwaway value so the pure functions can be tested without a database.
process.env.DATABASE_URL ??= "postgres://unit:unit@localhost:5432/unit";
const { classifyArchive, effectiveArchiveStatus } = await import("./article-archive.js");
const { markdownContentLength, proseContentLength } = await import("./page-preview.js");

describe("classifyArchive", () => {
  // Comfortably past the paywall threshold — the length of a marked-paywalled
  // hs.fi teaser (headline, standfirst, captions).
  const longText = "Pitkä uutisteksti jossa riittää sisältöä. ".repeat(30);
  const thinText = "Tilaajille.";
  // The shape iltalehti.fi serves for a login-walled article (body withheld
  // server-side, wall drawn by JS, no schema.org marking): kicker, headline,
  // lead, caption, byline and a teaser list — every block furniture-short,
  // yet the total beats the overall length threshold.
  const furnitureText = [
    "Kotimaa",
    "# Otsikko joka tiivistää jutun ytimen yhteen virkkeeseen",
    "Ingressi kertaa jutun pääpointin parilla lauseella heti otsikon alla.",
    "Kuvituskuva paikan päältä kesällä 2010. ETUNIMI SUKUNIMI / TOIMISTO",
    "Toimittajan Nimi",
    "perjantai 29.3.2024 klo 21:10",
    "### Lue myös",
    ...Array.from(
      { length: 10 },
      (_, i) => `Aiheeseen liittyvän jutun otsikko numero ${i} – jatkoa vielä pidemmälle`,
    ),
  ].join("\n\n");

  it("trusts an explicit paywall marking even when the teaser is long", () => {
    expect(classifyArchive(true, longText, false)).toBe("paywalled");
  });

  it("falls back to the length heuristic when unmarked", () => {
    expect(classifyArchive(true, longText, null)).toBe("ok");
    expect(classifyArchive(true, thinText, null)).toBe("paywalled");
  });

  it("length-checks marked-free pages too — a consent wall can eat one", () => {
    expect(classifyArchive(true, longText, true)).toBe("ok");
    expect(classifyArchive(true, thinText, true)).toBe("paywalled");
  });

  it("flags a furniture-only page whose total length beats the threshold", () => {
    // Guard the fixture itself: it must be long overall yet prose-free, or
    // the assertion below stops exercising the prose gate.
    expect(markdownContentLength(furnitureText)).toBeGreaterThanOrEqual(600);
    expect(proseContentLength(furnitureText)).toBe(0);
    expect(classifyArchive(true, furnitureText, null)).toBe("paywalled");
  });

  it("keeps unfetched pages failed regardless of marking", () => {
    expect(classifyArchive(false, "", false)).toBe("failed");
  });
});

describe("effectiveArchiveStatus", () => {
  it("passes stored statuses through untouched", () => {
    expect(effectiveArchiveStatus("pending", true)).toBe("pending");
    expect(effectiveArchiveStatus("ok", true)).toBe("ok");
    // A stored status stays even if archiving has since been turned off.
    expect(effectiveArchiveStatus("failed", false)).toBe("failed");
  });

  it("maps a never-attempted row by whether archiving is available", () => {
    expect(effectiveArchiveStatus(null, true)).toBe("missing");
    expect(effectiveArchiveStatus(null, false)).toBe("disabled");
  });
});
