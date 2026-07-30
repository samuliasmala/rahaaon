import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AiInstructionsDialog } from "./ai-instructions-dialog.js";
import { ArchiveInfo } from "./archive-info.js";
import {
  draftsEqual,
  syncDraftToPatch,
  toExtractionDraft,
  toExtractionPatch,
} from "./extraction-draft.js";
import { ExtractionFields } from "./extraction-fields.js";
import {
  getGetApiAdminItemsQueryKey,
  getGetApiAdminSuggestionsQueryKey,
  getGetApiAdminSuggestionsRejectedQueryKey,
  usePatchApiAdminSuggestionsId,
  usePostApiAdminSuggestionsIdApprove,
  usePostApiAdminSuggestionsIdReject,
  usePostApiAdminSuggestionsIdReprocess,
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
 * "Käsittele uudelleen" re-runs the AI extraction (optionally with editor
 * instructions) through the background pipeline; the card locks until the
 * redraft lands and then reloads the draft from it.
 */
export function QueueCard({ entry }: { entry: SuggestionWithArchive }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toExtractionDraft(entry));
  const [reprocessOpen, setReprocessOpen] = useState(false);
  // Covers the whole reprocess kick (POST + the refetch that brings
  // `entry.reprocessing`), so the card can't unlock in the gap between them.
  const [reprocessKicked, setReprocessKicked] = useState(false);

  const patchMutation = usePatchApiAdminSuggestionsId();
  const approveMutation = usePostApiAdminSuggestionsIdApprove();
  const rejectMutation = usePostApiAdminSuggestionsIdReject();
  const reprocessMutation = usePostApiAdminSuggestionsIdReprocess();
  const reprocessing = entry.reprocessing || reprocessKicked;
  const busy = approveMutation.isPending || rejectMutation.isPending;

  // When a redraft lands, the refetched entry's fields change under the local
  // draft — reload it. Keyed on content, not on observing a `reprocessing`
  // flank: a run that finishes within one refetch (or is watched from another
  // tab) never shows the flag at all. An entry refetched unchanged (another
  // card's action invalidating the list) compares equal and leaves in-progress
  // edits alone; blur-saves don't refetch the list at all.
  const prevEntry = useRef(entry);
  useEffect(() => {
    const fresh = toExtractionDraft(entry);
    if (!draftsEqual(fresh, toExtractionDraft(prevEntry.current))) setDraft(fresh);
    prevEntry.current = entry;
  }, [entry]);

  function saveDraft() {
    // The fields are disabled while a reprocess runs, but a blur can still
    // race the finish — don't let a stale draft clobber the fresh redraft.
    if (reprocessing) return;
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

  async function reprocess(instructions?: string) {
    setReprocessKicked(true);
    try {
      await reprocessMutation.mutateAsync({
        id: entry.id,
        data: instructions ? { instructions } : {},
      });
      // The refetch re-renders this card locked until the background run lands.
      await refreshQueue();
      toast("Uudelleenkäsittely aloitettu");
    } catch {
      toast("Uudelleenkäsittely epäonnistui. Yritä uudelleen.");
    } finally {
      setReprocessKicked(false);
    }
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
          busy={busy || reprocessing}
          disabled={reprocessing}
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
          <div className="mt-auto flex flex-col gap-2.5 pt-1">
            {entry.canReprocess && (
              <Button
                variant="outline"
                disabled={busy || reprocessing}
                onClick={() => setReprocessOpen(true)}
              >
                {reprocessing ? "Tekoäly käsittelee…" : "Käsittele uudelleen"}
              </Button>
            )}
            {entry.reprocessError && !reprocessing && (
              <p className="text-[13px] text-accent">
                Uudelleenkäsittely epäonnistui: {entry.reprocessError}
              </p>
            )}
            <div className="flex gap-2.5">
              <Button
                variant="success"
                className="flex-1"
                disabled={busy || reprocessing}
                onClick={() => void approve()}
              >
                Hyväksy ja julkaise
              </Button>
              {/* Enabled while a reprocess runs: rejecting doubles as the way
                  to cancel it (the worker discards a redraft for a rejected
                  suggestion), and as the escape hatch if the worker is down. */}
              <Button variant="outlineDanger" disabled={busy} onClick={() => void reject()}>
                Hylkää
              </Button>
            </div>
          </div>
        </div>
      </div>
      <AiInstructionsDialog
        open={reprocessOpen}
        onClose={() => setReprocessOpen(false)}
        title="Käsittele uudelleen"
        description="Tekoäly lukee lähteen uudelleen ja korvaa kortin tiedot — myös käsin tehdyt muokkaukset."
        confirmLabel="Käsittele uudelleen"
        onSubmit={(instructions) => {
          setReprocessOpen(false);
          void reprocess(instructions);
        }}
      />
    </section>
  );
}
