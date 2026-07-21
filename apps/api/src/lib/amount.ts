import type { AmountType } from "../db/schema/content.js";

export interface AmountState {
  amountEur: number;
  amountType: AmountType;
  amountMaxEur: number | null;
}

/**
 * Keep the amount, its qualifier and the range mutually consistent on every
 * write path (AI extraction and editorial edits alike): 'unknown' never
 * carries a figure, a figure of 0 always means 'unknown', and an upper bound
 * only exists above the lower one.
 */
export function normalizeAmount(state: AmountState): AmountState {
  let { amountEur, amountType, amountMaxEur } = state;
  if (amountType === "unknown") amountEur = 0;
  else if (amountEur === 0) amountType = "unknown";
  if (amountMaxEur !== null && (amountType === "unknown" || amountMaxEur <= amountEur)) {
    amountMaxEur = null;
  }
  return { amountEur, amountType, amountMaxEur };
}
