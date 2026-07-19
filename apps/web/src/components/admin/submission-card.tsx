import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
 * submit time plus the verdict — onward to the AI queue ("Käsittele"; runs the
 * LLM extraction, see the API's suggestion-ai module) or into the rejected
 * archive ("Hylkää").
 */
export function SubmissionCard({ entry }: { entry: UrlSubmission }) {
  const queryClient = useQueryClient();
  const processMutation = usePostApiAdminSubmissionsIdProcess();
  const rejectMutation = usePostApiAdminSubmissionsIdReject();
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
    // The entry left this queue and appeared in the AI queue.
    await Promise.all([
      refreshSubmissions(),
      queryClient.invalidateQueries({ queryKey: getGetApiAdminSuggestionsQueryKey() }),
    ]);
    toast("Siirretty tekoälyn käsiteltäväksi");
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
        </div>
        <div className="flex shrink-0 gap-2.5 md:self-center">
          <Button disabled={busy} onClick={() => void process()}>
            {processMutation.isPending ? "Käsitellään…" : "Käsittele"}
          </Button>
          <Button variant="outlineDanger" disabled={busy} onClick={() => void reject()}>
            Hylkää
          </Button>
        </div>
      </div>
    </section>
  );
}
