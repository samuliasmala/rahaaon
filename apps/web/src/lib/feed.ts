import type { WasteItem } from "../api/model/index.js";

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
      // keywords is guarded: an old API deploy without the field must degrade
      // to a narrower search, not throw in the feed's render body.
      const haystack = [item.title, item.entity, item.category, item.sourceName]
        .concat(item.keywords ?? [])
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function sortFeedItems(items: WasteItem[], sort: SortOrder): WasteItem[] {
  return [...items].sort((a, b) => {
    switch (sort) {
      case "amount":
        return b.amountEur - a.amountEur;
      case "votes":
        return b.votes - a.votes;
      case "new":
        return b.publishedAt.localeCompare(a.publishedAt);
    }
  });
}

/**
 * Sum of all listed items — the hero counter (the feed endpoint already
 * excludes hidden). amountEur is a range's lower bound and 0 for unknown
 * amounts, so the total stays a conservative "at least this much".
 */
export function totalRecorded(items: WasteItem[]): number {
  return items.reduce((sum, item) => sum + item.amountEur, 0);
}
