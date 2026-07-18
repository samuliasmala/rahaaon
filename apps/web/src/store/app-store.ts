import { create } from "zustand";
import { seedItems, seedQueue } from "../data/seed.js";
import { parseEuroAmount } from "../lib/format.js";
import type { SuggestionPreview } from "../lib/suggestion-ai.js";
import type { QueueItem, WasteItem } from "../lib/types.js";

/** Queue fields the editor can change before publishing. */
type QueueEdit = Partial<Pick<QueueItem, "title" | "summary" | "amount" | "entity" | "category">>;

/**
 * All feed + editorial data lives here, seeded with demo content. This is the
 * single integration point for the future backend: swap the actions for API
 * calls and the components stay untouched.
 */
interface AppState {
  items: WasteItem[];
  queue: QueueItem[];
  /** Item ids the visitor has upvoted this session — toggling again removes the vote. */
  voted: Record<number, boolean>;
  toggleVote: (id: number) => void;
  toggleHidden: (id: number) => void;
  updateQueueItem: (id: number, patch: QueueEdit) => void;
  /** Move a queue entry to the top of the public feed. */
  approveQueueItem: (id: number) => void;
  rejectQueueItem: (id: number) => void;
  /** Reader confirmed the AI preview — push the suggestion into the review queue. */
  submitSuggestion: (url: string, preview: SuggestionPreview) => void;
}

export const useAppStore = create<AppState>((set) => ({
  items: seedItems,
  queue: seedQueue,
  voted: {},

  toggleVote: (id) =>
    set((state) => {
      const hasVoted = Boolean(state.voted[id]);
      return {
        voted: { ...state.voted, [id]: !hasVoted },
        items: state.items.map((item) =>
          item.id === id ? { ...item, votes: item.votes + (hasVoted ? -1 : 1) } : item,
        ),
      };
    }),

  toggleHidden: (id) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, hidden: !item.hidden } : item)),
    })),

  updateQueueItem: (id, patch) =>
    set((state) => ({
      queue: state.queue.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    })),

  approveQueueItem: (id) =>
    set((state) => {
      const entry = state.queue.find((q) => q.id === id);
      if (!entry) return {};
      const published: WasteItem = {
        id: Date.now(),
        title: entry.title,
        amount: parseEuroAmount(entry.amount),
        entity: entry.entity,
        category: entry.category,
        source: entry.sourceName,
        url: entry.url,
        days: 0,
        votes: 0,
        hidden: false,
        summary: entry.summary,
        quote: `Lähde: ${entry.sourceName}.`,
      };
      return {
        queue: state.queue.filter((q) => q.id !== id),
        items: [published, ...state.items],
      };
    }),

  rejectQueueItem: (id) => set((state) => ({ queue: state.queue.filter((q) => q.id !== id) })),

  submitSuggestion: (url, preview) =>
    set((state) => ({
      queue: [
        {
          id: Date.now(),
          title: preview.title,
          amount: String(preview.amount),
          entity: preview.entity,
          category: preview.category,
          sourceName: preview.sourceName,
          url,
          confidence: preview.confidence,
          received: "juuri nyt",
          summary: preview.summary,
          aiNote: preview.aiNote,
        },
        ...state.queue,
      ],
    })),
}));
