import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DetailDialog } from "../components/feed/detail-dialog.js";
import { FilterBar } from "../components/feed/filter-bar.js";
import { Hero } from "../components/feed/hero.js";
import { ItemRow } from "../components/feed/item-row.js";
import { Button } from "../components/ui/button.js";
import {
  filterFeedItems,
  sortFeedItems,
  totalRecorded,
  type FeedFilter,
  type SortOrder,
} from "../lib/feed.js";
import { useAppStore } from "../store/app-store.js";

/** Feed rows shown before the reader asks for more. */
const PAGE_SIZE = 6;

export const Route = createFileRoute("/")({
  component: FeedPage,
});

function FeedPage() {
  const items = useAppStore((s) => s.items);

  const [filter, setFilter] = useState<FeedFilter>("Kaikki");
  const [sort, setSort] = useState<SortOrder>("new");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [detailId, setDetailId] = useState<number | null>(null);

  const filtered = sortFeedItems(filterFeedItems(items, filter, search), sort);
  const visible = filtered.slice(0, visibleCount);
  const detailItem = items.find((item) => item.id === detailId) ?? null;

  // Narrowing the result set makes stale deep pagination pointless — reset it.
  function updateFilter(next: FeedFilter) {
    setFilter(next);
    setVisibleCount(PAGE_SIZE);
  }
  function updateSearch(next: string) {
    setSearch(next);
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <main>
      <Hero total={totalRecorded(items)} />
      <FilterBar
        filter={filter}
        onFilter={updateFilter}
        sort={sort}
        onSort={setSort}
        search={search}
        onSearch={updateSearch}
      />
      <div className="mx-auto w-full max-w-[1240px] px-4 pt-1 pb-10 md:px-12 md:pb-12">
        {filtered.length === 0 && (
          <p className="py-16 text-center text-base text-muted">
            Ei osumia haulla. Kokeile toista hakusanaa — rahareikiä kyllä riittää.
          </p>
        )}
        {visible.map((item) => (
          <ItemRow key={item.id} item={item} onOpen={() => setDetailId(item.id)} />
        ))}
        {filtered.length > visibleCount && (
          <div className="pt-7 text-center">
            <Button
              variant="outline"
              size="lg"
              className="px-7 text-sm"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            >
              Näytä lisää
            </Button>
          </div>
        )}
      </div>
      <DetailDialog item={detailItem} onClose={() => setDetailId(null)} />
    </main>
  );
}
