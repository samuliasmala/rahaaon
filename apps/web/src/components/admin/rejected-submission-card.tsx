import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArchiveInfo } from "./archive-info.js";
import { submissionArchiveRef } from "./archive-ref.js";
import {
  getGetApiAdminSubmissionsQueryKey,
  getGetApiAdminSubmissionsRejectedQueryKey,
  usePostApiAdminSubmissionsIdRestore,
} from "../../api/admin/admin.js";
import { formatTimeAgo } from "../../lib/format.js";
import { Button } from "../ui/button.js";
import type { RejectedUrlSubmission } from "../../api/model/index.js";

/**
 * One archived link rejection: a read-only recap of the submission plus the
 * way back — restoring puts it in the Ehdotusjono for a fresh verdict.
 */
export function RejectedSubmissionCard({ entry }: { entry: RejectedUrlSubmission }) {
  const queryClient = useQueryClient();
  const restoreMutation = usePostApiAdminSubmissionsIdRestore();

  async function restore() {
    try {
      await restoreMutation.mutateAsync({ id: entry.id });
    } catch {
      toast("Palautus epäonnistui. Yritä uudelleen.");
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetApiAdminSubmissionsRejectedQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetApiAdminSubmissionsQueryKey() }),
    ]);
    toast("Linkki palautettu jonoon");
  }

  return (
    <section className="animate-in overflow-hidden rounded-[10px] border border-hairline bg-surface duration-250 fade-in slide-in-from-bottom-[10px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-wash px-4.5 py-3.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-body uppercase">
          Hylätty linkki
        </span>
        <span className="ml-auto text-xs text-muted">
          Hylätty {formatTimeAgo(entry.rejectedAt)}
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
        </div>
        <Button
          variant="outline"
          className="shrink-0 md:self-center"
          disabled={restoreMutation.isPending}
          onClick={() => void restore()}
        >
          {restoreMutation.isPending ? "Palautetaan…" : "Palauta jonoon"}
        </Button>
      </div>
    </section>
  );
}
