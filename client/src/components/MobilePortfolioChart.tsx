import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { format, parse, subHours, eachHourOfInterval } from "date-fns";
import { sk } from "date-fns/locale";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useTheme } from "@/hooks/useTheme";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BrokerLogo } from "@/components/BrokerLogo";
import { ArrowRightLeft, Bell, ExternalLink, Eye, EyeOff, HelpCircle, Loader2, Moon, RefreshCw } from "lucide-react";
import type { Holding } from "@shared/schema";
import { isPokemonPortfolio } from "@shared/pokemonTcg";
import { getExtendedSessionLabel, getQuoteRefreshIntervalMs, getQuoteStaleTimeMs, getUsMarketSessionState, shouldShowExtendedQuote, shouldUseExtendedQuotes } from "@/lib/usMarketSession";
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

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  marketState?: string | null;
  preMarketPrice?: number | null;
  preMarketChangePercent?: number | null;
}

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
  cashValue?: number;
  onRefreshQuotes?: () => void | Promise<void>;
  quotesRefreshing?: boolean;
  athCelebrationActive?: boolean;
  importantNotifications?: Array<{
    id: string;
    title: string;
    subtitle: string;
    dateIso: string | null;
    infoUrl?: string;
    tone?: "default" | "positive" | "negative" | "warning";
  }>;
  importantNotificationCount?: number;
}

export function MobilePortfolioChart({ 
  totalValue, 
  totalInvested, 
  dailyChange, 
  dailyChangePercent,
  totalProfit = 0,
  totalProfitPercent = 0,
  unrealizedGain = 0,
  cashValue = 0,
  onRefreshQuotes,
  quotesRefreshing = false,
  athCelebrationActive = false,
  importantNotifications = [],
  importantNotificationCount = 0,
}: MobilePortfolioChartProps) {
  const premarketMoonClass = "text-amber-600 dark:text-amber-400";
  const [periodSelection, setPeriodSelection] =
    useState<PortfolioChartPeriodSelection>({ type: "preset", period: "ALL" });
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
  const { getQueryParam, selectedPortfolio, selectedPortfolioId, isAllPortfolios } = usePortfolio();
  const hideCash = !isAllPortfolios && isPokemonPortfolio(selectedPortfolio?.brokerCode);
  const {
    showChart,
    showTooltip,
    showChartBenchmark,
    chartBenchmarkId,
    hideAmounts,
    toggleHideAmounts,
  } = useChartSettings();
  const { theme } = useTheme();
  
  const maskAmount = (amount: string) => hideAmounts ? "••••••" : amount;
  const formatNotificationDate = (value: string | null): string => {
    if (!value) return "—";
    try {
      return format(parse(value, "yyyy-MM-dd", new Date()), "d. M. yyyy", { locale: sk });
    } catch {
      const ts = Date.parse(value);
      if (Number.isFinite(ts)) return new Date(ts).toLocaleDateString("sk-SK");
      return value;
    }
  };
  
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
    staleTime: getQuoteStaleTimeMs(),
    refetchInterval: () => getQuoteRefreshIntervalMs(),
    queryFn: async () => {
      if (!holdings || holdings.length === 0) return {};
      
      const tickers = holdings.map(h => h.ticker);
      const refresh = shouldUseExtendedQuotes(getUsMarketSessionState());
      const res = await fetch("/api/stocks/quotes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers, refresh }),
      });
      
      if (!res.ok) throw new Error("Failed to fetch quotes");
      
      const data = await res.json();
      
      if (data.errors && Object.keys(data.errors).length > 0) {
        console.warn("Some quotes failed to fetch:", data.errors);
      }
      
      return data.quotes as Record<string, StockQuote>;
    },
  });

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
      format(parse(d, "yyyy-MM-dd", new Date()), "d. MMM", { locale: sk }),
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

  // P&L for the selected range. The chart line jumps whenever there's a BUY
  // or SELL inside the window, so to get an honest gain we subtract the net
  // cash inflow that happened after the first chart point:
  //   periodGain = lastValue − firstValue − (buys − sells inside window)
  // For "ALL" the formula naturally collapses to totalValue − totalInvested.
  const periodChange = useMemo(() => {
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

  const benchColor = chartBenchmarkStroke(theme === "dark" ? "dark" : "light");
  const benchLabel = chartBenchmarkLabel(chartBenchmarkId);
  const benchPeriodReturn = useMemo(() => {
    if (!showBenchLine || chartData.length === 0) return null;
    for (let i = chartData.length - 1; i >= 0; i--) {
      const pct = chartData[i]!.benchmarkPct;
      if (pct != null && Number.isFinite(pct)) return pct;
    }
    return null;
  }, [chartData, showBenchLine]);
  const benchLabelWithReturn =
    benchPeriodReturn == null
      ? benchLabel
      : `${benchLabel} ${benchPeriodReturn >= 0 ? "+" : ""}${benchPeriodReturn.toFixed(1)}%`;

  const isPositive = periodChange.amount >= 0;
  // Light: match text-green-500 / text-red-500; dark: keep existing pastel strokes
  const chartColor = isPositive
    ? theme === "dark"
      ? "hsl(168 72% 52%)"
      : "hsl(142 71% 45%)"
    : theme === "dark"
      ? "hsl(350 65% 68%)"
      : "hsl(0 84% 60%)";

  const preOpenPreview = useMemo(() => {
    if (!holdings || holdings.length === 0 || !quotes) {
      return { available: false, amount: 0, percent: 0 };
    }

    const usSession = getUsMarketSessionState();
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
      const showExtended = shouldShowExtendedQuote(
        usSession,
        quote.marketState,
        quote.preMarketChangePercent,
      );
      const preOpenRaw = showExtended ? quote.preMarketPrice : null;
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

  const usSessionState = getUsMarketSessionState();

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
    <div className="md:hidden bg-background px-3 pt-2 pb-2" data-testid="mobile-portfolio-chart">
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
          {athCelebrationActive && (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 text-sm motion-safe:animate-bounce"
              title="ATH dnes"
              data-testid="badge-mobile-portfolio-ath-confetti"
            >
              <span aria-hidden>🎉</span>
              <span aria-hidden>✨</span>
            </span>
          )}
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
        <div className="flex items-center gap-0.5">
          <button
            onClick={toggleHideAmounts}
            className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground"
            data-testid="button-toggle-amounts"
          >
            {hideAmounts ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="relative p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground"
                aria-label="Dôležité notifikácie"
                data-testid="button-mobile-notifications"
              >
                <Bell className="h-4 w-4" />
                {importantNotificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold text-white">
                    {importantNotificationCount > 99 ? "99+" : importantNotificationCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(92vw,420px)] p-0" align="end">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <p className="text-sm font-semibold">Dôležité notifikácie</p>
                <span className="text-xs text-muted-foreground">{importantNotificationCount}</span>
              </div>
              {importantNotifications.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground">
                  Zatiaľ žiadne nové dôležité notifikácie.
                </div>
              ) : (
                <ul className="max-h-[58vh] overflow-y-auto divide-y divide-border/60">
                  {importantNotifications.map((n) => (
                    <li key={n.id} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-snug">{n.title}</p>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatNotificationDate(n.dateIso)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{n.subtitle}</p>
                      {n.infoUrl && (
                        <a
                          href={n.infoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                          Detail
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
        </div>
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

      <div className="flex items-center gap-2 mb-1">
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
        <div className="flex items-center gap-2 mb-1">
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
      {usSessionState === "CLOSED" && !preOpenPreview.available && (
        <div className="mb-1 text-[10px] text-muted-foreground">Trh uzatvorený</div>
      )}

      <div className="flex items-center gap-2 mb-1">
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

      {!hideCash && (
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] text-muted-foreground">Hotovosť:</span>
        <span className="text-xs font-medium text-foreground" data-testid="text-mobile-cash-balance">
          {maskAmount(formatCurrency(cashValue))}
        </span>
      </div>
      )}

      {shouldUseExtendedQuotes(usSessionState) && (
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Moon className={`h-3 w-3 ${premarketMoonClass}`} />
            {getExtendedSessionLabel(usSessionState)}
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
          <div className="relative h-[180px] -mx-4 overflow-hidden" data-testid="chart-portfolio-performance">
            <div className="chart-fade-grid" aria-hidden />
            {showBenchLine && (
              <div
                className="pointer-events-none absolute left-3 top-1.5 z-10 text-[10px] font-medium tracking-wide"
                style={{ color: benchColor }}
                data-testid="mobile-chart-benchmark-label"
              >
                {benchLabelWithReturn}
              </div>
            )}
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                    <filter id="chartLineGlowMobile" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
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
                                <div className="text-sm font-semibold">
                                  {maskAmount(formatCurrency(data.value))}
                                </div>
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
                    fill="url(#colorValue)"
                    style={{ filter: "url(#chartLineGlowMobile)" }}
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

          <div
            className="flex items-center justify-between mt-2 px-1"
            data-testid="mobile-period-gain"
          >
            <span className="text-[11px] text-muted-foreground truncate max-w-[55%]">
              {periodSelection.type === "custom"
                ? chartPeriodGainLabel(periodSelection, true)
                : `Za ${chartPeriodGainLabel(periodSelection, true)}`}:
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

          <PortfolioChartPeriodPicker
            layout="mobile"
            value={periodSelection}
            onChange={setPeriodSelection}
          />
        </>
      )}
    </div>
  );
}
