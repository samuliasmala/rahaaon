import { cn } from "../../lib/cn.js";
import { FEED_FILTERS, SORT_ORDERS, type FeedFilter, type SortOrder } from "../../lib/feed.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";

const SORT_LABELS: Record<SortOrder, string> = {
  new: "Uusimmat",
  amount: "Suurin summa",
  votes: "Eniten ääniä",
};

export function FilterBar({
  filter,
  onFilter,
  sort,
  onSort,
  search,
  onSearch,
}: {
  filter: FeedFilter;
  onFilter: (filter: FeedFilter) => void;
  sort: SortOrder;
  onSort: (sort: SortOrder) => void;
  search: string;
  onSearch: (search: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3.5 md:px-12 md:py-4.5">
      {FEED_FILTERS.map((chip) => (
        <button
          key={chip}
          type="button"
          aria-pressed={chip === filter}
          onClick={() => onFilter(chip)}
          className={cn(
            "cursor-pointer rounded-full border px-3.5 py-[7px] text-[13px] font-medium transition-colors",
            chip === filter
              ? "border-ink bg-ink text-white"
              : "border-hairline-strong bg-surface text-body hover:border-ink",
          )}
        >
          {chip}
        </button>
      ))}
      <div className="ml-auto flex grow flex-wrap items-center gap-2.5 md:grow-0">
        <Select
          aria-label="Järjestä"
          value={sort}
          onChange={(e) => onSort(e.target.value as SortOrder)}
          className="flex-none"
        >
          {SORT_ORDERS.map((order) => (
            <option key={order} value={order}>
              {SORT_LABELS[order]}
            </option>
          ))}
        </Select>
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Hae kuntaa tai juttua…"
          aria-label="Hae kuntaa tai juttua"
          className="min-w-[160px] flex-1 px-3.5 text-[13px] md:w-[220px] md:flex-none"
        />
      </div>
    </div>
  );
}
