import { describe, expect, it } from "vitest";
import { filterFeedItems, sortFeedItems, totalRecorded } from "./feed.js";
import type { WasteItem } from "../api/model/index.js";

function makeItem(overrides: Partial<WasteItem>): WasteItem {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Testijuttu",
    amountEur: 1000,
    amountType: "exact",
    amountMaxEur: null,
    entity: "Oulu",
    category: "Muu",
    sourceName: "Kaleva",
    sourceUrl: "https://example.fi/juttu",
    articleTitle: "",
    summary: "",
    quote: "",
    keywords: [],
    hidden: false,
    publishedAt: "2026-07-17T00:00:00.000Z",
    articlePublishedAt: null,
    votes: 10,
    voted: false,
    ...overrides,
  };
}

const items: WasteItem[] = [
  makeItem({
    id: "1",
    entity: "Valtio",
    category: "IT-hankkeet",
    amountEur: 500,
    publishedAt: "2026-07-15T00:00:00.000Z",
    votes: 5,
    keywords: ["tietojärjestelmä", "budjettiylitys"],
  }),
  makeItem({
    id: "2",
    entity: "Oulu",
    category: "Rakentaminen",
    amountEur: 900,
    publishedAt: "2026-07-17T00:00:00.000Z",
    votes: 50,
  }),
  makeItem({
    id: "3",
    entity: "ELY-keskus",
    category: "Rakentaminen",
    amountEur: 100,
    publishedAt: "2026-07-16T00:00:00.000Z",
    votes: 9,
  }),
];

describe("filterFeedItems", () => {
  it("scopes 'Valtio' to the state itself", () => {
    expect(filterFeedItems(items, "Valtio", "").map((i) => i.id)).toEqual(["1"]);
  });

  it("scopes 'Kaupungit' to municipalities, excluding national bodies", () => {
    expect(filterFeedItems(items, "Kaupungit", "").map((i) => i.id)).toEqual(["2"]);
  });

  it("treats the remaining chips as category filters", () => {
    expect(filterFeedItems(items, "Rakentaminen", "").map((i) => i.id)).toEqual(["2", "3"]);
  });

  it("matches search across title, entity, category, source and keywords", () => {
    expect(filterFeedItems(items, "Kaikki", "oulu").map((i) => i.id)).toEqual(["2"]);
    expect(filterFeedItems(items, "Kaikki", "it-hank").map((i) => i.id)).toEqual(["1"]);
    expect(filterFeedItems(items, "Kaikki", "budjettiylitys").map((i) => i.id)).toEqual(["1"]);
    expect(filterFeedItems(items, "Kaikki", "ei osumia")).toEqual([]);
  });
});

describe("sortFeedItems", () => {
  it("sorts by recency, amount or votes", () => {
    expect(sortFeedItems(items, "new").map((i) => i.id)).toEqual(["2", "3", "1"]);
    expect(sortFeedItems(items, "amount").map((i) => i.id)).toEqual(["2", "1", "3"]);
    expect(sortFeedItems(items, "votes").map((i) => i.id)).toEqual(["2", "3", "1"]);
  });

  it("does not mutate the input", () => {
    const before = items.map((i) => i.id);
    sortFeedItems(items, "amount");
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe("totalRecorded", () => {
  it("sums the listed items", () => {
    expect(totalRecorded(items)).toBe(1500);
  });

  it("counts a range by its lower bound and an unknown amount as zero", () => {
    const mixed = [
      makeItem({ amountEur: 100, amountMaxEur: 900 }),
      makeItem({ amountEur: 0, amountType: "unknown" }),
    ];
    expect(totalRecorded(mixed)).toBe(100);
  });
});
