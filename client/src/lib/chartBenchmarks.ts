/** Benchmarky pre porovnanie na dashboarde (graf vývoja portfólia). */

export type ChartBenchmarkId = "sp500" | "msciWorld" | "nasdaq";

export type ChartBenchmarkOption = {
  id: ChartBenchmarkId;
  /** Krátky názov v ľavom hornom rohu grafu */
  label: string;
  /** Popis v selecte */
  description: string;
};

export const CHART_BENCHMARK_OPTIONS: ChartBenchmarkOption[] = [
  {
    id: "sp500",
    label: "S&P 500",
    description: "Americký index veľkých firiem",
  },
  {
    id: "msciWorld",
    label: "MSCI World",
    description: "Globálne akcie rozvinutých trhov",
  },
  {
    id: "nasdaq",
    label: "Nasdaq",
    description: "Technologický index Nasdaq Composite",
  },
];

export const DEFAULT_CHART_BENCHMARK: ChartBenchmarkId = "sp500";

export function isChartBenchmarkId(raw: unknown): raw is ChartBenchmarkId {
  return raw === "sp500" || raw === "msciWorld" || raw === "nasdaq";
}

export function chartBenchmarkLabel(id: ChartBenchmarkId): string {
  return CHART_BENCHMARK_OPTIONS.find((o) => o.id === id)?.label ?? "S&P 500";
}

/** Oranžová pastelová čiara pre benchmark (light / dark). */
export function chartBenchmarkStroke(theme: "light" | "dark"): string {
  return theme === "dark" ? "hsl(28 72% 68%)" : "hsl(28 78% 58%)";
}

export type BenchmarkHistoryPoint = { date: string; close: number };

export type BenchmarkHistoryRes = {
  id: ChartBenchmarkId;
  label: string;
  symbol: string | null;
  points: BenchmarkHistoryPoint[];
};

function lookupCloseOnOrBefore(
  closesByDate: Map<string, number>,
  iso: string,
): number | null {
  if (closesByDate.has(iso)) return closesByDate.get(iso)!;
  // Lookback cez víkendy / sviatky (max 14 dní).
  const d = new Date(`${iso}T12:00:00.000Z`);
  for (let i = 1; i <= 14; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const key = d.toISOString().slice(0, 10);
    if (closesByDate.has(key)) return closesByDate.get(key)!;
  }
  return null;
}

/**
 * Kumulatívny % výnos indexu od prvého dňa rozsahu: (close_t / close_0 − 1) × 100.
 * Rovnaká logika ako na stránke Grafy — obe krivky sú porovnateľné.
 */
export function benchmarkCumulativePct(
  dates: string[],
  closesByDate: Map<string, number>,
): (number | null)[] {
  if (dates.length === 0) return [];
  const base = lookupCloseOnOrBefore(closesByDate, dates[0]!);
  if (base == null || !(base > 0)) {
    return dates.map(() => null);
  }
  return dates.map((iso) => {
    const c = lookupCloseOnOrBefore(closesByDate, iso);
    if (c == null || !(c > 0)) return null;
    return (c / base - 1) * 100;
  });
}

/**
 * Kumulatívny % výnos portfólia v rozsahu po odpočítaní čistých vkladov:
 *   gain_t = value_t − value_0 − (invested_t − invested_0)
 *   pct_t  = gain_t / value_0 × 100
 * (na t=0 je 0 %). Bez tohto by vklady „nafúkli“ zelenú krivku oproti indexu.
 */
export function portfolioCumulativePctSeries(
  values: number[],
  invested: number[],
): number[] {
  if (values.length === 0) return [];
  const v0 = values[0]!;
  const i0 = invested[0] ?? 0;
  if (!(v0 > 0)) return values.map(() => 0);
  return values.map((v, idx) => {
    const inv = invested[idx] ?? i0;
    const netInflow = inv - i0;
    const gain = v - v0 - netInflow;
    return (gain / v0) * 100;
  });
}

/**
 * @deprecated Použi `benchmarkCumulativePct` — abs. rebase vyzerá na grafe ako rovná čiara,
 * keď portfólio rastie hlavne vkladmi.
 */
export function rebaseBenchmarkToStart(
  dates: string[],
  closesByDate: Map<string, number>,
  startValue: number,
): (number | null)[] {
  const pct = benchmarkCumulativePct(dates, closesByDate);
  if (!(startValue > 0)) return dates.map(() => null);
  return pct.map((p) => (p == null ? null : startValue * (1 + p / 100)));
}
