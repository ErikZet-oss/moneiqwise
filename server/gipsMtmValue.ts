import type { Transaction } from "@shared/schema";
import { getTickerCurrency } from "@shared/tickerCurrency";
import { sumNetCashLedgerEurUpTo } from "@shared/netCashLedgerUpTo";
import { endOfDay, parseISO } from "date-fns";
import { convertAmountBetween, type AllExchangeRates } from "./convertAmountBetween";

function priceOnOrBefore(
  history: Record<string, number> | undefined,
  targetIso: string,
  maxBackDays = 14,
): number | null {
  if (!history) return null;
  if (history[targetIso] != null) return history[targetIso];
  const d = new Date(`${targetIso}T00:00:00Z`);
  for (let i = 1; i <= maxBackDays; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const key = d.toISOString().slice(0, 10);
    if (history[key] != null) return history[key];
  }
  return null;
}

/**
 * Trhová hodnota držby + čistá hotovosť (net ledger) v EUR, potom v preferovanej mene.
 * Hotovosť musí zohľadňovať DEPOSIT/WITHDRAWAL aj BUY/SELL/DIVIDEND/TAX.
 */
export function mtmValueAtEod(
  sortedTx: Transaction[],
  baseIso: string, // "YYYY-MM-DD" — EOD vrátane tohoto dňa
  historicalByTicker: Record<string, Record<string, number>>,
  historicalFxEurPerUnitByCurrency: Record<string, Record<string, number>>,
  currentPrices: Record<string, number>,
  rates: AllExchangeRates,
  userCcy: string,
  todayIso: string,
): number {
  const state = new Map<string, { shares: number; totalCost: number; avgCost: number }>();
  for (const t of sortedTx) {
    const d = new Date(t.transactionDate as unknown as string).toISOString().slice(0, 10);
    if (d > baseIso) break;
    if (t.type !== "BUY" && t.type !== "SELL") continue;
    if (
      !t.ticker ||
      t.ticker.toUpperCase() === "CASH" ||
      t.ticker.toUpperCase() === "PORTFOLIO_CASH_FLOW"
    ) {
      continue;
    }
    const shares = parseFloat(t.shares);
    const price = parseFloat(t.pricePerShare);
    const commission = parseFloat(t.commission || "0");
    const key = t.ticker.toUpperCase();
    let st = state.get(key);
    if (!st) {
      st = { shares: 0, totalCost: 0, avgCost: 0 };
      state.set(key, st);
    }
    if (t.type === "BUY") {
      st.totalCost += shares * price + commission;
      st.shares += shares;
      st.avgCost = st.shares > 0 ? st.totalCost / st.shares : 0;
    } else {
      st.totalCost = Math.max(0, st.totalCost - shares * st.avgCost);
      st.shares = Math.max(0, st.shares - shares);
    }
  }

  const eod = endOfDay(parseISO(baseIso + "T12:00:00"));
  const cashEur = sumNetCashLedgerEurUpTo(
    sortedTx,
    eod,
    {},
    rates,
  );

  let sum = 0;
  const eurPerUnitOnOrBefore = (
    currency: ReturnType<typeof getTickerCurrency>,
    iso: string,
  ): number | null => {
    if (currency === "EUR") return 1;
    const h = historicalFxEurPerUnitByCurrency[currency];
    const eurPerUnit = priceOnOrBefore(h, iso);
    if (eurPerUnit != null && Number.isFinite(eurPerUnit) && eurPerUnit > 0) {
      return eurPerUnit;
    }
    // Fallback to current FX if historical point missing.
    const fallback = convertAmountBetween(1, currency, "EUR", rates);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  };

  const priceInCcy = (ticker: string, iso: string): number | null => {
    const u = ticker.toUpperCase();
    const hist = historicalByTicker[u];
    let raw = priceOnOrBefore(hist, iso);
    if (raw == null && iso >= todayIso && currentPrices[u] != null) {
      raw = currentPrices[u];
    }
    if (raw == null) return null;
    const tickerCcy = getTickerCurrency(u);
    const eurPerUnit = eurPerUnitOnOrBefore(tickerCcy, iso);
    if (eurPerUnit == null) return null;
    const eurPrice = raw * eurPerUnit;
    return convertAmountBetween(eurPrice, "EUR", userCcy, rates);
  };

  state.forEach((h, ticker) => {
    if (h.shares <= 0) return;
    const price = priceInCcy(ticker, baseIso);
    sum += price != null ? h.shares * price : h.shares * h.avgCost; // cost fallback
  });
  return sum + convertAmountBetween(cashEur, "EUR", userCcy, rates);
}

