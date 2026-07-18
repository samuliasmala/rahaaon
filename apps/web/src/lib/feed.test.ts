import { describe, expect, it } from "vitest";
import { filterFeedItems, sortFeedItems, totalRecorded } from "./feed.js";
import type { WasteItem } from "./types.js";

function makeItem(overrides: Partial<WasteItem>): WasteItem {
  return {
    id: 1,
    title: "Testijuttu",
    amount: 1000,
    entity: "Oulu",
    category: "Muu",
    source: "Kaleva",
    url: "https://example.fi/juttu",
    days: 1,
    votes: 10,
    hidden: false,
    summary: "",
    quote: "",
    ...overrides,
  };
}

const items: WasteItem[] = [
  makeItem({ id: 1, entity: "Valtio", category: "IT-hankkeet", amount: 500, days: 3, votes: 5 }),
  makeItem({ id: 2, entity: "Oulu", category: "Rakentaminen", amount: 900, days: 1, votes: 50 }),
  makeItem({
    id: 3,
    entity: "ELY-keskus",
    category: "Rakentaminen",
    amount: 100,
    days: 2,
    votes: 9,
  }),
  makeItem({
    id: 4,
    entity: "Tampere",
    category: "Kulttuuri",
    amount: 300,
    days: 4,
    votes: 99,
    hidden: true,
  }),
];

describe("filterFeedItems", () => {
  it("excludes hidden items from every view", () => {
    expect(filterFeedItems(items, "Kaikki", "").map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("scopes 'Valtio' to the state itself", () => {
    expect(filterFeedItems(items, "Valtio", "").map((i) => i.id)).toEqual([1]);
  });

  it("scopes 'Kaupungit' to municipalities, excluding national bodies", () => {
    expect(filterFeedItems(items, "Kaupungit", "").map((i) => i.id)).toEqual([2]);
  });

  it("treats the remaining chips as category filters", () => {
    expect(filterFeedItems(items, "Rakentaminen", "").map((i) => i.id)).toEqual([2, 3]);
  });

  it("matches search across title, entity, category and source", () => {
    expect(filterFeedItems(items, "Kaikki", "oulu").map((i) => i.id)).toEqual([2]);
    expect(filterFeedItems(items, "Kaikki", "it-hank").map((i) => i.id)).toEqual([1]);
    expect(filterFeedItems(items, "Kaikki", "ei osumia")).toEqual([]);
  });
});

describe("sortFeedItems", () => {
  it("sorts by age, amount or votes", () => {
    expect(sortFeedItems(items, "new").map((i) => i.id)).toEqual([2, 3, 1, 4]);
    expect(sortFeedItems(items, "amount").map((i) => i.id)).toEqual([2, 1, 4, 3]);
    expect(sortFeedItems(items, "votes").map((i) => i.id)).toEqual([4, 2, 3, 1]);
  });

  it("does not mutate the input", () => {
    const before = items.map((i) => i.id);
    sortFeedItems(items, "amount");
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe("totalRecorded", () => {
  it("sums visible items only", () => {
    expect(totalRecorded(items)).toBe(1500);
  });
});
