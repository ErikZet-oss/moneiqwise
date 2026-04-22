import type { Transaction } from "@shared/schema";
import { computeFifoRealizedGainsFromTransactions } from "@shared/fifoRealizedGains";
import type { RealizedGainsComputedSummary, RealizedTickerRow } from "@shared/realizedGainsTypes";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";

export type { RealizedGainsComputedSummary, RealizedTickerRow };
export { transactionLotKey } from "@shared/lotKey";

/**
 * FIFO v EUR; historický kurz: `baseCurrencyAmount` alebo `exchangeRateAtTransaction`,
 * inak Frankfurter podľa dňa transakcie.
 */
export async function computeRealizedGainsFromTransactionsAsync(
  userTransactions: Transaction[],
  now = new Date(),
): Promise<RealizedGainsComputedSummary> {
  const m = await buildEurPerUnitByTxnIdForTransactions(userTransactions);
  return computeFifoRealizedGainsFromTransactions(userTransactions, m, now).summary;
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
  return computeFifoRealizedGainsFromTransactions(userTransactions, m, now).summary;
}
