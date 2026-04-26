import type { Transaction } from "./schema";
import { isCloseTradeCashRow } from "./sellCloseTradeFallback";

type CashLineLike = Pick<
  Transaction,
  "type" | "ticker" | "shares" | "pricePerShare" | "baseCurrencyAmount"
>;

/**
 * Súčet hotovosti v EUR (základ) z vkladov a výberov.
 * Preferuje `baseCurrencyAmount`; inak cena * počet (pri hotovosťových riadkoch býva 1 * suma so znamienkom).
 */
export function sumCashFlowEurFromRows(rows: CashLineLike[]): number {
  let s = 0;
  for (const t of rows) {
    if (t.type !== "DEPOSIT" && t.type !== "WITHDRAWAL") continue;
    const fromBase =
      t.baseCurrencyAmount != null && String(t.baseCurrencyAmount).trim() !== ""
        ? parseFloat(String(t.baseCurrencyAmount))
        : NaN;
    const line = Number.isFinite(fromBase)
      ? fromBase
      : parseFloat(String(t.shares)) * parseFloat(String(t.pricePerShare));
    if (Number.isFinite(line)) s += line;
  }
  return s;
}

type CashWithName = CashLineLike & { companyName?: string | null };

/**
 * Súčet v EUR (základ) z vkladov / výberov označených ako XTB *close trade*
 * (import ukladá `companyName` s podreťazcom "close trade").
 * Toto **nie** súčasť FIFO z akcií (BUY/SELL) — doplňuje hotovosť, ktorú broker
 * môže účtovať oddelene od riadku typu predaj.
 */
export function sumCloseTradeCashFlowEurFromRows(rows: CashWithName[]): number {
  const only = rows.filter(
    (t) =>
      (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") && isCloseTradeCashRow(t as Transaction),
  );
  return sumCashFlowEurFromRows(only);
}

/** Rovnaká logika ako `sumCashFlowEurFromRows` pre plné `Transaction` polia. */
export function sumCashFlowEurFromTransactions(transactions: Transaction[]): number {
  return sumCashFlowEurFromRows(transactions);
}

/**
 * Hotovosť (EUR) k okamihu **konca dňa** `asOf` (včítane transakcií s dátumom tento deň v lokálnom čase).
 */
export function sumCashFlowEurUpTo(
  transactions: Pick<Transaction, "type" | "ticker" | "shares" | "pricePerShare" | "baseCurrencyAmount" | "transactionDate">[],
  asOfDateEndOfDay: Date,
): number {
  const limit = asOfDateEndOfDay.getTime();
  const sub = transactions.filter((t) => {
    if (t.type !== "DEPOSIT" && t.type !== "WITHDRAWAL") return false;
    const ts = new Date(t.transactionDate as unknown as string).getTime();
    return ts <= limit;
  });
  return sumCashFlowEurFromRows(sub);
}
