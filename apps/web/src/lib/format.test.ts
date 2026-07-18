import { describe, expect, it } from "vitest";
import { formatAge, formatAgeShort, formatCount, formatEur, parseEuroAmount } from "./format.js";

// fi-FI groups digits with a non-breaking space.
const NBSP = " ";

describe("formatEur", () => {
  it("formats whole euros with Finnish grouping", () => {
    expect(formatEur(62_000_000)).toBe(`62${NBSP}000${NBSP}000 €`);
    expect(formatEur(0)).toBe("0 €");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(2041)).toBe(`2${NBSP}041`);
    expect(formatCount(448)).toBe("448");
  });
});

describe("formatAge", () => {
  it("renders fresh, day-old and week-old ages", () => {
    expect(formatAge(0)).toBe("juuri nyt");
    expect(formatAge(3)).toBe("3 pv sitten");
    expect(formatAge(14)).toBe("2 vk sitten");
  });
});

describe("formatAgeShort", () => {
  it("renders the compact admin variant", () => {
    expect(formatAgeShort(0)).toBe("juuri nyt");
    expect(formatAgeShort(8)).toBe("8 pv");
  });
});

describe("parseEuroAmount", () => {
  it("extracts digits from free-text amounts", () => {
    expect(parseEuroAmount("400000")).toBe(400_000);
    expect(parseEuroAmount("400 000 €")).toBe(400_000);
    expect(parseEuroAmount("ei summaa")).toBe(0);
  });
});
