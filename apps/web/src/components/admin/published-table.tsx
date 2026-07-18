import { cn } from "../../lib/cn.js";
import { formatAgeShort, formatCount, formatEur } from "../../lib/format.js";
import { useAppStore } from "../../store/app-store.js";
import { Button } from "../ui/button.js";
import type { WasteItem } from "../../lib/types.js";

const GRID_COLS = "grid-cols-[1fr_150px_110px_90px_110px]";

/** Every published item — hidden ones stay listed here, greyed out. */
export function PublishedTable({ items }: { items: WasteItem[] }) {
  const toggleHidden = useAppStore((s) => s.toggleHidden);

  return (
    <div className="overflow-x-auto rounded-[10px] border border-hairline bg-surface">
      <div className="min-w-[780px]">
        <div
          className={cn(
            "grid gap-4 border-b border-hairline bg-wash px-6 py-3",
            "text-[11px] font-semibold tracking-[0.08em] text-muted uppercase",
            GRID_COLS,
          )}
        >
          <span>Juttu</span>
          <span>Summa</span>
          <span>Taho</span>
          <span>Äänet</span>
          <span />
        </div>
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "grid items-center gap-4 border-b border-hairline-soft px-6 py-4",
              GRID_COLS,
            )}
          >
            <div className="flex flex-col gap-0.5">
              <span
                className={cn("text-sm font-semibold", item.hidden ? "text-faint" : "text-ink")}
              >
                {item.title}
              </span>
              <span className="text-xs text-muted">
                {item.category} · {item.source} · {formatAgeShort(item.days)}
              </span>
            </div>
            <span className="font-display text-sm font-semibold text-accent tabular">
              {formatEur(item.amount)}
            </span>
            <span className="text-[13px] font-medium text-body">{item.entity}</span>
            <span className="text-[13px] font-medium text-body tabular">
              ▲ {formatCount(item.votes)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="w-full px-0 text-xs"
              onClick={() => toggleHidden(item.id)}
            >
              {item.hidden ? "Palauta" : "Piilota"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
