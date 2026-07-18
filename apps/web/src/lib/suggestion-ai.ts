import type { Category } from "./types.js";

/**
 * Stand-in for the backend AI ingestion pipeline. The real service will fetch
 * the article, extract the amount/entity/category and draft a summary; until it
 * exists this module fakes the same steps client-side so the suggestion flow is
 * fully walkable.
 */

export const AI_STEPS = [
  "Ladataan artikkeli…",
  "Poimitaan summa ja taho…",
  "Kategorisoidaan…",
  "Laaditaan tiivistelmä…",
] as const;

/** Milliseconds between simulated pipeline steps. */
export const AI_STEP_INTERVAL_MS = 750;

/** Loose check matching the prototype: "starts with http(s):// and has a dot". */
export function isLikelyUrl(value: string): boolean {
  return /^https?:\/\/.+\..+/.test(value.trim());
}

export interface SuggestionPreview {
  amount: number;
  title: string;
  entity: string;
  category: Category;
  sourceName: string;
  summary: string;
  aiNote: string;
  confidence: number;
}

/** Map a hostname to a publication name the way the prototype does. */
function sourceNameFromUrl(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace("www.", "");
  } catch {
    // fall through to the unknown-source label
  }
  if (host.includes("hs.fi")) return "Helsingin Sanomat";
  if (host.includes("yle")) return "Yle";
  if (host.includes("il")) return "Iltalehti";
  return host || "Tuntematon lähde";
}

/** Fixed mock extraction — every submitted link "reads" as the same story. */
export function mockExtractArticle(url: string): SuggestionPreview {
  return {
    amount: 87_000,
    title: "Kaupungintalon aulaan vuokrattiin viherseinä, jonka kasvit ovat muovia",
    entity: "Vantaa",
    category: "Muu",
    sourceName: sourceNameFromUrl(url),
    summary:
      'Kolmivuotinen vuokrasopimus sisältää "kasvillisuuden elinvoimaisuuden ylläpidon". ' +
      "Huoltokäynneillä muovikasvit pyyhitään pölystä. Sopimuksen arvo on 87 000 €.",
    aiNote: "Summa poimittu sopimuksen kokonaisarvosta. Vuosikustannus ei selviä lähteestä.",
    confidence: 88,
  };
}
