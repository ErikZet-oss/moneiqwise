import type { Transaction } from "./schema";
import { transactionLotKey } from "./lotKey";
import { inferTradeCurrency } from "./transactionEur";
import { buySellLineEur, eurPerUnitOfTradeCurrency } from "./transactionEur";
import type { OpenFifoLot } from "./fifoRealizedGains";

const MS_365D = 365 * 24 * 60 * 60 * 1000;

function txnIsoDate(txn: Transaction): string {
  return new Date(txn.transactionDate as unknown as string).toISOString().slice(0, 10);
}

/**
 * Jeden alokovaný diel realizácie pri SELL (pomer podľa množstva z FIFO lotu).
 * Slúži na rozlíšenie zisku <365 dní (zdaniteľné) a ≥365 dní (oslobodenie tituly SK).
 */
export type FifoRealizedPortionEur = {
  sellTransactionId: string;
  acquiredAt: string;
  sellDate: string;
  /** Kalendárny rok predaja (z dátumu SELL). */
  saleYear: number;
  /** Počet ks z tohto lotu v rámci danej SELL. */
  shares: number;
  costEur: number;
  proceedsEur: number;
  gainEur: number;
  /** true = držané aspoň 365 dní medzi nákupom a predajom. */
  holdingAtLeast365Days: boolean;
  ticker: string;
};

/**
 * Rovnaké FIFO v EUR ako `computeFifoRealizedGainsFromTransactions`, ale k predaju pripočíta
 * čiastkové zlomky pripísané na otvárané loty (proporcionálne výťažok z predaja).
 */
export function computeFifoRealizedPortionsEur(
  userTransactions: Transaction[],
  eurPerUnitByTxnId: Map<string, number | null>,
): FifoRealizedPortionEur[] {
  const sorted = [...userTransactions].sort(
    (a, b) =>
      new Date(a.transactionDate as unknown as string).getTime() -
      new Date(b.transactionDate as unknown as string).getTime(),
  );

  const lots: Record<string, OpenFifoLot[]> = {};
  const getKey = (txn: Transaction) => transactionLotKey(txn);
  const out: FifoRealizedPortionEur[] = [];

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
        acquiredAt: txnIsoDate(txn),
        remainingShares: sh,
        costPerShareEur: cps,
        priceLocal: epu.priceLocal,
        eurPerUnit: epu.eurPerUnit,
        ccy: inferTradeCurrency(txn) as OpenFifoLot["ccy"],
      });
    } else if (txn.type === "SELL") {
      const fb = eurPerUnitByTxnId.get(txn.id) ?? null;
      const { eur: proceedsEur } = buySellLineEur(txn, fb);
      const shSell = parseFloat(String(txn.shares));
      if (!(shSell > 0) || !Number.isFinite(proceedsEur)) continue;

      const sellDayIso = txnIsoDate(txn);
      const sellInstant = new Date(txn.transactionDate as unknown as string);
      const y = sellInstant.getUTCFullYear();

      const queue = lots[key] ?? [];
      let toSell = shSell;
      for (const lot of queue) {
        if (toSell <= 0) break;
        if (lot.remainingShares <= 0) continue;
        const take = Math.min(toSell, lot.remainingShares);
        const costPortionEur = take * lot.costPerShareEur;
        const proceedsPortionEur = (take / shSell) * proceedsEur;
        const gainEur = proceedsPortionEur - costPortionEur;
        const acquiredT = new Date(`${lot.acquiredAt}T00:00:00Z`);
        const holdingAtLeast365Days =
          Number.isFinite(sellInstant.getTime()) &&
          sellInstant.getTime() - acquiredT.getTime() >= MS_365D;
        out.push({
          sellTransactionId: txn.id,
          acquiredAt: lot.acquiredAt,
          sellDate: sellDayIso,
          saleYear: y,
          shares: take,
          costEur: costPortionEur,
          proceedsEur: proceedsPortionEur,
          gainEur,
          holdingAtLeast365Days,
          ticker: txn.ticker,
        });
        lot.remainingShares -= take;
        toSell -= take;
      }
    }
  }

  return out;
}
