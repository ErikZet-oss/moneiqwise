import type { Transaction } from "@shared/schema";
import { computeFifoRealizedGainsFromTransactions } from "@shared/fifoRealizedGains";
import type { RealizedGainsComputedSummary, RealizedTickerRow } from "@shared/realizedGainsTypes";
import {
  eurPerUnitFromTxn,
  grossAndCommission,
  resolveBuySellLineEur,
} from "@shared/transactionEur";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";

export type { RealizedGainsComputedSummary, RealizedTickerRow };
export { transactionLotKey } from "@shared/lotKey";

const REALIZED_NEAR_ZERO = 1e-6;

function sumScaledStoredGainEur(
  sells: Transaction[],
  eurPerUnitByTxnId: Map<string, number | null>,
): number {
  let s = 0;
  for (const t of sells) {
    s += scaleStoredRealizedGainToEur(t, eurPerUnitByTxnId.get(t.id) ?? null);
  }
  return s;
}

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
 * Záloha, ak FIFO nezapočíta žiadny SELL (napr. chýbajúce loty po importe), ale v DB je
 * pri predaji vypočítaný `realizedGain` a ceny — agregácia podľa tickeru v EUR.
 */
function summaryFromStoredSellRealized(
  sells: Transaction[],
  eurPerUnitByTxnId: Map<string, number | null>,
  now: Date,
): RealizedGainsComputedSummary {
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let totalRealized = 0;
  let realizedYTD = 0;
  let realizedThisMonth = 0;
  let realizedToday = 0;
  let transactionCount = 0;
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
    const fb = eurPerUnitByTxnId.get(txn.id) ?? null;
    const proceedsEur = resolveBuySellLineEur(txn, fb);
    const gainEur = scaleStoredRealizedGainToEur(txn, fb);
    if (Math.abs(proceedsEur) < 1e-9 && Math.abs(gainEur) < 1e-9) continue;
    transactionCount++;
    totalRealized += gainEur;

    const txnDate = new Date(txn.transactionDate as unknown as string);
    if (txnDate >= startOfYear) realizedYTD += gainEur;
    if (txnDate >= startOfMonth) realizedThisMonth += gainEur;
    if (txnDate >= todayStart) realizedToday += gainEur;

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
    byTicker[tk].totalSold += Math.abs(proceedsEur);
    byTicker[tk].transactions += 1;
  }

  return {
    totalRealized,
    realizedYTD,
    realizedThisMonth,
    realizedToday,
    byTicker: Object.values(byTicker).sort((a, b) => b.totalGain - a.totalGain),
    transactionCount,
  };
}

/**
 * FIFO v EUR; historický kurz: `baseCurrencyAmount` alebo `exchangeRateAtTransaction`,
 * inak Frankfurter podľa dňa transakcie.
 */
export async function computeRealizedGainsFromTransactionsAsync(
  userTransactions: Transaction[],
  now = new Date(),
): Promise<RealizedGainsComputedSummary> {
  const m = await buildEurPerUnitByTxnIdForTransactions(userTransactions);
  const fifo = computeFifoRealizedGainsFromTransactions(userTransactions, m, now);
  const sells = userTransactions.filter(
    (t) =>
      String(t.type ?? "")
        .trim()
        .toUpperCase() === "SELL",
  );

  const storedSum = sumScaledStoredGainEur(sells, m);
  if (
    sells.length > 0 &&
    Math.abs(fifo.summary.totalRealized) < REALIZED_NEAR_ZERO &&
    Math.abs(storedSum) >= REALIZED_NEAR_ZERO
  ) {
    const fromStored = summaryFromStoredSellRealized(sells, m, now);
    if (fromStored.transactionCount > 0) return fromStored;
  }

  if (fifo.summary.transactionCount > 0) {
    return fifo.summary;
  }

  if (sells.length === 0) {
    return fifo.summary;
  }

  const fallback = summaryFromStoredSellRealized(sells, m, now);
  if (fallback.transactionCount > 0) {
    return fallback;
  }

  return fifo.summary;
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
  const fifo = computeFifoRealizedGainsFromTransactions(userTransactions, m, now);
  const sells = userTransactions.filter(
    (t) =>
      String(t.type ?? "")
        .trim()
        .toUpperCase() === "SELL",
  );

  const storedSum = sumScaledStoredGainEur(sells, m);
  if (
    sells.length > 0 &&
    Math.abs(fifo.summary.totalRealized) < REALIZED_NEAR_ZERO &&
    Math.abs(storedSum) >= REALIZED_NEAR_ZERO
  ) {
    const fromStored = summaryFromStoredSellRealized(sells, m, now);
    if (fromStored.transactionCount > 0) return fromStored;
  }

  if (fifo.summary.transactionCount > 0) {
    return fifo.summary;
  }
  if (sells.length === 0) return fifo.summary;
  const fallback = summaryFromStoredSellRealized(sells, m, now);
  return fallback.transactionCount > 0 ? fallback : fifo.summary;
}
