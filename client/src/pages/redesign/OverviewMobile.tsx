import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import type { OptionTrade } from "@shared/schema";
import type { HoldingWithCostCurrency } from "@shared/holdingCostCurrency";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { Badge, Card, EmptyState, StatTile, TopBar } from "@/redesign/ui";
import { IconButton, KvRow, PageBody, signedMoney, signedPct, toneOf } from "./mobileChrome";

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  annualDividendPerShare?: number;
}

interface OverviewBundle {
  byPortfolioId: Record<
    string,
    {
      holdings: HoldingWithCostCurrency[];
      totalRealized: number;
      closeTradeNetEur: number;
      dividendNet: number;
      trailing12mDividendNet: number;
      cashEur: number;
    }
  >;
}

type Metrics = {
  totalValue: number;
  stockValue: number;
  cashValue: number;
  totalInvested: number;
  realizedGain: number;
  unrealizedGain: number;
  totalProfit: number;
  totalProfitPercent: number;
  dailyChange: number;
  dailyChangePercent: number;
  passiveIncome: number;
  passiveIncomePercent: number;
};

async function fetchOverviewBundle(): Promise<OverviewBundle> {
  const res = await fetch("/api/overview", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch overview");
  return res.json();
}

async function fetchQuotes(tickers: string[], refresh: boolean): Promise<Record<string, StockQuote>> {
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

export default function OverviewMobile() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { portfolios, setSelectedPortfolioId, isLoading: portfoliosLoading } = usePortfolio();
  const { convertPrice, getTickerCurrency, resolveHoldingCostCurrency, pnlInvestedForDisplay, formatCurrency } =
    useCurrency();
  const { hideAmounts } = useChartSettings();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const mask = (value: string) => (hideAmounts ? "••••••" : value);

  const { data: overview, isPending } = useQuery({
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
      holdings.forEach((holding) => set.add(holding.ticker));
    });
    return Array.from(set).sort();
  }, [overview]);

  const quotesQueryKey = useMemo(
    () => ["/api/quotes-overview", allTickers.join(",")] as const,
    [allTickers],
  );

  const { data: quotes } = useQuery({
    queryKey: quotesQueryKey,
    enabled: allTickers.length > 0,
    queryFn: () => fetchQuotes(allTickers, false),
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: optionTrades } = useQuery<OptionTrade[]>({
    queryKey: ["/api/options", "overview-all"],
    queryFn: async () => {
      const res = await fetch("/api/options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch option trades");
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: forwardIncomeByPortfolio = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/dividends/forward-income", "overview-by-portfolio", portfolios.map((p) => p.id).join(",")],
    enabled: portfolios.length > 0,
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(
        portfolios.map(async (portfolio) => {
          const res = await fetch(
            `/api/dividends/forward-income?portfolio=${encodeURIComponent(portfolio.id)}`,
            { credentials: "include" },
          );
          if (!res.ok) {
            out[portfolio.id] = 0;
            return;
          }
          const data = (await res.json()) as { annualIncome?: number };
          out[portfolio.id] = Number.isFinite(data?.annualIncome) ? data.annualIncome! : 0;
        }),
      );
      return out;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: ytdByPortfolioId = {} } = useQuery<Record<string, number | null>>({
    queryKey: ["/api/portfolio-history", "overview-ytd", portfolios.map((p) => p.id).join(",")],
    enabled: portfolios.length > 0,
    queryFn: async () => {
      const out: Record<string, number | null> = {};
      await Promise.all(
        portfolios.map(async (portfolio) => {
          try {
            const params = new URLSearchParams({ portfolio: portfolio.id, range: "ytd" });
            const res = await fetch(`/api/portfolio-history?${params.toString()}`, { credentials: "include" });
            if (!res.ok) {
              out[portfolio.id] = null;
              return;
            }
            const data = (await res.json()) as { points?: Array<{ portfolioCumulativePct: number }> };
            const last = data.points?.[data.points.length - 1];
            out[portfolio.id] = last && Number.isFinite(last.portfolioCumulativePct) ? last.portfolioCumulativePct : null;
          } catch {
            out[portfolio.id] = null;
          }
        }),
      );
      return out;
    },
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const metricsById = useMemo(() => {
    const map = new Map<string, Metrics>();
    if (!overview?.byPortfolioId) return map;
    const defaultPortfolioId = portfolios.find((p) => p.isDefault)?.id ?? portfolios[0]?.id;
    const optionsById = new Map<string, OptionTrade[]>();
    portfolios.forEach((portfolio) => optionsById.set(portfolio.id, []));
    (optionTrades ?? []).forEach((trade) => {
      const pid = trade.portfolioId ?? defaultPortfolioId;
      if (pid && optionsById.has(pid)) optionsById.get(pid)!.push(trade);
    });

    for (const portfolio of portfolios) {
      const row = overview.byPortfolioId[portfolio.id];
      const holdings = row?.holdings ?? [];
      let stockValue = 0;
      let totalInvested = 0;
      let dailyChange = 0;
      let forwardDividendIncome = 0;
      holdings.forEach((holding) => {
        const shares = parseFloat(holding.shares);
        const invested = parseFloat(holding.totalInvested);
        const quoteCurrency = getTickerCurrency(holding.ticker);
        const costCurrency = resolveHoldingCostCurrency(holding);
        totalInvested += pnlInvestedForDisplay(holding);
        const quote = quotes?.[holding.ticker];
        if (quote && Number.isFinite(quote.price) && quote.price > 0) {
          const annual = Number(quote.annualDividendPerShare ?? 0);
          if (Number.isFinite(annual) && annual > 0) {
            forwardDividendIncome += shares * convertPrice(annual, quoteCurrency);
          }
          stockValue += shares * convertPrice(quote.price, quoteCurrency);
          dailyChange += shares * convertPrice(quote.change, quoteCurrency);
        } else {
          stockValue += convertPrice(invested, costCurrency);
        }
      });

      let optionsRealizedGain = 0;
      let openBuyPremium = 0;
      let openBuyCost = 0;
      let openSellCommission = 0;
      (optionsById.get(portfolio.id) ?? []).forEach((trade) => {
        const realized = parseFloat(String(trade.realizedGain ?? "0"));
        if (trade.status !== "OPEN" && Number.isFinite(realized)) optionsRealizedGain += realized;
        if (trade.status === "OPEN") {
          const premium = parseFloat(String(trade.premium ?? "0"));
          const contracts = parseFloat(String(trade.contracts ?? "0"));
          const commission = parseFloat(String(trade.commission ?? "0"));
          const premiumValue = Number.isFinite(premium) && Number.isFinite(contracts) ? premium * 100 * contracts : 0;
          if (trade.direction === "BUY") {
            openBuyPremium += premiumValue;
            openBuyCost += premiumValue + (Number.isFinite(commission) ? commission : 0);
          } else {
            openSellCommission += Number.isFinite(commission) ? commission : 0;
          }
        }
      });
      stockValue += openBuyPremium - openSellCommission;
      totalInvested += openBuyCost;
      const cashValue = convertPrice(Number.isFinite(row?.cashEur) ? row!.cashEur : 0, "EUR");
      const historicalDividends = convertPrice(Number.isFinite(row?.dividendNet) ? row!.dividendNet : 0, "EUR");
      const unrealizedGain = stockValue - totalInvested;
      const realizedGain =
        convertPrice(row?.totalRealized ?? 0, "EUR") + convertPrice(row?.closeTradeNetEur ?? 0, "EUR");
      const totalProfit = unrealizedGain + realizedGain + convertPrice(optionsRealizedGain, "EUR") + historicalDividends;
      const trailing = convertPrice(row?.trailing12mDividendNet ?? 0, "EUR");
      const forwardOverride = forwardIncomeByPortfolio[portfolio.id] ?? 0;
      const passiveIncome = forwardOverride > 0 ? forwardOverride : forwardDividendIncome > 0 ? forwardDividendIncome : trailing;
      const base = stockValue - dailyChange;
      map.set(portfolio.id, {
        totalValue: stockValue + cashValue,
        stockValue,
        cashValue,
        totalInvested,
        realizedGain,
        unrealizedGain,
        totalProfit,
        totalProfitPercent: totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0,
        dailyChange,
        dailyChangePercent: base > 0 ? (dailyChange / base) * 100 : 0,
        passiveIncome,
        passiveIncomePercent: stockValue > 0 ? (passiveIncome / stockValue) * 100 : 0,
      });
    }
    return map;
  }, [
    overview,
    portfolios,
    quotes,
    optionTrades,
    forwardIncomeByPortfolio,
    convertPrice,
    getTickerCurrency,
    resolveHoldingCostCurrency,
    pnlInvestedForDisplay,
  ]);

  const aggregated = useMemo(() => {
    if (metricsById.size === 0) return null;
    const sum: Metrics = {
      totalValue: 0,
      stockValue: 0,
      cashValue: 0,
      totalInvested: 0,
      realizedGain: 0,
      unrealizedGain: 0,
      totalProfit: 0,
      totalProfitPercent: 0,
      dailyChange: 0,
      dailyChangePercent: 0,
      passiveIncome: 0,
      passiveIncomePercent: 0,
    };
    metricsById.forEach((metrics) => {
      sum.totalValue += metrics.totalValue;
      sum.stockValue += metrics.stockValue;
      sum.cashValue += metrics.cashValue;
      sum.totalInvested += metrics.totalInvested;
      sum.realizedGain += metrics.realizedGain;
      sum.unrealizedGain += metrics.unrealizedGain;
      sum.totalProfit += metrics.totalProfit;
      sum.dailyChange += metrics.dailyChange;
      sum.passiveIncome += metrics.passiveIncome;
    });
    const base = sum.stockValue - sum.dailyChange;
    sum.totalProfitPercent = sum.totalInvested > 0 ? (sum.totalProfit / sum.totalInvested) * 100 : 0;
    sum.dailyChangePercent = base > 0 ? (sum.dailyChange / base) * 100 : 0;
    sum.passiveIncomePercent = sum.stockValue > 0 ? (sum.passiveIncome / sum.stockValue) * 100 : 0;
    return sum;
  }, [metricsById]);

  const weightedYtd = useMemo(() => {
    let weight = 0;
    let acc = 0;
    for (const portfolio of portfolios) {
      const ytd = ytdByPortfolioId[portfolio.id];
      const value = metricsById.get(portfolio.id)?.totalValue ?? 0;
      if (ytd == null || !(value > 0)) continue;
      acc += ytd * value;
      weight += value;
    }
    return weight > 0 ? acc / weight : null;
  }, [portfolios, ytdByPortfolioId, metricsById]);

  const refreshAll = useCallback(async () => {
    if (allTickers.length === 0) return;
    setRefreshingId("all");
    try {
      await queryClient.fetchQuery({
        queryKey: quotesQueryKey,
        queryFn: () => fetchQuotes(allTickers, true),
      });
    } finally {
      setRefreshingId(null);
    }
  }, [allTickers, queryClient, quotesQueryKey]);

  const refreshOne = useCallback(
    async (portfolioId: string, event: MouseEvent) => {
      event.stopPropagation();
      const tickers = overview?.byPortfolioId[portfolioId]?.holdings?.map((h) => h.ticker).filter(Boolean) ?? [];
      if (tickers.length === 0) return;
      setRefreshingId(portfolioId);
      try {
        const fresh = await fetchQuotes(tickers, true);
        queryClient.setQueryData<Record<string, StockQuote>>(quotesQueryKey, (prev) => ({ ...(prev ?? {}), ...fresh }));
      } finally {
        setRefreshingId(null);
      }
    },
    [overview, queryClient, quotesQueryKey],
  );

  const openPortfolio = (id: string) => {
    setSelectedPortfolioId(id);
    setLocation("/");
  };

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Prehľad portfólií" title="Portfóliá" />
      <PageBody>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs leading-4 text-[var(--rd-text-secondary)]">
            Rýchly prehľad výkonnosti všetkých vašich portfólií.
          </p>
          <IconButton
            label="Obnoviť ceny všetkých portfólií"
            onClick={() => void refreshAll()}
            spinning={refreshingId === "all"}
          />
        </div>

        {portfoliosLoading || isPending ? (
          <Card>
            <p className="text-sm text-[var(--rd-text-secondary)]">Načítavam portfóliá…</p>
          </Card>
        ) : portfolios.length === 0 || !aggregated ? (
          <EmptyState title="Žiadne portfólio" body="Po vytvorení portfólia sa tu zobrazí súhrn hodnoty a zisku." />
        ) : (
          <>
            <Card className="gap-1.5">
              <div className="flex items-center gap-1.5">
                <p className="min-w-0 flex-1 rd-type-overline text-[var(--rd-text-tertiary)]">
                  Celková hodnota
                </p>
                {weightedYtd != null ? (
                  <Badge label={`YTD ${signedPct(weightedYtd)}`} tone={weightedYtd >= 0 ? "Profit" : "Loss"} />
                ) : null}
              </div>
              <p className="rd-type-display-hero text-[var(--rd-text-primary)]">
                {mask(formatCurrency(aggregated.totalValue))}
              </p>
              <KvRow label="Investované" value={mask(formatCurrency(aggregated.totalInvested))} />
              <KvRow label="Hotovosť" value={mask(formatCurrency(aggregated.cashValue))} />
            </Card>

            <div className="grid grid-cols-2 gap-2">
              <StatTile
                label="Celkový zisk"
                value={mask(signedMoney(formatCurrency, aggregated.totalProfit))}
                sub={signedPct(aggregated.totalProfitPercent)}
                tone={
                  toneOf(aggregated.totalProfit) === "down"
                    ? "Down"
                    : toneOf(aggregated.totalProfit) === "up"
                      ? "Up"
                      : "Neutral"
                }
              />
              <StatTile
                label="Denná zmena"
                value={mask(signedMoney(formatCurrency, aggregated.dailyChange))}
                sub={signedPct(aggregated.dailyChangePercent)}
                tone={
                  toneOf(aggregated.dailyChange) === "down"
                    ? "Down"
                    : toneOf(aggregated.dailyChange) === "up"
                      ? "Up"
                      : "Neutral"
                }
              />
              <StatTile
                label="Nerealizovaný"
                value={mask(signedMoney(formatCurrency, aggregated.unrealizedGain))}
                sub="otvorené pozície"
                tone={toneOf(aggregated.unrealizedGain) === "down" ? "Down" : "Up"}
              />
              <StatTile
                label="Realizovaný"
                value={mask(signedMoney(formatCurrency, aggregated.realizedGain))}
                sub="z predajov"
                tone={toneOf(aggregated.realizedGain) === "down" ? "Down" : "Up"}
              />
            </div>
            <StatTile
              label="Pasívny príjem"
              value={mask(formatCurrency(aggregated.passiveIncome))}
              sub={signedPct(aggregated.passiveIncomePercent)}
            />

            <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Portfóliá</p>
            {portfolios.map((portfolio) => {
              const metrics = metricsById.get(portfolio.id);
              const ytd = ytdByPortfolioId[portfolio.id];
              if (!metrics) return null;
              return (
                <Card key={portfolio.id} className="gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <p className="min-w-0 flex-1 rd-type-h2">{portfolio.name}</p>
                    {ytd != null ? (
                      <Badge label={`YTD ${signedPct(ytd)}`} tone={ytd >= 0 ? "Profit" : "Loss"} />
                    ) : null}
                    <button
                      type="button"
                      aria-label="Obnoviť ceny a dennú zmenu"
                      onClick={(event) => void refreshOne(portfolio.id, event)}
                      className="inline-flex size-8 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)]"
                    >
                      {refreshingId === portfolio.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                    </button>
                  </div>
                  <p className="rd-type-display-lg">{mask(formatCurrency(metrics.totalValue))}</p>
                  <KvRow label="Investované" value={mask(formatCurrency(metrics.totalInvested))} />
                  <KvRow label="Hotovosť" value={mask(formatCurrency(metrics.cashValue))} />
                  <div className="h-px w-full bg-[var(--rd-border-subtle)]" />
                  <KvRow
                    label="Celkový zisk"
                    value={`${mask(signedMoney(formatCurrency, metrics.totalProfit))} · ${signedPct(metrics.totalProfitPercent)}`}
                    tone={toneOf(metrics.totalProfit)}
                  />
                  <KvRow
                    label="Nerealizovaný"
                    value={mask(signedMoney(formatCurrency, metrics.unrealizedGain))}
                    tone={toneOf(metrics.unrealizedGain)}
                  />
                  <KvRow
                    label="Realizovaný"
                    value={mask(signedMoney(formatCurrency, metrics.realizedGain))}
                    tone={toneOf(metrics.realizedGain)}
                  />
                  <KvRow
                    label="Denná zmena"
                    value={`${mask(signedMoney(formatCurrency, metrics.dailyChange))} · ${signedPct(metrics.dailyChangePercent)}`}
                    tone={toneOf(metrics.dailyChange)}
                  />
                  <KvRow
                    label="Pasívny príjem"
                    value={`${signedPct(metrics.passiveIncomePercent)} (${mask(formatCurrency(metrics.passiveIncome))})`}
                  />
                  <button
                    type="button"
                    onClick={() => openPortfolio(portfolio.id)}
                    className="inline-flex min-h-4 items-center justify-end gap-1 self-end text-xs font-medium leading-4 text-[var(--rd-profit)]"
                  >
                    Otvoriť portfólio
                    <ChevronRight className="size-3.5" />
                  </button>
                </Card>
              );
            })}
          </>
        )}
      </PageBody>
    </div>
  );
}
