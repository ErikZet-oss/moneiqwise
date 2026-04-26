import type { Transaction } from "@shared/schema";
import { computeFifoRealizedGainsFromTransactions } from "@shared/fifoRealizedGains";
import type { RealizedGainsComputedSummary, RealizedTickerRow } from "@shared/realizedGainsTypes";
import { buildCloseTradeFallbackEurBySellId } from "@shared/sellCloseTradeFallback";
import {
  eurPerUnitFromTxn,
  grossAndCommission,
  resolveBuySellLineEur,
} from "@shared/transactionEur";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";

export type { RealizedGainsComputedSummary, RealizedTickerRow };
export { transactionLotKey } from "@shared/lotKey";

const REALIZED_NEAR_ZERO = 1e-6;

export type RealizedGainsComputeResult = {
  summary: RealizedGainsComputedSummary;
  /** Suma EUR z XTB close-trade párovania zarátaná do `totalRealized` (odpočíta sa od hrubého close-trade v routes). */
  mergedPairedCloseTradeEur: number;
};

/**
 * Broker uloží `realizedGain` v mene obchodu (rovnako ako cena). Prevedie na EUR
 * rovnakým pomerom ako výnos riadka (EUR / lokálny výnos), aby sedelo s `buySellLineEur`.
 */
function scaleStoredRealizedGainToEur(t: Transaction, fb: number | null): number {
  const rg = parseFloat(String(t.realizedGain ?? "0"));
  if (!Number.isFinite(rg) || Math.abs(rg) < 1e-12) return 0;
  if (
    String(t.type ?? "")
      .trim()
      .toUpperCase() !== "SELL"
  )
    return 0;
  const epu = eurPerUnitFromTxn(t, fb);
  if (epu != null) return rg * epu;
  const lineEur = resolveBuySellLineEur(t, fb);
  const { gross, commission } = grossAndCommission(t);
  const lineLocal = gross - commission;
  if (Number.isFinite(lineEur) && Math.abs(lineEur) >= 1e-9 && Math.abs(lineLocal) >= 1e-9) {
    return rg * (lineEur / lineLocal);
  }
  return 0;
}

/**
 * Súčet realizovaného zisku zo stĺpca `realizedGain` pri SELL (rovnaká logika ako v Histórii),
 * s prepočtom do EUR; pri prázdnom stĺpci ako v Histórii „close trade“ fallback (EUR).
 */
function summaryFromStoredSellRealized(
  sells: Transaction[],
  eurPerUnitByTxnId: Map<string, number | null>,
  now: Date,
  fallbackBySellId: Map<string, number>,
): RealizedGainsComputeResult {
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let totalRealized = 0;
  let realizedYTD = 0;
  let realizedThisMonth = 0;
  let realizedToday = 0;
  let transactionCount = 0;
  let mergedPairedCloseTradeEur = 0;
  const byTicker: Record<string, RealizedTickerRow> = {};

  const sorted = [...sells].sort((a, b) => {
    const ta = new Date(a.transactionDate as unknown as string).getTime();
    const tb = new Date(b.transactionDate as unknown as string).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  for (const txn of sorted) {
    const sh = Math.abs(parseFloat(String(txn.shares)));
    if (!(sh > 0)) continue;

    const rgRaw = parseFloat(String(txn.realizedGain ?? "0"));
    const fb = eurPerUnitByTxnId.get(txn.id) ?? null;
    let gainEur = scaleStoredRealizedGainToEur(txn, fb);
    if (
      Number.isFinite(rgRaw) &&
      Math.abs(rgRaw) >= 1e-9 &&
      Math.abs(gainEur) < REALIZED_NEAR_ZERO
    ) {
      gainEur = rgRaw;
    }
    let usedCloseTradePair = false;
    if (!Number.isFinite(gainEur) || Math.abs(gainEur) < 1e-12) {
      const closeFb = fallbackBySellId.get(txn.id);
      if (closeFb != null && Number.isFinite(closeFb) && Math.abs(closeFb) > 1e-9) {
        gainEur = closeFb;
        usedCloseTradePair = true;
      }
    }
    if (!Number.isFinite(gainEur) || Math.abs(gainEur) < 1e-12) continue;

    if (usedCloseTradePair) mergedPairedCloseTradeEur += gainEur;

    transactionCount++;
    totalRealized += gainEur;

    const txnDate = new Date(txn.transactionDate as unknown as string);
    if (txnDate >= startOfYear) realizedYTD += gainEur;
    if (txnDate >= startOfMonth) realizedThisMonth += gainEur;
    if (txnDate >= todayStart) realizedToday += gainEur;

    const proceedsEur = resolveBuySellLineEur(txn, fb);
    const { gross, commission } = grossAndCommission(txn);
    const lineLocal = gross - commission;
    const epu = eurPerUnitFromTxn(txn, fb);
    const soldEur =
      Number.isFinite(proceedsEur) && Math.abs(proceedsEur) >= 1e-9
        ? Math.abs(proceedsEur)
        : epu != null && Number.isFinite(lineLocal)
          ? Math.abs(lineLocal * epu)
          : Math.abs(lineLocal);

    const tk = String(txn.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!byTicker[tk]) {
      byTicker[tk] = {
        ticker: tk,
        companyName: txn.companyName || tk,
        totalGain: 0,
        totalSold: 0,
        transactions: 0,
      };
    }
    byTicker[tk].totalGain += gainEur;
    byTicker[tk].totalSold += soldEur;
    byTicker[tk].transactions += 1;
  }

  return {
    summary: {
      totalRealized,
      realizedYTD,
      realizedThisMonth,
      realizedToday,
      byTicker: Object.values(byTicker).sort((a, b) => b.totalGain - a.totalGain),
      transactionCount,
    },
    mergedPairedCloseTradeEur,
  };
}

function sellsHaveStoredRealizedGain(sells: Transaction[]): boolean {
  return sells.some((t) => {
    const r = parseFloat(String(t.realizedGain ?? "0"));
    return Number.isFinite(r) && Math.abs(r) >= 1e-9;
  });
}

function mergeSkippedSellCloseTradeFallback(
  summary: RealizedGainsComputedSummary,
  sells: Transaction[],
  fifoProcessedSellIds: Set<string>,
  fallbackBySellId: Map<string, number>,
  now: Date,
): number {
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let mergedPairedCloseTradeEur = 0;
  const byTickerMap: Record<string, RealizedTickerRow> = {};
  for (const row of summary.byTicker) {
    byTickerMap[row.ticker] = { ...row };
  }

  for (const sell of sells) {
    if (fifoProcessedSellIds.has(sell.id)) continue;
    const sh = Math.abs(parseFloat(String(sell.shares)));
    if (!(sh > 0)) continue;
    const fb = fallbackBySellId.get(sell.id);
    if (fb == null || !Number.isFinite(fb) || Math.abs(fb) < 1e-9) continue;

    mergedPairedCloseTradeEur += fb;
    summary.transactionCount++;
    summary.totalRealized += fb;
    const txnDate = new Date(sell.transactionDate as unknown as string);
    if (txnDate >= startOfYear) summary.realizedYTD += fb;
    if (txnDate >= startOfMonth) summary.realizedThisMonth += fb;
    if (txnDate >= todayStart) summary.realizedToday += fb;

    const tk = String(sell.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!byTickerMap[tk]) {
      byTickerMap[tk] = {
        ticker: tk,
        companyName: sell.companyName || tk,
        totalGain: 0,
        totalSold: 0,
        transactions: 0,
      };
    }
    byTickerMap[tk].totalGain += fb;
    byTickerMap[tk].transactions += 1;
  }

  summary.byTicker = Object.values(byTickerMap).sort((a, b) => b.totalGain - a.totalGain);
  return mergedPairedCloseTradeEur;
}

/**
 * FIFO v EUR; historický kurz: `baseCurrencyAmount` alebo `exchangeRateAtTransaction`,
 * inak Frankfurter podľa dňa transakcie.
 */
export async function computeRealizedGainsFromTransactionsAsync(
  userTransactions: Transaction[],
  now = new Date(),
): Promise<RealizedGainsComputeResult> {
  const m = await buildEurPerUnitByTxnIdForTransactions(userTransactions);
  const fallbackBySellId = buildCloseTradeFallbackEurBySellId(userTransactions);
  const sells = userTransactions.filter(
    (t) =>
      String(t.type ?? "")
        .trim()
        .toUpperCase() === "SELL",
  );

  let mergedPairedCloseTradeEur = 0;

  if (sellsHaveStoredRealizedGain(sells)) {
    const fromStored = summaryFromStoredSellRealized(sells, m, now, fallbackBySellId);
    mergedPairedCloseTradeEur += fromStored.mergedPairedCloseTradeEur;
    if (fromStored.summary.transactionCount > 0) {
      return { summary: fromStored.summary, mergedPairedCloseTradeEur };
    }
  }

  const fifo = computeFifoRealizedGainsFromTransactions(userTransactions, m, now);
  const summary: RealizedGainsComputedSummary = {
    ...fifo.summary,
    byTicker: fifo.summary.byTicker.map((r) => ({ ...r })),
  };
  mergedPairedCloseTradeEur += mergeSkippedSellCloseTradeFallback(
    summary,
    sells,
    fifo.fifoProcessedSellIds,
    fallbackBySellId,
    now,
  );

  if (summary.transactionCount > 0) {
    return { summary, mergedPairedCloseTradeEur };
  }

  if (sells.length === 0) {
    return { summary, mergedPairedCloseTradeEur };
  }

  const fallback = summaryFromStoredSellRealized(sells, m, now, fallbackBySellId);
  mergedPairedCloseTradeEur += fallback.mergedPairedCloseTradeEur;
  if (fallback.summary.transactionCount > 0) {
    return { summary: fallback.summary, mergedPairedCloseTradeEur };
  }

  return { summary, mergedPairedCloseTradeEur };
}

/**
 * FIFO bez čakania na API (len uložené kurzy / base v riadku).
 */
export function computeRealizedGainsFromTransactions(
  userTransactions: Transaction[],
  now = new Date(),
): RealizedGainsComputedSummary {
  const m = new Map<string, number | null>();
  for (const t of userTransactions) m.set(t.id, null);
  const fallbackBySellId = buildCloseTradeFallbackEurBySellId(userTransactions);
  const sells = userTransactions.filter(
    (t) =>
      String(t.type ?? "")
        .trim()
        .toUpperCase() === "SELL",
  );

  if (sellsHaveStoredRealizedGain(sells)) {
    const fromStored = summaryFromStoredSellRealized(sells, m, now, fallbackBySellId);
    if (fromStored.summary.transactionCount > 0) {
      return fromStored.summary;
    }
  }

  const fifo = computeFifoRealizedGainsFromTransactions(userTransactions, m, now);
  const summary: RealizedGainsComputedSummary = {
    ...fifo.summary,
    byTicker: fifo.summary.byTicker.map((r) => ({ ...r })),
  };
  mergeSkippedSellCloseTradeFallback(
    summary,
    sells,
    fifo.fifoProcessedSellIds,
    fallbackBySellId,
    now,
  );

  if (summary.transactionCount > 0) {
    return summary;
  }
  if (sells.length === 0) return summary;
  const fallback = summaryFromStoredSellRealized(sells, m, now, fallbackBySellId);
  return fallback.summary.transactionCount > 0 ? fallback.summary : summary;
}
