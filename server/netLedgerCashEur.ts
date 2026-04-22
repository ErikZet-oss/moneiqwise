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

  const eurM = await buildEurPerUnitByTxnIdForTransactions(list);
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
): Promise<number> {
  const b = await computeCashLedgerBreakdownEur(list, rates);
  return b.netCashEur;
}

/** O koľko sa zmení hotovosť jednou transakciou (+ prírastok, − odtok / výber kapitálu pri BUY). */
export async function getCashEffectEurForTransaction(
  t: Transaction,
  eurM: Map<string, number | null>,
  rates: AllExchangeRates,
): Promise<number> {
  if (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") {
    return sumCashFlowEurFromRows([t]);
  }
  if (t.type === "BUY" || t.type === "SELL") {
    const { eur } = buySellLineEur(t, eurM.get(t.id) ?? null);
    if (!Number.isFinite(eur)) return 0;
    return t.type === "BUY" ? -eur : eur;
  }
  if (t.type === "DIVIDEND") {
    const eurB = eurBaseFromRow(t);
    if (eurB !== null) return eurB;
    const sh = parseFloat(t.shares);
    const p = parseFloat(t.pricePerShare);
    const tax = parseFloat(t.commission || "0");
    const ccy = inferTradeCurrency(t);
    const lineNet = sh * p - tax;
    if (!Number.isFinite(lineNet)) return 0;
    return convertAmountBetween(lineNet, ccy, "EUR", rates);
  }
  if (t.type === "TAX") {
    const eurB = eurBaseFromRow(t);
    if (eurB !== null) return eurB;
    const sh = parseFloat(t.shares);
    const p = parseFloat(t.pricePerShare);
    const ccy = inferTradeCurrency(t);
    const v = sh * p;
    if (!Number.isFinite(v)) return 0;
    return convertAmountBetween(v, ccy, "EUR", rates);
  }
  return 0;
}

export type CashLedgerFlowRow = {
  id: string;
  transactionDate: string;
  type: string;
  ticker: string;
  companyName: string;
  effectEur: number;
  runningEur: number;
  lineEurAbsForTrade?: number;
  baseCurrencyAmount: string | null;
  commission: string | null;
};

/**
 * Všetky transakcie časovo zoradené s kumulatívnou hotovosťou (bežíci zostatok).
 * Pri `firstNegativeIndex` môžete nájsť prvý mínusový stav.
 */
export async function computeCashLedgerFlowEur(
  list: Transaction[],
  rates: AllExchangeRates,
): Promise<{
  rows: CashLedgerFlowRow[];
  firstRunningNegative: { atIndex: number; atDate: string; runningEur: number } | null;
}> {
  if (list.length === 0) {
    return { rows: [], firstRunningNegative: null };
  }
  const eurM = await buildEurPerUnitByTxnIdForTransactions(list);
  const withEffect: { t: Transaction; e: number }[] = [];
  for (const t of list) {
    const e = await getCashEffectEurForTransaction(t, eurM, rates);
    withEffect.push({ t, e: Number.isFinite(e) ? e : 0 });
  }
  const sorted = [...withEffect].sort((a, b) => {
    const da = new Date(a.t.transactionDate as unknown as string).getTime();
    const db = new Date(b.t.transactionDate as unknown as string).getTime();
    if (da !== db) return da - db;
    return String(a.t.id).localeCompare(String(b.t.id));
  });
  let run = 0;
  const rows: CashLedgerFlowRow[] = [];
  let firstRunningNegative: {
    atIndex: number;
    atDate: string;
    runningEur: number;
  } | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const { t, e } = sorted[i]!;
    run += e;
    const { eur: lineEur } =
      t.type === "BUY" || t.type === "SELL"
        ? buySellLineEur(t, eurM.get(t.id) ?? null)
        : { eur: 0 as number };
    const row: CashLedgerFlowRow = {
      id: t.id,
      transactionDate: new Date(t.transactionDate as unknown as string).toISOString(),
      type: t.type,
      ticker: t.ticker,
      companyName: t.companyName,
      effectEur: e,
      runningEur: run,
      baseCurrencyAmount: t.baseCurrencyAmount != null ? String(t.baseCurrencyAmount) : null,
      commission: t.commission != null ? String(t.commission) : null,
    };
    if (t.type === "BUY" || t.type === "SELL") {
      row.lineEurAbsForTrade = Number.isFinite(lineEur) ? Math.abs(lineEur) : undefined;
    }
    if (firstRunningNegative == null && run < 0) {
      firstRunningNegative = {
        atIndex: i,
        atDate: row.transactionDate,
        runningEur: run,
      };
    }
    rows.push(row);
  }
  return { rows, firstRunningNegative };
}

export type TopBuyRow = {
  id: string;
  transactionDate: string;
  ticker: string;
  companyName: string;
  eur: number;
  baseCurrencyAmount: string | null;
  shares: string;
  pricePerShare: string;
  commission: string | null;
};

export async function computeTopBuyRowsByEur(
  list: Transaction[],
  eurM: Map<string, number | null>,
  limit: number,
): Promise<TopBuyRow[]> {
  const buys = list.filter((t) => t.type === "BUY");
  const rows: { t: Transaction; eur: number }[] = [];
  for (const t of buys) {
    const { eur } = buySellLineEur(t, eurM.get(t.id) ?? null);
    if (!Number.isFinite(eur)) continue;
    rows.push({ t, eur: Math.abs(eur) });
  }
  rows.sort((a, b) => b.eur - a.eur);
  return rows.slice(0, limit).map(({ t, eur }) => ({
    id: t.id,
    transactionDate: new Date(t.transactionDate as unknown as string).toISOString(),
    ticker: t.ticker,
    companyName: t.companyName,
    eur,
    baseCurrencyAmount: t.baseCurrencyAmount != null ? String(t.baseCurrencyAmount) : null,
    shares: t.shares,
    pricePerShare: t.pricePerShare,
    commission: t.commission != null ? String(t.commission) : null,
  }));
}
