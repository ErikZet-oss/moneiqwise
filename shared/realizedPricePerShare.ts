import type { Transaction } from "./schema";
import type { OpenFifoLot } from "./fifoRealizedGains";
import { resolveInstrumentPricePerShare } from "./instrumentPrice";
import type { RealizedTickerRow } from "./realizedGainsTypes";
import { getTickerCurrency, type QuoteCurrency } from "./tickerCurrency";

/** Nákupná cena/ks v mene inštrumentu (FIFO lot). */
export function fifoLotCostPerShareLocal(lot: OpenFifoLot): number {
  if (lot.eurPerUnit > 1e-12) {
    return lot.costPerShareEur / lot.eurPerUnit;
  }
  if (lot.priceLocal > 0) return lot.priceLocal;
  return 0;
}

/** Predajná cena/ks v mene inštrumentu — rovnaká logika ako História / `instrumentPrice`. */
export function sellInstrumentPricePerShare(
  txn: Pick<
    Transaction,
    | "instrumentPricePerShare"
    | "pricePerShare"
    | "shares"
    | "ticker"
    | "originalCurrency"
    | "currency"
    | "exchangeRateAtTransaction"
  >,
  eurPerUnit: number | null,
): number {
  const instrumentPx = resolveInstrumentPricePerShare(txn);
  if (instrumentPx > 0) return instrumentPx;
  const tradePx = parseFloat(String(txn.pricePerShare ?? "0"));
  if (Number.isFinite(tradePx) && Math.abs(tradePx) > 0) {
    return Math.abs(tradePx);
  }
  const sh = Math.abs(parseFloat(String(txn.shares ?? "0")));
  if (sh > 1e-12 && eurPerUnit != null && eurPerUnit > 1e-12) {
    const lineLocal = Math.abs(tradePx) * sh;
    if (lineLocal > 1e-12) return lineLocal / sh;
  }
  return 0;
}

export function quoteCurrencyForTicker(ticker: string): QuoteCurrency {
  return getTickerCurrency(ticker);
}

export type RealizedTickerAgg = {
  ticker: string;
  companyName: string;
  totalGain: number;
  totalCost: number;
  totalSold: number;
  transactions: number;
  totalSharesSold: number;
  priceCurrency: QuoteCurrency;
  weightedBuyLocal: number;
  weightedSellLocal: number;
};

export function emptyRealizedTickerAgg(ticker: string, companyName: string): RealizedTickerAgg {
  return {
    ticker,
    companyName,
    totalGain: 0,
    totalCost: 0,
    totalSold: 0,
    transactions: 0,
    totalSharesSold: 0,
    priceCurrency: quoteCurrencyForTicker(ticker),
    weightedBuyLocal: 0,
    weightedSellLocal: 0,
  };
}

export function finalizeRealizedTickerAgg(row: RealizedTickerAgg): RealizedTickerRow {
  const sh = row.totalSharesSold;
  return {
    ticker: row.ticker,
    companyName: row.companyName,
    totalGain: row.totalGain,
    totalCost: row.totalCost,
    totalSold: row.totalSold,
    transactions: row.transactions,
    totalSharesSold: sh,
    avgBuyPricePerShare: sh > 1e-12 ? row.weightedBuyLocal / sh : 0,
    avgSellPricePerShare: sh > 1e-12 ? row.weightedSellLocal / sh : 0,
    priceCurrency: row.priceCurrency,
  };
}
