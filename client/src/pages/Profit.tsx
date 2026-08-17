import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, AlertCircle, Wallet, ChevronRight } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine } from "recharts";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, eachMonthOfInterval, parseISO, isAfter, isBefore, isSameDay, subDays, isWeekend, startOfDay } from "date-fns";
import { sk } from "date-fns/locale";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CompanyLogo } from "@/components/CompanyLogo";
import { HelpTip } from "@/components/HelpTip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Transaction } from "@shared/schema";

type PerformanceMethod = "simple" | "twr";

const PROFIT_PERF_METHOD_KEY = "moneiqwise.profit.performanceMethod";

function readStoredPerformanceMethod(): PerformanceMethod {
  try {
    const v = localStorage.getItem(PROFIT_PERF_METHOD_KEY);
    if (v === "twr" || v === "simple") return v;
  } catch {
    /* ignore */
  }
  return "simple";
}

/**
 * Prepočet kumulatívneho % na priemerné ročné (CAGR / annualized):
 * (1 + r)^(1/roky) − 1.
 */
function annualizePercentReturn(
  cumulativePct: number,
  startIso: string,
  endIso: string,
): number | null {
  if (!Number.isFinite(cumulativePct) || !startIso || !endIso || startIso > endIso) return null;
  const startMs = new Date(`${startIso}T12:00:00.000Z`).getTime();
  const endMs = new Date(`${endIso}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const years = (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000);
  if (!(years > 0)) return null;
  const r = cumulativePct / 100;
  if (r <= -1) return -100;
  const annualized = (Math.pow(1 + r, 1 / years) - 1) * 100;
  return Number.isFinite(annualized) ? annualized : null;
}

function yearsBetweenIso(startIso: string, endIso: string): number | null {
  const startMs = new Date(`${startIso}T12:00:00.000Z`).getTime();
  const endMs = new Date(`${endIso}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000);
}

interface RealizedGainSummary {
  totalRealized: number;
  closeTradeNetEur?: number;
  realizedGainTotal?: number;
  realizedYTD: number;
  realizedThisMonth: number;
  realizedToday: number;
  byTicker: {
    ticker: string;
    companyName: string;
    totalGain: number;
    totalSold: number;
    transactions: number;
  }[];
  transactionCount: number;
}


interface DailyValue {
  date: Date;
  dateStr: string;
  portfolioValue: number;
  totalCost: number;
  dailyProfit: number;
  cumulativeProfit: number;
}

interface PeriodStats {
  period: string;
  periodDate: Date;
  startValue: number;
  endValue: number;
  periodProfit: number;
  percentReturn: number;
}

interface PerformancePeriodStats {
  label: string;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  netInflow: number;
  profit: number;
  percentReturn: number;
  /** Reťazený TWR % (rovnaký výpočet ako YTD na dashboarde). */
  twrPercentReturn?: number;
  /** Buy-and-hold S&P 500 % v tom istom období. */
  sp500PercentReturn?: number | null;
  realizedGain: number;
  dividends: number;
  transactionCount: number;
}

interface YearPerformance extends PerformancePeriodStats {
  year: number;
  months: PerformancePeriodStats[];
}

interface PerformanceResponse {
  currency: string;
  years: YearPerformance[];
  totals: PerformancePeriodStats | null;
  computedAt: number;
}

interface PortfolioHistoryPoint {
  date: string;
  totalValue: number;
  netInvested: number;
}

interface PortfolioHistoryResponse {
  points: PortfolioHistoryPoint[];
}

export default function Profit() {
  const { formatCurrency } = useCurrency();
  const { getQueryParam } = usePortfolio();
  const [narrowViewport, setNarrowViewport] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrowViewport(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const portfolioParam = getQueryParam();

  const { data: transactions, isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: realizedGains } = useQuery<RealizedGainSummary>({
    queryKey: ["/api/realized-gains", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/realized-gains?portfolio=${portfolioParam}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch realized gains");
      return res.json();
    },
  });

  // Pre-aggregated year + month performance from server; cached per user and
  // invalidated on any transaction write so repeated opens are instant.
  // Query key v2: response includes twrPercentReturn (busts older client cache).
  const queryClient = useQueryClient();
  const [twrRefreshing, setTwrRefreshing] = useState(false);

  const {
    data: performanceData,
    isLoading: performanceLoading,
    isFetching: performanceFetching,
  } = useQuery<PerformanceResponse>({
    queryKey: ["/api/portfolio-performance", portfolioParam, "v4-twr-fx"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("portfolio", portfolioParam);
      const res = await fetch(`/api/portfolio-performance?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch portfolio performance");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const refreshPerformanceWithTwr = useCallback(async () => {
    setTwrRefreshing(true);
    try {
      const params = new URLSearchParams();
      params.set("portfolio", portfolioParam);
      params.set("refresh", "1");
      const res = await fetch(`/api/portfolio-performance?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const json = (await res.json()) as PerformanceResponse;
      queryClient.setQueryData(
        ["/api/portfolio-performance", portfolioParam, "v4-twr-fx"],
        json,
      );
    } finally {
      setTwrRefreshing(false);
    }
  }, [portfolioParam, queryClient]);

  const { data: historySeries, isLoading: historySeriesLoading } = useQuery<PortfolioHistoryResponse>({
    queryKey: ["/api/portfolio-history", portfolioParam, "all", "profit"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("portfolio", portfolioParam);
      params.set("range", "all");
      const res = await fetch(`/api/portfolio-history?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolio history");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const dailyData = useMemo(() => {
    const points = historySeries?.points ?? [];
    if (points.length === 0) {
      return [];
    }
    const dailyValues: DailyValue[] = [];
    let previousCumulativeProfit = 0;
    points.forEach((p, index) => {
      const day = parseISO(`${p.date}T00:00:00`);
      const cumulativeProfit = p.totalValue - p.netInvested;
      const dailyProfit = index === 0 ? cumulativeProfit : cumulativeProfit - previousCumulativeProfit;
      dailyValues.push({
        date: day,
        dateStr: p.date,
        portfolioValue: p.totalValue,
        totalCost: p.netInvested,
        dailyProfit,
        cumulativeProfit,
      });
      previousCumulativeProfit = cumulativeProfit;
    });
    return dailyValues;
  }, [historySeries?.points]);

  const periodStats = useMemo(() => {
    if (!performanceData?.years?.length) return [];
    const months: PeriodStats[] = [];
    for (const y of performanceData.years) {
      for (const m of y.months) {
        const d = parseISO(`${m.startDate}T00:00:00`);
        months.push({
          period: format(d, "MMM yyyy", { locale: sk }),
          periodDate: d,
          startValue: m.startValue,
          endValue: m.endValue,
          periodProfit: m.profit,
          percentReturn: m.percentReturn,
        });
      }
    }
    return months.sort((a, b) => a.periodDate.getTime() - b.periodDate.getTime());
  }, [performanceData]);

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  const isLoading = transactionsLoading || historySeriesLoading;

  if (isLoading) {
    return (
      <div className="max-w-full space-y-3 overflow-x-hidden md:space-y-6">
        <Card>
          <CardHeader className="p-4 pb-2">
            <Skeleton className="h-5 w-40 md:h-6 md:w-48" />
            <Skeleton className="h-3 w-56 md:h-4 md:w-64" />
          </CardHeader>
          <CardContent className="p-4 pt-3">
            <Skeleton className="h-48 w-full md:h-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!transactions || transactions.length === 0) {
    return (
      <Card className="max-w-full overflow-x-hidden">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium">Zisk v čase</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Štatistika vášho zisku podľa období
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          <div className="py-8 text-center text-muted-foreground md:py-12">
            <p className="text-sm md:text-base">Zatiaľ žiadne transakcie na zobrazenie.</p>
            <p className="mt-2 text-xs md:text-sm">Začnite nákupom akcií aby ste videli štatistiku.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartYTick = (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(0)}k`;
    return String(Math.round(n));
  };

  return (
    <div className="max-w-full space-y-3 overflow-x-hidden pb-6 md:space-y-6 md:pb-10">
      {dailyData.length === 0 && (
        <Alert className="px-3 py-2 text-xs md:px-4 md:py-3 md:text-sm">
          <AlertCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
          <AlertDescription>
            Historické body pre graf zatiaľ nie sú k dispozícii.
          </AlertDescription>
        </Alert>
      )}

      <h2 className="text-lg font-semibold">Analýza zisku</h2>

      {/* Year / month performance breakdown (server-aggregated, cached) */}
      <YearMonthPerformance
        data={performanceData}
        loading={performanceLoading}
        fetching={performanceFetching || twrRefreshing}
        onRefreshTwr={refreshPerformanceWithTwr}
        formatCurrency={formatCurrency}
        formatPercent={formatPercent}
      />

      {/* Realized Gains Section */}
      <Card className="max-w-full overflow-x-hidden">
        <CardHeader className="space-y-1 p-4 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <Wallet className="h-4 w-4 shrink-0" />
            Realizovaný zisk/strata
          </CardTitle>
          <CardDescription className="text-xs leading-snug md:text-sm">
            Z predajov podľa histórie; celkom vrátane príp. XTB „close trade“.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          {realizedGains &&
          (realizedGains.transactionCount > 0 ||
            Math.abs(realizedGains.closeTradeNetEur ?? 0) > 1e-9) ? (
            <div className="space-y-3 md:space-y-4">
              <div className="grid grid-cols-4 gap-1.5 md:gap-3">
                <div className="rounded-md bg-muted/40 px-1.5 py-1.5 md:rounded-lg md:px-3 md:py-2.5">
                  <div className="mb-0.5 text-[9px] text-muted-foreground md:text-xs">Dnes</div>
                  <div className={`text-[11px] font-semibold tabular-nums leading-tight tracking-tight md:text-xl ${realizedGains.realizedToday >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-realized-today">
                    {formatCurrency(realizedGains.realizedToday)}
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 px-1.5 py-1.5 md:rounded-lg md:px-3 md:py-2.5">
                  <div className="mb-0.5 text-[9px] text-muted-foreground md:text-xs">Mesiac</div>
                  <div className={`text-[11px] font-semibold tabular-nums leading-tight tracking-tight md:text-xl ${realizedGains.realizedThisMonth >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-realized-month">
                    {formatCurrency(realizedGains.realizedThisMonth)}
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 px-1.5 py-1.5 md:rounded-lg md:px-3 md:py-2.5">
                  <div className="mb-0.5 text-[9px] text-muted-foreground md:text-xs">YTD</div>
                  <div className={`text-[11px] font-semibold tabular-nums leading-tight tracking-tight md:text-xl ${realizedGains.realizedYTD >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-realized-ytd">
                    {formatCurrency(realizedGains.realizedYTD)}
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 px-1.5 py-1.5 md:rounded-lg md:px-3 md:py-2.5">
                  <div className="mb-0.5 text-[9px] text-muted-foreground md:text-xs">Celkovo</div>
                  <div
                    className={`text-[11px] font-semibold tabular-nums leading-tight tracking-tight md:text-xl ${(realizedGains.realizedGainTotal ?? realizedGains.totalRealized) >= 0 ? "text-green-500" : "text-red-500"}`}
                    data-testid="text-realized-total"
                  >
                    {formatCurrency(
                      realizedGains.realizedGainTotal ?? realizedGains.totalRealized,
                    )}
                  </div>
                </div>
              </div>

              {realizedGains.byTicker.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:mb-2 md:text-xs md:normal-case md:tracking-normal">
                    Podľa tickerov
                  </h4>
                  <div className="space-y-0 md:hidden" data-testid="list-realized-by-ticker-mobile">
                    {realizedGains.byTicker.map((item) => (
                      <div
                        key={item.ticker}
                        className="flex items-center gap-2 border-b border-border/60 py-1.5 last:border-b-0"
                        data-testid={`row-realized-${item.ticker}`}
                      >
                        <CompanyLogo
                          ticker={item.ticker}
                          companyName={item.companyName}
                          size="xs"
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate text-xs font-semibold font-mono leading-tight">
                              {item.ticker}
                            </span>
                            <span className="truncate text-[9px] text-muted-foreground leading-tight">
                              {item.companyName}
                            </span>
                          </div>
                          <div className="text-[9px] text-muted-foreground tabular-nums leading-tight">
                            {item.transactions}× predaj · {formatCurrency(item.totalSold)}
                          </div>
                        </div>
                        <div
                          className={`shrink-0 text-right text-xs font-semibold tabular-nums leading-tight ${
                            item.totalGain >= 0 ? "text-green-500" : "text-red-500"
                          }`}
                        >
                          {item.totalGain >= 0 ? "+" : ""}
                          {formatCurrency(item.totalGain)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Table className="hidden min-w-0 text-xs md:table">
                    <TableHeader className="[&_th]:h-8 [&_th]:px-2 [&_th]:py-1.5">
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead>Spoločnosť</TableHead>
                        <TableHead className="text-right">Predajov</TableHead>
                        <TableHead className="text-right">Predané za</TableHead>
                        <TableHead className="text-right">Zisk/Strata</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="[&_td]:px-2 [&_td]:py-1.5">
                      {realizedGains.byTicker.map((item) => (
                        <TableRow key={item.ticker} data-testid={`row-realized-${item.ticker}-table`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <CompanyLogo ticker={item.ticker} companyName={item.companyName} size="xs" />
                              <span className="font-semibold font-mono">{item.ticker}</span>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground">
                            {item.companyName}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{item.transactions}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.totalSold)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold tabular-nums ${
                              item.totalGain >= 0 ? "text-green-500" : "text-red-500"
                            }`}
                          >
                            {item.totalGain >= 0 ? "+" : ""}
                            {formatCurrency(item.totalGain)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground md:py-8">
              <p className="text-sm md:text-base">Zatiaľ ste nepredali žiadne akcie.</p>
              <p className="mt-1 text-xs md:text-sm">Po predaji akcií tu uvidíte realizovaný zisk alebo stratu.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-full overflow-x-hidden">
        <CardHeader className="space-y-1 p-4 pb-2">
          <CardTitle className="text-sm font-medium">Vývoj hodnoty portfólia</CardTitle>
          <CardDescription className="text-xs md:text-sm">Od prvého obchodu po dnes (obchodné dni)</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          <div className="h-[200px] w-full max-w-full min-w-0 md:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyData} margin={{ top: 4, right: 4, left: -8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="dateStr" 
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                tickFormatter={(value) => format(parseISO(value), "d.M.yy", { locale: sk })}
                minTickGap={24}
              />
              <YAxis 
                width={36}
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                tickFormatter={chartYTick}
              />
              <Tooltip 
                formatter={(value: number) => [formatCurrency(value), "Hodnota"]}
                labelFormatter={(label) => format(parseISO(label), "d. MMMM yyyy", { locale: sk })}
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  color: "hsl(var(--foreground))",
                  fontSize: "12px",
                }}
              />
              <Line 
                type="monotone" 
                dataKey="portfolioValue" 
                name="Hodnota portfólia" 
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
              <Line 
                type="monotone" 
                dataKey="totalCost" 
                name="Investované" 
                stroke="#9ca3af"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-full overflow-x-hidden">
        <CardHeader className="space-y-1 p-4 pb-2">
          <CardTitle className="text-sm font-medium">Mesačný zisk/strata</CardTitle>
          <CardDescription className="text-xs md:text-sm">Zisk alebo strata za obdobie</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          <div className="h-[200px] w-full max-w-full min-w-0 md:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={periodStats}
              margin={{ top: 4, right: 4, left: -8, bottom: narrowViewport ? 16 : 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="period" 
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: narrowViewport ? 9 : 11 }}
                interval="preserveStartEnd"
                angle={narrowViewport ? -35 : 0}
                textAnchor={narrowViewport ? "end" : "middle"}
                height={narrowViewport ? 48 : 28}
              />
              <YAxis 
                width={36}
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                tickFormatter={chartYTick}
              />
              <Tooltip 
                formatter={(value: number) => [formatCurrency(value), "Zisk"]}
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  color: "hsl(var(--foreground))",
                  fontSize: "12px",
                }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <Bar dataKey="periodProfit" name="Zisk" maxBarSize={28}>
                {periodStats.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.periodProfit >= 0 ? "#22c55e" : "#ef4444"} 
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-full overflow-x-hidden">
        <CardHeader className="space-y-1 p-4 pb-2">
          <CardTitle className="text-sm font-medium">Mesačné štatistiky</CardTitle>
          <CardDescription className="text-xs md:text-sm">Detailný prehľad za obdobie</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          <div className="w-full max-w-full overflow-x-hidden">
            <Table className="w-full min-w-0 text-xs md:text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 px-1.5 py-1 md:h-12 md:px-4">Obdobie</TableHead>
                  <TableHead className="hidden h-9 px-1.5 text-right md:table-cell md:h-12 md:px-4">
                    Hodnota na začiatku
                  </TableHead>
                  <TableHead className="hidden h-9 px-1.5 text-right md:table-cell md:h-12 md:px-4">
                    Hodnota na konci
                  </TableHead>
                  <TableHead className="h-9 px-1.5 py-1 text-right md:h-12 md:px-4">Zisk</TableHead>
                  <TableHead className="h-9 w-12 px-1 py-1 text-right md:h-12 md:w-auto md:px-4">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periodStats.map((period) => (
                  <TableRow key={period.period} data-testid={`row-profit-period-${period.period}`}>
                    <TableCell className="max-w-[5.5rem] truncate px-1.5 py-1.5 font-medium md:max-w-none md:px-4 md:py-3">
                      {period.period}
                    </TableCell>
                    <TableCell className="hidden px-1.5 text-right md:table-cell md:px-4">
                      {formatCurrency(period.startValue)}
                    </TableCell>
                    <TableCell className="hidden px-1.5 text-right md:table-cell md:px-4">
                      {formatCurrency(period.endValue)}
                    </TableCell>
                    <TableCell className={`px-1.5 py-1.5 text-right text-[11px] font-medium tabular-nums md:px-4 md:py-3 md:text-sm ${period.periodProfit >= 0 ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}`}>
                      {formatCurrency(period.periodProfit)}
                    </TableCell>
                    <TableCell className={`px-1 py-1.5 text-right text-[11px] tabular-nums md:px-4 md:py-3 md:text-sm ${period.percentReturn >= 0 ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}`}>
                      {formatPercent(period.percentReturn)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Výkonnosť podľa rokov a mesiacov
// -----------------------------------------------------------------------------
// Purely presentational — all the heavy aggregation lives on the server (see
// /api/portfolio-performance). This component takes the pre-computed years +
// months and lets the user drill into any year to see monthly detail.
function YearMonthPerformance({
  data,
  loading,
  fetching,
  onRefreshTwr,
  formatCurrency,
  formatPercent,
}: {
  data?: PerformanceResponse;
  loading: boolean;
  fetching?: boolean;
  onRefreshTwr?: () => void;
  formatCurrency: (n: number) => string;
  formatPercent: (n: number) => string;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [method, setMethod] = useState<PerformanceMethod>(readStoredPerformanceMethod);

  useEffect(() => {
    try {
      localStorage.setItem(PROFIT_PERF_METHOD_KEY, method);
    } catch {
      /* ignore */
    }
  }, [method]);

  const hasTwrData =
    !!data?.years?.length &&
    data.years.every((y) => typeof y.twrPercentReturn === "number");

  const twrRefreshAttempted = useRef(false);
  useEffect(() => {
    if (method !== "twr" || !data || hasTwrData || !onRefreshTwr) return;
    if (twrRefreshAttempted.current) return;
    twrRefreshAttempted.current = true;
    onRefreshTwr();
  }, [method, data, hasTwrData, onRefreshTwr]);

  const pctFor = (row: PerformancePeriodStats): number | null => {
    if (method === "twr") {
      return typeof row.twrPercentReturn === "number" ? row.twrPercentReturn : null;
    }
    return row.percentReturn;
  };

  const spxFor = (row: PerformancePeriodStats): number | null => {
    if (typeof row.sp500PercentReturn === "number" && Number.isFinite(row.sp500PercentReturn)) {
      return row.sp500PercentReturn;
    }
    return null;
  };

  const annualized = useMemo(() => {
    if (!data?.totals) return null;
    const totalPct =
      method === "twr"
        ? typeof data.totals.twrPercentReturn === "number"
          ? data.totals.twrPercentReturn
          : null
        : data.totals.percentReturn;
    if (totalPct == null || !Number.isFinite(totalPct)) return null;
    const years = yearsBetweenIso(data.totals.startDate, data.totals.endDate);
    const avg = annualizePercentReturn(
      totalPct,
      data.totals.startDate,
      data.totals.endDate,
    );
    if (avg == null || years == null) return null;
    const spxAvg =
      method === "twr" && typeof data.totals.sp500PercentReturn === "number"
        ? annualizePercentReturn(
            data.totals.sp500PercentReturn,
            data.totals.startDate,
            data.totals.endDate,
          )
        : null;
    return { avg, years, spxAvg };
  }, [data, method]);

  const colCount = method === "twr" ? 9 : 8;

  if (loading && !data) {
    return (
      <Card className="max-w-full overflow-x-hidden">
        <CardHeader className="space-y-1 p-4 pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarDays className="h-4 w-4 shrink-0" />
            Výkonnosť podľa rokov a mesiacov
          </CardTitle>
          <CardDescription className="text-xs leading-snug md:text-sm">
            Ročný a mesačný prehľad výnosov portfólia
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.years.length === 0) {
    return null;
  }

  const toggleYear = (year: number) =>
    setExpanded((prev) => ({ ...prev, [year]: !prev[year] }));

  const signClass = (value: number) =>
    value > 0
      ? "text-green-600 dark:text-green-500"
      : value < 0
      ? "text-red-600 dark:text-red-500"
      : "text-muted-foreground";

  const monthName = (label: string) => {
    const [m] = label.split("/");
    const idx = parseInt(m, 10) - 1;
    const date = new Date(2000, idx, 1);
    return format(date, "LLLL", { locale: sk });
  };

  return (
    <Card className="max-w-full overflow-x-hidden">
      <CardHeader className="space-y-2 p-4 pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
              <CalendarDays className="h-4 w-4 shrink-0" />
              Výkonnosť podľa rokov a mesiacov
              <HelpTip title="Ako sa počíta % výkonnosť">
                <p>
                  <strong>Jednoduchý %</strong> (predvolené):{" "}
                  <code className="text-[10px]">zisk = koniec − začiatok − čistý inflow</code>, kde
                  začiatok/koniec = trhová hodnota držaných akcií (Yahoo) a čistý inflow = nákupy −
                  predaje (v mene zobrazenia). Percentá:{" "}
                  <code className="text-[10px]">zisk / (začiatok + max(inflow, 0)) × 100</code>.
                  Stĺpec Zisk/Strata v € vždy používa tento vzorec.
                </p>
                <p>
                  <strong>TWR %</strong> (Time-Weighted Return): rovnaká logika, historické FX a
                  hustota vzorkovania ako YTD na hlavnom dashboarde. Medzi dňami v období:{" "}
                  <code className="text-[10px]">r = (V₁ − V₀ − Δvklady) / V₀</code>, potom sa
                  násobí <code className="text-[10px]">(1+r)</code>. V = MTM hodnoty (akcie +
                  hotovosť). Δvklady = zmena súčtu DEPOSIT/WITHDRAWAL. Výsledok:{" "}
                  <code className="text-[10px]">(∏(1+r) − 1) × 100</code>. Očisťuje timing
                  vkladov/výberov — vhodné na porovnanie s indexom.
                </p>
                <p>
                  <strong>S&amp;P 500 %</strong> (len v režime TWR): buy-and-hold výnos indexu{" "}
                  <code className="text-[10px]">^GSPC</code> v tom istom období:{" "}
                  <code className="text-[10px]">(cena_koniec / cena_začiatok − 1) × 100</code>.
                </p>
                <p className="text-muted-foreground">
                  Dividendy sú v tabuľke samostatne; do jednoduchého % nie sú priamo pripočítané.
                  TWR ich zachytáva cez zmenu peňaženky/MTM.
                </p>
                <p>
                  <strong>Priemerné ročné %</strong>: annualizácia celkového % (CAGR) —{" "}
                  <code className="text-[10px]">(1 + r)^(1/roky) − 1</code>, kde{" "}
                  <code className="text-[10px]">r</code> je kumulatívny výnos (jednoduchý alebo TWR)
                  od prvej transakcie doteraz a roky = počet dní / 365,25.
                </p>
              </HelpTip>
            </CardTitle>
            <CardDescription className="text-xs leading-snug md:text-sm">
              Ročný prehľad s rozbalením na mesiace. Prepni % medzi jednoduchým výpočtom a TWR.
              {method === "twr" && fetching && !hasTwrData ? (
                <span className="ml-1 text-muted-foreground">(načítavam TWR…)</span>
              ) : null}
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={method}
            onValueChange={(v) => {
              if (v === "simple" || v === "twr") setMethod(v);
            }}
            className="justify-start sm:justify-end shrink-0"
            data-testid="toggle-profit-performance-method"
          >
            <ToggleGroupItem value="simple" className="text-xs px-2.5 h-8" aria-label="Jednoduchý %">
              Jednoduchý
            </ToggleGroupItem>
            <ToggleGroupItem value="twr" className="text-xs px-2.5 h-8" aria-label="TWR %">
              TWR
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {annualized && (
          <div
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2"
            data-testid="text-avg-annual-return"
          >
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground md:text-xs md:normal-case md:tracking-normal">
              Priemerné ročné zhodnotenie
              {method === "twr" ? " (TWR)" : ""}
            </span>
            <span className={`text-sm font-semibold tabular-nums md:text-base ${signClass(annualized.avg)}`}>
              {formatPercent(annualized.avg)}
              <span className="ml-1 text-[10px] font-medium text-muted-foreground md:text-xs">
                p.a.
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground md:text-xs">
              za {annualized.years < 1
                ? `${Math.max(1, Math.round(annualized.years * 365))} dní`
                : `${annualized.years.toFixed(1).replace(".", ",")} r.`}
            </span>
            {method === "twr" && annualized.spxAvg != null && (
              <span className="text-[10px] text-muted-foreground md:text-xs">
                · S&amp;P 500{" "}
                <span className={`font-medium tabular-nums ${signClass(annualized.spxAvg)}`}>
                  {formatPercent(annualized.spxAvg)} p.a.
                </span>
              </span>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-3">
        <div className="w-full max-w-full overflow-x-hidden">
          <Table className="w-full min-w-0 text-[10px] md:text-sm">
            <TableHeader className="[&_th]:h-8 [&_th]:px-1.5 [&_th]:py-1.5 md:[&_th]:h-12 md:[&_th]:px-4 md:[&_th]:py-3">
              <TableRow>
                <TableHead className="w-6 md:w-8"></TableHead>
                <TableHead>Obdobie</TableHead>
                <TableHead className="text-right hidden md:table-cell">Hodnota na začiatku</TableHead>
                <TableHead className="text-right hidden md:table-cell">Hodnota na konci</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Vklady − výbery</TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <span className="md:hidden">Zisk</span>
                  <span className="hidden md:inline">Zisk/Strata</span>
                </TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  {method === "twr" ? "TWR %" : "%"}
                </TableHead>
                {method === "twr" && (
                  <TableHead className="text-right whitespace-nowrap">S&amp;P %</TableHead>
                )}
                <TableHead className="text-right hidden lg:table-cell">Dividendy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_td]:px-1.5 [&_td]:py-1.5 md:[&_td]:p-4">
              {data.years.map((year) => {
                const isOpen = !!expanded[year.year];
                const yearPct = pctFor(year);
                return (
                  <Fragment key={year.year}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => toggleYear(year.year)}
                      data-testid={`row-perf-year-${year.year}`}
                    >
                      <TableCell className="w-6 md:w-8">
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 transition-transform md:h-4 md:w-4 ${isOpen ? "rotate-90" : ""}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-[4.5rem] truncate font-semibold md:max-w-none">
                        {year.label}
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell">
                        {formatCurrency(year.startValue)}
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell">
                        {formatCurrency(year.endValue)}
                      </TableCell>
                      <TableCell className="text-right hidden lg:table-cell text-muted-foreground">
                        {formatCurrency(year.netInflow)}
                      </TableCell>
                      <TableCell className={`text-right text-[10px] font-semibold tabular-nums md:text-sm ${signClass(year.profit)}`}>
                        {formatCurrency(year.profit)}
                      </TableCell>
                      <TableCell
                        className={`text-right text-[10px] font-semibold tabular-nums md:text-sm ${
                          yearPct == null ? "text-muted-foreground" : signClass(yearPct)
                        }`}
                      >
                        {yearPct == null ? "—" : formatPercent(yearPct)}
                      </TableCell>
                      {method === "twr" && (() => {
                        const spx = spxFor(year);
                        return (
                          <TableCell
                            className={`text-right text-[10px] font-semibold tabular-nums md:text-sm ${
                              spx == null ? "text-muted-foreground" : signClass(spx)
                            }`}
                          >
                            {spx == null ? "—" : formatPercent(spx)}
                          </TableCell>
                        );
                      })()}
                      <TableCell className="text-right hidden lg:table-cell">
                        {year.dividends > 0 ? formatCurrency(year.dividends) : "—"}
                      </TableCell>
                    </TableRow>

                    {isOpen && year.months.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={colCount} className="py-2 text-center text-xs text-muted-foreground md:py-3 md:text-sm">
                          Žiadne dáta za tento rok.
                        </TableCell>
                      </TableRow>
                    )}

                    {isOpen &&
                      year.months.map((m) => {
                        const mPct = pctFor(m);
                        const mSpx = spxFor(m);
                        return (
                          <TableRow
                            key={m.label}
                            className="bg-muted/20"
                            data-testid={`row-perf-month-${m.label}`}
                          >
                            <TableCell></TableCell>
                            <TableCell className="max-w-[5rem] truncate pl-3 capitalize text-muted-foreground md:max-w-none md:pl-8">
                              {monthName(m.label)}
                            </TableCell>
                            <TableCell className="text-right hidden md:table-cell text-muted-foreground">
                              {formatCurrency(m.startValue)}
                            </TableCell>
                            <TableCell className="text-right hidden md:table-cell text-muted-foreground">
                              {formatCurrency(m.endValue)}
                            </TableCell>
                            <TableCell className="text-right hidden lg:table-cell text-muted-foreground">
                              {formatCurrency(m.netInflow)}
                            </TableCell>
                            <TableCell className={`text-right text-[10px] tabular-nums md:text-sm ${signClass(m.profit)}`}>
                              {formatCurrency(m.profit)}
                            </TableCell>
                            <TableCell
                              className={`text-right text-[10px] tabular-nums md:text-sm ${
                                mPct == null ? "text-muted-foreground" : signClass(mPct)
                              }`}
                            >
                              {mPct == null ? "—" : formatPercent(mPct)}
                            </TableCell>
                            {method === "twr" && (
                              <TableCell
                                className={`text-right text-[10px] tabular-nums md:text-sm ${
                                  mSpx == null ? "text-muted-foreground" : signClass(mSpx)
                                }`}
                              >
                                {mSpx == null ? "—" : formatPercent(mSpx)}
                              </TableCell>
                            )}
                            <TableCell className="text-right hidden lg:table-cell text-muted-foreground">
                              {m.dividends > 0 ? formatCurrency(m.dividends) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </Fragment>
                );
              })}

              {data.totals && (() => {
                const totalPct = pctFor(data.totals);
                const totalSpx = spxFor(data.totals);
                return (
                  <TableRow className="border-t-2 font-semibold" data-testid="row-perf-total">
                    <TableCell></TableCell>
                    <TableCell>Celkovo</TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      {formatCurrency(data.totals.startValue)}
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      {formatCurrency(data.totals.endValue)}
                    </TableCell>
                    <TableCell className="text-right hidden lg:table-cell text-muted-foreground">
                      {formatCurrency(data.totals.netInflow)}
                    </TableCell>
                    <TableCell className={`text-right ${signClass(data.totals.profit)}`}>
                      {formatCurrency(data.totals.profit)}
                    </TableCell>
                    <TableCell
                      className={`text-right ${
                        totalPct == null ? "text-muted-foreground" : signClass(totalPct)
                      }`}
                    >
                      {totalPct == null ? "—" : formatPercent(totalPct)}
                    </TableCell>
                    {method === "twr" && (
                      <TableCell
                        className={`text-right ${
                          totalSpx == null ? "text-muted-foreground" : signClass(totalSpx)
                        }`}
                      >
                        {totalSpx == null ? "—" : formatPercent(totalSpx)}
                      </TableCell>
                    )}
                    <TableCell className="text-right hidden lg:table-cell">
                      {data.totals.dividends > 0 ? formatCurrency(data.totals.dividends) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
