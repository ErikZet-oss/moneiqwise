import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Briefcase,
  Loader2,
  RefreshCw,
  HelpCircle,
  Moon,
} from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { BrokerLogo } from "@/components/BrokerLogo";
import type { HoldingWithCostCurrency } from "@shared/holdingCostCurrency";
import type { OptionTrade } from "@shared/schema";
import {
  getExtendedSessionLabel,
  getUsMarketSessionState,
  shouldShowExtendedQuote,
  shouldUseExtendedQuotes,
} from "@/lib/usMarketSession";

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  /** Očakávaná ročná dividenda na akciu v mene tickera. */
  annualDividendPerShare?: number;
  preMarketPrice?: number | null;
  preMarketChange?: number | null;
  preMarketChangePercent?: number | null;
  marketState?: string | null;
}

type ForwardIncomeResponse = {
  annualIncome: number;
};

type PortfolioHistoryYtdRes = {
  startIso?: string;
  points: Array<{
    date: string;
    portfolioCumulativePct: number;
    sp500CumulativePct: number;
  }>;
};

interface OverviewBundle {
  byPortfolioId: Record<
    string,
    {
      holdings: HoldingWithCostCurrency[];
      /** Realiz. zisk z akcii (FIFO) v EUR. */
      totalRealized: number;
      /** Hotov. efekt z XTB „close trade“ (vklad/výber), nie je v FIFO. */
      closeTradeNetEur: number;
      /** Čisté dividendy v EUR (server: dividendNetEur). */
      dividendNet: number;
      /** Posledných 12 mesiacov čistých dividend (fallback pre pasívny príjem). */
      trailing12mDividendNet: number;
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
  /** Realiz. zisk: FIFO akcií + XTB close trade (v menách UI), rovnako ako na Dashboarde. */
  realizedGain: number;
  unrealizedGain: number;
  totalProfit: number;
  totalProfitPercent: number;
  dailyChange: number;
  dailyChangePercent: number;
  /** Očakávaný ročný príjem z dividend (forward) v mene zobrazenia. */
  passiveIncome: number;
  /** Očakávaný ročný dividendový výnos voči aktuálnej hodnote akcií. */
  passiveIncomePercent: number;
  hasQuotes: boolean;
}

type PreOpenPreview = { available: boolean; amount: number; percent: number };

const PREMARKET_MOON_CLASS = "text-amber-600 dark:text-amber-400";
const EMPTY_PRE_OPEN: PreOpenPreview = { available: false, amount: 0, percent: 0 };

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

async function fetchAllOptionTrades(): Promise<OptionTrade[]> {
  const res = await fetch("/api/options", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch option trades");
  return res.json();
}

export default function Overview() {
  const queryClient = useQueryClient();
  const [refreshingPortfolioId, setRefreshingPortfolioId] = useState<string | null>(
    null,
  );
  const {
    portfolios,
    setSelectedPortfolioId,
    isLoading: portfoliosLoading,
  } = usePortfolio();
  const { convertPrice, getTickerCurrency, resolveHoldingCostCurrency, pnlInvestedForDisplay, formatCurrency } = useCurrency();
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

  const { data: optionTrades } = useQuery<OptionTrade[]>({
    queryKey: ["/api/options", "overview-all"],
    queryFn: fetchAllOptionTrades,
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
        portfolios.map(async (p) => {
          const res = await fetch(
            `/api/dividends/forward-income?portfolio=${encodeURIComponent(p.id)}`,
            { credentials: "include" },
          );
          if (!res.ok) {
            out[p.id] = 0;
            return;
          }
          const data = (await res.json()) as ForwardIncomeResponse;
          out[p.id] = Number.isFinite(data?.annualIncome) ? data.annualIncome : 0;
        }),
      );
      return out;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const optionsByPortfolioId = useMemo(() => {
    const out = new Map<string, OptionTrade[]>();
    portfolios.forEach((p) => out.set(p.id, []));
    if (!optionTrades || portfolios.length === 0) return out;

    const defaultPortfolioId =
      portfolios.find((p) => (p as { isDefault?: boolean }).isDefault)?.id ?? portfolios[0]?.id;

    optionTrades.forEach((t) => {
      const pid = t.portfolioId ?? defaultPortfolioId;
      if (!pid || !out.has(pid)) return;
      out.get(pid)!.push(t);
    });
    return out;
  }, [optionTrades, portfolios]);

  const computeMetrics = (
    holdings: HoldingWithCostCurrency[],
    optionTradesForPortfolio: OptionTrade[],
    totalRealizedFifoEur: number,
    closeTradeNetEur: number,
    dividendNetEur: number,
    trailing12mDividendNetEur: number,
    cashEur: number,
  ): PortfolioMetrics => {
    let stockValue = 0;
    let totalInvested = 0;
    let dailyChange = 0;
    let forwardDividendIncome = 0;
    let anyQuote = false;

    holdings.forEach((h) => {
      const shares = parseFloat(h.shares);
      const invested = parseFloat(h.totalInvested);
      const quoteCurrency = getTickerCurrency(h.ticker);
      const costCurrency = resolveHoldingCostCurrency(h);

      totalInvested += pnlInvestedForDisplay(h);

      const quote = quotes?.[h.ticker];
      if (quote) {
        const annualDividendPerShare = Number(quote.annualDividendPerShare ?? 0);
        if (Number.isFinite(annualDividendPerShare) && annualDividendPerShare > 0) {
          forwardDividendIncome += shares * convertPrice(annualDividendPerShare, quoteCurrency);
        }
        anyQuote = true;
        stockValue += shares * convertPrice(quote.price, quoteCurrency);
        dailyChange += shares * convertPrice(quote.change, quoteCurrency);
      } else {
        stockValue += convertPrice(invested, costCurrency);
      }
    });

    const cashValue = convertPrice(
      Number.isFinite(cashEur) ? cashEur : 0,
      "EUR",
    );

    const historicalDividendsDisplay = convertPrice(
      Number.isFinite(dividendNetEur) ? dividendNetEur : 0,
      "EUR",
    );

    let optionsRealizedGain = 0;
    let openOptionsBuyPremiumValue = 0;
    let openOptionsBuyTotalCost = 0;
    let openOptionsSellCommission = 0;

    optionTradesForPortfolio.forEach((trade) => {
      const realized = parseFloat(String(trade.realizedGain ?? "0"));
      if (trade.status !== "OPEN" && Number.isFinite(realized)) {
        optionsRealizedGain += realized;
      }

      if (trade.status === "OPEN") {
        const premium = parseFloat(String(trade.premium ?? "0"));
        const contracts = parseFloat(String(trade.contracts ?? "0"));
        const commission = parseFloat(String(trade.commission ?? "0"));
        const premiumValue =
          Number.isFinite(premium) && Number.isFinite(contracts)
            ? premium * 100 * contracts
            : 0;

        if (trade.direction === "BUY") {
          openOptionsBuyPremiumValue += premiumValue;
          openOptionsBuyTotalCost += premiumValue + (Number.isFinite(commission) ? commission : 0);
        } else {
          openOptionsSellCommission += Number.isFinite(commission) ? commission : 0;
        }
      }
    });

    stockValue += openOptionsBuyPremiumValue;
    stockValue -= openOptionsSellCommission;
    totalInvested += openOptionsBuyTotalCost;

    const totalValue = stockValue + cashValue;

    const unrealizedGain = stockValue - totalInvested;
    const rFifo = convertPrice(
      Number.isFinite(totalRealizedFifoEur) ? totalRealizedFifoEur : 0,
      "EUR",
    );
    const rClose = convertPrice(
      Number.isFinite(closeTradeNetEur) ? closeTradeNetEur : 0,
      "EUR",
    );
    const realizedGain = rFifo + rClose;
    const optionsRealizedDisplay = convertPrice(optionsRealizedGain, "EUR");
    const totalProfit = unrealizedGain + realizedGain + optionsRealizedDisplay + historicalDividendsDisplay;
    const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    const baseValue = stockValue - dailyChange;
    const dailyChangePercent = baseValue > 0 ? (dailyChange / baseValue) * 100 : 0;
    const trailing12mFallback = convertPrice(
      Number.isFinite(trailing12mDividendNetEur) ? trailing12mDividendNetEur : 0,
      "EUR",
    );
    const passiveIncomeDisplay = forwardDividendIncome > 0 ? forwardDividendIncome : trailing12mFallback;
    const passiveIncomePercentDisplay =
      stockValue > 0 ? (passiveIncomeDisplay / stockValue) * 100 : 0;

    return {
      totalValue,
      stockValue,
      cashValue,
      totalInvested,
      realizedGain,
      unrealizedGain,
      totalProfit,
      totalProfitPercent,
      dailyChange,
      dailyChangePercent,
      passiveIncome: passiveIncomeDisplay,
      passiveIncomePercent: passiveIncomePercentDisplay,
      hasQuotes: anyQuote,
    };
  };

  const computePreOpenPreview = useCallback(
    (holdings: HoldingWithCostCurrency[]): PreOpenPreview => {
      if (!quotes || holdings.length === 0) return EMPTY_PRE_OPEN;

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

      if (!hasPreOpenData) return EMPTY_PRE_OPEN;

      const amount = totalPreOpen - totalCurrent;
      const percent = totalCurrent > 0 ? (amount / totalCurrent) * 100 : 0;
      return { available: true, amount, percent };
    },
    [quotes, convertPrice, getTickerCurrency],
  );

  const formatPercent = (value: number) => {
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${Math.abs(value).toFixed(2)}%`;
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

  const pctBadgeClass = (value: number) =>
    value >= 0 ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500";

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
      const options = optionsByPortfolioId.get(p.id) ?? [];
      const totalRealizedFifoEur = row?.totalRealized ?? 0;
      const closeTradeNetEur = row?.closeTradeNetEur ?? 0;
      const dividendNetEur = row?.dividendNet ?? 0;
      const trailing12mDividendNetEur = row?.trailing12mDividendNet ?? 0;
      const cashEur = row?.cashEur ?? 0;
      map.set(
        p.id,
        (() => {
          const m = computeMetrics(
            holdings,
            options,
            totalRealizedFifoEur,
            closeTradeNetEur,
            dividendNetEur,
            trailing12mDividendNetEur,
            cashEur,
          );
          const passiveIncomeFromDividendsSection = forwardIncomeByPortfolio[p.id] ?? 0;
          if (passiveIncomeFromDividendsSection > 0) {
            const passiveIncomePercent =
              m.stockValue > 0 ? (passiveIncomeFromDividendsSection / m.stockValue) * 100 : 0;
            return {
              ...m,
              passiveIncome: passiveIncomeFromDividendsSection,
              passiveIncomePercent,
            };
          }
          return m;
        })(),
      );
    }
    return map;
    // quotes / currency helpers must trigger recompute when quotes arrive
  }, [overview, portfolios, quotes, convertPrice, getTickerCurrency, resolveHoldingCostCurrency, pnlInvestedForDisplay, optionsByPortfolioId, forwardIncomeByPortfolio]);

  const preOpenByPortfolioId = useMemo(() => {
    const map = new Map<string, PreOpenPreview>();
    if (!overview?.byPortfolioId) return map;
    for (const p of portfolios) {
      const holdings = overview.byPortfolioId[p.id]?.holdings ?? [];
      map.set(p.id, computePreOpenPreview(holdings));
    }
    return map;
  }, [overview, portfolios, computePreOpenPreview]);

  const { data: ytdByPortfolioId = {} } = useQuery<Record<string, number | null>>({
    queryKey: ["/api/portfolio-history", "overview-ytd", portfolios.map((p) => p.id).join(",")],
    enabled: portfolios.length > 0,
    queryFn: async () => {
      const out: Record<string, number | null> = {};
      await Promise.all(
        portfolios.map(async (p) => {
          try {
            const params = new URLSearchParams();
            params.set("portfolio", p.id);
            params.set("range", "ytd");
            const res = await fetch(`/api/portfolio-history?${params.toString()}`, {
              credentials: "include",
            });
            if (!res.ok) {
              out[p.id] = null;
              return;
            }
            const data = (await res.json()) as PortfolioHistoryYtdRes;
            const last = data.points?.[data.points.length - 1];
            out[p.id] =
              last && Number.isFinite(last.portfolioCumulativePct)
                ? last.portfolioCumulativePct
                : null;
          } catch {
            out[p.id] = null;
          }
        }),
      );
      return out;
    },
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const usSessionState = getUsMarketSessionState();
  const showExtendedSession = shouldUseExtendedQuotes(usSessionState);

  const aggregatedMetrics = useMemo((): PortfolioMetrics | null => {
    if (metricsByPortfolioId.size === 0) return null;
    let totalValue = 0;
    let stockValue = 0;
    let cashValue = 0;
    let totalInvested = 0;
    let realizedGain = 0;
    let unrealizedGain = 0;
    let totalProfit = 0;
    let dailyChange = 0;
    let passiveIncome = 0;
    let hasQuotes = false;

    metricsByPortfolioId.forEach((m) => {
      totalValue += m.totalValue;
      stockValue += m.stockValue;
      cashValue += m.cashValue;
      totalInvested += m.totalInvested;
      realizedGain += m.realizedGain;
      unrealizedGain += m.unrealizedGain;
      totalProfit += m.totalProfit;
      dailyChange += m.dailyChange;
      passiveIncome += m.passiveIncome;
      if (m.hasQuotes) hasQuotes = true;
    });

    const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    const baseValue = stockValue - dailyChange;
    const dailyChangePercent = baseValue > 0 ? (dailyChange / baseValue) * 100 : 0;
    const passiveIncomePercent = stockValue > 0 ? (passiveIncome / stockValue) * 100 : 0;

    return {
      totalValue,
      stockValue,
      cashValue,
      totalInvested,
      realizedGain,
      unrealizedGain,
      totalProfit,
      totalProfitPercent,
      dailyChange,
      dailyChangePercent,
      passiveIncome,
      passiveIncomePercent,
      hasQuotes,
    };
  }, [metricsByPortfolioId]);

  const allHoldingsFlat = useMemo(() => {
    if (!overview?.byPortfolioId) return [] as HoldingWithCostCurrency[];
    const out: HoldingWithCostCurrency[] = [];
    for (const p of portfolios) {
      const holdings = overview.byPortfolioId[p.id]?.holdings ?? [];
      out.push(...holdings);
    }
    return out;
  }, [overview, portfolios]);

  const aggregatedPreOpen = useMemo(
    () => computePreOpenPreview(allHoldingsFlat),
    [computePreOpenPreview, allHoldingsFlat],
  );

  const { data: ytdAllPortfolios = null } = useQuery<number | null>({
    queryKey: ["/api/portfolio-history", "overview-ytd", "all"],
    enabled: portfolios.length > 0,
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        params.set("portfolio", "all");
        params.set("range", "ytd");
        const res = await fetch(`/api/portfolio-history?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) return null;
        const data = (await res.json()) as PortfolioHistoryYtdRes;
        const last = data.points?.[data.points.length - 1];
        return last && Number.isFinite(last.portfolioCumulativePct)
          ? last.portfolioCumulativePct
          : null;
      } catch {
        return null;
      }
    },
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const overviewLoading = overviewPending || (!overview && overviewFetching);

  const renderYtdBadge = (ytdPct: number | null | undefined, testId: string) => (
    <span
      className={`text-[10px] font-medium tabular-nums shrink-0 ${
        ytdPct != null ? getChangeTone(ytdPct) : "text-muted-foreground"
      }`}
      data-testid={testId}
      title="YTD výkonnosť"
    >
      YTD {ytdPct != null ? formatPercent(ytdPct) : "—"}
    </span>
  );

  const renderMetricRows = (
    m: PortfolioMetrics,
    opts: {
      preOpen: PreOpenPreview;
      idPrefix: string;
    },
  ) => {
    const displayedDaily = usSessionState === "LIVE" ? m.dailyChange : 0;
    const displayedDailyPct = usSessionState === "LIVE" ? m.dailyChangePercent : 0;

    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">Celkový zisk</span>
          <span className="inline-flex items-center gap-1.5 min-w-0 justify-end">
            <span className={`text-xs font-semibold tabular-nums ${getChangeTone(m.totalProfit)}`}>
              {maskAmount(formatSignedCurrency(m.totalProfit))}
            </span>
            <span
              className={`text-[10px] px-1 py-0.5 rounded font-medium tabular-nums shrink-0 ${pctBadgeClass(m.totalProfitPercent)}`}
            >
              {formatPercent(m.totalProfitPercent)}
            </span>
          </span>
        </div>

        <div
          className="flex items-center justify-between gap-2"
          data-testid={`${opts.idPrefix}-unrealized`}
        >
          <span className="text-[10px] text-muted-foreground">Nerealizovaný</span>
          <span className={`text-xs font-medium tabular-nums ${getChangeTone(m.unrealizedGain)}`}>
            {maskAmount(formatSignedCurrency(m.unrealizedGain))}
          </span>
        </div>

        <div
          className="flex items-center justify-between gap-2"
          data-testid={`${opts.idPrefix}-realized-gain`}
        >
          <span className="text-[10px] text-muted-foreground">Realizovaný</span>
          <span className={`text-xs font-medium tabular-nums ${getChangeTone(m.realizedGain)}`}>
            {maskAmount(formatSignedCurrency(m.realizedGain))}
          </span>
        </div>

        {usSessionState === "LIVE" ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">Denná zmena</span>
            {m.hasQuotes ? (
              <span className="inline-flex items-center gap-1.5 min-w-0 justify-end">
                <span className={`text-xs font-medium tabular-nums ${getChangeTone(displayedDaily)}`}>
                  {maskAmount(formatSignedCurrency(displayedDaily))}
                </span>
                <span
                  className={`text-[10px] px-1 py-0.5 rounded font-medium tabular-nums shrink-0 ${pctBadgeClass(displayedDailyPct)}`}
                >
                  {formatPercent(displayedDailyPct)}
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
        ) : showExtendedSession ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
              <Moon className={`h-2.5 w-2.5 shrink-0 ${PREMARKET_MOON_CLASS}`} />
              {getExtendedSessionLabel(usSessionState)}
            </span>
            {opts.preOpen.available ? (
              <span className="inline-flex items-center gap-1.5 min-w-0 justify-end">
                <span
                  className={`text-xs font-medium tabular-nums ${getChangeTone(opts.preOpen.amount)}`}
                  data-testid={`${opts.idPrefix}-pre-open`}
                >
                  {maskAmount(formatSignedCurrency(opts.preOpen.amount))}
                </span>
                <span
                  className={`text-[10px] px-1 py-0.5 rounded font-medium tabular-nums shrink-0 ${pctBadgeClass(opts.preOpen.percent)}`}
                >
                  {formatPercent(opts.preOpen.percent)}
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">bez dát</span>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">Denná zmena</span>
            <span className="text-xs text-muted-foreground">Trh uzatvorený</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            Pasívny príjem
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 shrink-0 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs">
                <p className="font-medium mb-1">Čo znamenajú čísla</p>
                <p>
                  Suma = očakávaný ročný príjem (Forward Dividend): počet držaných kusov × ročná
                  dividenda na akciu z aktuálnej kotácie, prepočítaná FX kurzom do vašej meny.
                  Percentá = očakávaný ročný dividendový výnos voči aktuálnej hodnote akcií.
                </p>
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="text-xs font-medium tabular-nums text-right">
            <span className={m.passiveIncome > 0 ? "text-green-500" : "text-muted-foreground"}>
              {formatPercent(m.passiveIncomePercent)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {" "}
              ({maskAmount(formatCurrency(m.passiveIncome))})
            </span>
          </span>
        </div>
      </div>
    );
  };

  if (portfoliosLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 md:gap-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-lg font-semibold" data-testid="text-overview-title">
          Prehľad portfólií
        </h1>
        <p className="text-xs text-muted-foreground">
          Rýchly prehľad výkonnosti všetkých vašich portfólií.
        </p>
      </div>

      {portfolios.length === 0 ? (
        <Card>
          <CardContent className="p-4 py-6 text-center text-muted-foreground text-xs">
            Zatiaľ nemáte žiadne portfóliá. Vytvorte si prvé v sekcii Nastavenia.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <Card
            className="md:col-span-2 border-border/70 bg-card/95 shadow-sm"
            data-testid="overview-card-total"
          >
            <CardContent className="p-3 md:p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-semibold text-sm truncate">Celková hodnota</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {renderYtdBadge(ytdAllPortfolios, "overview-ytd-all")}
                  {allTickers.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={quotesFetching || refreshingPortfolioId !== null}
                      onClick={() => refreshAllQuotes()}
                      aria-label="Obnoviť ceny všetkých portfólií"
                      data-testid="button-overview-refresh-all-quotes"
                    >
                      {quotesFetching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {overviewLoading || !aggregatedMetrics ? (
                <>
                  <Skeleton className="h-8 w-40" />
                  <Skeleton className="h-24 w-full" />
                </>
              ) : (
                <>
                  <div>
                    <div
                      className="text-2xl font-semibold leading-tight tracking-tight tabular-nums"
                      data-testid="text-overview-grand-total"
                    >
                      {maskAmount(formatCurrency(aggregatedMetrics.totalValue))}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>
                        Investované: {maskAmount(formatCurrency(aggregatedMetrics.totalInvested))}
                      </span>
                      {aggregatedMetrics.cashValue !== 0 && (
                        <span>
                          Hotovosť: {maskAmount(formatCurrency(aggregatedMetrics.cashValue))}
                        </span>
                      )}
                    </div>
                  </div>
                  {renderMetricRows(aggregatedMetrics, {
                    preOpen: aggregatedPreOpen,
                    idPrefix: "overview-total",
                  })}
                </>
              )}
            </CardContent>
          </Card>

          {portfolios.map((portfolio) => {
            const m = metricsByPortfolioId.get(portfolio.id);
            const bundleRow = overview?.byPortfolioId[portfolio.id];
            const preOpen = preOpenByPortfolioId.get(portfolio.id) ?? EMPTY_PRE_OPEN;
            const ytdPct = ytdByPortfolioId[portfolio.id];
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
                className="hover-elevate cursor-pointer border-border/70 bg-card/95 shadow-sm"
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
                <CardContent className="p-3 md:p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {portfolio.brokerCode ? (
                        <BrokerLogo brokerCode={portfolio.brokerCode} size="xs" />
                      ) : (
                        <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-semibold text-sm truncate">
                        {portfolio.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {renderYtdBadge(ytdPct, `overview-ytd-${portfolio.id}`)}
                      {bundleRow &&
                        bundleRow.holdings &&
                        bundleRow.holdings.length > 0 &&
                        allTickers.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            disabled={quotesFetching || refreshingPortfolioId !== null}
                            onClick={(e) => refreshPortfolioQuotes(portfolio.id, e)}
                            aria-label="Obnoviť ceny a dennú zmenu"
                            data-testid={`button-overview-refresh-quotes-${portfolio.id}`}
                          >
                            {quotesFetching || refreshingPortfolioId === portfolio.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                    </div>
                  </div>

                  {overviewLoading || !m ? (
                    <Skeleton className="h-8 w-40" />
                  ) : (
                    <div>
                      <div
                        className="text-2xl font-semibold leading-tight tracking-tight tabular-nums"
                        data-testid={`overview-value-${portfolio.id}`}
                      >
                        {maskAmount(formatCurrency(m.totalValue))}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                        <span>
                          Investované: {maskAmount(formatCurrency(m.totalInvested))}
                        </span>
                        {m.cashValue !== 0 && (
                          <span data-testid={`overview-cash-${portfolio.id}`}>
                            Hotovosť: {maskAmount(formatCurrency(m.cashValue))}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {overviewLoading || !m ? (
                    <Skeleton className="h-24 w-full" />
                  ) : hasAnyActivity ? (
                    renderMetricRows(m, {
                      preOpen,
                      idPrefix: `overview-${portfolio.id}`,
                    })
                  ) : (
                    <p className="text-xs text-muted-foreground">
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
