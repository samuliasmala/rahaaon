import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArchiveInfo } from "./archive-info.js";
import { syncDraftToPatch, toExtractionDraft, toExtractionPatch } from "./extraction-draft.js";
import { ExtractionFields } from "./extraction-fields.js";
import {
  getGetApiAdminItemsQueryKey,
  getGetApiAdminSuggestionsQueryKey,
  getGetApiAdminSuggestionsRejectedQueryKey,
  usePatchApiAdminSuggestionsId,
  usePostApiAdminSuggestionsIdApprove,
  usePostApiAdminSuggestionsIdReject,
} from "../../api/admin/admin.js";
import { getGetApiItemsQueryKey } from "../../api/items/items.js";
import { type SuggestionWithArchive } from "../../api/model/index.js";
import { cn } from "../../lib/cn.js";
import { formatTimeAgo } from "../../lib/format.js";
import { Button } from "../ui/button.js";
import { Pill } from "../ui/pill.js";

function confidenceClasses(confidence: number): string {
  if (confidence >= 85) return "bg-ok-wash text-ok";
  if (confidence >= 70) return "bg-warn-wash text-warn";
  return "bg-accent-wash text-accent";
}

/**
 * One AI-preprocessed suggestion: editable extraction + source panel + verdict.
 * Edits live in local draft state and are saved on blur; approving saves the
 * draft first so what the editor sees is exactly what gets published.
 */
export function QueueCard({ entry }: { entry: SuggestionWithArchive }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toExtractionDraft(entry));

  const patchMutation = usePatchApiAdminSuggestionsId();
  const approveMutation = usePostApiAdminSuggestionsIdApprove();
  const rejectMutation = usePostApiAdminSuggestionsIdReject();
  const busy = approveMutation.isPending || rejectMutation.isPending;

  function saveDraft() {
    const patch = toExtractionPatch(draft);
    setDraft((d) => syncDraftToPatch(d, patch));
    // Blur-saves have no save button whose state could reveal a failure —
    // surface it, or the editor walks away believing the edit landed.
    patchMutation.mutate(
      { id: entry.id, data: patch },
      { onError: () => toast("Tallennus epäonnistui. Yritä uudelleen.") },
    );
  }

  async function refreshQueue() {
    await queryClient.invalidateQueries({ queryKey: getGetApiAdminSuggestionsQueryKey() });
  }

  async function approve() {
    try {
      await patchMutation.mutateAsync({ id: entry.id, data: toExtractionPatch(draft) });
      await approveMutation.mutateAsync({ id: entry.id });
    } catch {
      toast("Julkaisu epäonnistui. Yritä uudelleen.");
      return;
    }
    await Promise.all([
      refreshQueue(),
      queryClient.invalidateQueries({ queryKey: getGetApiItemsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetApiAdminItemsQueryKey() }),
    ]);
    toast("Julkaistu etusivulle");
  }

  async function reject() {
    try {
      await rejectMutation.mutateAsync({ id: entry.id });
    } catch {
      toast("Hylkäys epäonnistui. Yritä uudelleen.");
      return;
    }
    await Promise.all([
      refreshQueue(),
      queryClient.invalidateQueries({ queryKey: getGetApiAdminSuggestionsRejectedQueryKey() }),
    ]);
    toast("Ehdotus hylätty");
  }

  return (
    <section className="animate-in overflow-hidden rounded-[10px] border border-hairline bg-surface duration-250 fade-in slide-in-from-bottom-[10px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-wash px-4.5 py-3.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-body uppercase">
          Tekoälyn esikäsittelemä ehdotus
        </span>
        <Pill className={cn(confidenceClasses(entry.confidence), "tabular")}>
          AI-varmuus {entry.confidence}%
        </Pill>
        <span className="ml-auto text-xs text-muted">
          Saapunut {formatTimeAgo(entry.createdAt)}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 p-4.5 md:grid-cols-[minmax(0,1fr)_320px] md:p-8">
        <ExtractionFields
          idPrefix={`queue-${entry.id}`}
          draft={draft}
          setDraft={setDraft}
          onSave={saveDraft}
          summaryLabel="Tekoälyn tiivistelmä"
          busy={busy}
        />

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-wash-soft px-4 py-3.5">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              Lähde
            </p>
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="text-[13px]/[1.4] font-medium break-all text-accent hover:text-accent-deep"
            >
              {entry.url}
            </a>
            <p className="text-xs text-muted">{entry.sourceName}</p>
            <ArchiveInfo
              archive={entry.archive}
              url={entry.url}
              listQueryKeys={[getGetApiAdminSuggestionsQueryKey()]}
              processed
            />
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-wash-soft px-4 py-3.5">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
              Tekoälyn huomiot
            </p>
            <p className="text-[13px]/[1.5] text-body">{entry.aiNote}</p>
          </div>
          <div className="mt-auto flex gap-2.5 pt-1">
            <Button
              variant="success"
              className="flex-1"
              disabled={busy}
              onClick={() => void approve()}
            >
              Hyväksy ja julkaise
            </Button>
            <Button variant="outlineDanger" disabled={busy} onClick={() => void reject()}>
              Hylkää
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
