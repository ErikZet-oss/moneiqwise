import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { format, parse } from "date-fns";
import { sk } from "date-fns/locale";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useTheme } from "@/hooks/useTheme";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PortfolioChartPeriodPicker,
  buildPortfolioHistorySearchParams,
  chartPeriodGainLabel,
  portfolioHistoryQueryKeyPart,
  type PortfolioChartPeriodSelection,
} from "@/components/PortfolioChartPeriodPicker";
import {
  buildComparisonPctSeries,
  chartBenchmarkLabel,
  chartBenchmarkStroke,
  type BenchmarkHistoryRes,
} from "@/lib/chartBenchmarks";

interface SnapshotPoint {
  date: string;
  totalValueEur: number;
  investedAmountEur: number;
  dailyProfitEur: number;
}

interface SnapshotHistoryRes {
  points: SnapshotPoint[];
}

interface DesktopPortfolioChartProps {
  totalValue: number;
  totalInvested: number;
  totalProfit: number;
  totalProfitPercent: number;
}

export function DesktopPortfolioChart({ 
  totalValue, 
  totalInvested,
  totalProfit,
  totalProfitPercent,
}: DesktopPortfolioChartProps) {
  const [periodSelection, setPeriodSelection] =
    useState<PortfolioChartPeriodSelection>({ type: "preset", period: "ALL" });
  const [chartDataIdle, setChartDataIdle] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) setChartDataIdle(true);
    };
    if (typeof requestIdleCallback !== "undefined") {
      const ricId = requestIdleCallback(run, { timeout: 600 });
      return () => {
        cancelled = true;
        cancelIdleCallback(ricId);
      };
    }
    const t = window.setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  const { formatCurrency, convertPrice } = useCurrency();
  const { getQueryParam } = usePortfolio();
  const {
    showChart,
    showTooltip,
    showChartBenchmark,
    chartBenchmarkId,
  } = useChartSettings();
  const { theme } = useTheme();
  
  const portfolioParam = getQueryParam();
  const chartQueriesEnabled = showChart && chartDataIdle;

  const { data: history } = useQuery<SnapshotHistoryRes>({
    queryKey: ["/api/portfolio/history", portfolioParam, portfolioHistoryQueryKeyPart(periodSelection)],
    enabled: chartQueriesEnabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const p = buildPortfolioHistorySearchParams(portfolioParam, periodSelection);
      const res = await fetch(`/api/portfolio/history?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolio history snapshots");
      return res.json();
    },
  });

  const historyPoints = history?.points ?? [];
  const benchFrom = historyPoints[0]?.date;
  const benchTo = historyPoints[historyPoints.length - 1]?.date;

  const { data: benchmarkHistory } = useQuery<BenchmarkHistoryRes>({
    queryKey: ["/api/benchmark/history", chartBenchmarkId, benchFrom, benchTo],
    enabled:
      chartQueriesEnabled &&
      showChartBenchmark &&
      !!benchFrom &&
      !!benchTo &&
      historyPoints.length > 1,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("id", chartBenchmarkId);
      if (benchFrom) p.set("from", benchFrom);
      if (benchTo) p.set("to", benchTo);
      const res = await fetch(`/api/benchmark/history?${p.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch benchmark history");
      return res.json();
    },
  });

  const showBenchLine =
    showChartBenchmark &&
    !!benchmarkHistory?.points?.length &&
    historyPoints.length > 1;

  const chartData = useMemo(() => {
    const points = historyPoints;
    if (points.length === 0) {
      return [];
    }

    const values = points.map((p) => convertPrice(p.totalValueEur, "EUR"));
    const invested = points.map((p) => convertPrice(p.investedAmountEur, "EUR"));
    const dates = points.map((p) => p.date);
    const displayDates = dates.map((d) =>
      format(parse(d, "yyyy-MM-dd", new Date()), "d. MMM yyyy", { locale: sk }),
    );

    if (showBenchLine && benchmarkHistory?.points?.length) {
      const closes = new Map<string, number>();
      for (const pt of benchmarkHistory.points) {
        if (Number.isFinite(pt.close) && pt.close > 0) closes.set(pt.date, pt.close);
      }
      const comparison = buildComparisonPctSeries(dates, values, invested, closes);
      const from = comparison.startIndex;
      return dates.slice(from).map((date, j) => {
        const i = from + j;
        return {
          date,
          displayDate: displayDates[i]!,
          value: values[i]!,
          invested: invested[i]!,
          portfolioPct: comparison.points[i]!.portfolioPct,
          benchmarkPct: comparison.points[i]!.benchmarkPct,
        };
      });
    }

    return dates.map((date, i) => ({
      date,
      displayDate: displayDates[i]!,
      value: values[i]!,
      invested: invested[i]!,
      portfolioPct: 0,
      benchmarkPct: null as number | null,
    }));
  }, [historyPoints, convertPrice, showBenchLine, benchmarkHistory?.points]);

  // P&L scoped to the selected time range. The chart itself plots raw
  // portfolio value over time, which will jump up/down whenever the user
  // buys or sells during the period. To report an honest gain/loss for the
  // period we have to subtract that net cash inflow:
  //   periodGain = value_now − value_at_period_start − (buys − sells in period)
  // For "ALL" the formula naturally collapses to totalValue − totalInvested.
  const periodGainLoss = useMemo(() => {
    if (periodSelection.type === "preset" && periodSelection.period === "ALL") {
      return { amount: totalProfit, percent: totalProfitPercent };
    }
    if (chartData.length < 2) {
      const change = totalValue - totalInvested;
      const percent = totalInvested > 0 ? (change / totalInvested) * 100 : 0;
      return { amount: change, percent };
    }

    const firstPoint = chartData[0];
    const lastPoint = chartData[chartData.length - 1];
    const firstValue = firstPoint.value;
    const lastValue = lastPoint.value;

    const netInflow = lastPoint.invested - firstPoint.invested;

    const change = lastValue - firstValue - netInflow;
    const baseline = firstValue + Math.max(netInflow, 0);
    const percent = baseline > 0 ? (change / baseline) * 100 : 0;
    return { amount: change, percent };
  }, [
    chartData,
    periodSelection,
    totalProfit,
    totalProfitPercent,
    totalValue,
    totalInvested,
  ]);

  const minValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    if (showBenchLine) {
      const vals = chartData.flatMap((d) =>
        [d.portfolioPct, d.benchmarkPct].filter(
          (v): v is number => v != null && Number.isFinite(v),
        ),
      );
      if (vals.length === 0) return 0;
      const min = Math.min(...vals);
      return min - Math.max(1, Math.abs(min) * 0.08);
    }
    return Math.min(...chartData.map((d) => d.value)) * 0.995;
  }, [chartData, showBenchLine]);

  const maxValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    if (showBenchLine) {
      const vals = chartData.flatMap((d) =>
        [d.portfolioPct, d.benchmarkPct].filter(
          (v): v is number => v != null && Number.isFinite(v),
        ),
      );
      if (vals.length === 0) return 1;
      const max = Math.max(...vals);
      return max + Math.max(1, Math.abs(max) * 0.08);
    }
    return Math.max(...chartData.map((d) => d.value)) * 1.005;
  }, [chartData, showBenchLine]);

  const isPositive = periodGainLoss.amount >= 0;
  // Light: match text-green-500 / text-red-500; dark: keep existing pastel strokes
  const chartColor = isPositive
    ? theme === "dark"
      ? "hsl(168 72% 52%)"
      : "hsl(142 71% 45%)"
    : theme === "dark"
      ? "hsl(350 65% 68%)"
      : "hsl(0 84% 60%)";
  const benchColor = chartBenchmarkStroke(theme === "dark" ? "dark" : "light");
  const benchLabel = chartBenchmarkLabel(chartBenchmarkId);

  if (!showChart) {
    return null;
  }

  return (
    <Card className="hidden md:block h-full" data-testid="desktop-portfolio-chart">
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold">Vývoj portfólia</CardTitle>
            <div className="flex items-center gap-2 mt-1" data-testid="desktop-period-gain">
              <span className="text-xs text-muted-foreground">
                {chartPeriodGainLabel(periodSelection)} zisk/strata:
              </span>
              <span className={`text-sm font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>
                {isPositive ? "+" : ""}{formatCurrency(periodGainLoss.amount)}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                isPositive ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"
              }`}>
                {isPositive ? "+" : ""}{periodGainLoss.percent.toFixed(2)}%
              </span>
            </div>
          </div>
          <PortfolioChartPeriodPicker
            layout="desktop"
            value={periodSelection}
            onChange={setPeriodSelection}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="relative h-[220px] w-full min-w-0 overflow-hidden rounded-lg" data-testid="chart-desktop-portfolio-performance">
          <div className="chart-fade-grid" aria-hidden />
          {showBenchLine && (
            <div
              className="pointer-events-none absolute left-3 top-2 z-10 text-[10px] font-medium tracking-wide"
              style={{ color: benchColor }}
              data-testid="desktop-chart-benchmark-label"
            >
              {benchLabel}
            </div>
          )}
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                <defs>
                  <linearGradient id="colorValueDesktop" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                  <filter id="chartLineGlowDesktop" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2.2" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <XAxis 
                  dataKey="displayDate" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  domain={[minValue, maxValue]} 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(value) =>
                    showBenchLine
                      ? `${Number(value).toFixed(0)}%`
                      : formatCurrency(value)
                  }
                  width={80}
                />
                {showTooltip && (
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload as (typeof chartData)[number];
                        return (
                          <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                            <div className="text-xs text-muted-foreground">{data.displayDate}</div>
                            {showBenchLine ? (
                              <>
                                <div className="text-sm font-semibold">
                                  Portfólio: {data.portfolioPct >= 0 ? "+" : ""}
                                  {data.portfolioPct.toFixed(2)}%
                                </div>
                                {data.benchmarkPct != null && (
                                  <div className="text-xs mt-0.5" style={{ color: benchColor }}>
                                    {benchLabel}: {data.benchmarkPct >= 0 ? "+" : ""}
                                    {data.benchmarkPct.toFixed(2)}%
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-sm font-semibold">{formatCurrency(data.value)}</div>
                            )}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey={showBenchLine ? "portfolioPct" : "value"}
                  stroke={chartColor}
                  strokeWidth={2.25}
                  fill="url(#colorValueDesktop)"
                  style={{ filter: "url(#chartLineGlowDesktop)" }}
                />
                {showBenchLine && (
                  <Line
                    type="monotone"
                    dataKey="benchmarkPct"
                    stroke={benchColor}
                    strokeWidth={1.75}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Nedostatok dát pre graf
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
