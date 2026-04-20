import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Calendar, CalendarDays, AlertCircle, BarChart3, Wallet } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine } from "recharts";
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, eachDayOfInterval, eachMonthOfInterval, eachYearOfInterval, parseISO, isAfter, isBefore, isSameDay, subDays, isWeekend, startOfDay } from "date-fns";
import { sk } from "date-fns/locale";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CompanyLogo } from "@/components/CompanyLogo";
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

interface RealizedGainSummary {
  totalRealized: number;
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

type ViewMode = "daily" | "month" | "year" | "ytd";

export default function Profit() {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { getQueryParam } = usePortfolio();
  
  const portfolioParam = getQueryParam();

  const { data: transactions, isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
  });

  const { data: holdings, isLoading: holdingsLoading } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
  });

  const { data: quotes, isLoading: quotesLoading } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/quotes", holdings?.map(h => h.ticker)],
    enabled: !!holdings && holdings.length > 0,
    staleTime: 60 * 1000,
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

  const allTickers = useMemo(() => {
    if (!transactions) return [];
    const tickers = new Set<string>();
    transactions.forEach(t => tickers.add(t.ticker.toUpperCase()));
    return Array.from(tickers);
  }, [transactions]);

  const { data: historicalData, isLoading: historicalLoading } = useQuery<HistoricalResponse>({
    queryKey: ["/api/stocks/history/batch", allTickers],
    enabled: allTickers.length > 0,
    queryFn: async () => {
      if (allTickers.length === 0) return { prices: {}, errors: {}, fetchedCount: 0, totalRequested: 0 };
      const response = await apiRequest("POST", "/api/stocks/history/batch", { tickers: allTickers });
      return response.json();
    },
    staleTime: 12 * 60 * 60 * 1000,
  });

  const { data: realizedGains } = useQuery<RealizedGainSummary>({
    queryKey: ["/api/realized-gains", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/realized-gains?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch realized gains");
      return res.json();
    },
  });


  const historicalPrices = historicalData?.prices || {};
  const historicalErrors = historicalData?.errors || {};
  const hasHistoricalData = Object.keys(historicalPrices).length > 0 && 
    Object.values(historicalPrices).some(prices => Object.keys(prices).length > 0);

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

  const calculatePortfolioValueAtDate = (targetDate: Date, useCurrentPrices: boolean = false): { value: number; cost: number } => {
    const holdingsAtDate = calculateHoldingsAtDate(targetDate);
    let totalValue = 0;
    let totalCost = 0;

    Object.entries(holdingsAtDate).forEach(([ticker, holding]) => {
      if (holding.shares > 0) {
        totalCost += holding.totalCost;
        
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

    return { value: totalValue, cost: totalCost };
  };

  const dailyData = useMemo(() => {
    if (!transactions || transactions.length === 0) {
      return [];
    }

    const dates = transactions.map(t => parseISO(t.transactionDate as unknown as string));
    const minDate = startOfDay(new Date(Math.min(...dates.map(d => d.getTime()))));
    const maxDate = startOfDay(new Date());

    const allDays = eachDayOfInterval({ start: minDate, end: maxDate });
    
    const tradingDays = allDays.filter(day => !isWeekend(day));

    const dailyValues: DailyValue[] = [];
    let previousCumulativeProfit = 0;

    tradingDays.forEach((day, index) => {
      const isToday = isSameDay(day, new Date());
      const { value, cost } = calculatePortfolioValueAtDate(day, isToday);
      
      const cumulativeProfit = value - cost;
      const dailyProfit = index === 0 ? cumulativeProfit : (cumulativeProfit - previousCumulativeProfit);

      if (value > 0 || cost > 0) {
        dailyValues.push({
          date: day,
          dateStr: format(day, "yyyy-MM-dd"),
          portfolioValue: value,
          totalCost: cost,
          dailyProfit,
          cumulativeProfit,
        });
        previousCumulativeProfit = cumulativeProfit;
      }
    });

    return dailyValues;
  }, [transactions, historicalPrices, quotes]);

  const periodStats = useMemo(() => {
    if (dailyData.length === 0) return [];

    const firstDate = dailyData[0].date;
    const lastDate = dailyData[dailyData.length - 1].date;

    let periods: { start: Date; end: Date; label: string }[] = [];

    if (viewMode === "daily") {
      const last30Days = dailyData.slice(-30);
      return last30Days.map((day, index) => {
        const prevDay = index > 0 ? last30Days[index - 1] : null;
        const startValue = prevDay ? prevDay.portfolioValue : day.totalCost;
        const percentReturn = startValue > 0 ? (day.dailyProfit / startValue) * 100 : 0;
        
        return {
          period: format(day.date, "d. MMM", { locale: sk }),
          periodDate: day.date,
          startValue,
          endValue: day.portfolioValue,
          periodProfit: day.dailyProfit,
          percentReturn,
        };
      });
    } else if (viewMode === "month") {
      const months = eachMonthOfInterval({ start: startOfMonth(firstDate), end: endOfMonth(lastDate) });
      periods = months.map(month => ({
        start: startOfMonth(month),
        end: endOfMonth(month),
        label: format(month, "MMM yyyy", { locale: sk }),
      }));
    } else if (viewMode === "year") {
      const years = eachYearOfInterval({ start: startOfYear(firstDate), end: endOfYear(lastDate) });
      periods = years.map(year => ({
        start: startOfYear(year),
        end: endOfYear(year),
        label: format(year, "yyyy"),
      }));
    } else if (viewMode === "ytd") {
      const ytdStart = startOfYear(new Date());
      periods = [{
        start: ytdStart,
        end: new Date(),
        label: `YTD ${format(new Date(), "yyyy")}`,
      }];
    }

    return periods.map(period => {
      const daysInPeriod = dailyData.filter(d => 
        !isBefore(d.date, period.start) && !isAfter(d.date, period.end)
      );

      if (daysInPeriod.length === 0) {
        return {
          period: period.label,
          periodDate: period.start,
          startValue: 0,
          endValue: 0,
          periodProfit: 0,
          percentReturn: 0,
        };
      }

      const firstDayIndex = dailyData.findIndex(d => isSameDay(d.date, daysInPeriod[0].date));
      const startValue = firstDayIndex > 0 ? dailyData[firstDayIndex - 1].portfolioValue : daysInPeriod[0].totalCost;
      const endValue = daysInPeriod[daysInPeriod.length - 1].portfolioValue;
      
      const periodProfit = daysInPeriod.reduce((sum, day) => sum + day.dailyProfit, 0);
      const percentReturn = startValue > 0 ? (periodProfit / startValue) * 100 : 0;

      return {
        period: period.label,
        periodDate: period.start,
        startValue,
        endValue,
        periodProfit,
        percentReturn,
      };
    }).filter(p => p.startValue > 0 || p.endValue > 0 || p.periodProfit !== 0);
  }, [dailyData, viewMode]);

  const summaryStats = useMemo(() => {
    if (dailyData.length === 0 || !transactions) {
      return null;
    }

    const today = dailyData[dailyData.length - 1];
    const yesterday = dailyData.length > 1 ? dailyData[dailyData.length - 2] : null;
    
    const dailyProfit = today.dailyProfit;
    const dailyPercent = yesterday ? (dailyProfit / yesterday.portfolioValue) * 100 : 0;

    const thisMonth = dailyData.filter(d => 
      d.date.getMonth() === new Date().getMonth() && 
      d.date.getFullYear() === new Date().getFullYear()
    );
    const monthlyProfit = thisMonth.reduce((sum, d) => sum + d.dailyProfit, 0);
    const monthStartValue = thisMonth.length > 0 ? 
      (dailyData.findIndex(d => isSameDay(d.date, thisMonth[0].date)) > 0 
        ? dailyData[dailyData.findIndex(d => isSameDay(d.date, thisMonth[0].date)) - 1].portfolioValue 
        : thisMonth[0].totalCost) 
      : 0;
    const monthlyPercent = monthStartValue > 0 ? (monthlyProfit / monthStartValue) * 100 : 0;

    const thisYear = dailyData.filter(d => d.date.getFullYear() === new Date().getFullYear());
    const yearlyProfit = thisYear.reduce((sum, d) => sum + d.dailyProfit, 0);
    const yearStartValue = thisYear.length > 0 ? 
      (dailyData.findIndex(d => isSameDay(d.date, thisYear[0].date)) > 0 
        ? dailyData[dailyData.findIndex(d => isSameDay(d.date, thisYear[0].date)) - 1].portfolioValue 
        : thisYear[0].totalCost) 
      : 0;
    const yearlyPercent = yearStartValue > 0 ? (yearlyProfit / yearStartValue) * 100 : 0;

    const totalProfit = today.cumulativeProfit;
    const totalPercent = today.totalCost > 0 ? (totalProfit / today.totalCost) * 100 : 0;

    const dates = transactions.map(t => parseISO(t.transactionDate as unknown as string));
    const firstPurchaseDate = new Date(Math.min(...dates.map(d => d.getTime())));

    return {
      currentValue: today.portfolioValue,
      totalCost: today.totalCost,
      dailyProfit,
      dailyPercent,
      monthlyProfit,
      monthlyPercent,
      yearlyProfit,
      yearlyPercent,
      totalProfit,
      totalPercent,
      firstPurchaseDate,
    };
  }, [dailyData, transactions]);

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  const isLoading = transactionsLoading || holdingsLoading || quotesLoading || historicalLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-64 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!transactions || transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Zisk v čase</CardTitle>
          <CardDescription>Štatistika vášho zisku podľa období</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <p>Zatiaľ žiadne transakcie na zobrazenie.</p>
            <p className="text-sm mt-2">Začnite nákupom akcií aby ste videli štatistiku.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {!hasHistoricalData && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Historické ceny nie sú úplne k dispozícii. Niektoré výpočty môžu používať aktuálne ceny.
          </AlertDescription>
        </Alert>
      )}

      {Object.keys(historicalErrors).length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Historické ceny nie sú dostupné pre: {Object.keys(historicalErrors).join(", ")}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-xl font-semibold">Analýza zisku</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={viewMode === "daily" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("daily")}
            data-testid="button-view-daily"
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Denný
          </Button>
          <Button
            variant={viewMode === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("month")}
            data-testid="button-view-month"
          >
            <Calendar className="h-4 w-4 mr-2" />
            Mesačný
          </Button>
          <Button
            variant={viewMode === "year" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("year")}
            data-testid="button-view-year"
          >
            <CalendarDays className="h-4 w-4 mr-2" />
            Ročný
          </Button>
          <Button
            variant={viewMode === "ytd" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("ytd")}
            data-testid="button-view-ytd"
          >
            YTD
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Denný zisk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${(summaryStats?.dailyProfit ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-daily-profit">
              {summaryStats ? formatCurrency(summaryStats.dailyProfit) : "-"}
            </div>
            <div className={`text-sm flex items-center gap-1 ${(summaryStats?.dailyPercent ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              {(summaryStats?.dailyPercent ?? 0) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {summaryStats ? formatPercent(summaryStats.dailyPercent) : "-"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Mesačný zisk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${(summaryStats?.monthlyProfit ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-monthly-profit">
              {summaryStats ? formatCurrency(summaryStats.monthlyProfit) : "-"}
            </div>
            <div className={`text-sm flex items-center gap-1 ${(summaryStats?.monthlyPercent ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              {(summaryStats?.monthlyPercent ?? 0) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {summaryStats ? formatPercent(summaryStats.monthlyPercent) : "-"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">YTD zisk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${(summaryStats?.yearlyProfit ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-ytd-profit">
              {summaryStats ? formatCurrency(summaryStats.yearlyProfit) : "-"}
            </div>
            <div className={`text-sm flex items-center gap-1 ${(summaryStats?.yearlyPercent ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              {(summaryStats?.yearlyPercent ?? 0) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {summaryStats ? formatPercent(summaryStats.yearlyPercent) : "-"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Celkový zisk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${(summaryStats?.totalProfit ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-total-profit">
              {summaryStats ? formatCurrency(summaryStats.totalProfit) : "-"}
            </div>
            <div className={`text-sm flex items-center gap-1 ${(summaryStats?.totalPercent ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              {(summaryStats?.totalPercent ?? 0) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {summaryStats ? formatPercent(summaryStats.totalPercent) : "-"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Aktuálna hodnota</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-current-value">
              {summaryStats ? formatCurrency(summaryStats.currentValue) : "-"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Celkovo investované</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-invested">
              {summaryStats ? formatCurrency(summaryStats.totalCost) : "-"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Prvý nákup</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-first-purchase">
              {summaryStats?.firstPurchaseDate 
                ? format(summaryStats.firstPurchaseDate, "d. MMM yyyy", { locale: sk })
                : "-"
              }
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Realized Gains Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Realizovaný zisk/strata
          </CardTitle>
          <CardDescription>
            Zisk alebo strata z predaných akcií (uzavretých pozícií)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {realizedGains && realizedGains.transactionCount > 0 ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="text-sm text-muted-foreground mb-1">Dnes</div>
                  <div className={`text-lg font-bold ${realizedGains.realizedToday >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-realized-today">
                    {formatCurrency(realizedGains.realizedToday)}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="text-sm text-muted-foreground mb-1">Tento mesiac</div>
                  <div className={`text-lg font-bold ${realizedGains.realizedThisMonth >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-realized-month">
                    {formatCurrency(realizedGains.realizedThisMonth)}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="text-sm text-muted-foreground mb-1">YTD</div>
                  <div className={`text-lg font-bold ${realizedGains.realizedYTD >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-realized-ytd">
                    {formatCurrency(realizedGains.realizedYTD)}
                  </div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="text-sm text-muted-foreground mb-1">Celkovo</div>
                  <div className={`text-lg font-bold ${realizedGains.totalRealized >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-realized-total">
                    {formatCurrency(realizedGains.totalRealized)}
                  </div>
                </div>
              </div>

              {realizedGains.byTicker.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Podľa tickerov</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead>Spoločnosť</TableHead>
                        <TableHead className="text-right">Predajov</TableHead>
                        <TableHead className="text-right">Predané za</TableHead>
                        <TableHead className="text-right">Zisk/Strata</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {realizedGains.byTicker.map((item) => (
                        <TableRow key={item.ticker} data-testid={`row-realized-${item.ticker}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <CompanyLogo ticker={item.ticker} companyName={item.companyName} size="sm" />
                              <span className="font-medium">{item.ticker}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[200px] truncate">{item.companyName}</TableCell>
                          <TableCell className="text-right">{item.transactions}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.totalSold)}</TableCell>
                          <TableCell className={`text-right font-medium ${item.totalGain >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {item.totalGain >= 0 ? "+" : ""}{formatCurrency(item.totalGain)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>Zatiaľ ste nepredali žiadne akcie.</p>
              <p className="text-sm mt-1">Po predaji akcií tu uvidíte realizovaný zisk alebo stratu.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vývoj hodnoty portfólia</CardTitle>
          <CardDescription>Hodnota portfólia v čase</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={dailyData.slice(-90)}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="dateStr" 
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(value) => format(parseISO(value), "d.M", { locale: sk })}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
              />
              <Tooltip 
                formatter={(value: number) => [formatCurrency(value), "Hodnota"]}
                labelFormatter={(label) => format(parseISO(label), "d. MMMM yyyy", { locale: sk })}
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  color: "hsl(var(--foreground))",
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {viewMode === "daily" ? "Denný" : viewMode === "month" ? "Mesačný" : viewMode === "year" ? "Ročný" : "YTD"} zisk/strata
          </CardTitle>
          <CardDescription>
            Zisk alebo strata za obdobie
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={periodStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="period" 
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip 
                formatter={(value: number) => [formatCurrency(value), "Zisk"]}
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  color: "hsl(var(--foreground))",
                }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <Bar dataKey="periodProfit" name="Zisk">
                {periodStats.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.periodProfit >= 0 ? "#22c55e" : "#ef4444"} 
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {viewMode === "daily" ? "Denné" : viewMode === "month" ? "Mesačné" : viewMode === "year" ? "Ročné" : "YTD"} štatistiky
          </CardTitle>
          <CardDescription>
            Detailný prehľad za obdobie
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Obdobie</TableHead>
                  <TableHead className="text-right">Hodnota na začiatku</TableHead>
                  <TableHead className="text-right">Hodnota na konci</TableHead>
                  <TableHead className="text-right">Zisk/Strata</TableHead>
                  <TableHead className="text-right">% Výnos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periodStats.map((period) => (
                  <TableRow key={period.period} data-testid={`row-profit-period-${period.period}`}>
                    <TableCell className="font-medium">{period.period}</TableCell>
                    <TableCell className="text-right">{formatCurrency(period.startValue)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(period.endValue)}</TableCell>
                    <TableCell className={`text-right font-medium ${period.periodProfit >= 0 ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}`}>
                      {formatCurrency(period.periodProfit)}
                    </TableCell>
                    <TableCell className={`text-right ${period.percentReturn >= 0 ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}`}>
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
