import type { Transaction } from "./schema";
import { transactionLotKey } from "./lotKey";
import type { RealizedGainsComputedSummary, RealizedTickerRow } from "./realizedGainsTypes";
import { inferTradeCurrency, type TradeCurrency } from "./transactionEur";
import { buySellLineEur, eurPerUnitOfTradeCurrency } from "./transactionEur";

/**
 * Otvorený nákupný lot (FIFO).
 * `costPerShareEur` = celkové EUR za akciu pri nákupe; konštantné až do úplného zatvorenia.
 */
export interface OpenFifoLot {
  remainingShares: number;
  costPerShareEur: number;
  priceLocal: number;
  eurPerUnit: number;
  ccy: TradeCurrency;
}

/**
 * FIFO v EUR. `eurPerUnitByTxnId` – vypočítané v deň D z Frankfurter, ak v DB chýba kurz.
 */
export function computeFifoRealizedGainsFromTransactions(
  userTransactions: Transaction[],
  eurPerUnitByTxnId: Map<string, number | null>,
  now = new Date(),
): {
  summary: RealizedGainsComputedSummary;
  openLots: Record<string, OpenFifoLot[]>;
} {
  const sorted = [...userTransactions].sort(
    (a, b) =>
      new Date(a.transactionDate as unknown as string).getTime() -
      new Date(b.transactionDate as unknown as string).getTime(),
  );

  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let totalRealized = 0;
  let realizedYTD = 0;
  let realizedThisMonth = 0;
  let realizedToday = 0;
  const byTicker: Record<string, RealizedTickerRow> = {};
  let transactionCount = 0;

  const lots: Record<string, OpenFifoLot[]> = {};

  const getKey = (txn: Transaction) => transactionLotKey(txn);

  for (const txn of sorted) {
    const key = getKey(txn);
    if (txn.type === "BUY") {
      const fb = eurPerUnitByTxnId.get(txn.id) ?? null;
      const { eur: lineEur } = buySellLineEur(txn, fb);
      const sh = parseFloat(String(txn.shares));
      if (!(sh > 0) || !Number.isFinite(lineEur) || lineEur <= 0) continue;
      const epu = eurPerUnitOfTradeCurrency(txn, lineEur, fb);
      const cps = lineEur / sh;
      if (!lots[key]) lots[key] = [];
      lots[key].push({
        remainingShares: sh,
        costPerShareEur: cps,
        priceLocal: epu.priceLocal,
        eurPerUnit: epu.eurPerUnit,
        ccy: inferTradeCurrency(txn),
      });
    } else if (txn.type === "SELL") {
      const fb = eurPerUnitByTxnId.get(txn.id) ?? null;
      const { eur: proceedsEur } = buySellLineEur(txn, fb);
      const shSell = parseFloat(String(txn.shares));
      if (!(shSell > 0) || !Number.isFinite(proceedsEur)) continue;
      transactionCount++;

      const queue = lots[key] ?? [];
      let toSell = shSell;
      let costRemoved = 0;
      for (const lot of queue) {
        if (toSell <= 0) break;
        if (lot.remainingShares <= 0) continue;
        const take = Math.min(toSell, lot.remainingShares);
        costRemoved += take * lot.costPerShareEur;
        lot.remainingShares -= take;
        toSell -= take;
      }

      const gain = proceedsEur - costRemoved;
      totalRealized += gain;

      const txnDate = new Date(txn.transactionDate as unknown as string);
      if (txnDate >= startOfYear) realizedYTD += gain;
      if (txnDate >= startOfMonth) realizedThisMonth += gain;
      if (txnDate >= todayStart) realizedToday += gain;

      const aggTicker = txn.ticker;
      const sellValue = parseFloat(String(txn.shares)) * parseFloat(String(txn.pricePerShare));
      if (!byTicker[aggTicker]) {
        byTicker[aggTicker] = {
          ticker: txn.ticker,
          companyName: txn.companyName,
          totalGain: 0,
          totalSold: 0,
          transactions: 0,
        };
      }
      byTicker[aggTicker].totalGain += gain;
      byTicker[aggTicker].totalSold += sellValue;
      byTicker[aggTicker].transactions += 1;
    }
  }

  const tickerSummary = Object.values(byTicker).sort(
    (a, b) => b.totalGain - a.totalGain,
  );

  return {
    summary: {
      totalRealized,
      realizedYTD,
      realizedThisMonth,
      realizedToday,
      byTicker: tickerSummary,
      transactionCount,
    },
    openLots: lots,
  };
}
