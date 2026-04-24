import type { Transaction } from "@shared/schema";
import { mtmValueAtEod } from "./gipsMtmValue";
import { sumCashFlowEurUpTo } from "@shared/cashFromTransactions";
import { convertAmountBetween, type AllExchangeRates } from "./convertAmountBetween";

export type PortfolioHistoryRange = "1m" | "6m" | "ytd" | "1y" | "all";

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function spCloseOnOrBefore(
  h: Record<string, number> | undefined,
  iso: string,
): number | null {
  if (!h) return null;
  if (h[iso] != null && Number.isFinite(h[iso])) return h[iso]!;
  for (let i = 1; i <= 30; i++) {
    const t = addDaysIso(iso, -i);
    if (h[t] != null && Number.isFinite(h[t])) return h[t]!;
  }
  return null;
}

function toUserCcy(
  eur: number,
  userCcy: string,
  rates: AllExchangeRates,
): number {
  if (userCcy === "EUR") return eur;
  return convertAmountBetween(eur, "EUR", userCcy, rates);
}

/**
 * Dátumy v intervale (krok) tak, aby najviac `maxPoints` bodov.
 */
export function subsampleDateRange(
  startIso: string,
  endIso: string,
  maxPoints: number,
): string[] {
  if (startIso > endIso) return [];
  const end = new Date(`${endIso}T12:00:00.000Z`);
  let d = new Date(`${startIso}T12:00:00.000Z`);
  let n = 0;
  for (let t = d.getTime(); t <= end.getTime(); t += 86400000) n++;
  const step = Math.max(1, Math.ceil(n / Math.max(1, maxPoints)));
  const out: string[] = [];
  let i = 0;
  d = new Date(`${startIso}T12:00:00.000Z`);
  while (d.getTime() <= end.getTime()) {
    if (i % step === 0) {
      out.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
  }
  const last = end.toISOString().slice(0, 10);
  if (out.length === 0) out.push(startIso);
  if (out[out.length - 1] !== last) out.push(last);
  return Array.from(new Set(out)).sort();
}

function rangeToStartIso(
  range: PortfolioHistoryRange,
  endIso: string,
  firstTxIso: string,
): string {
  const end = new Date(`${endIso}T12:00:00.000Z`);
  const start = new Date(end);
  if (range === "1m") {
    start.setUTCMonth(start.getUTCMonth() - 1);
  } else if (range === "6m") {
    start.setUTCMonth(start.getUTCMonth() - 6);
  } else if (range === "ytd") {
    return `${end.getUTCFullYear()}-01-01`;
  } else if (range === "1y") {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  } else {
    return firstTxIso;
  }
  return start.toISOString().slice(0, 10);
}

export type HistoryPoint = {
  date: string;
  totalValue: number;
  netInvested: number;
  /** Segmentovo reťaz. výnos po odpoč. tokov; aprox. TWR. */
  portfolioCumulativePct: number;
  /** (S_t / S_start − 1) * 100 */
  sp500CumulativePct: number;
};

/**
 * Denné / vybrané dni MTM (rovnaký motor ako TWR) + porovnateľné % k S&amp;P 500.
 */
export function computePortfolioHistorySeries(
  sortedTx: Transaction[],
  spHist: Record<string, number>,
  historicalByTicker: Record<string, Record<string, number>>,
  currentPrices: Record<string, number>,
  rates: AllExchangeRates,
  userCcy: string,
  endIso: string,
  range: PortfolioHistoryRange,
  maxPoints = 150,
): {
  points: HistoryPoint[];
  startIso: string;
  endIso: string;
  currency: string;
  methodNote: string;
} {
  if (sortedTx.length === 0) {
    return {
      points: [],
      startIso: endIso,
      endIso,
      currency: userCcy,
      methodNote: "Bez transakcií",
    };
  }
  const firstTxIso = new Date(sortedTx[0]!.transactionDate as unknown as string)
    .toISOString()
    .slice(0, 10);
  let startIso = rangeToStartIso(range, endIso, firstTxIso);
  if (startIso < firstTxIso) startIso = firstTxIso;
  if (startIso > endIso) {
    return {
      points: [],
      startIso,
      endIso,
      currency: userCcy,
      methodNote: "Neplatný rozsah",
    };
  }
  const hasSp = spHist && Object.keys(spHist).length > 0;
  if (!hasSp) {
    // Graf celkovej hodnoty a investované ostávajú; benchmark len 0.
  }

  const dates = subsampleDateRange(startIso, endIso, maxPoints);
  const todayIso = endIso;
  const points: HistoryPoint[] = [];
  let cumFactor = 1;
  const sStart = hasSp ? spCloseOnOrBefore(spHist, dates[0]!) : null;

  for (let i = 0; i < dates.length; i++) {
    const iso = dates[i]!;
    const eod = new Date(`${iso}T23:59:59.999Z`);
    const V = mtmValueAtEod(
      sortedTx,
      iso,
      historicalByTicker,
      currentPrices,
      rates,
      userCcy,
      todayIso,
    );
    /** Rovnaká báza ako hotovosť v `mtmValueAtEod`: všetky DEPOSIT/WITHDRAWAL. */
    const netEur = sumCashFlowEurUpTo(sortedTx, eod);
    const N = toUserCcy(netEur, userCcy, rates);

    if (i > 0) {
      const prevIso = dates[i - 1]!;
      const eodP = new Date(`${prevIso}T23:59:59.999Z`);
      const v0 = mtmValueAtEod(
        sortedTx,
        prevIso,
        historicalByTicker,
        currentPrices,
        rates,
        userCcy,
        todayIso,
      );
      const n0U = toUserCcy(sumCashFlowEurUpTo(sortedTx, eodP), userCcy, rates);
      const dN = N - n0U;
      if (v0 > 1e-9) {
        const r = (V - v0 - dN) / v0;
        if (Number.isFinite(r) && r > -0.999) cumFactor *= 1 + r;
      }
    }
    const st = hasSp ? (spCloseOnOrBefore(spHist, iso) ?? sStart) : null;
    const sp500CumulativePct =
      hasSp && sStart != null && sStart > 0 && st != null
        ? (st / sStart - 1) * 100
        : 0;
    const portfolioCumulativePct = (cumFactor - 1) * 100;

    points.push({
      date: iso,
      totalValue: V,
      netInvested: N,
      portfolioCumulativePct,
      sp500CumulativePct,
    });
  }

  return {
    points,
    startIso: dates[0] ?? startIso,
    endIso: dates[dates.length - 1] ?? endIso,
    currency: userCcy,
    methodNote:
      "Celková hodnota = oceňovanie účtovaných transakcií a hotovosť (mtmValueAtEod, ako TWR). " +
      "Čisté vklady − výbery = súčet všetkých DEPOSIT/WITHDRAWAL do daného dňa (rovnako ako hotovosť v celkovej hodnote). " +
      (hasSp
        ? "Kumulatívny % portfólia: reťaz. segmenty výnosov (V−V0−ΔN)/V0 medzi dátumami; S&P: uzávierky voči prvému dňu rozsahu. "
        : "S&P 500 nebolo možné načítať; benchmark 0 %. ") +
      "Krivky % v prvom bode: 0.",
  };
}
