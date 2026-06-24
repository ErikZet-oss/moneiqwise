import type { Holding, Transaction } from "./schema";
import { inferTradeCurrency, type TradeCurrency } from "./transactionEur";
import { getTickerCostCurrency } from "./tickerCurrency";
import { computePnlInvestedEur, type HoldingPnlRates } from "./holdingPnlCost";

/**
 * Mena, v ktorej sú uložené `averageCost` / `totalInvested` v holdingu
 * (z BUY transakcií — napr. EUR pri XTB EUR účte, nie USD podľa tickera).
 */
export function inferHoldingCostCurrency(
  ticker: string,
  portfolioTransactions: Transaction[],
): TradeCurrency {
  const upper = ticker.toUpperCase();
  const trades = portfolioTransactions.filter(
    (t) =>
      t.ticker.toUpperCase() === upper &&
      (t.type === "BUY" || t.type === "SELL"),
  );

  if (trades.length === 0) {
    return getTickerCostCurrency(ticker);
  }

  const buys = trades.filter((t) => t.type === "BUY");
  const weighted = buys.length > 0 ? buys : trades;

  const byCurrency = new Map<TradeCurrency, number>();
  for (const t of weighted) {
    const c = inferTradeCurrency(t);
    const sh = Math.abs(parseFloat(String(t.shares)));
    if (!Number.isFinite(sh) || sh <= 0) continue;
    byCurrency.set(c, (byCurrency.get(c) ?? 0) + sh);
  }

  if (byCurrency.size === 0) {
    return inferTradeCurrency(trades[0]!);
  }

  let best: TradeCurrency = getTickerCostCurrency(ticker);
  let bestWeight = -1;
  for (const [currency, weight] of Array.from(byCurrency.entries())) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = currency;
    }
  }
  return best;
}

export type HoldingWithCostCurrency = Holding & {
  costCurrency?: TradeCurrency;
  /** Náklad v EUR pre výpočet zisku % (XTB: USD otváracia × aktuálny kurz). */
  pnlInvestedEur?: number;
};

export function enrichHoldingsWithCostCurrency(
  holdings: Holding[],
  allTransactions: Transaction[],
  rates?: HoldingPnlRates,
): HoldingWithCostCurrency[] {
  return holdings.map((h) => {
    const pid = h.portfolioId;
    const relevant =
      pid == null
        ? allTransactions
        : allTransactions.filter((t) => t.portfolioId === pid || t.portfolioId == null);
    return {
      ...h,
      costCurrency: inferHoldingCostCurrency(h.ticker, relevant),
      ...(rates
        ? { pnlInvestedEur: computePnlInvestedEur(h, relevant, rates) }
        : {}),
    };
  });
}
