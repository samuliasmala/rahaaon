import { useQueryClient } from "@tanstack/react-query";
import { getGetApiAdminItemsQueryKey } from "../api/admin/admin.js";
import { getGetApiItemsQueryKey, usePostApiItemsIdVote } from "../api/items/items.js";
import type { AdminWasteItem, WasteItem } from "../api/model/index.js";

/**
 * Vote-toggle mutation that patches the new count into every cached item list
 * (public feed + admin) so the UI updates without a refetch. The patch is
 * generic so the admin list's extra fields (archive ref) survive typed.
 */
export function useToggleVote() {
  const queryClient = useQueryClient();
  return usePostApiItemsIdVote({
    mutation: {
      onSuccess: (result, { id }) => {
        const patch = <T extends WasteItem>(items: T[] | undefined) =>
          items?.map((item) =>
            item.id === id ? { ...item, votes: result.votes, voted: result.voted } : item,
          );
        queryClient.setQueryData<WasteItem[]>(getGetApiItemsQueryKey(), patch);
        queryClient.setQueryData<AdminWasteItem[]>(getGetApiAdminItemsQueryKey(), patch);
      },
    },
  });
}
