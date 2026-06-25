import type { Transaction } from "@shared/schema";
import { computeFifoRealizedGainsFromTransactions } from "@shared/fifoRealizedGains";
import type { RealizedGainsComputedSummary, RealizedTickerRow } from "@shared/realizedGainsTypes";
import { buildCloseTradeFallbackPairing, hasAuthoritativeStoredRealizedGain } from "@shared/sellCloseTradeFallback";
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

type ResolvedSellGain = {
  sell: Transaction;
  gainEur: number;
  usedCloseTrade: boolean;
};

function resolveSellGainEur(
  sell: Transaction,
  eurPerUnitByTxnId: Map<string, number | null>,
  fallbackBySellId: Map<string, number>,
  fifoGainBySellId: Map<string, number>,
  closeTradePairedSellIds: Set<string>,
): ResolvedSellGain | null {
  const sh = Math.abs(parseFloat(String(sell.shares)));
  if (!(sh > 0)) return null;

  const fb = eurPerUnitByTxnId.get(sell.id) ?? null;
  const closeFb = fallbackBySellId.get(sell.id);

  if (
    closeFb != null &&
    Number.isFinite(closeFb) &&
    Math.abs(closeFb) >= REALIZED_NEAR_ZERO &&
    !hasAuthoritativeStoredRealizedGain(sell)
  ) {
    return { sell, gainEur: closeFb, usedCloseTrade: true };
  }

  const rgRaw = parseFloat(String(sell.realizedGain ?? "0"));
  let gainEur = 0;
  let usedCloseTrade = false;

  if (hasAuthoritativeStoredRealizedGain(sell)) {
    gainEur = scaleStoredRealizedGainToEur(sell, fb);
    if (Math.abs(gainEur) < REALIZED_NEAR_ZERO) gainEur = rgRaw;
  }

  if (Math.abs(gainEur) < REALIZED_NEAR_ZERO) {
    const fifoGain = fifoGainBySellId.get(sell.id);
    if (fifoGain != null && Number.isFinite(fifoGain)) {
      gainEur = fifoGain;
      usedCloseTrade = closeTradePairedSellIds.has(sell.id);
    }
  }

  if (Math.abs(gainEur) < REALIZED_NEAR_ZERO) {
    const closeFb = fallbackBySellId.get(sell.id);
    if (closeFb != null && Number.isFinite(closeFb) && Math.abs(closeFb) >= REALIZED_NEAR_ZERO) {
      gainEur = closeFb;
      usedCloseTrade = true;
    }
  }

  if (!Number.isFinite(gainEur) || Math.abs(gainEur) < REALIZED_NEAR_ZERO) return null;
  return { sell, gainEur, usedCloseTrade };
}

function aggregateResolvedSellGains(
  resolved: ResolvedSellGain[],
  eurPerUnitByTxnId: Map<string, number | null>,
  now: Date,
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

  const sorted = [...resolved].sort((a, b) => {
    const ta = new Date(a.sell.transactionDate as unknown as string).getTime();
    const tb = new Date(b.sell.transactionDate as unknown as string).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.sell.id).localeCompare(String(b.sell.id));
  });

  for (const { sell: txn, gainEur, usedCloseTrade } of sorted) {
    if (usedCloseTrade) mergedPairedCloseTradeEur += gainEur;

    transactionCount++;
    totalRealized += gainEur;

    const txnDate = new Date(txn.transactionDate as unknown as string);
    if (txnDate >= startOfYear) realizedYTD += gainEur;
    if (txnDate >= startOfMonth) realizedThisMonth += gainEur;
    if (txnDate >= todayStart) realizedToday += gainEur;

    const fb = eurPerUnitByTxnId.get(txn.id) ?? null;
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

function computeRealizedGainsCore(
  userTransactions: Transaction[],
  eurPerUnitByTxnId: Map<string, number | null>,
  now: Date,
): RealizedGainsComputeResult {
  const { bySellId: fallbackBySellId } = buildCloseTradeFallbackPairing(userTransactions);
  const sells = userTransactions.filter(
    (t) =>
      String(t.type ?? "")
        .trim()
        .toUpperCase() === "SELL",
  );

  const fifo = computeFifoRealizedGainsFromTransactions(
    userTransactions,
    eurPerUnitByTxnId,
    now,
    fallbackBySellId,
  );

  const resolved: ResolvedSellGain[] = [];
  for (const sell of sells) {
    const row = resolveSellGainEur(
      sell,
      eurPerUnitByTxnId,
      fallbackBySellId,
      fifo.gainEurBySellId,
      fifo.closeTradePairedSellIds,
    );
    if (row) resolved.push(row);
  }

  return aggregateResolvedSellGains(resolved, eurPerUnitByTxnId, now);
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
  return computeRealizedGainsCore(userTransactions, m, now);
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
  return computeRealizedGainsCore(userTransactions, m, now).summary;
}
