import type { Holding, Transaction } from "./schema";

export type HoldingPnlRates = {
  usdToEur: number;
  gbpToEur: number;
  czkToEur: number;
  plnToEur: number;
};

/**
 * Nákladová základňa pre výpočet zisku % v EUR — ako XTB „Čistý zisk %“:
 * skutočne zaplatené EUR z peňaženky (totalInvested), nie USD open × aktuálny FX.
 */
export function computePnlInvestedEur(
  holding: Pick<Holding, "ticker" | "shares" | "totalInvested">,
  _portfolioTransactions: Transaction[],
  _rates: HoldingPnlRates,
): number {
  const holdingShares = parseFloat(String(holding.shares));
  const eurPaid = parseFloat(String(holding.totalInvested));
  if (!(holdingShares > 0) || !Number.isFinite(eurPaid) || eurPaid <= 0) return 0;
  return eurPaid;
}
