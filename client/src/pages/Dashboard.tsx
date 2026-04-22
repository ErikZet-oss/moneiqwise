import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Minus, ArrowUpDown, ArrowUp, ArrowDown, Wallet, Banknote, Newspaper, ExternalLink, HelpCircle, Loader2, RefreshCw } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { CompanyLogo } from "@/components/CompanyLogo";
import { MobilePortfolioChart } from "@/components/MobilePortfolioChart";
import { DesktopPortfolioChart } from "@/components/DesktopPortfolioChart";
import type { Holding } from "@shared/schema";
import { formatShareQuantity } from "@/lib/utils";

interface RealizedGainSummary {
  totalRealized: number;
  realizedYTD: number;
  realizedThisMonth: number;
  realizedToday: number;
  transactionCount: number;
}

interface DividendSummary {
  totalNet: number;
  netYTD: number;
  netThisMonth: number;
  netToday: number;
  transactionCount: number;
}

interface OptionStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: string;
  totalRealizedGain: string;
  totalWins: string;
  totalLosses: string;
  avgWin: string;
  avgLoss: string;
}

interface PnlBreakdown {
  currency: string;
  realizedCapitalGain: number;
  unrealizedPriceGain: number;
  unrealizedFxGain: number;
  residualUnrealized: number;
  dividendNet: number;
  method: { realized: string; costEur: string };
}

interface TwrResponse {
  timeWeightedReturn: number;
  sp500TimeWeightedReturn: number;
  linkedPeriods: number;
  note: string;
  method: string;
}

interface OptionTrade {
  id: string;
  underlying: string;
  optionType: string;
  direction: string;
  strikePrice: string;
  premium: string;
  contracts: string;
  commission: string;
  status: string;
  realizedGain: string | null;
}

type SortField = "ticker" | "companyName" | "shares" | "avgCost" | "currentPrice" | "value" | "gainLoss";
type SortDirection = "asc" | "desc";

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
}

async function fetchDashboardQuotesBatch(
  tickers: string[],
  refresh: boolean,
): Promise<Record<string, StockQuote>> {
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
}

interface NewsArticle {
  ticker: string;
  title: string;
  link: string;
  publisher: string;
  publishedAt: number;
  summary?: string;
  thumbnail?: string;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { getQueryParam, selectedPortfolio, isAllPortfolios, portfolios } = usePortfolio();
  const { hideAmounts, showNews } = useChartSettings();
  const [sortField, setSortField] = useState<SortField>("ticker");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  
  const maskAmount = (amount: string) => hideAmounts ? "••••••" : amount;
  
  const portfolioParam = getQueryParam();
  
  const { data: holdings, isLoading: holdingsLoading } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
  });

  const {
    data: quotesData,
    dataUpdatedAt,
    isFetching: quotesFetching,
  } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/quotes", holdings?.map(h => h.ticker)],
    enabled: !!holdings && holdings.length > 0,
    // Quotes are the one thing we want reasonably fresh during market hours.
    // 1 minute gives near-live feel while still coalescing many renders into a
    // single network request. The server-side cache (30 min TTL) will usually
    // serve it instantly anyway.
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!holdings || holdings.length === 0) return {};
      const tickers = holdings.map(h => h.ticker);
      return fetchDashboardQuotesBatch(tickers, false);
    },
  });
  
  const quotes = quotesData;

  const refreshDashboardQuotes = useCallback(async () => {
    if (!holdings || holdings.length === 0) return;
    const tickers = holdings.map((h) => h.ticker);
    await queryClient.fetchQuery({
      queryKey: ["/api/quotes", tickers],
      queryFn: () => fetchDashboardQuotesBatch(tickers, true),
    });
  }, [holdings, queryClient]);
  
  const formatLastUpdated = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString("sk-SK", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const { data: realizedGains } = useQuery<RealizedGainSummary>({
    queryKey: ["/api/realized-gains", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/realized-gains?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch realized gains");
      return res.json();
    },
  });

  const { data: dividends } = useQuery<DividendSummary>({
    queryKey: ["/api/dividends", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      return res.json();
    },
  });

  const { data: optionStats } = useQuery<OptionStats>({
    queryKey: ["/api/options/stats/summary", isAllPortfolios ? "all" : portfolioParam],
    queryFn: async () => {
      const res = await fetch("/api/options/stats/summary");
      if (!res.ok) throw new Error("Failed to fetch options stats");
      return res.json();
    },
    enabled: isAllPortfolios,
  });

  const { data: optionTrades } = useQuery<OptionTrade[]>({
    queryKey: ["/api/options", isAllPortfolios ? "all" : portfolioParam],
    queryFn: async () => {
      const res = await fetch("/api/options");
      if (!res.ok) throw new Error("Failed to fetch options");
      return res.json();
    },
    enabled: isAllPortfolios,
  });

  const { data: pnlBreakdown } = useQuery<PnlBreakdown>({
    queryKey: ["/api/pnl-breakdown", portfolioParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/pnl-breakdown?portfolio=${encodeURIComponent(portfolioParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("pnl breakdown");
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  const { data: twrData } = useQuery<TwrResponse>({
    queryKey: ["/api/twr", portfolioParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/twr?portfolio=${encodeURIComponent(portfolioParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("twr");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: fees } = useQuery<{ stockFees: number; optionFees: number; totalFees: number }>({
    queryKey: ["/api/fees", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/fees?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch fees");
      return res.json();
    },
  });

  const { data: news, isLoading: newsLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/news?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    enabled: showNews && !!holdings && holdings.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const formatRelativeTime = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    if (diff < 60) return "Práve teraz";
    if (diff < 3600) return `pred ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `pred ${Math.floor(diff / 3600)} h`;
    if (diff < 604800) return `pred ${Math.floor(diff / 86400)} d`;
    return new Date(timestamp * 1000).toLocaleDateString("sk-SK");
  };

  const calculateOpenOptionsValue = () => {
    if (!optionTrades || !isAllPortfolios) return { 
      buyPremiumValue: 0, 
      buyTotalCost: 0, 
      sellCommission: 0, 
      openCount: 0 
    };
    
    let buyPremiumValue = 0;
    let buyTotalCost = 0;
    let sellCommission = 0;
    let openCount = 0;
    
    const openTrades = optionTrades.filter(t => t.status === "OPEN");
    
    openTrades.forEach((trade) => {
      const premium = parseFloat(trade.premium);
      const contracts = parseFloat(trade.contracts);
      const commission = parseFloat(trade.commission || "0");
      const premiumValue = premium * 100 * contracts;
      
      openCount++;
      
      if (trade.direction === "SELL") {
        sellCommission += commission;
      } else {
        buyPremiumValue += premiumValue;
        buyTotalCost += premiumValue + commission;
      }
    });
    
    return { buyPremiumValue, buyTotalCost, sellCommission, openCount };
  };

  // Hotovosť = súčet v EUR z vkladov a výberov (GET /api/portfolios ju už má v EUR, prepíname do zobrazovacej meny).
  const cashValue = useMemo(() => {
    if (isAllPortfolios) {
      return portfolios.reduce((sum, p) => {
        const n = parseFloat(p.cashBalance ?? "0");
        return sum + convertPrice(Number.isFinite(n) ? n : 0, "EUR");
      }, 0);
    }
    if (selectedPortfolio) {
      const n = parseFloat(selectedPortfolio.cashBalance ?? "0");
      return convertPrice(Number.isFinite(n) ? n : 0, "EUR");
    }
    return 0;
  }, [isAllPortfolios, portfolios, selectedPortfolio, convertPrice]);

  const calculatePortfolioMetrics = () => {
    const hasHoldings = holdings && holdings.length > 0 && quotes;
    const hasOptions = isAllPortfolios && optionStats;
    
    const stockRealizedGain = realizedGains?.totalRealized || 0;
    const dividendGain = dividends?.totalNet || 0;
    
    if (!hasHoldings && !hasOptions) {
      const totalProfit = stockRealizedGain + dividendGain;
      return {
        totalValue: cashValue,
        stockValue: 0,
        cashValue,
        totalInvested: 0,
        totalGainLoss: 0,
        totalGainLossPercent: 0,
        dailyChange: 0,
        dailyChangePercent: 0,
        optionsIncluded: false,
        optionsRealizedGain: 0,
        openOptionsCount: 0,
        unrealizedGain: 0,
        stockRealizedGain,
        dividendGain,
        totalProfit,
      };
    }

    // `stockValue` intentionally excludes cash so gains/P&L stay a function of
    // invested positions only. `totalValue` (what we display as "Celková
    // hodnota") then tops it up with the uninvested cash.
    let stockValue = 0;
    let totalInvested = 0;
    let dailyChange = 0;

    if (hasHoldings) {
      holdings!.forEach((holding) => {
        const quote = quotes![holding.ticker];
        const shares = parseFloat(holding.shares);
        const invested = parseFloat(holding.totalInvested);
        const tickerCurrency = getTickerCurrency(holding.ticker);
        
        totalInvested += invested;
        
        if (quote) {
          const convertedPrice = convertPrice(quote.price, tickerCurrency);
          const convertedChange = convertPrice(quote.change, tickerCurrency);
          const currentValue = shares * convertedPrice;
          stockValue += currentValue;
          dailyChange += shares * convertedChange;
        } else {
          stockValue += invested;
        }
      });
    }

    let optionsRealizedGain = 0;
    let openOptionsCount = 0;
    
    if (hasOptions && optionStats) {
      optionsRealizedGain = parseFloat(optionStats.totalRealizedGain);
      const openOptions = calculateOpenOptionsValue();
      openOptionsCount = openOptions.openCount;
      stockValue += openOptions.buyPremiumValue;
      stockValue -= openOptions.sellCommission;
      totalInvested += openOptions.buyTotalCost;
    }

    const totalGainLoss = stockValue - totalInvested;
    const totalGainLossPercent = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;
    const dailyChangePercent = (stockValue - dailyChange) > 0
      ? (dailyChange / (stockValue - dailyChange)) * 100
      : 0;

    const unrealizedGain = totalGainLoss;
    const totalProfit = unrealizedGain + stockRealizedGain + optionsRealizedGain + dividendGain;
    const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

    // Cash tops up the headline "Total value" only; profit / invested / gain
    // ratios above are intentionally computed against stockValue so that
    // uninvested cash does not distort performance numbers.
    const totalValue = stockValue + cashValue;

    return {
      totalValue,
      stockValue,
      cashValue,
      totalInvested,
      totalGainLoss,
      totalGainLossPercent,
      dailyChange,
      dailyChangePercent,
      optionsIncluded: hasOptions,
      optionsRealizedGain,
      openOptionsCount,
      unrealizedGain,
      stockRealizedGain,
      dividendGain,
      totalProfit,
      totalProfitPercent,
    };
  };

  const metrics = calculatePortfolioMetrics();

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    return sortDirection === "asc" 
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const sortedHoldings = useMemo(() => {
    if (!holdings || !quotes) return holdings || [];

    return [...holdings].sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      const aShares = parseFloat(a.shares);
      const bShares = parseFloat(b.shares);
      const aAvgCost = parseFloat(a.averageCost);
      const bAvgCost = parseFloat(b.averageCost);
      const aTickerCurrency = getTickerCurrency(a.ticker);
      const bTickerCurrency = getTickerCurrency(b.ticker);
      const aQuote = quotes[a.ticker];
      const bQuote = quotes[b.ticker];
      const aAvgCostDisplay = convertPrice(aAvgCost, aTickerCurrency);
      const bAvgCostDisplay = convertPrice(bAvgCost, bTickerCurrency);
      const aCurrentPrice = aQuote ? convertPrice(aQuote.price, aTickerCurrency) : aAvgCostDisplay;
      const bCurrentPrice = bQuote ? convertPrice(bQuote.price, bTickerCurrency) : bAvgCostDisplay;
      const aCurrentValue = aShares * aCurrentPrice;
      const bCurrentValue = bShares * bCurrentPrice;
      const aInvested = parseFloat(a.totalInvested);
      const bInvested = parseFloat(b.totalInvested);
      const aInvestedDisplay = convertPrice(aInvested, aTickerCurrency);
      const bInvestedDisplay = convertPrice(bInvested, bTickerCurrency);
      const aGainLoss = aCurrentValue - aInvestedDisplay;
      const bGainLoss = bCurrentValue - bInvestedDisplay;

      switch (sortField) {
        case "ticker":
          aValue = a.ticker.toUpperCase();
          bValue = b.ticker.toUpperCase();
          break;
        case "companyName":
          aValue = (a.companyName || "").toUpperCase();
          bValue = (b.companyName || "").toUpperCase();
          break;
        case "shares":
          aValue = aShares;
          bValue = bShares;
          break;
        case "avgCost":
          aValue = aAvgCostDisplay;
          bValue = bAvgCostDisplay;
          break;
        case "currentPrice":
          aValue = aCurrentPrice;
          bValue = bCurrentPrice;
          break;
        case "value":
          aValue = aCurrentValue;
          bValue = bCurrentValue;
          break;
        case "gainLoss":
          aValue = aGainLoss;
          bValue = bGainLoss;
          break;
        default:
          aValue = a.ticker;
          bValue = b.ticker;
      }

      if (typeof aValue === "string" && typeof bValue === "string") {
        const comparison = aValue.localeCompare(bValue, "sk");
        return sortDirection === "asc" ? comparison : -comparison;
      }

      const comparison = (aValue as number) - (bValue as number);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [holdings, quotes, sortField, sortDirection, convertPrice, getTickerCurrency]);

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  const getChangeIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (value < 0) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getChangeColor = (value: number) => {
    if (value > 0) return "text-green-500";
    if (value < 0) return "text-red-500";
    return "text-muted-foreground";
  };

  if (holdingsLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <MobilePortfolioChart 
        totalValue={metrics.totalValue}
        totalInvested={metrics.totalInvested}
        dailyChange={metrics.dailyChange}
        dailyChangePercent={metrics.dailyChangePercent}
        totalProfit={metrics.totalProfit}
        totalProfitPercent={metrics.totalProfitPercent}
        unrealizedGain={metrics.unrealizedGain}
        onRefreshQuotes={refreshDashboardQuotes}
        quotesRefreshing={quotesFetching}
      />

      <div className="hidden md:grid gap-3 md:grid-cols-4 xl:grid-cols-5">
        <Card data-testid="card-total-value">
          <CardHeader className="flex flex-row items-center justify-between gap-1 pb-1 p-6 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              Celková hodnota
              {metrics.optionsIncluded && (
                <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
                  + opcie
                </Badge>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px]">
                  <p className="font-semibold mb-1">Celková hodnota portfólia</p>
                  <p className="text-xs">Súčet aktuálnej trhovej hodnoty všetkých vašich pozícií. Pri opciách sa počíta hodnota prémia otvorených pozícií.</p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            {holdings && holdings.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={quotesFetching}
                onClick={() => refreshDashboardQuotes()}
                aria-label="Obnoviť ceny a dennú zmenu"
                data-testid="button-dashboard-refresh-quotes"
              >
                {quotesFetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <div className="text-2xl font-bold truncate" data-testid="text-total-value">
              {maskAmount(formatCurrency(metrics.totalValue))}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              Investované: {maskAmount(formatCurrency(metrics.totalInvested))}
              {metrics.optionsIncluded && metrics.openOptionsCount > 0 && (
                <span className="ml-1">({metrics.openOptionsCount} otvorených opcií)</span>
              )}
            </p>
            {metrics.cashValue !== 0 && (
              <p className="text-xs text-muted-foreground truncate">
                Z toho hotovosť / margin: {maskAmount(formatCurrency(metrics.cashValue))}
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-cash">
          <CardHeader className="flex flex-row items-center justify-between gap-1 pb-1 p-6 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              <Banknote className="h-4 w-4" />
              Hotovosť / margin
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px]">
                  <p className="font-semibold mb-1">Súčet vkladov a výberov</p>
                  <p className="text-xs">
                    V EUR (základ) z transakcií vklad a výber. Môže byť záporné (výber prevýšil vklady, alebo broker hlási margin / dlh).
                    Započítava sa do „Celkovej hodnoty“; karta zisku a výkonnosti stále reflektuje obchodovanie s titulmi.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <div className="text-2xl font-bold truncate" data-testid="text-cash-value">
              {maskAmount(formatCurrency(metrics.cashValue))}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {isAllPortfolios
                ? `Súčet z ${portfolios.length} ${portfolios.length === 1 ? "portfólia" : "portfólií"}`
                : "V EUR z vkladov a výberov (DEPOSIT / WITHDRAWAL)"}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-profit">
          <CardHeader className="flex flex-row items-center justify-between gap-1 pb-1 p-6 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              Celkový profit
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[300px]">
                  <p className="font-semibold mb-1">Celkový profit (P&L)</p>
                  <p className="text-xs mb-2">
                    Pre akcie: kapitálový zisk (FIFO, náklad v EUR v deň D), FX a dividendy z API. Celková suma hore stále zahŕňa opcie, ak ich máš.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            {getChangeIcon(metrics.totalProfit)}
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold truncate ${getChangeColor(metrics.totalProfit)}`} data-testid="text-total-profit">
                {maskAmount(formatCurrency(metrics.totalProfit))}
              </span>
              <span className={`text-sm font-medium ${getChangeColor(metrics.totalProfitPercent || 0)}`} data-testid="text-total-profit-percent">
                {formatPercent(metrics.totalProfitPercent || 0)}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground space-y-0.5 mt-1">
              {pnlBreakdown ? (
                <>
                  <div className="flex justify-between gap-1">
                    <span className="truncate" title="FIFO, kurz v deň transakcie">Kapitálový (cena):</span>
                    <span
                      className={getChangeColor(
                        pnlBreakdown.realizedCapitalGain +
                          pnlBreakdown.unrealizedPriceGain +
                          pnlBreakdown.residualUnrealized,
                      )}
                    >
                      {maskAmount(
                        formatCurrency(
                          pnlBreakdown.realizedCapitalGain +
                            pnlBreakdown.unrealizedPriceGain +
                            pnlBreakdown.residualUnrealized,
                        ),
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className="truncate">Dividendy (čisté):</span>
                    <span className="text-blue-500">
                      +{maskAmount(formatCurrency(pnlBreakdown.dividendNet))}
                    </span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className="truncate" title="Nerealizované: zmena kurzu pri fixnej cene v titule">
                      FX (kurzy):
                    </span>
                    <span className={getChangeColor(pnlBreakdown.unrealizedFxGain)}>
                      {maskAmount(formatCurrency(pnlBreakdown.unrealizedFxGain))}
                    </span>
                  </div>
                  {metrics.optionsIncluded && (
                    <p className="text-[9px] text-amber-600/90 pt-0.5">
                      Opcie zahrnuté v sume hore, nie v tomto rozpise (len akcie).
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>Nerealizovaný:</span>
                    <span className={getChangeColor(metrics.unrealizedGain)}>{maskAmount(formatCurrency(metrics.unrealizedGain))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Realizovaný:</span>
                    <span className={getChangeColor(metrics.stockRealizedGain + metrics.optionsRealizedGain)}>
                      {maskAmount(formatCurrency(metrics.stockRealizedGain + metrics.optionsRealizedGain))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dividendy:</span>
                    <span className="text-blue-500">+{maskAmount(formatCurrency(metrics.dividendGain))}</span>
                  </div>
                </>
              )}
            </div>
            {twrData && twrData.linkedPeriods > 0 && (
              <p className="text-[9px] text-muted-foreground border-t border-border/60 pt-1.5 mt-1.5 leading-tight">
                TWR (GIPS) vs. vklady: {formatPercent(twrData.timeWeightedReturn * 100)} · S&amp;P 500 (rovnaké
                obdobia): {formatPercent(twrData.sp500TimeWeightedReturn * 100)} · {twrData.linkedPeriods}{" "}
                segmentov
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-daily-change">
          <CardHeader className="flex flex-row items-center justify-between gap-1 pb-1 p-6 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              Denná zmena
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px]">
                  <p className="font-semibold mb-1">Denná zmena</p>
                  <p className="text-xs">Zmena hodnoty portfólia za dnešný obchodný deň. Počíta sa ako súčet denných zmien všetkých pozícií na základe aktuálnych trhových cien.</p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            {getChangeIcon(metrics.dailyChange)}
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <div className={`text-2xl font-bold truncate ${getChangeColor(metrics.dailyChange)}`} data-testid="text-daily-change">
              {maskAmount(formatCurrency(metrics.dailyChange))}
            </div>
            <p className={`text-xs ${getChangeColor(metrics.dailyChangePercent)}`}>
              {formatPercent(metrics.dailyChangePercent)}
            </p>
            {dataUpdatedAt && (
              <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-last-updated">
                {formatLastUpdated(dataUpdatedAt)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-realized-dividends">
          <CardHeader className="pb-1 p-6 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              Uzavreté
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[300px]">
                  <p className="font-semibold mb-1">Uzavreté obchody</p>
                  <ul className="text-xs space-y-1 list-disc pl-3">
                    <li><span className="font-medium">Realizované:</span> Zisk/strata z predaných akcií (predajná cena - nákupná cena - poplatky)</li>
                    <li><span className="font-medium">Dividendy:</span> Čisté dividendy po zrážkovej dani</li>
                    <li><span className="font-medium">Opcie:</span> Zisk/strata z uzavretých opčných obchodov</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-6 pt-0">
            <div className="flex items-center justify-between gap-1" data-testid="text-dashboard-realized">
              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                <Wallet className="h-3 w-3" />
                Realizované
              </span>
              {realizedGains && realizedGains.transactionCount > 0 ? (
                <span className={`text-sm font-semibold truncate ${getChangeColor(realizedGains.totalRealized)}`}>
                  {maskAmount(formatCurrency(realizedGains.totalRealized))}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-1" data-testid="text-dashboard-dividends">
              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                <Banknote className="h-3 w-3" />
                Dividendy
              </span>
              {dividends && dividends.transactionCount > 0 ? (
                <span className="text-sm font-semibold text-blue-500 truncate">
                  +{maskAmount(formatCurrency(dividends.totalNet))}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            {metrics.optionsIncluded && (
              <div className="flex items-center justify-between gap-1" data-testid="text-dashboard-options">
                <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                  <TrendingUp className="h-3 w-3" />
                  Opcie
                </span>
                {metrics.optionsRealizedGain !== 0 ? (
                  <span className={`text-sm font-semibold truncate ${getChangeColor(metrics.optionsRealizedGain)}`}>
                    {maskAmount(formatCurrency(metrics.optionsRealizedGain))}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <DesktopPortfolioChart 
        totalValue={metrics.totalValue}
        totalInvested={metrics.totalInvested}
      />
      
      <div className="md:hidden grid gap-2 grid-cols-2 px-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="bg-card rounded-lg p-2.5 border cursor-help">
              <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
                Poplatky
                <HelpCircle className="h-2.5 w-2.5" />
              </div>
              <div className="text-xs font-semibold text-orange-500">
                -{maskAmount(formatCurrency(fees?.totalFees || 0))}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[250px]">
            <p className="font-semibold mb-1">Poplatky a provízie</p>
            <p className="text-xs">Celková suma poplatkov za transakcie s akciami a opciami (otváracia + zatváracia provízia).</p>
          </TooltipContent>
        </Tooltip>
        <div className="bg-card rounded-lg p-2 border flex flex-col min-h-[3.25rem]">
          <div className="flex items-start justify-between gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="min-w-0 flex-1 cursor-help text-left">
                  <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
                    <Banknote className="h-2.5 w-2.5 shrink-0" />
                    Hotovosť / margin
                    <HelpCircle className="h-2.5 w-2.5" />
                  </div>
                  <div
                    className="text-xs font-semibold tabular-nums truncate text-foreground"
                    data-testid="text-cash-value-mobile"
                  >
                    {maskAmount(formatCurrency(metrics.cashValue))}
                  </div>
                  <div className="text-[9px] text-muted-foreground truncate mt-0.5 leading-tight">
                    {isAllPortfolios
                      ? portfolios.length === 1
                        ? "1 portfólio"
                        : portfolios.length >= 2 && portfolios.length <= 4
                          ? `${portfolios.length} portfóliá`
                          : `${portfolios.length} portfólií`
                      : "V EUR z vkladov a výberov"}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px]">
                <p className="font-semibold mb-1">Súčet vkladov a výberov</p>
                <p className="text-xs">
                  V EUR (základ) z vkladov a výberov. Započítava sa do celkovej hodnoty; neovplyvňuje karty so ziskom. Pri „Všetky portfóliá“ je súčet.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      
      <div className="md:hidden grid gap-2 grid-cols-2 px-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="bg-card rounded-lg p-2.5 border cursor-help">
              <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
                Realizovaný zisk
                <HelpCircle className="h-2.5 w-2.5" />
              </div>
              <div className={`text-xs font-semibold ${getChangeColor(metrics.stockRealizedGain + metrics.optionsRealizedGain)}`}>
                {maskAmount(formatCurrency(metrics.stockRealizedGain + metrics.optionsRealizedGain))}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[280px]">
            <p className="font-semibold mb-1">Realizovaný zisk</p>
            <p className="text-xs">Zisk alebo strata z uzavretých pozícií (akcie + opcie). Počíta sa ako rozdiel predajnej a nákupnej ceny mínus poplatky.</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="bg-card rounded-lg p-2.5 border cursor-help">
              <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
                Dividendy
                <HelpCircle className="h-2.5 w-2.5" />
              </div>
              <div className="text-xs font-semibold text-blue-500">
                +{maskAmount(formatCurrency(metrics.dividendGain))}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[250px]">
            <p className="font-semibold mb-1">Dividendy</p>
            <p className="text-xs">Čisté vyplatené dividendy po zrážkovej dani. Zahŕňa všetky dividendové platby od začiatku sledovania.</p>
          </TooltipContent>
        </Tooltip>
      </div>
      
      {metrics.optionsIncluded && (
        <div className="md:hidden px-4">
          <div className="bg-card rounded-lg p-2.5 border flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              Opcie zahrnuté
              {metrics.openOptionsCount > 0 && (
                <span className="ml-1">({metrics.openOptionsCount} otv.)</span>
              )}
            </span>
            <span className={`text-xs ${getChangeColor(metrics.optionsRealizedGain)}`}>
              Realizované: <span className="font-semibold">{maskAmount(formatCurrency(metrics.optionsRealizedGain))}</span>
            </span>
          </div>
        </div>
      )}

      {/* News Section */}
      {showNews && holdings && holdings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Novinky k vašim aktívam</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {newsLoading ? (
              <div className="flex gap-3 overflow-hidden">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="min-w-[280px] p-3 rounded-lg border bg-card">
                    <Skeleton className="h-4 w-12 mb-2" />
                    <Skeleton className="h-4 w-full mb-1" />
                    <Skeleton className="h-4 w-3/4 mb-2" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : news && news.length > 0 ? (
              <ScrollArea className="w-full whitespace-nowrap">
                <div className="flex gap-3 pb-3">
                  {news.map((article, index) => (
                    <a
                      key={index}
                      href={article.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-[280px] max-w-[280px] p-3 rounded-lg border bg-card hover-elevate transition-all group block"
                      data-testid={`link-news-${index}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-xs font-medium flex items-center gap-1.5 pr-2">
                          <CompanyLogo ticker={article.ticker} companyName="" size="xs" />
                          {article.ticker}
                        </Badge>
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                      </div>
                      <h4 className="text-sm font-medium line-clamp-2 whitespace-normal mb-2 group-hover:text-primary transition-colors">
                        {article.title}
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatRelativeTime(article.publishedAt)}</span>
                        <span>•</span>
                        <span className="truncate">{article.publisher}</span>
                      </div>
                    </a>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                Žiadne novinky k dispozícii
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="p-3 md:p-6">
          <CardTitle className="text-base md:text-lg">Prehľad aktív</CardTitle>
          <CardDescription className="text-xs md:text-sm">Vaše aktuálne držané akcie ({currency})</CardDescription>
        </CardHeader>
        <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
          {!holdings || holdings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-holdings">
              <p>Zatiaľ nemáte žiadne akcie.</p>
              <p className="text-sm">Pridajte svoju prvú transakciu v sekcii História (tlačidlo Pridať transakciu).</p>
            </div>
          ) : (
            <>
              {/* Mobile view - compact list */}
              <div className="md:hidden space-y-1">
                {sortedHoldings.map((holding) => {
                  const quote = quotes?.[holding.ticker];
                  const shares = parseFloat(holding.shares);
                  const tickerCurrency = getTickerCurrency(holding.ticker);
                  const avgCostDisplay = convertPrice(parseFloat(holding.averageCost), tickerCurrency);
                  const investedDisplay = convertPrice(parseFloat(holding.totalInvested), tickerCurrency);
                  const currentPrice = quote ? convertPrice(quote.price, tickerCurrency) : avgCostDisplay;
                  const currentValue = shares * currentPrice;
                  const gainLoss = currentValue - investedDisplay;
                  const gainLossPercent = investedDisplay > 0 ? (gainLoss / investedDisplay) * 100 : 0;

                  return (
                    <div
                      key={holding.id}
                      role="button"
                      tabIndex={0}
                      className="py-2 border-b last:border-b-0 cursor-pointer hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                      data-testid={`row-holding-${holding.ticker}`}
                      onClick={() => setLocation(`/asset/${encodeURIComponent(holding.ticker)}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setLocation(`/asset/${encodeURIComponent(holding.ticker)}`);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <CompanyLogo ticker={holding.ticker} companyName={holding.companyName} size="xs" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <a 
                                href={`https://finance.yahoo.com/quote/${holding.ticker}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-xs hover:text-primary"
                                data-testid={`link-ticker-${holding.ticker}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {holding.ticker}
                              </a>
                              <span className="text-[9px] text-muted-foreground">
                                {formatShareQuantity(shares)} ks
                              </span>
                            </div>
                            <p className="text-[9px] text-muted-foreground truncate">{holding.companyName}</p>
                          </div>
                        </div>
                        <div className="text-right pl-2">
                          <div className="text-xs font-semibold">{maskAmount(formatCurrency(currentValue))}</div>
                          <div className={`text-[10px] ${getChangeColor(gainLoss)}`}>
                            {formatPercent(gainLossPercent)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[9px] text-muted-foreground">
                        <div className="flex items-center gap-3">
                          <span>Priem: <span className="text-foreground">{maskAmount(formatCurrency(avgCostDisplay))}</span></span>
                          <span>Cena: <span className="text-foreground">{maskAmount(formatCurrency(currentPrice))}</span>
                            {quote && <span className={`ml-0.5 ${getChangeColor(quote.change)}`}>{formatPercent(quote.changePercent)}</span>}
                          </span>
                        </div>
                        <span className={getChangeColor(gainLoss)}>{maskAmount(formatCurrency(gainLoss))}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop view - table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("ticker")}
                        data-testid="sort-ticker"
                      >
                        <div className="flex items-center">
                          Ticker
                          {getSortIcon("ticker")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("companyName")}
                        data-testid="sort-company"
                      >
                        <div className="flex items-center">
                          Spoločnosť
                          {getSortIcon("companyName")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("shares")}
                        data-testid="sort-shares"
                      >
                        <div className="flex items-center justify-end">
                          Počet kusov
                          {getSortIcon("shares")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("avgCost")}
                        data-testid="sort-avgcost"
                      >
                        <div className="flex items-center justify-end">
                          Priem. cena
                          {getSortIcon("avgCost")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("currentPrice")}
                        data-testid="sort-currentprice"
                      >
                        <div className="flex items-center justify-end">
                          Aktuálna cena
                          {getSortIcon("currentPrice")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("value")}
                        data-testid="sort-value"
                      >
                        <div className="flex items-center justify-end">
                          Hodnota
                          {getSortIcon("value")}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("gainLoss")}
                        data-testid="sort-gainloss"
                      >
                        <div className="flex items-center justify-end">
                          Zisk/Strata
                          {getSortIcon("gainLoss")}
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedHoldings.map((holding) => {
                      const quote = quotes?.[holding.ticker];
                      const shares = parseFloat(holding.shares);
                      const tickerCurrency = getTickerCurrency(holding.ticker);
                      const avgCostDisplay = convertPrice(parseFloat(holding.averageCost), tickerCurrency);
                      const investedDisplay = convertPrice(parseFloat(holding.totalInvested), tickerCurrency);
                      const currentPrice = quote ? convertPrice(quote.price, tickerCurrency) : avgCostDisplay;
                      const currentValue = shares * currentPrice;
                      const gainLoss = currentValue - investedDisplay;
                      const gainLossPercent = investedDisplay > 0 ? (gainLoss / investedDisplay) * 100 : 0;

                      return (
                        <TableRow
                          key={holding.id}
                          data-testid={`row-holding-${holding.ticker}`}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setLocation(`/asset/${encodeURIComponent(holding.ticker)}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <CompanyLogo ticker={holding.ticker} companyName={holding.companyName} size="md" />
                              <a 
                                href={`https://finance.yahoo.com/quote/${holding.ticker}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium hover:text-primary hover:underline transition-colors"
                                data-testid={`link-ticker-${holding.ticker}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {holding.ticker}
                              </a>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{holding.companyName}</TableCell>
                          <TableCell className="text-right">{formatShareQuantity(shares)}</TableCell>
                          <TableCell className="text-right">{maskAmount(formatCurrency(avgCostDisplay))}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {maskAmount(formatCurrency(currentPrice))}
                              {quote && (
                                <span className={`text-xs ${getChangeColor(quote.change)}`}>
                                  ({formatPercent(quote.changePercent)})
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{maskAmount(formatCurrency(currentValue))}</TableCell>
                          <TableCell className={`text-right ${getChangeColor(gainLoss)}`}>
                            <div className="flex flex-col items-end">
                              <span>{maskAmount(formatCurrency(gainLoss))}</span>
                              <span className="text-xs">{formatPercent(gainLossPercent)}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
