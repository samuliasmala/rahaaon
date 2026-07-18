import { useQueryClient } from "@tanstack/react-query";
import { getGetApiAdminItemsQueryKey } from "../api/admin/admin.js";
import { getGetApiItemsQueryKey, usePostApiItemsIdVote } from "../api/items/items.js";
import type { WasteItem } from "../api/model/index.js";

/**
 * Vote-toggle mutation that patches the new count into every cached item list
 * (public feed + admin) so the UI updates without a refetch.
 */
export function useToggleVote() {
  const queryClient = useQueryClient();
  return usePostApiItemsIdVote({
    mutation: {
      onSuccess: (result, { id }) => {
        const patch = (items: WasteItem[] | undefined) =>
          items?.map((item) =>
            item.id === id ? { ...item, votes: result.votes, voted: result.voted } : item,
          );
        queryClient.setQueryData<WasteItem[]>(getGetApiItemsQueryKey(), patch);
        queryClient.setQueryData<WasteItem[]>(getGetApiAdminItemsQueryKey(), patch);
      },
    },
  });
}
