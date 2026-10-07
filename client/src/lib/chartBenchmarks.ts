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
 * Najbližšia uzávierka ≤ iso (binárne hľadanie).
 * Dôležité pre „Vše“ (vzorkovanie každých ~30 dní) — krátky lookback 14 dní nestačí.
 */
export function lookupCloseOnOrBefore(
  closesByDate: Map<string, number>,
  iso: string,
  sortedKeys?: string[],
): number | null {
  if (closesByDate.has(iso)) {
    const v = closesByDate.get(iso)!;
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  const keys =
    sortedKeys ??
    Array.from(closesByDate.keys())
      .filter((k) => {
        const v = closesByDate.get(k);
        return v != null && Number.isFinite(v) && v > 0;
      })
      .sort();
  if (keys.length === 0) return null;

  let lo = 0;
  let hi = keys.length - 1;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = keys[mid]!;
    if (k <= iso) {
      best = k;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best == null) return null;
  const v = closesByDate.get(best);
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

export type ComparisonPctPoint = {
  portfolioPct: number;
  benchmarkPct: number | null;
};

export type ComparisonPctSeries = {
  /** Index prvého dňa so spoločnými dátami (orezať graf odtiaľ). */
  startIndex: number;
  points: ComparisonPctPoint[];
};

/**
 * Spoločný % graf portfólio vs. index.
 *
 * Portfólio (rovnaká logika ako period gain na dashboarde):
 *   gain = value_t − value_0 − (invested_t − invested_0)
 *   denom = value_0 + max(invested_t − invested_0, 0)
 *   pct = gain / denom × 100
 *
 * Delenie len pevným value_0 pri „Vše“ dáva tisíce % (malý štart + neskôr veľké
 * vklady) a index na spoločnej osi vyzerá ako rovná čiara.
 *
 * Index: (close_t / close_0 − 1) × 100 od prvého spoločného dňa.
 */
export function buildComparisonPctSeries(
  dates: string[],
  values: number[],
  invested: number[],
  closesByDate: Map<string, number>,
): ComparisonPctSeries {
  const n = dates.length;
  if (n === 0) return { startIndex: 0, points: [] };

  const sortedKeys = Array.from(closesByDate.keys())
    .filter((k) => {
      const v = closesByDate.get(k);
      return v != null && Number.isFinite(v) && v > 0;
    })
    .sort();

  const lastInvested = Math.abs(invested[n - 1] ?? 0);
  // Preskoč „prvý drobný vklad“ — inak % od pár eur vyletí na tisíce.
  const minCapital = Math.max(100, lastInvested * 0.02);

  let start = -1;
  for (let i = 0; i < n; i++) {
    const v = values[i] ?? 0;
    const inv = invested[i] ?? 0;
    const c = lookupCloseOnOrBefore(closesByDate, dates[i]!, sortedKeys);
    if (Math.max(Math.abs(v), Math.abs(inv)) >= minCapital && c != null) {
      start = i;
      break;
    }
  }

  // Fallback: prvý deň s hodnotou > 0 a indexom
  if (start < 0) {
    for (let i = 0; i < n; i++) {
      const v = values[i] ?? 0;
      const c = lookupCloseOnOrBefore(closesByDate, dates[i]!, sortedKeys);
      if (v > 1e-6 && c != null) {
        start = i;
        break;
      }
    }
  }

  if (start < 0) {
    return {
      startIndex: 0,
      points: dates.map(() => ({ portfolioPct: 0, benchmarkPct: null })),
    };
  }

  const v0 = values[start]!;
  const i0 = invested[start] ?? 0;
  const c0 = lookupCloseOnOrBefore(closesByDate, dates[start]!, sortedKeys)!;

  const points = dates.map((iso, idx) => {
    if (idx < start) {
      return { portfolioPct: 0, benchmarkPct: null };
    }
    const v = values[idx]!;
    const inv = invested[idx] ?? i0;
    const netInflow = inv - i0;
    const gain = v - v0 - netInflow;
    const denom = v0 + Math.max(netInflow, 0);
    const portfolioPct = denom > 1e-9 ? (gain / denom) * 100 : 0;

    const c = lookupCloseOnOrBefore(closesByDate, iso, sortedKeys);
    const benchmarkPct =
      c != null && c0 > 0 ? (c / c0 - 1) * 100 : null;

    return { portfolioPct, benchmarkPct };
  });

  return { startIndex: start, points };
}
