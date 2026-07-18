import type { WasteItem } from "./types.js";

/** Filter chips shown above the feed: two entity scopes + the most common categories. */
export const FEED_FILTERS = [
  "Kaikki",
  "Valtio",
  "Kaupungit",
  "Rakentaminen",
  "IT-hankkeet",
  "Konsultit",
  "Kulttuuri",
] as const;

export type FeedFilter = (typeof FEED_FILTERS)[number];

export const SORT_ORDERS = ["new", "amount", "votes"] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

/** Entities that are not municipalities — excluded by the "Kaupungit" scope. */
const NATIONAL_ENTITIES = ["Valtio", "Hyvinvointialue", "ELY-keskus", "Kuntaliitto"];

export function filterFeedItems(
  items: WasteItem[],
  filter: FeedFilter,
  search: string,
): WasteItem[] {
  const query = search.trim().toLowerCase();
  return items.filter((item) => {
    if (item.hidden) return false;
    if (filter === "Valtio" && item.entity !== "Valtio") return false;
    if (filter === "Kaupungit" && NATIONAL_ENTITIES.includes(item.entity)) return false;
    if (
      filter !== "Kaikki" &&
      filter !== "Valtio" &&
      filter !== "Kaupungit" &&
      item.category !== filter
    ) {
      return false;
    }
    if (query) {
      const haystack = `${item.title} ${item.entity} ${item.category} ${item.source}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function sortFeedItems(items: WasteItem[], sort: SortOrder): WasteItem[] {
  return [...items].sort((a, b) => {
    switch (sort) {
      case "amount":
        return b.amount - a.amount;
      case "votes":
        return b.votes - a.votes;
      case "new":
        return a.days - b.days;
    }
  });
}

/** Sum of all visible (non-hidden) items — the hero counter. */
export function totalRecorded(items: WasteItem[]): number {
  return items.filter((item) => !item.hidden).reduce((sum, item) => sum + item.amount, 0);
}
