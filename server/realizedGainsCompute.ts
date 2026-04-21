import type { Transaction } from "@shared/schema";

export interface RealizedTickerRow {
  ticker: string;
  companyName: string;
  totalGain: number;
  totalSold: number;
  transactions: number;
}

export interface RealizedGainsComputedSummary {
  totalRealized: number;
  realizedYTD: number;
  realizedThisMonth: number;
  realizedToday: number;
  byTicker: RealizedTickerRow[];
  transactionCount: number;
}

/** Jednoznačný kľúč pozície (portfólio + ticker), aj pri „všetky portfóliá“. */
export function transactionLotKey(txn: {
  portfolioId: string | null;
  ticker: string;
}): string {
  const pid = txn.portfolioId ?? "__none__";
  return `${pid}::${txn.ticker}`;
}

/**
 * Priemerovaný náklad; rovnaká logika ako POST /api/realized-gains/recalculate.
 * Nepotrebuje vyplnené pole realizedGain v DB (XTB import ho má často na 0).
 * Pri zlúčení transakcií z viacerých portfólií drží pozície oddelene (portfolioId + ticker).
 */
export function computeRealizedGainsFromTransactions(
  userTransactions: Transaction[],
  now = new Date(),
): RealizedGainsComputedSummary {
  const sorted = [...userTransactions].sort(
    (a, b) =>
      new Date(a.transactionDate as unknown as string).getTime() -
      new Date(b.transactionDate as unknown as string).getTime(),
  );

  const holdingsState: Record<
    string,
    { shares: number; avgCost: number; totalCost: number }
  > = {};

  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let totalRealized = 0;
  let realizedYTD = 0;
  let realizedThisMonth = 0;
  let realizedToday = 0;

  const byTicker: Record<string, RealizedTickerRow> = {};
  let transactionCount = 0;

  for (const txn of sorted) {
    const shares = parseFloat(txn.shares as unknown as string);
    const price = parseFloat(txn.pricePerShare as unknown as string);
    const commission = parseFloat(txn.commission || "0");

    const key = transactionLotKey(txn);

    if (txn.type === "BUY") {
      if (!holdingsState[key]) {
        holdingsState[key] = { shares: 0, avgCost: 0, totalCost: 0 };
      }
      const h = holdingsState[key];
      const totalCostBuy = shares * price + commission;
      const newShares = h.shares + shares;
      h.totalCost += totalCostBuy;
      h.avgCost = newShares > 0 ? h.totalCost / newShares : 0;
      h.shares = newShares;
    } else if (txn.type === "SELL") {
      transactionCount++;
      const sellValue = shares * price;

      let gain = 0;
      const h = holdingsState[key];
      if (h && h.shares > 0) {
        const costBasis = h.avgCost;
        gain = (price - costBasis) * shares - commission;

        const soldCost = shares * h.avgCost;
        h.shares = Math.max(0, h.shares - shares);
        h.totalCost = Math.max(0, h.totalCost - soldCost);
      }

      totalRealized += gain;

      const txnDate = new Date(txn.transactionDate as unknown as string);
      if (txnDate >= startOfYear) realizedYTD += gain;
      if (txnDate >= startOfMonth) realizedThisMonth += gain;
      if (txnDate >= todayStart) realizedToday += gain;

      const aggTicker = txn.ticker;
      if (!byTicker[aggTicker]) {
        byTicker[aggTicker] = {
          ticker: txn.ticker,
          companyName: txn.companyName,
          totalGain: 0,
          totalSold: 0,
          transactions: 0,
        };
      }
      byTicker[aggTicker].totalGain += gain;
      byTicker[aggTicker].totalSold += sellValue;
      byTicker[aggTicker].transactions += 1;
    }
  }

  const tickerSummary = Object.values(byTicker).sort(
    (a, b) => b.totalGain - a.totalGain,
  );

  return {
    totalRealized,
    realizedYTD,
    realizedThisMonth,
    realizedToday,
    byTicker: tickerSummary,
    transactionCount,
  };
}
