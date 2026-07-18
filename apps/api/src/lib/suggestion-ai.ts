import type { Category } from "../db/schema/content.js";

/**
 * Stand-in for the real AI ingestion pipeline. The real service will fetch the
 * article, extract the amount/entity/category and draft a summary with an LLM;
 * until it exists this module fakes the result so the suggestion flow works
 * end-to-end. Swap `extractArticle` for the real implementation later — the
 * routes and the web app won't change.
 */

export interface ArticleExtraction {
  title: string;
  amountEur: number;
  entity: string;
  category: Category;
  sourceName: string;
  summary: string;
  aiNote: string;
  /** Extraction confidence, 0–100. */
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
export function extractArticle(url: string): ArticleExtraction {
  return {
    title: "Kaupungintalon aulaan vuokrattiin viherseinä, jonka kasvit ovat muovia",
    amountEur: 87_000,
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
