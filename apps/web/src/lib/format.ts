/** "1 240 000 €" — space-grouped euros, Finnish locale. */
export function formatEur(amount: number): string {
  return `${amount.toLocaleString("fi-FI")} €`;
}

/** "2 041" — space-grouped count, Finnish locale. */
export function formatCount(value: number): string {
  return value.toLocaleString("fi-FI");
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

/** Best-effort whole euros from a free-text amount field ("400 000", "400000 €"). */
export function parseEuroAmount(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  return digits ? Number.parseInt(digits, 10) : 0;
}
