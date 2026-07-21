import { describe, expect, it } from "vitest";
import {
  type AmountFields,
  formatAge,
  formatAgeShort,
  formatAmount,
  formatCount,
  formatDate,
  formatEur,
  parseEuroAmount,
} from "./format.js";

// fi-FI groups digits with a non-breaking space.
const NBSP = " ";

describe("formatEur", () => {
  it("formats whole euros with Finnish grouping", () => {
    expect(formatEur(62_000_000)).toBe(`62${NBSP}000${NBSP}000 €`);
    expect(formatEur(0)).toBe("0 €");
  });
});

describe("formatAmount", () => {
  function amount(overrides: Partial<AmountFields>): AmountFields {
    return { amountEur: 40_000, amountType: "exact", amountMaxEur: null, ...overrides };
  }

  it("renders an exact amount as plain euros", () => {
    expect(formatAmount(amount({}))).toBe(`40${NBSP}000 €`);
  });

  it("prefixes approximate and lower-bound amounts", () => {
    expect(formatAmount(amount({ amountType: "approx" }))).toBe(`n. 40${NBSP}000 €`);
    expect(formatAmount(amount({ amountType: "min" }))).toBe(`yli 40${NBSP}000 €`);
  });

  it("renders a range, with the approx prefix when qualified", () => {
    expect(formatAmount(amount({ amountMaxEur: 60_000 }))).toBe(`40${NBSP}000–60${NBSP}000 €`);
    expect(formatAmount(amount({ amountType: "approx", amountMaxEur: 60_000 }))).toBe(
      `n. 40${NBSP}000–60${NBSP}000 €`,
    );
  });

  it("ignores an upper bound at or below the amount", () => {
    expect(formatAmount(amount({ amountMaxEur: 40_000 }))).toBe(`40${NBSP}000 €`);
  });

  it("labels unknown amounts instead of showing 0 €", () => {
    expect(formatAmount(amount({ amountEur: 0, amountType: "unknown" }))).toBe("Ei tiedossa");
    // 0 means "not stated" by convention regardless of the qualifier.
    expect(formatAmount(amount({ amountEur: 0 }))).toBe("Ei tiedossa");
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

describe("formatDate", () => {
  it("renders a YYYY-MM-DD date in Finnish style without zero-padding", () => {
    expect(formatDate("2025-11-04")).toBe("4.11.2025");
    expect(formatDate("2026-01-15")).toBe("15.1.2026");
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

  it("takes the first figure of a pasted range, not the concatenated digits", () => {
    expect(parseEuroAmount("100 000–200 000 €")).toBe(100_000);
    expect(parseEuroAmount("100-200")).toBe(100);
  });
});
