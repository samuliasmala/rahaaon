import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArchiveInfo, submissionArchiveRef } from "./archive-info.js";
import {
  getGetApiAdminSubmissionsQueryKey,
  getGetApiAdminSubmissionsRejectedQueryKey,
  getGetApiAdminSuggestionsQueryKey,
  usePostApiAdminSubmissionsIdProcess,
  usePostApiAdminSubmissionsIdReject,
} from "../../api/admin/admin.js";
import { formatTimeAgo } from "../../lib/format.js";
import { Button } from "../ui/button.js";
import type { UrlSubmission } from "../../api/model/index.js";

/**
 * One reader-submitted link in the Ehdotusjono: the page metadata captured at
 * submit time plus the verdict — onward to the AI queue ("Käsittele"; queues
 * the LLM extraction, which runs in the background — see the API's
 * submission-processor module) or into the rejected archive ("Hylkää"). While
 * the extraction runs the entry stays here as `processing: true` (a state that
 * survives page refreshes) and the admin view polls until it moves on. Hylkää
 * stays available even then — it doubles as the way to cancel a processing run.
 */
export function SubmissionCard({ entry }: { entry: UrlSubmission }) {
  const queryClient = useQueryClient();
  const processMutation = usePostApiAdminSubmissionsIdProcess();
  const rejectMutation = usePostApiAdminSubmissionsIdReject();
  const processing = entry.processing || processMutation.isPending;
  const busy = processMutation.isPending || rejectMutation.isPending;

  async function refreshSubmissions() {
    await queryClient.invalidateQueries({ queryKey: getGetApiAdminSubmissionsQueryKey() });
  }

  async function process() {
    try {
      await processMutation.mutateAsync({ id: entry.id });
    } catch {
      toast("Käsittely epäonnistui. Yritä uudelleen.");
      return;
    }
    // The entry is queued; the refetch re-renders this card locked
    // ("Käsitellään…") until the background extraction finishes. The AI queue
    // is invalidated too in case the extraction beat this refetch — then the
    // finish would never be observed as a processing → done transition.
    await Promise.all([
      refreshSubmissions(),
      queryClient.invalidateQueries({ queryKey: getGetApiAdminSuggestionsQueryKey() }),
    ]);
    toast("Käsittely aloitettu");
  }

  async function reject() {
    try {
      await rejectMutation.mutateAsync({ id: entry.id });
    } catch {
      toast("Hylkäys epäonnistui. Yritä uudelleen.");
      return;
    }
    await Promise.all([
      refreshSubmissions(),
      queryClient.invalidateQueries({ queryKey: getGetApiAdminSubmissionsRejectedQueryKey() }),
    ]);
    toast("Linkki hylätty");
  }

  return (
    <section className="animate-in overflow-hidden rounded-[10px] border border-hairline bg-surface duration-250 fade-in slide-in-from-bottom-[10px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-wash px-4.5 py-3.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-body uppercase">
          Lukijan ehdottama linkki
        </span>
        <span className="ml-auto text-xs text-muted">
          Saapunut {formatTimeAgo(entry.createdAt)}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4.5 md:flex-row md:items-center md:gap-6 md:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-[15px]/[1.35] font-semibold">
            {entry.title || entry.siteName || entry.url}
          </p>
          {entry.description && <p className="text-sm/[1.55] text-body">{entry.description}</p>}
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[13px] font-medium text-accent hover:text-accent-deep"
          >
            {entry.url}
          </a>
          <ArchiveInfo
            archive={submissionArchiveRef(entry)}
            url={entry.url}
            listQueryKeys={[
              getGetApiAdminSubmissionsQueryKey(),
              getGetApiAdminSubmissionsRejectedQueryKey(),
            ]}
          />
          {entry.processError && !processing && (
            <p className="text-[13px] text-accent">Käsittely epäonnistui: {entry.processError}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2.5 md:self-center">
          <Button disabled={processing || busy} onClick={() => void process()}>
            {processing ? "Käsitellään…" : "Käsittele"}
          </Button>
          {/* Enabled while processing: rejecting cancels the run (the worker
              discards a finished extraction for a non-processing row). */}
          <Button variant="outlineDanger" disabled={busy} onClick={() => void reject()}>
            Hylkää
          </Button>
        </div>
      </div>
    </section>
  );
}
