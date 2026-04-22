import type { Transaction } from "./schema";
import { getTickerCurrency } from "./tickerCurrency";
import { sumCashFlowEurFromRows } from "./cashFromTransactions";

export type TradeCurrency = "EUR" | "USD" | "GBP" | "CZK" | "PLN";

/**
 * Mena, v ktorej sú `shares` a `pricePerShare` zadané pre akciový obchod.
 */
export function inferTradeCurrency(t: Pick<Transaction, "ticker" | "originalCurrency" | "currency">): TradeCurrency {
  const oc = t.originalCurrency?.toUpperCase().trim();
  if (oc === "EUR" || oc === "USD" || oc === "GBP" || oc === "CZK" || oc === "PLN") {
    return oc;
  }
  const leg = t.currency?.toUpperCase().trim();
  if (leg === "EUR" || leg === "USD" || leg === "GBP" || leg === "CZK" || leg === "PLN") {
    return leg;
  }
  return getTickerCurrency(t.ticker);
}

/**
 * Pre DEPOSIT/WITHDRAWAL: EUR súčet (už v cashFromTransactions).
 */
export function cashLineEur(t: Pick<Transaction, "type" | "ticker" | "shares" | "pricePerShare" | "baseCurrencyAmount">): number {
  return sumCashFlowEurFromRows([t]);
}

/**
 * Súmova cena (bez poplatku) v lokálnej mene, poplatok v `commission` v rovnakých jednotkách.
 */
export function grossAndCommission(
  t: Pick<Transaction, "shares" | "pricePerShare" | "commission">,
): { gross: number; commission: number } {
  const sh = parseFloat(String(t.shares));
  const px = parseFloat(String(t.pricePerShare));
  const comm = parseFloat(String(t.commission || "0"));
  return {
    gross: sh * px,
    commission: Number.isFinite(comm) ? comm : 0,
  };
}

/**
 * Suma riadka BUY/SELL v EUR, ak je v transakcii:
 * - `baseCurrencyAmount` (v EUR) — preferované, presné podľa dňa;
 * - inak `(gross ± comm) * eurPerOneUnit` kde `eurPerOneUnit` = `exchangeRateAtTransaction` = EUR za 1 jednotku pôvodnej meny (schéma);
 * - inak `fallbackEur` musí dodať poskytovateľ (napr. Frankfurter v deň D).
 *
 * SELL: očakáva sa netto alebo bruto v baseCurrencyAmount; ak počítame z cien, `gross - comm` = výnos.
 */
export function buySellLineEur(
  t: Pick<
    Transaction,
    | "type"
    | "ticker"
    | "shares"
    | "pricePerShare"
    | "commission"
    | "baseCurrencyAmount"
    | "exchangeRateAtTransaction"
    | "originalCurrency"
    | "currency"
  >,
  /** EUR za 1 jednotku `inferTradeCurrency(t)` — z Frankfurteru ak chýba rate v DB */
  fallbackEurPerUnit: number | null,
): { eur: number; source: "base" | "storedRate" | "frankfurtFallback" } {
  if (t.type !== "BUY" && t.type !== "SELL") {
    return { eur: 0, source: "base" };
  }
  const fromBase = t.baseCurrencyAmount != null && String(t.baseCurrencyAmount).trim() !== ""
    ? parseFloat(String(t.baseCurrencyAmount))
    : NaN;
  if (Number.isFinite(fromBase)) {
    return { eur: fromBase, source: "base" };
  }

  const ccy = inferTradeCurrency(t);
  const { gross, commission } = grossAndCommission(t);
  const ex = t.exchangeRateAtTransaction != null && String(t.exchangeRateAtTransaction).trim() !== ""
    ? parseFloat(String(t.exchangeRateAtTransaction))
    : NaN;
  if (ccy === "EUR") {
    return {
      eur: t.type === "BUY" ? gross + commission : gross - commission,
      source: "storedRate",
    };
  }
  if (Number.isFinite(ex) && ex > 0) {
    // schéma: ex = EUR za 1 jednotku cudzej meny
    const lineLocal = t.type === "BUY" ? gross + commission : gross - commission;
    return { eur: lineLocal * ex, source: "storedRate" };
  }
  if (fallbackEurPerUnit != null && Number.isFinite(fallbackEurPerUnit) && fallbackEurPerUnit > 0) {
    const lineLocal = t.type === "BUY" ? gross + commission : gross - commission;
    return { eur: lineLocal * fallbackEurPerUnit, source: "frankfurtFallback" };
  }
  return { eur: 0, source: "frankfurtFallback" };
}

/** Pre FIFO lot: cena/akciu (lokálna) a kurz € / 1 jednotka meny (USD atď.). */
export function eurPerUnitOfTradeCurrency(
  t: Pick<Transaction, "ticker" | "exchangeRateAtTransaction" | "originalCurrency" | "currency" | "shares" | "pricePerShare" | "commission" | "baseCurrencyAmount" | "type">,
  resolvedLineEur: number,
  fallbackEurPerUnit: number | null,
): { eurPerUnit: number; priceLocal: number; ccy: TradeCurrency } {
  const ccy = inferTradeCurrency(t);
  const { gross, commission } = grossAndCommission(t);
  if (t.type !== "BUY" && t.type !== "SELL") {
    return { eurPerUnit: 1, priceLocal: 0, ccy };
  }
  const lineLocal = t.type === "BUY" ? gross + commission : gross - commission;
  if (ccy === "EUR") {
    return { eurPerUnit: 1, priceLocal: parseFloat(String(t.pricePerShare)) || 0, ccy };
  }
  const ex =
    t.exchangeRateAtTransaction != null && String(t.exchangeRateAtTransaction).trim() !== ""
      ? parseFloat(String(t.exchangeRateAtTransaction))
      : NaN;
  if (Number.isFinite(ex) && ex > 0) {
    return { eurPerUnit: ex, priceLocal: parseFloat(String(t.pricePerShare)) || 0, ccy };
  }
  if (fallbackEurPerUnit != null && Number.isFinite(fallbackEurPerUnit) && lineLocal !== 0) {
    return {
      eurPerUnit: fallbackEurPerUnit,
      priceLocal: parseFloat(String(t.pricePerShare)) || 0,
      ccy,
    };
  }
  if (lineLocal !== 0 && Number.isFinite(resolvedLineEur)) {
    return {
      eurPerUnit: resolvedLineEur / lineLocal,
      priceLocal: parseFloat(String(t.pricePerShare)) || 0,
      ccy,
    };
  }
  return { eurPerUnit: 1, priceLocal: parseFloat(String(t.pricePerShare)) || 0, ccy };
}
