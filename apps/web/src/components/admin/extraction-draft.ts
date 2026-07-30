import { parseEuroAmount } from "../../lib/format.js";
import type { AmountType, Category, PatchSuggestion } from "../../api/model/index.js";

/** Local editing state for the extraction fields; amounts kept as raw input strings. */
export interface ExtractionDraft {
  title: string;
  summary: string;
  quote: string;
  amount: string;
  amountMax: string;
  amountType: AmountType;
  entity: string;
  category: Category;
  articlePublishedAt: string;
  /** Comma-separated in the editor; split back into a list at the patch boundary. */
  keywords: string;
}

/**
 * The editable fields suggestions and published items share. Derived from the
 * generated client so a regeneration that renames a field fails to compile
 * here and at the PatchItem call site, instead of being silently stripped.
 */
export type ExtractionPatch = Required<PatchSuggestion>;

export function toExtractionDraft(source: ExtractionPatch): ExtractionDraft {
  return {
    title: source.title,
    summary: source.summary,
    quote: source.quote,
    amount: String(source.amountEur),
    amountMax: source.amountMaxEur === null ? "" : String(source.amountMaxEur),
    amountType: source.amountType,
    entity: source.entity,
    category: source.category,
    articlePublishedAt: source.articlePublishedAt ?? "",
    keywords: source.keywords.join(", "),
  };
}

/**
 * Comma-separated editor input → keyword list, mirroring the server's caps
 * (10 keywords of 60 chars, no dupes) so a patch can't fail validation.
 */
function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of input.split(",")) {
    const keyword = part.trim().slice(0, 60).trim();
    if (!keyword || seen.has(keyword.toLowerCase())) continue;
    seen.add(keyword.toLowerCase());
    keywords.push(keyword);
    if (keywords.length >= 10) break;
  }
  return keywords;
}

export function toExtractionPatch(draft: ExtractionDraft): ExtractionPatch {
  // Mirror the server's normalisation: no figure ⟺ "Ei tiedossa", and an
  // upper bound only above the lower one.
  const figure = draft.amountType === "unknown" ? 0 : parseEuroAmount(draft.amount);
  const amountType = figure === 0 ? "unknown" : draft.amountType;
  const amountMax = draft.amountMax.trim() ? parseEuroAmount(draft.amountMax) : null;
  return {
    title: draft.title,
    summary: draft.summary,
    quote: draft.quote.trim(),
    amountEur: figure,
    amountType,
    amountMaxEur:
      amountType !== "unknown" && amountMax !== null && amountMax > figure ? amountMax : null,
    entity: draft.entity,
    category: draft.category,
    articlePublishedAt: draft.articlePublishedAt || null,
    keywords: parseKeywords(draft.keywords),
  };
}

/** Field-by-field equality, for "are there unsaved edits?" checks. */
export function draftsEqual(a: ExtractionDraft, b: ExtractionDraft): boolean {
  return (Object.keys(a) as (keyof ExtractionDraft)[]).every((key) => a[key] === b[key]);
}

/**
 * Sync a draft's normalised fields to what actually got saved, so a
 * normalised-away value (an upper bound below the amount, an over-cap
 * keyword) can't linger in the editor.
 */
export function syncDraftToPatch(draft: ExtractionDraft, patch: ExtractionPatch): ExtractionDraft {
  return {
    ...draft,
    amount: String(patch.amountEur),
    amountType: patch.amountType,
    amountMax: patch.amountMaxEur === null ? "" : String(patch.amountMaxEur),
    keywords: patch.keywords.join(", "),
  };
}
