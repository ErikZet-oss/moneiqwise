import type { Transaction } from "./schema";
import { sumCashFlowEurFromRows } from "./cashFromTransactions";
import { buySellLineEur, inferTradeCurrency } from "./transactionEur";
import { convertAmountBetween, type AllExchangeRates } from "./convertAmountBetween";

function eurBaseFromRow(t: Pick<Transaction, "baseCurrencyAmount">): number | null {
  if (t.baseCurrencyAmount == null) return null;
  const s = String(t.baseCurrencyAmount).trim();
  if (s === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Vplyv jednej transakcie na čistú hotovosť v EUR — zladené s `computeCashLedgerBreakdownEur` / `cashBalance`.
 */
export function transactionNetCashDeltaEur(
  t: Transaction,
  fallbackEurPerUnit: number | null,
  rates: AllExchangeRates,
): number {
  if (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") {
    return sumCashFlowEurFromRows([t]);
  }
  if (t.type === "BUY" || t.type === "SELL") {
    const { eur } = buySellLineEur(t, fallbackEurPerUnit);
    if (!Number.isFinite(eur)) return 0;
    return t.type === "BUY" ? -eur : eur;
  }
  if (t.type === "DIVIDEND") {
    const eurB = eurBaseFromRow(t);
    if (eurB !== null) return eurB;
    const sh = parseFloat(t.shares);
    const p = parseFloat(t.pricePerShare);
    const tax = parseFloat(t.commission || "0");
    const ccy = inferTradeCurrency(t);
    const lineNet = sh * p - tax;
    if (!Number.isFinite(lineNet)) return 0;
    return convertAmountBetween(lineNet, ccy, "EUR", rates);
  }
  if (t.type === "TAX") {
    const eurB = eurBaseFromRow(t);
    if (eurB !== null) return eurB;
    const sh = parseFloat(t.shares);
    const p = parseFloat(t.pricePerShare);
    const ccy = inferTradeCurrency(t);
    const v = sh * p;
    if (!Number.isFinite(v)) return 0;
    return convertAmountBetween(v, ccy, "EUR", rates);
  }
  return 0;
}

function resolveFallback(
  txnId: string,
  map: Map<string, number | null> | Record<string, number | null | undefined>,
): number | null {
  if (map instanceof Map) return map.get(txnId) ?? null;
  const v = map[txnId];
  return v === undefined ? null : v;
}

/**
 * Kumulatívna čistá hotovosť v EUR k koncu dňa `asOfEndOfDay` (transakcie s časom ≤ asOf).
 */
export function sumNetCashLedgerEurUpTo(
  transactions: Transaction[],
  asOfEndOfDay: Date,
  eurPerUnitByTxnId: Map<string, number | null> | Record<string, number | null | undefined>,
  rates: AllExchangeRates,
): number {
  const limit = asOfEndOfDay.getTime();
  let sum = 0;
  for (const t of transactions) {
    const ts = new Date(t.transactionDate as unknown as string).getTime();
    if (ts > limit) continue;
    sum += transactionNetCashDeltaEur(t, resolveFallback(t.id, eurPerUnitByTxnId), rates);
  }
  return sum;
}
