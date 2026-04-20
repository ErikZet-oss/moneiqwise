import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { format, subDays, subMonths, subYears, startOfYear, parseISO, isAfter, startOfDay, isSameDay, isWeekend } from "date-fns";
import { sk } from "date-fns/locale";
import { eachDayOfInterval } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface DesktopPortfolioChartProps {
  totalValue: number;
  totalInvested: number;
}

export function DesktopPortfolioChart({ 
  totalValue, 
  totalInvested
}: DesktopPortfolioChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("ALL");
  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { getQueryParam } = usePortfolio();
  const { showChart, showTooltip } = useChartSettings();
  
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
    let totalVal = 0;

    Object.entries(holdingsAtDate).forEach(([ticker, holding]) => {
      if (holding.shares > 0) {
        let price: number | null = null;
        
        if (useCurrentPrices) {
          price = getCurrentPrice(ticker);
        } else {
          price = getPrice(ticker, targetDate);
        }
        
        if (price) {
          totalVal += holding.shares * price;
        } else {
          totalVal += holding.totalCost;
        }
      }
    });

    return totalVal;
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
          displayDate: format(day, "d. MMM yyyy", { locale: sk }),
          value,
        });
      }
    });

    return data;
  }, [transactions, historicalPrices, quotes, selectedPeriod]);

  // P&L scoped to the selected time range. The chart itself plots raw
  // portfolio value over time, which will jump up/down whenever the user
  // buys or sells during the period. To report an honest gain/loss for the
  // period we have to subtract that net cash inflow:
  //   periodGain = value_now − value_at_period_start − (buys − sells in period)
  // For "ALL" the formula naturally collapses to totalValue − totalInvested.
  const periodGainLoss = useMemo(() => {
    if (chartData.length < 2) {
      const change = totalValue - totalInvested;
      const percent = totalInvested > 0 ? (change / totalInvested) * 100 : 0;
      return { amount: change, percent };
    }

    const firstPoint = chartData[0];
    const lastPoint = chartData[chartData.length - 1];
    const firstValue = firstPoint.value;
    const lastValue = lastPoint.value;

    // Sum buys/sells that happened AFTER the first chart point (same-day
    // activity is already baked into firstValue, so don't double-count it).
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

  const periods: TimePeriod[] = ["1D", "1W", "1M", "YTD", "1Y", "ALL"];

  const periodLabel: Record<TimePeriod, string> = {
    "1D": "Za 1D",
    "1W": "Za 1T",
    "1M": "Za 1M",
    YTD: "Za YTD",
    "1Y": "Za 1R",
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
