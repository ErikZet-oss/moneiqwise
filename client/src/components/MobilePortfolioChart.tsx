import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { format, parse, subHours, eachHourOfInterval } from "date-fns";
import { sk } from "date-fns/locale";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BrokerLogo } from "@/components/BrokerLogo";
import { ArrowRightLeft, Eye, EyeOff, HelpCircle, Loader2, Moon, RefreshCw } from "lucide-react";
import type { Holding } from "@shared/schema";

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  preMarketPrice?: number | null;
}

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

interface MobilePortfolioChartProps {
  totalValue: number;
  totalInvested: number;
  dailyChange: number;
  dailyChangePercent: number;
  totalProfit?: number;
  totalProfitPercent?: number;
  unrealizedGain?: number;
  onRefreshQuotes?: () => void | Promise<void>;
  quotesRefreshing?: boolean;
}

export function MobilePortfolioChart({ 
  totalValue, 
  totalInvested, 
  dailyChange, 
  dailyChangePercent,
  totalProfit = 0,
  totalProfitPercent = 0,
  unrealizedGain = 0,
  onRefreshQuotes,
  quotesRefreshing = false,
}: MobilePortfolioChartProps) {
  const premarketMoonClass = "text-amber-600 dark:text-amber-400";
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("ALL");
  /** Odloží ťažké dotazy (história, eur map) až po idle — rýchlejší prvý render dashboardu. */
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

  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { getQueryParam, selectedPortfolio, selectedPortfolioId } = usePortfolio();
  const { showChart, showTooltip, hideAmounts, toggleHideAmounts } = useChartSettings();
  
  const maskAmount = (amount: string) => hideAmounts ? "••••••" : amount;
  
  const portfolioParam = getQueryParam();
  const chartQueriesEnabled = showChart && chartDataIdle;

  const { data: holdings } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
    enabled: chartQueriesEnabled,
  });

  const { data: quotes } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/quotes", holdings?.map(h => h.ticker)],
    enabled: chartQueriesEnabled && !!holdings && holdings.length > 0,
    queryFn: async () => {
      if (!holdings || holdings.length === 0) return {};
      
      const tickers = holdings.map(h => h.ticker);
      const res = await fetch("/api/stocks/quotes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers }),
      });
      
      if (!res.ok) throw new Error("Failed to fetch quotes");
      
      const data = await res.json();
      
      if (data.errors && Object.keys(data.errors).length > 0) {
        console.warn("Some quotes failed to fetch:", data.errors);
      }
      
      return data.quotes as Record<string, StockQuote>;
    },
  });

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

  const getCurrentPrice = (ticker: string): number | null => {
    const upperTicker = ticker.toUpperCase();
    const tickerCurrency = getTickerCurrency(ticker);
    let price: number | null = null;
    
    if (quotes?.[upperTicker]) price = quotes[upperTicker].price;
    else if (quotes?.[ticker]) price = quotes[ticker].price;
    
    if (price !== null) {
      return convertPrice(price, tickerCurrency);
    }
    return null;
  };

  const chartData = useMemo(() => {
    const points = history?.points ?? [];
    if (points.length === 0) {
      return [];
    }
    return points.map((p) => ({
      date: p.date,
      displayDate: format(parse(p.date, "yyyy-MM-dd", new Date()), "d. MMM", { locale: sk }),
      value: convertPrice(p.totalValueEur, "EUR"),
      invested: convertPrice(p.investedAmountEur, "EUR"),
    }));
  }, [history?.points, convertPrice]);

  // P&L for the selected range. The chart line jumps whenever there's a BUY
  // or SELL inside the window, so to get an honest gain we subtract the net
  // cash inflow that happened after the first chart point:
  //   periodGain = lastValue − firstValue − (buys − sells inside window)
  // For "ALL" the formula naturally collapses to totalValue − totalInvested.
  const periodChange = useMemo(() => {
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

  const periodLabel: Record<TimePeriod, string> = {
    "1M": "1M",
    "3M": "3M",
    "6M": "6M",
    YTD: "YTD",
    ALL: "celé obdobie",
  };

  const minValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.min(...chartData.map(d => d.value)) * 0.995;
  }, [chartData]);

  const maxValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.max(...chartData.map(d => d.value)) * 1.005;
  }, [chartData]);

  const isPositive = periodChange.amount >= 0;
  const chartColor = isPositive ? "#22c55e" : "#ef4444";

  const preOpenPreview = useMemo(() => {
    if (!holdings || holdings.length === 0 || !quotes) {
      return { available: false, amount: 0, percent: 0 };
    }

    let totalCurrent = 0;
    let totalPreOpen = 0;
    let hasPreOpenData = false;

    for (const holding of holdings) {
      const quote = quotes[holding.ticker];
      if (!quote) continue;

      const shares = parseFloat(holding.shares);
      if (!Number.isFinite(shares) || shares <= 0) continue;

      const tickerCurrency = getTickerCurrency(holding.ticker);
      const regularPrice = convertPrice(quote.price, tickerCurrency);
      const preOpenRaw = quote.preMarketPrice;
      const preOpenPrice =
        typeof preOpenRaw === "number" && Number.isFinite(preOpenRaw) && preOpenRaw > 0
          ? convertPrice(preOpenRaw, tickerCurrency)
          : null;

      totalCurrent += shares * regularPrice;
      if (preOpenPrice != null) {
        totalPreOpen += shares * preOpenPrice;
        hasPreOpenData = true;
      } else {
        totalPreOpen += shares * regularPrice;
      }
    }

    if (!hasPreOpenData) {
      return { available: false, amount: 0, percent: 0 };
    }

    const amount = totalPreOpen - totalCurrent;
    const percent = totalCurrent > 0 ? (amount / totalCurrent) * 100 : 0;
    return { available: true, amount, percent };
  }, [holdings, quotes, convertPrice, getTickerCurrency]);

  const periods: TimePeriod[] = ["1M", "3M", "6M", "YTD", "ALL"];

  const usSessionState = (() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bratislava",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(new Date());

    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const isWeekend = weekday.startsWith("Sat") || weekday.startsWith("Sun");
    if (isWeekend) return "CLOSED" as const;

    const minutes = hour * 60 + minute;
    if (minutes >= 10 * 60 && minutes < 15 * 60 + 30) return "PRE_MARKET" as const;
    if (minutes >= 15 * 60 + 30 && minutes < 22 * 60) return "LIVE" as const;
    return "CLOSED" as const;
  })();

  const displayedDailyChange = usSessionState === "LIVE" ? dailyChange : 0;
  const displayedDailyChangePercent = usSessionState === "LIVE" ? dailyChangePercent : 0;

  const formatLargeNumber = (num: number) => {
    const formatted = formatCurrency(num);
    return formatted;
  };

  const portfolioLabel = selectedPortfolioId === "all"
    ? "Všetky portfóliá"
    : selectedPortfolio?.name ?? null;

  return (
    <div className="md:hidden bg-background px-4 pt-4 pb-2" data-testid="mobile-portfolio-chart">
      {portfolioLabel && (
        <div
          className="flex items-center gap-2 mb-1 min-w-0"
          data-testid="mobile-portfolio-header"
        >
          {selectedPortfolioId !== "all" && (
            <BrokerLogo brokerCode={selectedPortfolio?.brokerCode} size="sm" />
          )}
          <div
            className="text-sm font-semibold text-foreground truncate min-w-0"
            data-testid="text-mobile-portfolio-name"
          >
            {portfolioLabel}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-1">
        <Popover>
          <PopoverTrigger asChild>
            <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1 cursor-help">
              Celková hodnota
              <HelpCircle className="h-3 w-3" />
            </div>
          </PopoverTrigger>
          <PopoverContent className="max-w-[260px] p-3">
            <p className="font-semibold mb-1 text-sm">Celková hodnota portfólia</p>
            <p className="text-xs text-muted-foreground">Súčet aktuálnej trhovej hodnoty všetkých vašich pozícií vrátane opcií.</p>
          </PopoverContent>
        </Popover>
        <button
          onClick={toggleHideAmounts}
          className="p-1.5 rounded-full hover:bg-muted transition-colors"
          data-testid="button-toggle-amounts"
        >
          {hideAmounts ? (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Eye className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>
      
      <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
        <span className="text-3xl font-bold tracking-tight" data-testid="text-mobile-total-value">
          {maskAmount(formatLargeNumber(totalValue))}
        </span>
        {onRefreshQuotes && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 touch-manipulation"
            disabled={quotesRefreshing}
            onClick={() => void onRefreshQuotes()}
            aria-label="Obnoviť ceny a dennú zmenu"
            data-testid="button-mobile-refresh-quotes"
          >
            {quotesRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        )}
        <span className="text-sm text-muted-foreground flex items-center gap-1">
          {currency}
          <ArrowRightLeft className="h-3 w-3" />
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Popover>
          <PopoverTrigger asChild>
            <span className="text-xs text-muted-foreground flex items-center gap-1 cursor-help">
              Celkový profit:
              <HelpCircle className="h-2.5 w-2.5" />
            </span>
          </PopoverTrigger>
          <PopoverContent className="max-w-[280px] p-3">
            <p className="font-semibold mb-1 text-sm">Celkový profit (P&L)</p>
            <p className="text-xs text-muted-foreground">Nerealizovaný + Realizovaný zisk + Dividendy. Zahŕňa všetky zisky a straty z akcií aj opcií.</p>
          </PopoverContent>
        </Popover>
        <span className={`text-sm font-semibold ${totalProfit >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-mobile-total-profit">
          {totalProfit >= 0 ? "+" : ""}{maskAmount(formatCurrency(totalProfit))}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          totalProfit >= 0 ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"
        }`}>
          {totalProfit >= 0 ? "+" : ""}{totalProfitPercent.toFixed(2)}%
        </span>
      </div>

      {usSessionState === "LIVE" && (
        <div className="flex items-center gap-2 mb-4">
          <Popover>
            <PopoverTrigger asChild>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1 cursor-help">
                Denná zmena:
                <HelpCircle className="h-2.5 w-2.5" />
              </span>
            </PopoverTrigger>
            <PopoverContent className="max-w-[260px] p-3">
              <p className="font-semibold mb-1 text-sm">Denná zmena</p>
              <p className="text-xs text-muted-foreground">Zmena hodnoty portfólia za posledný obchodný deň.</p>
            </PopoverContent>
          </Popover>
          <span className={`text-xs font-medium ${displayedDailyChange >= 0 ? "text-green-500" : "text-red-500"}`}>
            {displayedDailyChange >= 0 ? "+" : ""}{maskAmount(formatCurrency(displayedDailyChange))}
          </span>
          <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${
            displayedDailyChange >= 0 ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"
          }`}>
            {displayedDailyChange >= 0 ? "+" : ""}{displayedDailyChangePercent.toFixed(2)}%
          </span>
        </div>
      )}
      {usSessionState !== "LIVE" && (
        <div className="mb-1 text-[10px] text-muted-foreground">Trh uzatvorený</div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-muted-foreground">
          Nerealizovaný zisk:
        </span>
        <span
          className={`text-xs font-medium ${
            unrealizedGain >= 0 ? "text-green-500" : "text-red-500"
          }`}
          data-testid="text-mobile-unrealized-gain"
        >
          {unrealizedGain >= 0 ? "+" : ""}
          {maskAmount(formatCurrency(unrealizedGain))}
        </span>
      </div>

      {usSessionState !== "LIVE" && (
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Moon className={`h-3 w-3 ${premarketMoonClass}`} />
            Pred open:
          </span>
          {preOpenPreview.available ? (
            <>
              <span
                className={`text-xs font-medium ${
                  preOpenPreview.amount >= 0 ? "text-green-500" : "text-red-500"
                }`}
                data-testid="text-mobile-pre-open-amount"
              >
                {preOpenPreview.amount >= 0 ? "+" : ""}
                {maskAmount(formatCurrency(preOpenPreview.amount))}
              </span>
              <span
                className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                  preOpenPreview.amount >= 0
                    ? "bg-green-500/20 text-green-500"
                    : "bg-red-500/20 text-red-500"
                }`}
                data-testid="text-mobile-pre-open-percent"
              >
                {preOpenPreview.percent >= 0 ? "+" : ""}
                {preOpenPreview.percent.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">bez dát</span>
          )}
        </div>
      )}

      {showChart && (
        <>
          <div className="h-[180px] -mx-4" data-testid="chart-portfolio-performance">
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="displayDate" 
                    hide 
                  />
                  <YAxis 
                    domain={[minValue, maxValue]} 
                    hide 
                  />
                  {showTooltip && (
                    <RechartsTooltip 
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
                    fill="url(#colorValue)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Nedostatok dát pre graf
              </div>
            )}
          </div>

          <div
            className="flex items-center justify-between mt-2 px-1"
            data-testid="mobile-period-gain"
          >
            <span className="text-[11px] text-muted-foreground">
              Za {periodLabel[selectedPeriod]}:
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={`text-xs font-semibold ${
                  periodChange.amount >= 0 ? "text-green-500" : "text-red-500"
                }`}
              >
                {periodChange.amount >= 0 ? "+" : ""}
                {maskAmount(formatCurrency(periodChange.amount))}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  periodChange.amount >= 0
                    ? "bg-green-500/20 text-green-500"
                    : "bg-red-500/20 text-red-500"
                }`}
              >
                {periodChange.amount >= 0 ? "+" : ""}
                {periodChange.percent.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center -mx-2 mt-2">
            {periods.map((period) => (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  selectedPeriod === period
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`button-period-${period}`}
              >
                {period === "ALL" ? "Vše" : period}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
