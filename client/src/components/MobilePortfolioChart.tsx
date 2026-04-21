import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { format, subDays, subMonths, subYears, startOfYear, parseISO, isAfter, startOfDay, isSameDay, isWeekend, subHours, eachDayOfInterval, eachHourOfInterval } from "date-fns";
import { sk } from "date-fns/locale";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BrokerLogo } from "@/components/BrokerLogo";
import { ArrowRightLeft, Eye, EyeOff, HelpCircle, Loader2, RefreshCw } from "lucide-react";
import type { Transaction, Holding } from "@shared/schema";

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
}

interface HistoricalPrices {
  [ticker: string]: Record<string, number>;
}

interface HistoricalResponse {
  prices: HistoricalPrices;
  errors: Record<string, string>;
  fetchedCount: number;
  totalRequested: number;
}

type TimePeriod = "1D" | "1W" | "1M" | "YTD" | "1Y" | "ALL";

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
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("ALL");
  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { getQueryParam, selectedPortfolio, selectedPortfolioId } = usePortfolio();
  const { showChart, showTooltip, hideAmounts, toggleHideAmounts } = useChartSettings();
  
  const maskAmount = (amount: string) => hideAmounts ? "••••••" : amount;
  
  const portfolioParam = getQueryParam();

  const { data: transactions } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
  });

  const { data: holdings } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
  });

  const { data: quotes } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/quotes", holdings?.map(h => h.ticker)],
    enabled: !!holdings && holdings.length > 0,
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

  const { data: historicalData } = useQuery<HistoricalResponse>({
    queryKey: ["/api/stocks/history/batch", holdings?.map(h => h.ticker)],
    enabled: !!holdings && holdings.length > 0,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      if (!holdings || holdings.length === 0) return { prices: {}, errors: {}, fetchedCount: 0, totalRequested: 0 };
      const tickers = holdings.map(h => h.ticker);
      const res = await fetch("/api/stocks/history/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) throw new Error("Failed to fetch historical prices");
      return res.json();
    },
  });

  const historicalPrices = historicalData?.prices || {};

  const getPrice = (ticker: string, date: Date): number | null => {
    const upperTicker = ticker.toUpperCase();
    const dateStr = format(date, "yyyy-MM-dd");
    const tickerCurrency = getTickerCurrency(ticker);
    
    let price: number | null = null;
    
    if (historicalPrices[upperTicker]?.[dateStr]) {
      price = historicalPrices[upperTicker][dateStr];
    }
    
    if (!price) {
      for (let i = 1; i <= 7; i++) {
        const prevDateStr = format(subDays(date, i), "yyyy-MM-dd");
        if (historicalPrices[upperTicker]?.[prevDateStr]) {
          price = historicalPrices[upperTicker][prevDateStr];
          break;
        }
      }
    }
    
    if (!price) {
      if (quotes?.[upperTicker]) price = quotes[upperTicker].price;
      else if (quotes?.[ticker]) price = quotes[ticker].price;
    }
    
    if (price !== null) {
      return convertPrice(price, tickerCurrency);
    }
    
    return null;
  };

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

  const calculateHoldingsAtDate = (targetDate: Date) => {
    if (!transactions) return {};
    
    const holdingsAtDate: Record<string, { shares: number; avgCost: number; totalCost: number }> = {};
    
    const txnsUpToDate = transactions
      .filter(t => {
        const txnDate = parseISO(t.transactionDate as unknown as string);
        return !isAfter(startOfDay(txnDate), startOfDay(targetDate));
      })
      .sort((a, b) => {
        const dateA = parseISO(a.transactionDate as unknown as string);
        const dateB = parseISO(b.transactionDate as unknown as string);
        return dateA.getTime() - dateB.getTime();
      });

    txnsUpToDate.forEach(txn => {
      if (txn.type !== "BUY" && txn.type !== "SELL") return;
      
      const shares = parseFloat(txn.shares);
      const price = parseFloat(txn.pricePerShare);
      const commission = parseFloat(txn.commission || "0");

      if (txn.type === "BUY") {
        if (!holdingsAtDate[txn.ticker]) {
          holdingsAtDate[txn.ticker] = { shares: 0, avgCost: 0, totalCost: 0 };
        }
        const existing = holdingsAtDate[txn.ticker];
        const totalCost = shares * price + commission;
        const newShares = existing.shares + shares;
        existing.totalCost += totalCost;
        existing.avgCost = existing.totalCost / newShares;
        existing.shares = newShares;
      } else if (txn.type === "SELL") {
        if (holdingsAtDate[txn.ticker]) {
          const existing = holdingsAtDate[txn.ticker];
          const soldCost = shares * existing.avgCost;
          existing.shares = Math.max(0, existing.shares - shares);
          existing.totalCost = Math.max(0, existing.totalCost - soldCost);
        }
      }
    });

    return holdingsAtDate;
  };

  const calculatePortfolioValueAtDate = (targetDate: Date, useCurrentPrices: boolean = false): number => {
    const holdingsAtDate = calculateHoldingsAtDate(targetDate);
    let totalValue = 0;

    Object.entries(holdingsAtDate).forEach(([ticker, holding]) => {
      if (holding.shares > 0) {
        let price: number | null = null;
        
        if (useCurrentPrices) {
          price = getCurrentPrice(ticker);
        } else {
          price = getPrice(ticker, targetDate);
        }
        
        if (price) {
          totalValue += holding.shares * price;
        } else {
          totalValue += holding.totalCost;
        }
      }
    });

    return totalValue;
  };

  const chartData = useMemo(() => {
    if (!transactions || transactions.length === 0) {
      return [];
    }

    const now = new Date();
    let startDate: Date;
    
    switch (selectedPeriod) {
      case "1D":
        startDate = subDays(now, 1);
        break;
      case "1W":
        startDate = subDays(now, 7);
        break;
      case "1M":
        startDate = subMonths(now, 1);
        break;
      case "YTD":
        startDate = startOfYear(now);
        break;
      case "1Y":
        startDate = subYears(now, 1);
        break;
      case "ALL":
        const dates = transactions.map(t => parseISO(t.transactionDate as unknown as string));
        startDate = new Date(Math.min(...dates.map(d => d.getTime())));
        break;
      default:
        startDate = subMonths(now, 1);
    }

    const allDays = eachDayOfInterval({ start: startOfDay(startDate), end: startOfDay(now) });
    const tradingDays = allDays.filter(day => !isWeekend(day));

    const data: { date: string; value: number; displayDate: string }[] = [];

    tradingDays.forEach((day) => {
      const isToday = isSameDay(day, now);
      const value = calculatePortfolioValueAtDate(day, isToday);
      
      if (value > 0) {
        data.push({
          date: format(day, "yyyy-MM-dd"),
          displayDate: format(day, "d. MMM", { locale: sk }),
          value,
        });
      }
    });

    return data;
  }, [transactions, historicalPrices, quotes, selectedPeriod]);

  // P&L for the selected range. The chart line jumps whenever there's a BUY
  // or SELL inside the window, so to get an honest gain we subtract the net
  // cash inflow that happened after the first chart point:
  //   periodGain = lastValue − firstValue − (buys − sells inside window)
  // For "ALL" the formula naturally collapses to totalValue − totalInvested.
  const periodChange = useMemo(() => {
    if (chartData.length < 2) {
      const change = totalValue - totalInvested;
      const percent = totalInvested > 0 ? (change / totalInvested) * 100 : 0;
      return { amount: change, percent };
    }

    const firstPoint = chartData[0];
    const lastPoint = chartData[chartData.length - 1];
    const firstValue = firstPoint.value;
    const lastValue = lastPoint.value;

    let netInflow = 0;
    if (transactions) {
      transactions.forEach((t) => {
        if (t.type !== "BUY" && t.type !== "SELL") return;
        const d = format(parseISO(t.transactionDate as unknown as string), "yyyy-MM-dd");
        if (d > firstPoint.date && d <= lastPoint.date) {
          const shares = parseFloat(t.shares);
          const price = parseFloat(t.pricePerShare);
          const commission = parseFloat(t.commission || "0");
          if (t.type === "BUY") {
            netInflow += shares * price + commission;
          } else {
            netInflow -= shares * price - commission;
          }
        }
      });
    }

    const change = lastValue - firstValue - netInflow;
    const baseline = firstValue + Math.max(netInflow, 0);
    const percent = baseline > 0 ? (change / baseline) * 100 : 0;
    return { amount: change, percent };
  }, [chartData, transactions, totalValue, totalInvested]);

  const periodLabel: Record<TimePeriod, string> = {
    "1D": "1D",
    "1W": "1T",
    "1M": "1M",
    YTD: "YTD",
    "1Y": "1R",
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

  const periods: TimePeriod[] = ["1D", "1W", "1M", "YTD", "1Y", "ALL"];

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
        <span className={`text-xs font-medium ${dailyChange >= 0 ? "text-green-500" : "text-red-500"}`}>
          {dailyChange >= 0 ? "+" : ""}{maskAmount(formatCurrency(dailyChange))}
        </span>
        <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${
          dailyChange >= 0 ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"
        }`}>
          {dailyChange >= 0 ? "+" : ""}{dailyChangePercent.toFixed(2)}%
        </span>
      </div>

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
