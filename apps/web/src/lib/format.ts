/** "1 240 000 €" — space-grouped euros, Finnish locale. */
export function formatEur(amount: number): string {
  return `${amount.toLocaleString("fi-FI")} €`;
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

/** Best-effort whole euros from a free-text amount field ("400 000", "400000 €"). */
export function parseEuroAmount(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}
