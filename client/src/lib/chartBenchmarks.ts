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

/**
 * Prelož indexové uzávierky na „hypotetickú“ hodnotu portfólia:
 * na prvý deň = startValue, ďalej rastie/klesá rovnako ako index.
 */
export function rebaseBenchmarkToStart(
  dates: string[],
  closesByDate: Map<string, number>,
  startValue: number,
): (number | null)[] {
  if (dates.length === 0 || !(startValue > 0)) {
    return dates.map(() => null);
  }

  const lookupClose = (iso: string): number | null => {
    if (closesByDate.has(iso)) return closesByDate.get(iso)!;
    // Lookback cez víkendy / sviatky (max 10 dní).
    const d = new Date(`${iso}T12:00:00.000Z`);
    for (let i = 1; i <= 10; i++) {
      d.setUTCDate(d.getUTCDate() - 1);
      const key = d.toISOString().slice(0, 10);
      if (closesByDate.has(key)) return closesByDate.get(key)!;
    }
    return null;
  };

  const base = lookupClose(dates[0]!);
  if (base == null || !(base > 0)) {
    return dates.map(() => null);
  }

  return dates.map((iso) => {
    const c = lookupClose(iso);
    if (c == null || !(c > 0)) return null;
    return startValue * (c / base);
  });
}
