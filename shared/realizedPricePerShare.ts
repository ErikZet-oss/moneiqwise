import type { Transaction } from "./schema";
import type { OpenFifoLot } from "./fifoRealizedGains";
import { resolveInstrumentPricePerShare } from "./instrumentPrice";
import type { RealizedTickerRow } from "./realizedGainsTypes";
import { getTickerCurrency, type QuoteCurrency } from "./tickerCurrency";
import { grossAndCommission, inferTradeCurrency } from "./transactionEur";

/** Cena/ks ako stĺpec v Histórii (pricePerShare → riadok → base → instrument). */
export function historyLinePricePerShare(
  txn: Pick<
    Transaction,
    | "type"
    | "shares"
    | "pricePerShare"
    | "commission"
    | "baseCurrencyAmount"
    | "instrumentPricePerShare"
    | "ticker"
    | "originalCurrency"
    | "currency"
    | "exchangeRateAtTransaction"
  >,
  opts?: { lineEur?: number; eurPerUnit?: number | null },
): number {
  const instrumentPx = resolveInstrumentPricePerShare(txn);
  if (instrumentPx > 0) return instrumentPx;

  const quoteCcy = getTickerCurrency(txn.ticker);
  const accountCcy = inferTradeCurrency(txn);
  const leg = txn.currency?.trim().toUpperCase();
  const accountLine =
    leg === "EUR" || leg === "USD" || leg === "GBP" || leg === "CZK" || leg === "PLN" || leg === "HKD"
      ? leg
      : accountCcy;
  const px = parseFloat(String(txn.pricePerShare ?? "0"));
  if (quoteCcy === accountLine && Number.isFinite(px) && Math.abs(px) > 1e-12) {
    return Math.abs(px);
  }

  const sh = Math.abs(parseFloat(String(txn.shares ?? "0")));
  if (!(sh > 1e-12)) return 0;

  const { gross, commission } = grossAndCommission(txn);
  const kind = String(txn.type ?? "")
    .trim()
    .toUpperCase();
  const lineLocal =
    kind === "BUY" ? gross + commission : kind === "SELL" ? gross - commission : gross;
  if (Math.abs(lineLocal) > 1e-12 && quoteCcy === accountLine) {
    return Math.abs(lineLocal / sh);
  }

  const base = parseFloat(String(txn.baseCurrencyAmount ?? "NaN"));
  if (
    Number.isFinite(base) &&
    Math.abs(base) > 1e-12 &&
    quoteCcy === accountLine &&
    accountLine === "EUR"
  ) {
    return Math.abs(base) / sh;
  }

  const lineEur = opts?.lineEur;
  if (lineEur != null && Number.isFinite(lineEur) && Math.abs(lineEur) > 1e-12) {
    const epu = opts?.eurPerUnit;
    if (epu != null && epu > 1e-12 && quoteCcy !== "EUR") {
      return Math.abs(lineEur) / epu / sh;
    }
    if (quoteCcy === accountLine && accountLine === "EUR") {
      return Math.abs(lineEur) / sh;
    }
  }

  return 0;
}

/** Nákupná cena/ks v mene inštrumentu (FIFO lot). */
export function fifoLotCostPerShareLocal(lot: OpenFifoLot): number {
  if (lot.eurPerUnit > 1e-12) {
    const fromFx = lot.costPerShareEur / lot.eurPerUnit;
    if (Number.isFinite(fromFx) && fromFx > 1e-12) return fromFx;
  }
  if (lot.priceLocal > 1e-12) return lot.priceLocal;
  if (lot.costPerShareEur > 1e-12 && lot.ccy === "EUR") {
    return lot.costPerShareEur;
  }
  return 0;
}

/** Predajná cena/ks v mene inštrumentu — rovnaká logika ako História / `instrumentPrice`. */
export function sellInstrumentPricePerShare(
  txn: Pick<
    Transaction,
    | "type"
    | "instrumentPricePerShare"
    | "pricePerShare"
    | "shares"
    | "commission"
    | "baseCurrencyAmount"
    | "ticker"
    | "originalCurrency"
    | "currency"
    | "exchangeRateAtTransaction"
  >,
  eurPerUnit: number | null,
  lineEur?: number,
): number {
  const fromHistory = historyLinePricePerShare(txn, { lineEur, eurPerUnit });
  if (fromHistory > 0) return fromHistory;
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

export function emptyRealizedTickerAgg(
  ticker: string,
  companyName: string,
  priceCurrency?: QuoteCurrency,
): RealizedTickerAgg {
  return {
    ticker,
    companyName,
    totalGain: 0,
    totalCost: 0,
    totalSold: 0,
    transactions: 0,
    totalSharesSold: 0,
    priceCurrency: priceCurrency ?? quoteCurrencyForTicker(ticker),
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
