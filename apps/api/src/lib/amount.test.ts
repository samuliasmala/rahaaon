import { describe, expect, it } from "vitest";
import { normalizeAmount } from "./amount.js";

describe("normalizeAmount", () => {
  it("passes a consistent state through unchanged", () => {
    expect(
      normalizeAmount({ amountEur: 100_000, amountType: "approx", amountMaxEur: 200_000 }),
    ).toEqual({ amountEur: 100_000, amountType: "approx", amountMaxEur: 200_000 });
  });

  it("zeroes the figure and drops the range for 'unknown'", () => {
    expect(
      normalizeAmount({ amountEur: 87_000, amountType: "unknown", amountMaxEur: 90_000 }),
    ).toEqual({ amountEur: 0, amountType: "unknown", amountMaxEur: null });
  });

  it("flips a zero figure to 'unknown'", () => {
    expect(normalizeAmount({ amountEur: 0, amountType: "exact", amountMaxEur: null })).toEqual({
      amountEur: 0,
      amountType: "unknown",
      amountMaxEur: null,
    });
  });

  it("drops an upper bound that isn't above the figure", () => {
    expect(
      normalizeAmount({ amountEur: 100_000, amountType: "exact", amountMaxEur: 100_000 }),
    ).toEqual({ amountEur: 100_000, amountType: "exact", amountMaxEur: null });
  });
});
