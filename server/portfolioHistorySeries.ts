import type { Transaction } from "@shared/schema";
import { mtmValueAtEod } from "./gipsMtmValue";
import { sumCashFlowEurUpTo } from "@shared/cashFromTransactions";
import { convertAmountBetween, type AllExchangeRates } from "./convertAmountBetween";

export type PortfolioHistoryRange = "1m" | "3m" | "6m" | "ytd" | "1y" | "all";

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
  if (h[iso] != null && Number.isFinite(h[iso]!)) return h[iso]!;
  // Rýchly lookback na víkendy / sviatky.
  for (let i = 1; i <= 10; i++) {
    const t = addDaysIso(iso, -i);
    if (h[t] != null && Number.isFinite(h[t]!)) return h[t]!;
  }
  const sorted = Object.keys(h)
    .filter((k) => Number.isFinite(h[k]!))
    .sort();
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = sorted[mid]!;
    if (k <= iso) {
      best = k;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best != null ? h[best]! : null;
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
 * Dashboard graf — hustota bodov podľa rozsahu:
 * 1M denne, 3M/6M/YTD/1Y každých 5 dní, Všetko každých 30 dní.
 */
export function stepDaysForHistoryRange(range: PortfolioHistoryRange): number {
  if (range === "1m") return 1;
  if (range === "all") return 30;
  return 5;
}

/** Dátumy od start do end s pevným krokom (vždy vrátane začiatku a konca). */
export function dateRangeWithStep(
  startIso: string,
  endIso: string,
  stepDays: number,
): string[] {
  if (startIso > endIso) return [];
  const step = Math.max(1, Math.floor(stepDays) || 1);
  const end = new Date(`${endIso}T12:00:00.000Z`);
  const out: string[] = [];
  let d = new Date(`${startIso}T12:00:00.000Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + step);
  }
  const last = endIso.slice(0, 10);
  if (out.length === 0) out.push(startIso.slice(0, 10));
  if (out[out.length - 1] !== last) out.push(last);
  return Array.from(new Set(out)).sort();
}

/**
 * Snapshot úložisko: posledných ~30 dní denne, staršie každých 5 dní.
 * Rýchly backfill + dostatok dát na 1M/3M/6M/YTD.
 */
export function hybridSnapshotDates(startIso: string, endIso: string): string[] {
  if (startIso > endIso) return [];
  const recentStart = addDaysIso(endIso, -30);
  const cutoff = recentStart < startIso ? startIso : recentStart;
  const olderEnd = addDaysIso(cutoff, -1);
  const older =
    startIso <= olderEnd ? dateRangeWithStep(startIso, olderEnd, 5) : [];
  const recent = dateRangeWithStep(cutoff, endIso, 1);
  return Array.from(new Set([...older, ...recent])).sort();
}

/**
 * Dátumy v intervale (krok) tak, aby najviac `maxPoints` bodov.
 * (TWR — dashboard graf používa `dateRangeWithStep`.)
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
  return dateRangeWithStep(startIso, endIso, step);
}

/** Z hustých snapshotov vyber body podľa kroku rozsahu (najbližší predchádzajúci deň). */
export function subsampleRowsByStepDays<T extends { date: string }>(
  rows: T[],
  stepDays: number,
): T[] {
  if (rows.length === 0) return [];
  if (stepDays <= 1) return rows;
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const start = rows[0]!.date;
  const end = rows[rows.length - 1]!.date;
  const want = dateRangeWithStep(start, end, stepDays);
  const out: T[] = [];
  for (const d of want) {
    let hit = byDate.get(d);
    if (!hit) {
      for (let i = 1; i <= stepDays + 5 && !hit; i++) {
        hit = byDate.get(addDaysIso(d, -i));
      }
    }
    if (hit && (out.length === 0 || out[out.length - 1]!.date !== hit.date)) {
      out.push(hit);
    }
  }
  const last = rows[rows.length - 1]!;
  if (out.length === 0 || out[out.length - 1]!.date !== last.date) out.push(last);
  return out;
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
  } else if (range === "3m") {
    start.setUTCMonth(start.getUTCMonth() - 3);
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
 * `@deprecated maxPoints` — dashboard používa krok podľa `range`; parameter ostáva kvôli API.
 */
export function computePortfolioHistorySeries(
  sortedTx: Transaction[],
  spHist: Record<string, number>,
  historicalByTicker: Record<string, Record<string, number>>,
  historicalFxEurPerUnitByCurrency: Record<string, Record<string, number>>,
  currentPrices: Record<string, number>,
  rates: AllExchangeRates,
  userCcy: string,
  endIso: string,
  range: PortfolioHistoryRange,
  _maxPoints = 150,
  opts?: { dates?: string[]; stepDays?: number },
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

  const stepDays = opts?.stepDays ?? stepDaysForHistoryRange(range);
  const dates =
    opts?.dates && opts.dates.length > 0
      ? Array.from(
          new Set(opts.dates.filter((d) => d >= startIso && d <= endIso)),
        ).sort()
      : dateRangeWithStep(startIso, endIso, stepDays);

  const todayIso = endIso;
  const points: HistoryPoint[] = [];
  let cumFactor = 1;
  const sStart = hasSp && dates[0] ? spCloseOnOrBefore(spHist, dates[0]) : null;

  for (let i = 0; i < dates.length; i++) {
    const iso = dates[i]!;
    const eod = new Date(`${iso}T23:59:59.999Z`);
    const V = mtmValueAtEod(
      sortedTx,
      iso,
      historicalByTicker,
      historicalFxEurPerUnitByCurrency,
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
        historicalFxEurPerUnitByCurrency,
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
      `Vzorkovanie: každých ${stepDays} d. Krivky % v prvom bode: 0.`,
  };
}

/**
 * Reťazený TWR % medzi startIso a endIso (vrátane) — rovnaká logika ako
 * `portfolioCumulativePct` v histórii / YTD na dashboarde.
 * `maxPoints` limituje počet denných kotiev (výkon).
 */
export function computeChainedTwrPercent(
  sortedTx: Transaction[],
  startIso: string,
  endIso: string,
  historicalByTicker: Record<string, Record<string, number>>,
  historicalFxEurPerUnitByCurrency: Record<string, Record<string, number>>,
  currentPrices: Record<string, number>,
  rates: AllExchangeRates,
  userCcy: string,
  todayIso: string,
  maxPoints = 48,
): number {
  if (!startIso || !endIso || startIso > endIso) return 0;
  const dates = subsampleDateRange(startIso, endIso, maxPoints);
  if (dates.length < 2) return 0;

  let cumFactor = 1;
  for (let i = 1; i < dates.length; i++) {
    const iso = dates[i]!;
    const prevIso = dates[i - 1]!;
    const eod = new Date(`${iso}T23:59:59.999Z`);
    const eodP = new Date(`${prevIso}T23:59:59.999Z`);
    const V = mtmValueAtEod(
      sortedTx,
      iso,
      historicalByTicker,
      historicalFxEurPerUnitByCurrency,
      currentPrices,
      rates,
      userCcy,
      todayIso,
    );
    const v0 = mtmValueAtEod(
      sortedTx,
      prevIso,
      historicalByTicker,
      historicalFxEurPerUnitByCurrency,
      currentPrices,
      rates,
      userCcy,
      todayIso,
    );
    const N = toUserCcy(sumCashFlowEurUpTo(sortedTx, eod), userCcy, rates);
    const n0U = toUserCcy(sumCashFlowEurUpTo(sortedTx, eodP), userCcy, rates);
    const dN = N - n0U;
    if (v0 > 1e-9) {
      const r = (V - v0 - dN) / v0;
      if (Number.isFinite(r) && r > -0.999) cumFactor *= 1 + r;
    }
  }
  return (cumFactor - 1) * 100;
}

/**
 * Buy-and-hold výnos S&P 500 (^GSPC) v období: (uzávierka_koniec / uzávierka_začiatok − 1) × 100.
 * Rovnaká logika ako `sp500CumulativePct` na dashboarde / YTD.
 */
export function computeSp500PercentForRange(
  spHist: Record<string, number>,
  startIso: string,
  endIso: string,
): number | null {
  if (!startIso || !endIso || startIso > endIso) return null;
  if (!spHist || Object.keys(spHist).length === 0) return null;
  const s0 = spCloseOnOrBefore(spHist, startIso);
  const s1 = spCloseOnOrBefore(spHist, endIso);
  if (s0 == null || s1 == null || !(s0 > 0)) return null;
  return (s1 / s0 - 1) * 100;
}
