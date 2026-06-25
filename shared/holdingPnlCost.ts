import type { Holding, Transaction } from "./schema";
import { resolveInstrumentPricePerShare } from "./instrumentPrice";
import { getTickerCurrency, type QuoteCurrency } from "./tickerCurrency";

function quoteCurrencyToEurFactor(
  quoteCurrency: QuoteCurrency,
  rates: { usdToEur: number; gbpToEur: number; czkToEur: number; plnToEur: number },
): number {
  switch (quoteCurrency) {
    case "USD":
      return rates.usdToEur;
    case "GBP":
      return rates.gbpToEur;
    case "CZK":
      return rates.czkToEur;
    case "PLN":
      return rates.plnToEur;
    default:
      return 1;
  }
}

/**
 * Zostatkový náklad v mene kotácie (USD pri US akciách) — rovnaká logika ako sync holdingov,
 * ale s `instrumentPricePerShare` z XTB (otváracia cena v komentári / stĺpci kurzu).
 */
export function syncInstrumentCostBasisFromTrades(
  ticker: string,
  portfolioTransactions: Transaction[],
): { shares: number; totalInstrumentCost: number } {
  const upper = ticker.toUpperCase();
  const trades = portfolioTransactions
    .filter(
      (t) =>
        t.ticker.toUpperCase() === upper &&
        (t.type === "BUY" || t.type === "SELL"),
    )
    .sort(
      (a, b) =>
        new Date(a.transactionDate as unknown as string).getTime() -
        new Date(b.transactionDate as unknown as string).getTime(),
    );

  let shares = 0;
  let totalInstrumentCost = 0;

  for (const txn of trades) {
    const s = Math.abs(parseFloat(String(txn.shares)));
    const ip = resolveInstrumentPricePerShare(txn);
    if (!(s > 0) || !Number.isFinite(ip) || ip <= 0) continue;

    if (txn.type === "BUY") {
      totalInstrumentCost += s * ip;
      shares += s;
    } else {
      const avg = shares > 0 ? totalInstrumentCost / shares : 0;
      totalInstrumentCost = Math.max(0, totalInstrumentCost - s * avg);
      shares = Math.max(0, shares - s);
    }
  }

  return { shares, totalInstrumentCost };
}

export type HoldingPnlRates = {
  usdToEur: number;
  gbpToEur: number;
  czkToEur: number;
  plnToEur: number;
};

/**
 * Nákladová základňa pre výpočet zisku % v EUR — zladená s XTB:
 * pri US akciách na EUR účte = zostatok v USD (otváracia cena) × aktuálny kurz,
 * inak skutočne zaplatené EUR z holdingu.
 */
export function computePnlInvestedEur(
  holding: Pick<Holding, "ticker" | "shares" | "totalInvested">,
  portfolioTransactions: Transaction[],
  rates: HoldingPnlRates,
): number {
  const holdingShares = parseFloat(String(holding.shares));
  const eurPaid = parseFloat(String(holding.totalInvested));
  if (!(holdingShares > 0) || !Number.isFinite(eurPaid)) return 0;

  const quoteCurrency = getTickerCurrency(holding.ticker);
  const { shares, totalInstrumentCost } = syncInstrumentCostBasisFromTrades(
    holding.ticker,
    portfolioTransactions,
  );

  const sharesMatch = Math.abs(shares - holdingShares) <= Math.max(1e-6, holdingShares * 1e-4);
  if (sharesMatch && totalInstrumentCost > 0 && quoteCurrency !== "EUR") {
    const fx = quoteCurrencyToEurFactor(quoteCurrency, rates);
    if (fx > 0) {
      return totalInstrumentCost * fx;
    }
  }

  return eurPaid;
}
