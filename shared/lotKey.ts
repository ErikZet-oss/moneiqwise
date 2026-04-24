import type { Transaction } from "./schema";

/** Kľúč pozície: portfólio + ticker. */
export function transactionLotKey(txn: {
  portfolioId: string | null;
  ticker: string;
}): string {
  const pid = txn.portfolioId ?? "__none__";
  const sym = String(txn.ticker ?? "")
    .trim()
    .toUpperCase();
  return `${pid}::${sym}`;
}
