import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { format, parse } from "date-fns";
import { sk } from "date-fns/locale";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
type TimePeriod = "1M" | "3M" | "6M" | "YTD" | "ALL";

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
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("ALL");
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
  const { showChart, showTooltip } = useChartSettings();
  
  const portfolioParam = getQueryParam();
  const chartQueriesEnabled = showChart && chartDataIdle;

  const periodToRange: Record<TimePeriod, "1m" | "3m" | "6m" | "ytd" | "all"> = {
    "1M": "1m",
    "3M": "3m",
    "6M": "6m",
    YTD: "ytd",
    ALL: "all",
  };

  const { data: history } = useQuery<SnapshotHistoryRes>({
    queryKey: ["/api/portfolio/history", portfolioParam, periodToRange[selectedPeriod]],
    enabled: chartQueriesEnabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("portfolio", portfolioParam);
      p.set("range", periodToRange[selectedPeriod]);
      const res = await fetch(`/api/portfolio/history?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolio history snapshots");
      return res.json();
    },
  });

  const chartData = useMemo(() => {
    const points = history?.points ?? [];
    if (points.length === 0) {
      return [];
    }
    return points.map((p) => ({
      date: p.date,
      displayDate: format(parse(p.date, "yyyy-MM-dd", new Date()), "d. MMM yyyy", { locale: sk }),
      value: convertPrice(p.totalValueEur, "EUR"),
      invested: convertPrice(p.investedAmountEur, "EUR"),
    }));
  }, [history?.points, convertPrice]);

  // P&L scoped to the selected time range. The chart itself plots raw
  // portfolio value over time, which will jump up/down whenever the user
  // buys or sells during the period. To report an honest gain/loss for the
  // period we have to subtract that net cash inflow:
  //   periodGain = value_now − value_at_period_start − (buys − sells in period)
  // For "ALL" the formula naturally collapses to totalValue − totalInvested.
  const periodGainLoss = useMemo(() => {
    if (selectedPeriod === "ALL") {
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
    selectedPeriod,
    totalProfit,
    totalProfitPercent,
    totalValue,
    totalInvested,
  ]);

  const minValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.min(...chartData.map(d => d.value)) * 0.995;
  }, [chartData]);

  const maxValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.max(...chartData.map(d => d.value)) * 1.005;
  }, [chartData]);

  const isPositive = periodGainLoss.amount >= 0;
  const chartColor = isPositive ? "#22c55e" : "#ef4444";

  const periods: TimePeriod[] = ["1M", "3M", "6M", "YTD", "ALL"];

  const periodLabel: Record<TimePeriod, string> = {
    "1M": "Za 1M",
    "3M": "Za 3M",
    "6M": "Za 6M",
    YTD: "Za YTD",
    ALL: "Celkový",
  };

  if (!showChart) {
    return null;
  }

  return (
    <Card className="hidden md:block" data-testid="desktop-portfolio-chart">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Vývoj portfólia</CardTitle>
          <div className="flex items-center gap-2" data-testid="desktop-period-gain">
            <span className="text-xs text-muted-foreground">
              {periodLabel[selectedPeriod]} zisk/strata:
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
        <div className="flex gap-1 mt-2">
          {periods.map((period) => (
            <button
              key={period}
              onClick={() => setSelectedPeriod(period)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                selectedPeriod === period
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-desktop-period-${period}`}
            >
              {period === "ALL" ? "Vše" : period}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-[250px] w-full min-w-0" data-testid="chart-desktop-portfolio-performance">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                <defs>
                  <linearGradient id="colorValueDesktop" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
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
                  tickFormatter={(value) => formatCurrency(value)}
                  width={80}
                />
                {showTooltip && (
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
                            <div className="text-xs text-muted-foreground">{data.displayDate}</div>
                            <div className="text-sm font-semibold">{formatCurrency(data.value)}</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={chartColor}
                  strokeWidth={2}
                  fill="url(#colorValueDesktop)"
                />
              </AreaChart>
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
