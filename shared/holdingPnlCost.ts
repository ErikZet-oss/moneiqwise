import type { Holding, Transaction } from "./schema";
import { computeFifoRealizedGainsFromTransactions } from "./fifoRealizedGains";

export type HoldingPnlRates = {
  usdToEur: number;
  gbpToEur: number;
  czkToEur: number;
  plnToEur: number;
};

/**
 * Nákladová základňa pre zisk % (ako XTB „Čistý zisk %“):
 * súčet FIFO nákladov otvorených lotov v EUR (rovnaké ako rozbalené nákupy).
 * Záloha: `totalInvested` z holdingu.
 */
export function computePnlInvestedEur(
  holding: Pick<Holding, "ticker" | "shares" | "totalInvested" | "portfolioId">,
  portfolioTransactions: Transaction[],
  _rates: HoldingPnlRates,
): number {
  const holdingShares = parseFloat(String(holding.shares));
  const eurPaid = parseFloat(String(holding.totalInvested));
  if (!(holdingShares > 0)) return 0;

  const eurM = new Map<string, number | null>();
  for (const t of portfolioTransactions) eurM.set(t.id, null);

  const { openLots } = computeFifoRealizedGainsFromTransactions(
    portfolioTransactions,
    eurM,
  );
  const upper = String(holding.ticker ?? "")
    .trim()
    .toUpperCase();
  const pid = holding.portfolioId ?? "__none__";

  let fifoBook = 0;
  let fifoShares = 0;
  for (const [key, lots] of Object.entries(openLots)) {
    // Pri konkrétnom portfóliu len jeho loty; pri agregácii (portfolioId null) všetky.
    if (holding.portfolioId != null) {
      if (key !== `${pid}::${upper}`) continue;
    } else if (!key.endsWith(`::${upper}`)) {
      continue;
    }
    for (const lot of lots) {
      if (lot.remainingShares <= 1e-8) continue;
      fifoBook += lot.remainingShares * lot.costPerShareEur;
      fifoShares += lot.remainingShares;
    }
  }

  if (fifoShares > 1e-8) {
    const sharesMatch =
      Math.abs(fifoShares - holdingShares) <= Math.max(1e-4, holdingShares * 1e-2);
    if (sharesMatch && fifoBook > 0) return fifoBook;
  }

  if (Number.isFinite(eurPaid) && eurPaid > 0) return eurPaid;
  return fifoBook > 0 ? fifoBook : 0;
}
