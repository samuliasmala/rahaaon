import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { usePostApiAdminSubmissionsIdArchiveRetry } from "../../api/admin/admin.js";
import type { QueryKey } from "@tanstack/react-query";

/**
 * Kick the page-archive retry endpoint and refresh the queries whose payload
 * carries the archive state. `force` refetches even a settled (ok/paywalled)
 * capture, discarding the stored text — the caller is expected to confirm
 * with the user first. Resolves true when the archive run was started.
 *
 * `retrying` covers the whole round-trip including the refetch — the
 * mutation's own isPending drops the moment the POST resolves, which would
 * re-enable the caller's control while the view still shows the old state.
 * The refetch runs on failure too: a 409 means the view is stale (the archive
 * already finished or is running) and the refetch is what clears it. On
 * success the row is pending again and the lists poll it onward.
 */
export function useArchiveRetry(queryKeys: readonly QueryKey[]) {
  const [retrying, setRetrying] = useState(false);
  const queryClient = useQueryClient();
  const retryMutation = usePostApiAdminSubmissionsIdArchiveRetry();

  async function retryArchive(submissionId: string, { force = false } = {}): Promise<boolean> {
    if (retrying) return false;
    setRetrying(true);
    let started = true;
    try {
      await retryMutation.mutateAsync({
        id: submissionId,
        ...(force ? { params: { force: "1" } } : {}),
      });
    } catch {
      started = false;
      toast("Arkistoinnin käynnistys epäonnistui.");
    }
    try {
      await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    } finally {
      setRetrying(false);
    }
    if (started) toast("Arkistointi käynnistetty");
    return started;
  }

  return { retrying, retryArchive };
}
