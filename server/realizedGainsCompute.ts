import type { Transaction } from "@shared/schema";
import { computeFifoRealizedGainsFromTransactions } from "@shared/fifoRealizedGains";
import type { RealizedGainsComputedSummary, RealizedTickerRow } from "@shared/realizedGainsTypes";
import { buildCloseTradeFallbackPairing, hasAuthoritativeStoredRealizedGain, shouldPreferCloseTradeGain } from "@shared/sellCloseTradeFallback";
import {
  emptyRealizedTickerAgg,
  finalizeRealizedTickerAggWithPortfolios,
  UNKNOWN_PORTFOLIO_ID,
  type RealizedPortfolioMeta,
  historyLinePricePerShare,
  sellInstrumentPricePerShare,
  type RealizedTickerAgg,
} from "@shared/realizedPricePerShare";
import {
  eurPerUnitFromTxn,
  grossAndCommission,
  resolveBuySellLineEur,
} from "@shared/transactionEur";
import { getTickerCurrency } from "@shared/tickerCurrency";
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
    shouldPreferCloseTradeGain(sell, closeFb)
  ) {
    return { sell, gainEur: closeFb, usedCloseTrade: true };
  }

  const rgRaw = parseFloat(String(sell.realizedGain ?? "0"));
  let gainEur = 0;
  let usedCloseTrade = false;

  if (hasAuthoritativeStoredRealizedGain(sell, closeFb)) {
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

type SellMetrics = {
  sh: number;
  costEur: number;
  soldEur: number;
  buyWeighted: number;
  sellLocalPx: number;
};

function metricsForSell(
  txn: Transaction,
  gainEur: number,
  eurPerUnitByTxnId: Map<string, number | null>,
  costEurBySellId: Map<string, number>,
  buyWeightedLocalBySellId: Map<string, number>,
  sellPriceLocalBySellId: Map<string, number>,
): SellMetrics | null {
  const sh = Math.abs(parseFloat(String(txn.shares ?? "0")));
  if (!(sh > 0)) return null;

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

  const fifoCost = costEurBySellId.get(txn.id);
  const costEur =
    fifoCost != null && Number.isFinite(fifoCost) && fifoCost >= 0
      ? fifoCost
      : Math.max(0, soldEur - gainEur);

  let buyWeighted = buyWeightedLocalBySellId.get(txn.id);
  if (buyWeighted == null || !Number.isFinite(buyWeighted) || buyWeighted <= 0) {
    if (epu != null && epu > 1e-12 && costEur > 0) {
      buyWeighted = costEur / epu;
    } else {
      buyWeighted = 0;
    }
  }

  let sellLocalPx = sellPriceLocalBySellId.get(txn.id);
  if (sellLocalPx == null || !Number.isFinite(sellLocalPx) || sellLocalPx <= 0) {
    sellLocalPx = sellInstrumentPricePerShare(txn, epu ?? fb, soldEur);
  }
  if (sellLocalPx == null || !Number.isFinite(sellLocalPx) || sellLocalPx <= 0) {
    sellLocalPx = historyLinePricePerShare(txn, { lineEur: soldEur, eurPerUnit: epu ?? fb });
  }

  return { sh, costEur, soldEur, buyWeighted, sellLocalPx };
}

function applySellToAgg(agg: RealizedTickerAgg, gainEur: number, m: SellMetrics): void {
  agg.totalGain += gainEur;
  agg.totalCost += m.costEur;
  agg.totalSold += m.soldEur;
  agg.transactions += 1;
  agg.totalSharesSold += m.sh;
  agg.weightedBuyLocal += m.buyWeighted;
  agg.weightedSellLocal += m.sellLocalPx * m.sh;
}

function aggregateResolvedSellGains(
  resolved: ResolvedSellGain[],
  eurPerUnitByTxnId: Map<string, number | null>,
  now: Date,
  costEurBySellId: Map<string, number>,
  buyWeightedLocalBySellId: Map<string, number>,
  sellPriceLocalBySellId: Map<string, number>,
  portfolioMetaById: Map<string, RealizedPortfolioMeta>,
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
  const byTicker: Record<string, RealizedTickerAgg> = {};
  const byTickerPortfolio: Record<string, Record<string, RealizedTickerAgg>> = {};

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
    const metrics = metricsForSell(
      txn,
      gainEur,
      eurPerUnitByTxnId,
      costEurBySellId,
      buyWeightedLocalBySellId,
      sellPriceLocalBySellId,
    );
    if (!metrics) continue;

    const tk = String(txn.ticker ?? "")
      .trim()
      .toUpperCase();

    if (!byTicker[tk]) {
      byTicker[tk] = emptyRealizedTickerAgg(tk, txn.companyName || tk, getTickerCurrency(tk));
    }
    applySellToAgg(byTicker[tk], gainEur, metrics);

    const portfolioKey = String(txn.portfolioId ?? "").trim() || UNKNOWN_PORTFOLIO_ID;
    if (!byTickerPortfolio[tk]) byTickerPortfolio[tk] = {};
    if (!byTickerPortfolio[tk][portfolioKey]) {
      byTickerPortfolio[tk][portfolioKey] = emptyRealizedTickerAgg(
        tk,
        txn.companyName || tk,
        getTickerCurrency(tk),
      );
    }
    applySellToAgg(byTickerPortfolio[tk][portfolioKey], gainEur, metrics);
  }

  return {
    summary: {
      totalRealized,
      realizedYTD,
      realizedThisMonth,
      realizedToday,
      byTicker: Object.keys(byTicker)
        .map((tk) =>
          finalizeRealizedTickerAggWithPortfolios(
            byTicker[tk],
            byTickerPortfolio[tk] ?? {},
            portfolioMetaById,
          ),
        )
        .sort((a, b) => b.totalGain - a.totalGain),
      transactionCount,
    },
    mergedPairedCloseTradeEur,
  };
}

function computeRealizedGainsCore(
  userTransactions: Transaction[],
  eurPerUnitByTxnId: Map<string, number | null>,
  now: Date,
  portfolioMetaById: Map<string, RealizedPortfolioMeta>,
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

  return aggregateResolvedSellGains(
    resolved,
    eurPerUnitByTxnId,
    now,
    fifo.costEurBySellId,
    fifo.buyWeightedLocalBySellId,
    fifo.sellPriceLocalBySellId,
    portfolioMetaById,
  );
}

/**
 * FIFO v EUR; historický kurz: `baseCurrencyAmount` alebo `exchangeRateAtTransaction`,
 * inak Frankfurter podľa dňa transakcie.
 */
export async function computeRealizedGainsFromTransactionsAsync(
  userTransactions: Transaction[],
  now = new Date(),
  portfolioMetaById: Map<string, RealizedPortfolioMeta> = new Map(),
): Promise<RealizedGainsComputeResult> {
  const m = await buildEurPerUnitByTxnIdForTransactions(userTransactions);
  return computeRealizedGainsCore(userTransactions, m, now, portfolioMetaById);
}

export type SellRealizedRow = {
  gainEur: number;
  /** FIFO náklad (EUR); 0 ak neznámy. */
  costEur: number;
  /** zisk / náklad × 100; null ak náklad ≈ 0. */
  pct: number | null;
};

/** Rovnaká logika ako Zisk / FIFO — zisk + % pre každý SELL (História). */
export async function buildSellRealizedById(
  userTransactions: Transaction[],
  now = new Date(),
): Promise<Map<string, SellRealizedRow>> {
  const eurPerUnitByTxnId = await buildEurPerUnitByTxnIdForTransactions(userTransactions);
  const { bySellId: fallbackBySellId } = buildCloseTradeFallbackPairing(userTransactions);
  const fifo = computeFifoRealizedGainsFromTransactions(
    userTransactions,
    eurPerUnitByTxnId,
    now,
    fallbackBySellId,
  );
  const sells = userTransactions.filter(
    (t) =>
      String(t.type ?? "")
        .trim()
        .toUpperCase() === "SELL",
  );
  const out = new Map<string, SellRealizedRow>();
  for (const sell of sells) {
    const row = resolveSellGainEur(
      sell,
      eurPerUnitByTxnId,
      fallbackBySellId,
      fifo.gainEurBySellId,
      fifo.closeTradePairedSellIds,
    );
    if (!row) continue;
    const m = metricsForSell(
      sell,
      row.gainEur,
      eurPerUnitByTxnId,
      fifo.costEurBySellId,
      fifo.buyWeightedLocalBySellId,
      fifo.sellPriceLocalBySellId,
    );
    const costEur = m?.costEur ?? Math.max(0, (m?.soldEur ?? 0) - row.gainEur);
    const pct =
      costEur > REALIZED_NEAR_ZERO && Number.isFinite(costEur)
        ? (row.gainEur / costEur) * 100
        : null;
    out.set(sell.id, { gainEur: row.gainEur, costEur, pct });
  }
  return out;
}

/** @deprecated Prefer `buildSellRealizedById` (vracia aj %). */
export async function buildSellGainEurById(
  userTransactions: Transaction[],
  now = new Date(),
): Promise<Map<string, number>> {
  const byId = await buildSellRealizedById(userTransactions, now);
  const out = new Map<string, number>();
  for (const [id, row] of byId) out.set(id, row.gainEur);
  return out;
}

/**
 * FIFO bez čakania na API (len uložené kurzy / base v riadku).
 */
export function computeRealizedGainsFromTransactions(
  userTransactions: Transaction[],
  now = new Date(),
  portfolioMetaById: Map<string, RealizedPortfolioMeta> = new Map(),
): RealizedGainsComputedSummary {
  const m = new Map<string, number | null>();
  for (const t of userTransactions) m.set(t.id, null);
  return computeRealizedGainsCore(userTransactions, m, now, portfolioMetaById).summary;
}
