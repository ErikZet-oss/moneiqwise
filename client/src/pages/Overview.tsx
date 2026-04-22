import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Briefcase,
  TrendingUp,
  TrendingDown,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { BrokerLogo } from "@/components/BrokerLogo";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { Holding } from "@shared/schema";

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
}

interface OverviewBundle {
  byPortfolioId: Record<
    string,
    {
      holdings: Holding[];
      /** Realiz. zisk z akcii (FIFO) v EUR. */
      totalRealized: number;
      /** Hotov. efekt z XTB „close trade“ (vklad/výber), nie je v FIFO. */
      closeTradeNetEur: number;
      dividendNet: number;
      /** Čistá hotovosť (EUR) z vkladov a výberov */
      cashEur: number;
    }
  >;
}

interface PortfolioMetrics {
  totalValue: number;
  stockValue: number;
  cashValue: number;
  totalInvested: number;
  /** Realiz. zisk z akcii (FIFO) v menách UI. */
  realizedFifo: number;
  /** Netto z hot. riadkov XTB close trade (v menách UI). */
  closeTradePnl: number;
  /** FIFO + close trade — čo pripočítať k nereal. pri „celkovom zisku“. */
  realizedCombined: number;
  totalProfit: number;
  totalProfitPercent: number;
  dailyChange: number;
  dailyChangePercent: number;
  passiveIncome: number;
  passiveIncomePercent: number;
  hasQuotes: boolean;
}

async function fetchOverviewBundle(): Promise<OverviewBundle> {
  const res = await fetch("/api/overview", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch overview");
  return res.json();
}

async function fetchOverviewQuotesBatch(
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
  return data.quotes as Record<string, StockQuote>;
}

export default function Overview() {
  const queryClient = useQueryClient();
  const [refreshingPortfolioId, setRefreshingPortfolioId] = useState<string | null>(
    null,
  );
  const { portfolios, setSelectedPortfolioId, isLoading: portfoliosLoading } = usePortfolio();
  const { convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const [, setLocation] = useLocation();

  const maskAmount = (amount: string) => (hideAmounts ? "••••••" : amount);

  const {
    data: overview,
    isPending: overviewPending,
    isFetching: overviewFetching,
  } = useQuery({
    queryKey: ["/api/overview"],
    queryFn: fetchOverviewBundle,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const allTickers = useMemo(() => {
    const set = new Set<string>();
    if (!overview?.byPortfolioId) return [];
    Object.values(overview.byPortfolioId).forEach(({ holdings }) => {
      holdings.forEach((h) => set.add(h.ticker));
    });
    return Array.from(set).sort();
  }, [overview]);

  const {
    data: quotes,
    isFetching: quotesFetching,
  } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/quotes-overview", allTickers.join(",")],
    enabled: allTickers.length > 0,
    queryFn: () => fetchOverviewQuotesBatch(allTickers, false),
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const computeMetrics = (
    holdings: Holding[],
    totalRealizedFifoEur: number,
    closeTradeNetEur: number,
    dividends: number,
    cashEur: number,
  ): PortfolioMetrics => {
    let stockValue = 0;
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
        stockValue += shares * convertPrice(quote.price, tickerCurrency);
        dailyChange += shares * convertPrice(quote.change, tickerCurrency);
      } else {
        stockValue += invested;
      }
    });

    const cashValue = convertPrice(
      Number.isFinite(cashEur) ? cashEur : 0,
      "EUR",
    );

    const totalValue = stockValue + cashValue;

    const unrealized = stockValue - totalInvested;
    const rFifo = convertPrice(
      Number.isFinite(totalRealizedFifoEur) ? totalRealizedFifoEur : 0,
      "EUR",
    );
    const rClose = convertPrice(
      Number.isFinite(closeTradeNetEur) ? closeTradeNetEur : 0,
      "EUR",
    );
    const realizedCombined = rFifo + rClose;
    const totalProfit = unrealized + realizedCombined + dividends;
    const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    const baseValue = stockValue - dailyChange;
    const dailyChangePercent = baseValue > 0 ? (dailyChange / baseValue) * 100 : 0;
    const passiveIncomePercent = stockValue > 0 ? (dividends / stockValue) * 100 : 0;

    return {
      totalValue,
      stockValue,
      cashValue,
      totalInvested,
      realizedFifo: rFifo,
      closeTradePnl: rClose,
      realizedCombined,
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

  const quotesQueryKey = useMemo(
    () => ["/api/quotes-overview", allTickers.join(",")] as const,
    [allTickers],
  );

  const refreshAllQuotes = useCallback(async () => {
    if (allTickers.length === 0) return;
    await queryClient.fetchQuery({
      queryKey: quotesQueryKey,
      queryFn: () => fetchOverviewQuotesBatch(allTickers, true),
    });
  }, [allTickers, queryClient, quotesQueryKey]);

  const refreshPortfolioQuotes = useCallback(
    async (portfolioId: string, e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const row = overview?.byPortfolioId[portfolioId];
      const tickers =
        row?.holdings?.map((h) => h.ticker).filter(Boolean) ?? [];
      if (tickers.length === 0 || allTickers.length === 0) return;
      setRefreshingPortfolioId(portfolioId);
      try {
        const fresh = await fetchOverviewQuotesBatch(tickers, true);
        queryClient.setQueryData<Record<string, StockQuote>>(
          quotesQueryKey,
          (prev) => ({ ...(prev ?? {}), ...fresh }),
        );
      } finally {
        setRefreshingPortfolioId(null);
      }
    },
    [allTickers.length, overview?.byPortfolioId, queryClient, quotesQueryKey],
  );

  const metricsByPortfolioId = useMemo(() => {
    const map = new Map<string, PortfolioMetrics>();
    if (!overview?.byPortfolioId) return map;
    for (const p of portfolios) {
      const row = overview.byPortfolioId[p.id];
      const holdings = row?.holdings ?? [];
      const totalRealizedFifoEur = row?.totalRealized ?? 0;
      const closeTradeNetEur = row?.closeTradeNetEur ?? 0;
      const dividends = row?.dividendNet ?? 0;
      const cashEur = row?.cashEur ?? 0;
      map.set(
        p.id,
        computeMetrics(holdings, totalRealizedFifoEur, closeTradeNetEur, dividends, cashEur),
      );
    }
    return map;
    // quotes / currency helpers must trigger recompute when quotes arrive
  }, [overview, portfolios, quotes, convertPrice, getTickerCurrency]);

  const grandTotal = useMemo(() => {
    let total = 0;
    metricsByPortfolioId.forEach((m) => {
      total += m.totalValue;
    });
    return total;
  }, [metricsByPortfolioId]);

  const tickerDisplayNames = useMemo(() => {
    const map = new Map<string, string>();
    if (!overview?.byPortfolioId) return map;
    for (const row of Object.values(overview.byPortfolioId)) {
      for (const h of row.holdings ?? []) {
        if (!map.has(h.ticker)) {
          map.set(h.ticker, (h.companyName || h.ticker).trim() || h.ticker);
        }
      }
    }
    return map;
  }, [overview]);

  /** Top 5 denných % moverov medzi držanými titulmi (podľa kotácie). */
  const dailyMovers = useMemo(() => {
    if (!quotes || allTickers.length === 0) {
      return { gainers: [] as { ticker: string; name: string; pct: number }[], losers: [] as { ticker: string; name: string; pct: number }[] };
    }
    const rows = allTickers.map((t) => {
      const q = quotes[t];
      const raw = q?.changePercent;
      const pct =
        typeof raw === "number"
          ? raw
          : parseFloat(String(raw ?? ""));
      return {
        ticker: t,
        name: tickerDisplayNames.get(t) ?? t,
        pct: Number.isFinite(pct) ? pct : NaN,
      };
    }).filter((r) => Number.isFinite(r.pct));

    const gainers = [...rows]
      .filter((r) => r.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);
    const losers = [...rows]
      .filter((r) => r.pct < 0)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);

    return { gainers, losers };
  }, [quotes, allTickers, tickerDisplayNames]);

  const formatSignedDayPct = (value: number) => {
    const sign = value > 0 ? "+" : "";
    return `${sign}${Math.abs(value).toFixed(2)}%`;
  };

  const overviewLoading = overviewPending || (!overview && overviewFetching);

  const anyLoading =
    portfoliosLoading || overviewLoading;

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
            <div className="flex items-center justify-end gap-1">
              <div
                className="text-2xl font-bold"
                data-testid="text-overview-grand-total"
              >
                {maskAmount(formatCurrency(grandTotal))}
              </div>
              {allTickers.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={quotesFetching || refreshingPortfolioId !== null}
                  onClick={() => refreshAllQuotes()}
                  aria-label="Obnoviť ceny všetkých portfólií"
                  data-testid="button-overview-refresh-all-quotes"
                >
                  {quotesFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {portfolios.length > 0 && allTickers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card data-testid="overview-daily-gainers">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-500" />
                Najsilnejšie dnes (%)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Z vašich držaných akcií — denná zmena podľa kotácie.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {quotesFetching && !quotes ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </>
              ) : dailyMovers.gainers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Žiadna z držaných akcií dnes nebola v pluse.
                </p>
              ) : (
                dailyMovers.gainers.map((row, idx) => (
                  <div
                    key={row.ticker}
                    className="flex items-center justify-between gap-2 py-1.5 border-b border-border/60 last:border-0"
                    data-testid={`overview-gainer-${idx}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs text-muted-foreground tabular-nums w-5 shrink-0">
                        {idx + 1}.
                      </span>
                      <CompanyLogo ticker={row.ticker} companyName={row.name} size="xs" />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{row.ticker}</div>
                        <div className="text-xs text-muted-foreground truncate">{row.name}</div>
                      </div>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-green-500 shrink-0">
                      {formatSignedDayPct(row.pct)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card data-testid="overview-daily-losers">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-500" />
                Najslabšie dnes (%)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Z vašich držaných akcií — denná zmena podľa kotácie.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {quotesFetching && !quotes ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </>
              ) : dailyMovers.losers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Žiadna z držaných akcií dnes nebola v mínuse.
                </p>
              ) : (
                dailyMovers.losers.map((row, idx) => (
                  <div
                    key={row.ticker}
                    className="flex items-center justify-between gap-2 py-1.5 border-b border-border/60 last:border-0"
                    data-testid={`overview-loser-${idx}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs text-muted-foreground tabular-nums w-5 shrink-0">
                        {idx + 1}.
                      </span>
                      <CompanyLogo ticker={row.ticker} companyName={row.name} size="xs" />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{row.ticker}</div>
                        <div className="text-xs text-muted-foreground truncate">{row.name}</div>
                      </div>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-red-500 shrink-0">
                      {formatSignedDayPct(row.pct)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {portfolios.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Zatiaľ nemáte žiadne portfóliá. Vytvorte si prvé v sekcii Nastavenia.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {portfolios.map((portfolio) => {
            const m = metricsByPortfolioId.get(portfolio.id);
            const bundleRow = overview?.byPortfolioId[portfolio.id];
            const hasAnyActivity =
              (m?.totalValue ?? 0) > 0 ||
              (m?.totalInvested ?? 0) > 0 ||
              (m?.passiveIncome ?? 0) > 0 ||
              (m?.cashValue ?? 0) !== 0 ||
              (bundleRow?.totalRealized ?? 0) !== 0 ||
              (bundleRow?.closeTradeNetEur ?? 0) !== 0;

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

                  {overviewLoading || !m ? (
                    <Skeleton className="h-8 w-40" />
                  ) : (
                    <div>
                      <div className="flex items-center gap-1 flex-wrap">
                        <div
                          className="text-2xl md:text-3xl font-bold"
                          data-testid={`overview-value-${portfolio.id}`}
                        >
                          {maskAmount(formatCurrency(m.totalValue))}
                        </div>
                        {bundleRow &&
                          bundleRow.holdings &&
                          bundleRow.holdings.length > 0 &&
                          allTickers.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              disabled={
                                quotesFetching ||
                                refreshingPortfolioId !== null
                              }
                              onClick={(e) =>
                                refreshPortfolioQuotes(portfolio.id, e)
                              }
                              aria-label="Obnoviť ceny a dennú zmenu"
                              data-testid={`button-overview-refresh-quotes-${portfolio.id}`}
                            >
                              {quotesFetching ||
                              refreshingPortfolioId === portfolio.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                      </div>
                      {m.cashValue !== 0 && (
                        <div className="text-xs text-muted-foreground mt-1" data-testid={`overview-cash-${portfolio.id}`}>
                          Z toho hotovosť / margin: {maskAmount(formatCurrency(m.cashValue))}
                        </div>
                      )}
                    </div>
                  )}

                  {overviewLoading || !m ? (
                    <Skeleton className="h-16 w-full mt-1" />
                  ) : hasAnyActivity ? (
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

                      <div
                        className="flex items-center justify-between gap-2"
                        data-testid={`overview-realized-combined-${portfolio.id}`}
                      >
                        <span className="text-muted-foreground">Realizované (FIFO + close trade)</span>
                        <span className={`font-medium ${getChangeTone(m.realizedCombined)}`}>
                          {maskAmount(formatSignedCurrency(m.realizedCombined))}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground space-y-0.5 pl-0.5 border-l border-border/50 ml-0.5">
                        <div className="flex justify-between gap-2" data-testid={`overview-realized-fifo-${portfolio.id}`}>
                          <span>· akcie (FIFO)</span>
                          <span className={`tabular-nums ${getChangeTone(m.realizedFifo)}`}>
                            {maskAmount(formatSignedCurrency(m.realizedFifo))}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2" data-testid={`overview-close-trade-${portfolio.id}`}>
                          <span>· uzatvorenie (XTB)</span>
                          <span className={`tabular-nums ${getChangeTone(m.closeTradePnl)}`}>
                            {maskAmount(formatSignedCurrency(m.closeTradePnl))}
                          </span>
                        </div>
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
