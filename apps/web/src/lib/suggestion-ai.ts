/**
 * Client-side bits of the suggestion flow. The extraction itself runs on the
 * API (POST /api/suggestions/preview); this module only carries the step
 * animation shown while it runs and the pre-submit URL check.
 */

export const AI_STEPS = [
  "Ladataan artikkeli…",
  "Poimitaan summa ja taho…",
  "Kategorisoidaan…",
  "Laaditaan tiivistelmä…",
] as const;

/** Milliseconds between animated pipeline steps. */
export const AI_STEP_INTERVAL_MS = 750;

/** Loose check matching the prototype: "starts with http(s):// and has a dot". */
export function isLikelyUrl(value: string): boolean {
  return /^https?:\/\/.+\..+/.test(value.trim());
}
