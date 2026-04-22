import type { Transaction } from "@shared/schema";
import { sumCashFlowEurFromRows } from "@shared/cashFromTransactions";
import { buySellLineEur, inferTradeCurrency } from "@shared/transactionEur";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";
import { convertAmountBetween, type AllExchangeRates } from "./convertAmountBetween";

function eurBaseFromRow(t: Pick<Transaction, "baseCurrencyAmount">): number | null {
  if (t.baseCurrencyAmount == null) return null;
  const s = String(t.baseCurrencyAmount).trim();
  if (s === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Očakávané dispo hotovosť (EUR) z účtovania tokov: vklady/výbery,
 * nákup/predaj titulov (s kurzom z riadka alebo Frankfurterom),
 * dividendy a dane. Peniaze zaplatené za nákup sa tým odpočítajú
 * od sčítania s trhovou hodnotou pozícií (inak by bol dvojitý pripočet).
 */
export async function netLedgerCashEur(
  list: Transaction[],
  rates: AllExchangeRates,
): Promise<number> {
  if (list.length === 0) return 0;
  const eurM = await buildEurPerUnitByTxnIdForTransactions(list);
  let s = 0;
  for (const t of list) {
    if (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") {
      s += sumCashFlowEurFromRows([t]);
      continue;
    }
    if (t.type === "BUY" || t.type === "SELL") {
      const { eur } = buySellLineEur(t, eurM.get(t.id) ?? null);
      if (!Number.isFinite(eur)) continue;
      if (t.type === "BUY") {
        s -= eur;
      } else {
        s += eur;
      }
      continue;
    }
    if (t.type === "DIVIDEND") {
      // U importu (XTB) je hotovosť v EUR v baseCurrencyAmount; pôvodne sa tu mena brala
      // z tickera (USD) — suma pri USD titule sa omylom brala ako USD, nie ako EUR z výpisu.
      const eurB = eurBaseFromRow(t);
      if (eurB !== null) {
        s += eurB;
        continue;
      }
      const sh = parseFloat(t.shares);
      const p = parseFloat(t.pricePerShare);
      const tax = parseFloat(t.commission || "0");
      const ccy = inferTradeCurrency(t);
      const net = sh * p - tax;
      if (Number.isFinite(net)) s += convertAmountBetween(net, ccy, "EUR", rates);
      continue;
    }
    if (t.type === "TAX") {
      const eurB = eurBaseFromRow(t);
      if (eurB !== null) {
        s += eurB;
        continue;
      }
      const sh = parseFloat(t.shares);
      const p = parseFloat(t.pricePerShare);
      const ccy = inferTradeCurrency(t);
      const v = sh * p;
      if (Number.isFinite(v)) s += convertAmountBetween(v, ccy, "EUR", rates);
    }
  }
  return s;
}
