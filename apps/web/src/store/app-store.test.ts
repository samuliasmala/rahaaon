import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store.js";
import { seedItems, seedQueue } from "../data/seed.js";

beforeEach(() => {
  useAppStore.setState({ items: seedItems, queue: seedQueue, voted: {} });
});

describe("toggleVote", () => {
  it("adds a vote, then removes it on the second toggle", () => {
    const before = useAppStore.getState().items.find((i) => i.id === 1)?.votes ?? 0;

    useAppStore.getState().toggleVote(1);
    expect(useAppStore.getState().items.find((i) => i.id === 1)?.votes).toBe(before + 1);
    expect(useAppStore.getState().voted[1]).toBe(true);

    useAppStore.getState().toggleVote(1);
    expect(useAppStore.getState().items.find((i) => i.id === 1)?.votes).toBe(before);
    expect(useAppStore.getState().voted[1]).toBe(false);
  });
});

describe("toggleHidden", () => {
  it("hides and restores an item", () => {
    useAppStore.getState().toggleHidden(2);
    expect(useAppStore.getState().items.find((i) => i.id === 2)?.hidden).toBe(true);
    useAppStore.getState().toggleHidden(2);
    expect(useAppStore.getState().items.find((i) => i.id === 2)?.hidden).toBe(false);
  });
});

describe("updateQueueItem", () => {
  it("patches editable fields", () => {
    useAppStore.getState().updateQueueItem(101, { title: "Uusi otsikko", amount: "123 000" });
    const entry = useAppStore.getState().queue.find((q) => q.id === 101);
    expect(entry?.title).toBe("Uusi otsikko");
    expect(entry?.amount).toBe("123 000");
  });
});

describe("approveQueueItem", () => {
  it("moves the entry to the top of the feed with a parsed amount", () => {
    const itemCount = useAppStore.getState().items.length;

    useAppStore.getState().approveQueueItem(101);

    const { items, queue } = useAppStore.getState();
    expect(queue.find((q) => q.id === 101)).toBeUndefined();
    expect(items).toHaveLength(itemCount + 1);
    const published = items[0];
    expect(published?.title).toBe("Kaupunki tilasi 400 000 € sovelluksen, jolla on 23 latausta");
    expect(published?.amount).toBe(400_000);
    expect(published?.source).toBe("Länsiväylä");
    expect(published?.days).toBe(0);
    expect(published?.votes).toBe(0);
  });
});

describe("rejectQueueItem", () => {
  it("drops the entry without touching the feed", () => {
    const itemCount = useAppStore.getState().items.length;
    useAppStore.getState().rejectQueueItem(102);
    expect(useAppStore.getState().queue.find((q) => q.id === 102)).toBeUndefined();
    expect(useAppStore.getState().items).toHaveLength(itemCount);
  });
});

describe("submitSuggestion", () => {
  it("prepends a queue entry built from the AI preview", () => {
    useAppStore.getState().submitSuggestion("https://yle.fi/a/juttu", {
      amount: 87_000,
      title: "Testiehdotus",
      entity: "Vantaa",
      category: "Muu",
      sourceName: "Yle",
      summary: "Tiivistelmä.",
      aiNote: "Huomio.",
      confidence: 88,
    });

    const entry = useAppStore.getState().queue[0];
    expect(entry?.title).toBe("Testiehdotus");
    expect(entry?.amount).toBe("87000");
    expect(entry?.url).toBe("https://yle.fi/a/juttu");
    expect(entry?.received).toBe("juuri nyt");
  });
});
