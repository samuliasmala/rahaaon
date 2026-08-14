import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url.js";

describe("normalizeUrl", () => {
  it("folds the shapes one article arrives in into a single key", () => {
    const variants = [
      "https://hs.fi/politiikka/art-123",
      "http://hs.fi/politiikka/art-123",
      "https://www.hs.fi/politiikka/art-123",
      "https://WWW.HS.FI/politiikka/art-123",
      "https://hs.fi/politiikka/art-123/",
      "https://hs.fi/politiikka/art-123#kommentit",
      "  https://hs.fi/politiikka/art-123  ",
      "https://www.hs.fi/politiikka/art-123/?utm_source=facebook&utm_medium=social#top",
      "https://hs.fi/politiikka/art-123?fbclid=IwAR123",
    ];
    // Asserted as a whole so a failure names the variant that drifted.
    expect(Object.fromEntries(variants.map((v) => [v, normalizeUrl(v)]))).toEqual(
      Object.fromEntries(variants.map((v) => [v, "https://hs.fi/politiikka/art-123"])),
    );
  });

  it("keeps parameters that may select the article, ordered so paste order can't matter", () => {
    expect(normalizeUrl("https://yle.fi/a?b=2&a=1")).toBe("https://yle.fi/a?a=1&b=2");
    expect(normalizeUrl("https://yle.fi/a?a=1&b=2")).toBe("https://yle.fi/a?a=1&b=2");
    // Repeated keys sort by value too, so the two orders key alike.
    expect(normalizeUrl("https://yle.fi/a?tag=b&tag=a")).toBe(
      normalizeUrl("https://yle.fi/a?tag=a&tag=b"),
    );
    // `ref`/`s`/`id`/`page` are route-bearing on some sites — never dropped.
    expect(normalizeUrl("https://yle.fi/uutiset?id=42&utm_campaign=kesa&ref=etusivu")).toBe(
      "https://yle.fi/uutiset?id=42&ref=etusivu",
    );
  });

  it("keeps genuinely different pages apart", () => {
    const keys = [
      normalizeUrl("https://hs.fi/politiikka/art-123"),
      normalizeUrl("https://hs.fi/politiikka/art-124"),
      normalizeUrl("https://is.fi/politiikka/art-123"),
      normalizeUrl("https://hs.fi/politiikka/art-123?sivu=2"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("drops the scheme's default port but keeps any other", () => {
    expect(normalizeUrl("http://hs.fi:80/a")).toBe("https://hs.fi/a");
    expect(normalizeUrl("https://hs.fi:443/a")).toBe("https://hs.fi/a");
    expect(normalizeUrl("https://hs.fi:8443/a")).toBe("https://hs.fi:8443/a");
  });

  it("keys a bare domain without inventing a path", () => {
    expect(normalizeUrl("https://hs.fi")).toBe("https://hs.fi");
    expect(normalizeUrl("https://hs.fi/")).toBe("https://hs.fi");
  });

  it("falls back to the trimmed input when the value won't parse", () => {
    // Submit-time validation rejects these, but the backfill runs over rows
    // written before it existed — an unparsable value must still key stably.
    expect(normalizeUrl("  not a url  ")).toBe("not a url");
    expect(normalizeUrl("")).toBe("");
  });
});
