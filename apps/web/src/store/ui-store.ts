import { create } from "zustand";

/**
 * Client-side UI state. The suggestion dialog is opened from the header but
 * rendered at the root layout, so its visibility lives here rather than in
 * either component.
 */
interface UiState {
  suggestOpen: boolean;
  openSuggest: () => void;
  closeSuggest: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  suggestOpen: false,
  openSuggest: () => set({ suggestOpen: true }),
  closeSuggest: () => set({ suggestOpen: false }),
}));
