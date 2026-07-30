import { describe, expect, it } from "vitest";
import { MAX_KEYWORDS, MAX_KEYWORD_LENGTH, normalizeKeywords } from "./keyword-ai.js";

describe("normalizeKeywords", () => {
  it("trims, drops empties and dedupes case-insensitively keeping the first casing", () => {
    expect(normalizeKeywords([" Viherseinä ", "viherseinä", "", "   ", "muovikasvit"])).toEqual([
      "Viherseinä",
      "muovikasvit",
    ]);
  });

  it("caps the count and the keyword length", () => {
    const many = Array.from({ length: MAX_KEYWORDS + 5 }, (_, i) => `avainsana-${i}`);
    expect(normalizeKeywords(many)).toHaveLength(MAX_KEYWORDS);
    expect(normalizeKeywords(["a".repeat(MAX_KEYWORD_LENGTH + 20)])[0]).toHaveLength(
      MAX_KEYWORD_LENGTH,
    );
  });
});
