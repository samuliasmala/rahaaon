import { describe, expect, it } from "vitest";

/**
 * Unit tests for the pure archive classification: the schema.org paywall
 * marking beats the length heuristic when it says paywalled; marked-free and
 * unmarked pages fall back to the length check.
 */

// env.ts (imported transitively) demands DATABASE_URL at module load; give a
// throwaway value so the pure function can be tested without a database.
process.env.DATABASE_URL ??= "postgres://unit:unit@localhost:5432/unit";
const { classifyArchive } = await import("./article-archive.js");

describe("classifyArchive", () => {
  // Comfortably past the paywall threshold — the length of a marked-paywalled
  // hs.fi teaser (headline, standfirst, captions).
  const longText = "Pitkä uutisteksti jossa riittää sisältöä. ".repeat(30);
  const thinText = "Tilaajille.";

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

  it("keeps unfetched pages failed regardless of marking", () => {
    expect(classifyArchive(false, "", false)).toBe("failed");
  });
});
