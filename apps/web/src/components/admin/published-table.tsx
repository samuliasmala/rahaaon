import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import {
  type ExtractionPatch,
  syncDraftAmounts,
  toExtractionDraft,
  toExtractionPatch,
} from "./extraction-draft.js";
import { ExtractionFields } from "./extraction-fields.js";
import { getGetApiAdminItemsQueryKey, usePatchApiAdminItemsId } from "../../api/admin/admin.js";
import { getGetApiItemsQueryKey } from "../../api/items/items.js";
import { cn } from "../../lib/cn.js";
import { daysSince, formatAgeShort, formatAmount, formatCount } from "../../lib/format.js";
import { Button } from "../ui/button.js";
import type { WasteItem } from "../../api/model/index.js";

const GRID_COLS = "grid-cols-[1fr_150px_110px_90px_180px]";

/** Every published item — hidden ones stay listed here, greyed out. */
export function PublishedTable({ items }: { items: WasteItem[] }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  // One mutation for hide/restore and inline edits alike: every patch touches
  // the live feed, so refresh it alongside the admin list. Blur saves have no
  // other failure surface, so surface errors here.
  const patchMutation = usePatchApiAdminItemsId({
    mutation: {
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetApiAdminItemsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetApiItemsQueryKey() }),
        ]),
      onError: () => toast("Tallennus epäonnistui. Yritä uudelleen."),
    },
  });

  return (
    <div className="overflow-x-auto rounded-[10px] border border-hairline bg-surface">
      <div className="min-w-[850px]">
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
          <Fragment key={item.id}>
            <div
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
                  {item.category} · {item.sourceName} ·{" "}
                  {formatAgeShort(daysSince(item.publishedAt))}
                </span>
              </div>
              <span className="font-display text-sm font-semibold text-accent tabular">
                {formatAmount(item)}
              </span>
              <span className="text-[13px] font-medium text-body">{item.entity}</span>
              <span className="text-[13px] font-medium text-body tabular">
                ▲ {formatCount(item.votes)}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 px-0 text-xs"
                  // Opening waits out an in-flight save + refetch, so a fresh
                  // editor can't seed its draft from a stale cached item and
                  // then write the stale fields back on the next blur.
                  // Closing stays enabled — the save is already on its way.
                  disabled={editingId !== item.id && patchMutation.isPending}
                  onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                >
                  {editingId === item.id ? "Sulje" : "Muokkaa"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 px-0 text-xs"
                  disabled={patchMutation.isPending}
                  onClick={() =>
                    patchMutation.mutate({ id: item.id, data: { hidden: !item.hidden } })
                  }
                >
                  {item.hidden ? "Palauta" : "Piilota"}
                </Button>
              </div>
            </div>
            {editingId === item.id && (
              <PublishedItemEditor
                item={item}
                onSave={(patch) => patchMutation.mutate({ id: item.id, data: patch })}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Inline editor for a published item, expanded below its row. Same fields and
 * save-on-blur behaviour as the AI queue card — edits go live immediately.
 */
function PublishedItemEditor({
  item,
  onSave,
}: {
  item: WasteItem;
  onSave: (patch: ExtractionPatch) => void;
}) {
  const [draft, setDraft] = useState(() => toExtractionDraft(item));

  function saveDraft() {
    const patch = toExtractionPatch(draft);
    setDraft((d) => syncDraftAmounts(d, patch));
    onSave(patch);
  }

  return (
    <div className="border-b border-hairline-soft bg-wash-soft px-6 py-5">
      <ExtractionFields
        idPrefix={`item-${item.id}`}
        draft={draft}
        setDraft={setDraft}
        onSave={saveDraft}
      />
    </div>
  );
}
