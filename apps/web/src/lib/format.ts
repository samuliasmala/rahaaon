import type { AmountType } from "../api/model/index.js";

/** "1 240 000 €" — space-grouped euros, Finnish locale. */
export function formatEur(amount: number): string {
  return `${amount.toLocaleString("fi-FI")} €`;
}

/** The amount fields shared by feed items and suggestions. */
export interface AmountFields {
  amountEur: number;
  amountType: AmountType;
  amountMaxEur: number | null;
}

/** "1 240 000 €" / "n. 40 000 €" / "yli 40 000 €" / "100 000–200 000 €" / "Ei tiedossa". */
export function formatAmount(item: AmountFields): string {
  // 0 means "no amount stated" throughout the app — never render "0 €".
  if (item.amountType === "unknown" || item.amountEur === 0) return "Ei tiedossa";
  // A malformed upper bound (≤ the lower one) is ignored rather than rendered.
  if (item.amountMaxEur !== null && item.amountMaxEur > item.amountEur) {
    const range = `${item.amountEur.toLocaleString("fi-FI")}–${formatEur(item.amountMaxEur)}`;
    return item.amountType === "approx" ? `n. ${range}` : range;
  }
  if (item.amountType === "approx") return `n. ${formatEur(item.amountEur)}`;
  if (item.amountType === "min") return `yli ${formatEur(item.amountEur)}`;
  return formatEur(item.amountEur);
}

/** "2 041" — space-grouped count, Finnish locale. */
export function formatCount(value: number): string {
  return value.toLocaleString("fi-FI");
}

/** Whole days elapsed since an ISO timestamp (never negative). */
export function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Feed row age: "juuri nyt" / "3 pv sitten" / "2 vk sitten". */
export function formatAge(days: number): string {
  if (days === 0) return "juuri nyt";
  if (days < 7) return `${days} pv sitten`;
  return `${Math.round(days / 7)} vk sitten`;
}

/** "4.11.2025" — a YYYY-MM-DD date in Finnish style. String-parsed so no timezone can shift the day. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d}.${m}.${y}`;
}

/** Compact age for the admin table: "juuri nyt" / "3 pv". */
export function formatAgeShort(days: number): string {
  return days === 0 ? "juuri nyt" : `${days} pv`;
}

/** Queue arrival time: "juuri nyt" / "5 h sitten" / "2 pv sitten". */
export function formatTimeAgo(iso: string): string {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "juuri nyt";
  if (hours < 24) return `${hours} h sitten`;
  return `${Math.floor(hours / 24)} pv sitten`;
}

/**
 * Best-effort whole euros from a free-text amount field ("400 000", "400000 €").
 * A pasted range ("100 000–200 000") yields its first figure, not the digits
 * concatenated — the upper bound has its own field.
 */
export function parseEuroAmount(raw: string): number {
  const digits = (raw.split(/[-–—]/, 1)[0] ?? "").replace(/\D/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}
