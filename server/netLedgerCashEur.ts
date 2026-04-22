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

export type CashLedgerBreakdownEur = {
  currency: "EUR";
  /** Súčet vkladov (vždy kladné prírastky) */
  depositsEur: number;
  /** Súčet výberov (záporné, ak sú v dátach so znamienkom) */
  withdrawalsEur: number;
  /** Súčet hotovostného predaja nákupov (kladné číslo) */
  buysEur: number;
  /** Súčet príjmov z predajov (kladné číslo) */
  sellsEur: number;
  dividendsEur: number;
  taxEur: number;
  netCashEur: number;
  /** Počty riadkov podľa typu; `unknown` = neznámy typ (nemal by nastať) */
  counts: Record<string, number>;
};

/**
 * Rovnaká logika ako `netLedgerCashEur` — jeden prechod, vráti aj čiastkové súčty na kontrolu.
 */
export async function computeCashLedgerBreakdownEur(
  list: Transaction[],
  rates: AllExchangeRates,
  /** Ak je zadané (napr. z jedného buildEur pre viac portfólií), preskočí sa druhé Frankfurter volanie. */
  prebuiltEurPerTxn?: Map<string, number | null>,
): Promise<CashLedgerBreakdownEur> {
  const empty: CashLedgerBreakdownEur = {
    currency: "EUR",
    depositsEur: 0,
    withdrawalsEur: 0,
    buysEur: 0,
    sellsEur: 0,
    dividendsEur: 0,
    taxEur: 0,
    netCashEur: 0,
    counts: {},
  };
  if (list.length === 0) return empty;

  const eurM =
    prebuiltEurPerTxn ?? (await buildEurPerUnitByTxnIdForTransactions(list));
  const counts: Record<string, number> = {};
  const bump = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };

  let depositsEur = 0;
  let withdrawalsEur = 0;
  let buysEur = 0;
  let sellsEur = 0;
  let dividendsEur = 0;
  let taxEur = 0;
  let net = 0;

  for (const t of list) {
    if (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") {
      const line = sumCashFlowEurFromRows([t]);
      if (t.type === "DEPOSIT") {
        depositsEur += line;
      } else {
        withdrawalsEur += line;
      }
      net += line;
      bump(t.type);
      continue;
    }
    if (t.type === "BUY" || t.type === "SELL") {
      const { eur } = buySellLineEur(t, eurM.get(t.id) ?? null);
      if (!Number.isFinite(eur)) continue;
      if (t.type === "BUY") {
        buysEur += eur;
        net -= eur;
      } else {
        sellsEur += eur;
        net += eur;
      }
      bump(t.type);
      continue;
    }
    if (t.type === "DIVIDEND") {
      const eurB = eurBaseFromRow(t);
      let add = 0;
      if (eurB !== null) {
        add = eurB;
      } else {
        const sh = parseFloat(t.shares);
        const p = parseFloat(t.pricePerShare);
        const tax = parseFloat(t.commission || "0");
        const ccy = inferTradeCurrency(t);
        const lineNet = sh * p - tax;
        if (Number.isFinite(lineNet)) add = convertAmountBetween(lineNet, ccy, "EUR", rates);
      }
      dividendsEur += add;
      net += add;
      bump("DIVIDEND");
      continue;
    }
    if (t.type === "TAX") {
      const eurB = eurBaseFromRow(t);
      let add = 0;
      if (eurB !== null) {
        add = eurB;
      } else {
        const sh = parseFloat(t.shares);
        const p = parseFloat(t.pricePerShare);
        const ccy = inferTradeCurrency(t);
        const v = sh * p;
        if (Number.isFinite(v)) add = convertAmountBetween(v, ccy, "EUR", rates);
      }
      taxEur += add;
      net += add;
      bump("TAX");
      continue;
    }
    counts.unknown = (counts.unknown ?? 0) + 1;
  }

  return {
    currency: "EUR",
    depositsEur,
    withdrawalsEur,
    buysEur,
    sellsEur,
    dividendsEur,
    taxEur,
    netCashEur: net,
    counts,
  };
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
  prebuiltEurPerTxn?: Map<string, number | null>,
): Promise<number> {
  const b = await computeCashLedgerBreakdownEur(list, rates, prebuiltEurPerTxn);
  return b.netCashEur;
}
