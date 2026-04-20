import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { BrokerLogo } from "@/components/BrokerLogo";
import type { Holding } from "@shared/schema";

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
}

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

interface PortfolioMetrics {
  totalValue: number;
  totalInvested: number;
  totalProfit: number;
  totalProfitPercent: number;
  dailyChange: number;
  dailyChangePercent: number;
  passiveIncome: number;
  passiveIncomePercent: number;
  hasQuotes: boolean;
}

export default function Overview() {
  const { portfolios, setSelectedPortfolioId, isLoading: portfoliosLoading } = usePortfolio();
  const { convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const [, setLocation] = useLocation();

  const maskAmount = (amount: string) => (hideAmounts ? "••••••" : amount);

  const holdingsQueries = useQueries({
    queries: portfolios.map((p) => ({
      queryKey: ["/api/holdings", p.id],
      queryFn: async (): Promise<Holding[]> => {
        const res = await fetch(`/api/holdings?portfolio=${p.id}`);
        if (!res.ok) throw new Error("Failed to fetch holdings");
        return res.json();
      },
    })),
  });

  const realizedGainsQueries = useQueries({
    queries: portfolios.map((p) => ({
      queryKey: ["/api/realized-gains", p.id],
      queryFn: async (): Promise<RealizedGainSummary> => {
        const res = await fetch(`/api/realized-gains?portfolio=${p.id}`);
        if (!res.ok) throw new Error("Failed to fetch realized gains");
        return res.json();
      },
    })),
  });

  const dividendsQueries = useQueries({
    queries: portfolios.map((p) => ({
      queryKey: ["/api/dividends", p.id],
      queryFn: async (): Promise<DividendSummary> => {
        const res = await fetch(`/api/dividends?portfolio=${p.id}`);
        if (!res.ok) throw new Error("Failed to fetch dividends");
        return res.json();
      },
    })),
  });

  const allTickers = useMemo(() => {
    const set = new Set<string>();
    holdingsQueries.forEach((q) => {
      q.data?.forEach((h) => set.add(h.ticker));
    });
    return Array.from(set).sort();
  }, [holdingsQueries.map((q) => q.data).join("|")]);

  const { data: quotes } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/quotes-overview", allTickers.join(",")],
    enabled: allTickers.length > 0,
    queryFn: async () => {
      const res = await fetch("/api/stocks/quotes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers: allTickers }),
      });
      if (!res.ok) throw new Error("Failed to fetch quotes");
      const data = await res.json();
      return data.quotes as Record<string, StockQuote>;
    },
    staleTime: 60 * 1000,
  });

  const computeMetrics = (index: number): PortfolioMetrics => {
    const holdings = holdingsQueries[index]?.data ?? [];
    const realized = realizedGainsQueries[index]?.data?.totalRealized ?? 0;
    const dividends = dividendsQueries[index]?.data?.totalNet ?? 0;

    let totalValue = 0;
    let totalInvested = 0;
    let dailyChange = 0;
    let anyQuote = false;

    holdings.forEach((h) => {
      const shares = parseFloat(h.shares);
      const invested = parseFloat(h.totalInvested);
      const tickerCurrency = getTickerCurrency(h.ticker);

      totalInvested += invested;

      const quote = quotes?.[h.ticker];
      if (quote) {
        anyQuote = true;
        totalValue += shares * convertPrice(quote.price, tickerCurrency);
        dailyChange += shares * convertPrice(quote.change, tickerCurrency);
      } else {
        totalValue += invested;
      }
    });

    const unrealized = totalValue - totalInvested;
    const totalProfit = unrealized + realized + dividends;
    const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    const baseValue = totalValue - dailyChange;
    const dailyChangePercent = baseValue > 0 ? (dailyChange / baseValue) * 100 : 0;
    const passiveIncomePercent = totalValue > 0 ? (dividends / totalValue) * 100 : 0;

    return {
      totalValue,
      totalInvested,
      totalProfit,
      totalProfitPercent,
      dailyChange,
      dailyChangePercent,
      passiveIncome: dividends,
      passiveIncomePercent,
      hasQuotes: anyQuote,
    };
  };

  const formatPercent = (value: number) => {
    const abs = Math.abs(value);
    return `${abs.toFixed(1)}%`;
  };

  const formatSignedCurrency = (value: number) => {
    const formatted = formatCurrency(Math.abs(value));
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${formatted}`;
  };

  const getChangeTone = (value: number) => {
    if (value > 0) return "text-green-500";
    if (value < 0) return "text-red-500";
    return "text-muted-foreground";
  };

  const TrendIcon = ({ value }: { value: number }) => {
    if (value > 0) return <TrendingUp className="inline h-3 w-3" />;
    if (value < 0) return <TrendingDown className="inline h-3 w-3" />;
    return null;
  };

  const handleOpen = (id: string) => {
    setSelectedPortfolioId(id);
    setLocation("/");
  };

  const anyLoading =
    portfoliosLoading ||
    holdingsQueries.some((q) => q.isLoading) ||
    realizedGainsQueries.some((q) => q.isLoading) ||
    dividendsQueries.some((q) => q.isLoading);

  const grandTotal = useMemo(() => {
    let total = 0;
    portfolios.forEach((_, idx) => {
      total += computeMetrics(idx).totalValue;
    });
    return total;
  }, [portfolios, holdingsQueries.map((q) => q.data).join("|"), quotes]);

  if (portfoliosLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-overview-title">
            Prehľad portfólií
          </h1>
          <p className="text-sm text-muted-foreground">
            Rýchly prehľad výkonnosti všetkých vašich portfólií.
          </p>
        </div>
        {!anyLoading && portfolios.length > 0 && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Celková hodnota
            </div>
            <div className="text-2xl font-bold" data-testid="text-overview-grand-total">
              {maskAmount(formatCurrency(grandTotal))}
            </div>
          </div>
        )}
      </div>

      {portfolios.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Zatiaľ nemáte žiadne portfóliá. Vytvorte si prvé v sekcii Nastavenia.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {portfolios.map((portfolio, idx) => {
            const holdingsLoading = holdingsQueries[idx]?.isLoading;
            const m = computeMetrics(idx);
            const hasAnyActivity =
              m.totalValue > 0 ||
              m.totalInvested > 0 ||
              m.passiveIncome > 0 ||
              (realizedGainsQueries[idx]?.data?.totalRealized ?? 0) !== 0;

            return (
              <Card
                key={portfolio.id}
                className="hover-elevate cursor-pointer"
                onClick={() => handleOpen(portfolio.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpen(portfolio.id);
                  }
                }}
                data-testid={`overview-card-${portfolio.id}`}
              >
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    {portfolio.brokerCode ? (
                      <BrokerLogo brokerCode={portfolio.brokerCode} size="xs" />
                    ) : (
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-semibold text-sm tracking-wide uppercase truncate">
                      {portfolio.name}
                    </span>
                  </div>

                  {holdingsLoading ? (
                    <Skeleton className="h-8 w-40" />
                  ) : (
                    <div className="text-2xl md:text-3xl font-bold" data-testid={`overview-value-${portfolio.id}`}>
                      {maskAmount(formatCurrency(m.totalValue))}
                    </div>
                  )}

                  {hasAnyActivity ? (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Celkový zisk</span>
                        <span className={`font-medium ${getChangeTone(m.totalProfit)}`}>
                          {maskAmount(formatSignedCurrency(m.totalProfit))}{" "}
                          <span className="text-xs">
                            (<TrendIcon value={m.totalProfit} /> {formatPercent(m.totalProfitPercent)})
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Denný</span>
                        <span className={`font-medium ${getChangeTone(m.dailyChange)}`}>
                          {m.hasQuotes ? (
                            <>
                              {maskAmount(formatSignedCurrency(m.dailyChange))}{" "}
                              <span className="text-xs">
                                (<TrendIcon value={m.dailyChange} /> {formatPercent(m.dailyChangePercent)})
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Pasívny príjem</span>
                        <span className="font-medium">
                          <span className={m.passiveIncome > 0 ? "text-green-500" : "text-muted-foreground"}>
                            {formatPercent(m.passiveIncomePercent)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {" "}
                            ({maskAmount(formatCurrency(m.passiveIncome))})
                          </span>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      V tomto portfóliu zatiaľ nie sú žiadne transakcie.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
