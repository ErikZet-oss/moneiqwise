import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import {
  Area,
  ComposedChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownUp,
  Check,
  Eye,
  EyeOff,
  LayoutList,
  Pencil,
  RefreshCw,
} from "lucide-react";
import type { HoldingWithCostCurrency } from "@shared/holdingCostCurrency";
import { CASH_INTEREST_DISPLAY_NAME, CASH_INTEREST_TICKER } from "@shared/tickerCurrency";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings, type MobileAssetsSortBy } from "@/hooks/useChartSettings";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import {
  DASHBOARD_WIDGET_META,
  type DashboardWidgetId,
} from "@/lib/dashboardLayout";
import {
  getQuoteRefreshIntervalMs,
  getQuoteStaleTimeMs,
  getUsMarketSessionState,
  shouldUseExtendedQuotes,
} from "@/lib/usMarketSession";
import { formatShareQuantity } from "@/lib/utils";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Delta,
  Dialog,
  EmptyState,
  HoldingRow,
  HoldingRowSimple,
  NewsRow,
  SectionHeader,
  StatTile,
  TopBar,
  trendFromNumber,
} from "@/redesign/ui";
import {
  HelpButton,
  IconButton,
  KvRow,
  PageBody,
  PortfolioSwitcher,
  signedMoney,
  signedPct,
  toneOf,
} from "./mobileChrome";

type StockQuote = {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  preMarketPrice?: number | null;
  preMarketChangePercent?: number | null;
  marketState?: string | null;
};

type RealizedRes = { realizedGainTotal?: number; totalRealized?: number };
type DividendsRes = { totalNet?: number };
type OptionsSummary = { totalTrades?: number | string; totalRealizedGain?: string };
type HistoryPoint = { date: string; totalValue: number; netInvested: number };
type NewsItem = { ticker: string; title: string; publisher?: string; publishedAt?: string; link?: string };
type EarningsItem = { ticker: string; date: string; companyName?: string };
type MacroItem = { date: string; title: string };

const CHART_RANGES = [
  { v: "1d", label: "1D" },
  { v: "1w", label: "1W" },
  { v: "1m", label: "1M" },
  { v: "3m", label: "3M" },
  { v: "6m", label: "6M" },
  { v: "ytd", label: "YTD" },
  { v: "all", label: "Vše" },
] as const;

async function fetchQuotes(tickers: string[], refresh: boolean) {
  const res = await fetch("/api/stocks/quotes/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tickers, refresh }),
  });
  if (!res.ok) throw new Error("quotes");
  const data = await res.json();
  return data.quotes as Record<string, StockQuote>;
}

function holdingName(h: HoldingWithCostCurrency) {
  if (h.ticker.toUpperCase() === CASH_INTEREST_TICKER) return CASH_INTEREST_DISPLAY_NAME;
  return (h.companyName || h.ticker).trim() || h.ticker;
}

function simpleBadge(h: HoldingWithCostCurrency) {
  const name = (h.companyName || "").toLowerCase();
  if (/\betf\b/.test(name)) return "ETF";
  return "Akcie";
}

export default function DashboardMobile() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { convertPrice, getTickerCurrency, resolveHoldingCostCurrency, pnlInvestedForDisplay, formatCurrency } =
    useCurrency();
  const { getQueryParam, selectedPortfolio, isAllPortfolios, portfolios } = usePortfolio();
  const {
    hideAmounts,
    mobileAssetsSortBy,
    mobileAssetsSortOrder,
    mobileAssetsView,
    setMobileAssetsSortBy,
    setMobileAssetsSortOrder,
    setMobileAssetsView,
    toggleHideAmounts,
  } = useChartSettings();
  const {
    order,
    visible,
    editing,
    setEditing,
    isVisible,
    toggleVisible,
    resetLayout,
  } = useDashboardLayout();

  const portfolioParam = getQueryParam();
  const mask = (s: string) => (hideAmounts ? "••••••" : s);
  const overline = isAllPortfolios ? "Všetky portfóliá" : selectedPortfolio?.name || "Portfólio";

  const [pickerOpen, setPickerOpen] = useState(false);
  const [chartRange, setChartRange] = useState<(typeof CHART_RANGES)[number]["v"]>("all");
  const [sortOpen, setSortOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [draftSortBy, setDraftSortBy] = useState<MobileAssetsSortBy>(mobileAssetsSortBy);
  const [draftSortOrder, setDraftSortOrder] = useState<"asc" | "desc">(mobileAssetsSortOrder);
  const [holdingsLimit, setHoldingsLimit] = useState(10);

  const { data: holdings = [], isLoading: holdingsLoading } = useQuery<HoldingWithCostCurrency[]>({
    queryKey: ["/api/holdings", portfolioParam],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("holdings");
      return res.json();
    },
  });

  const tickers = useMemo(() => holdings.map((h) => h.ticker).sort(), [holdings]);

  const {
    data: quotes = {},
    isFetching: quotesFetching,
  } = useQuery({
    queryKey: ["/api/quotes", tickers],
    enabled: tickers.length > 0,
    staleTime: getQuoteStaleTimeMs(),
    refetchInterval: () => getQuoteRefreshIntervalMs(),
    queryFn: () => fetchQuotes(tickers, shouldUseExtendedQuotes(getUsMarketSessionState())),
  });

  const { data: realized } = useQuery<RealizedRes>({
    queryKey: ["/api/realized-gains", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/realized-gains?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("realized");
      return res.json();
    },
  });

  const { data: dividends } = useQuery<DividendsRes>({
    queryKey: ["/api/dividends", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("dividends");
      return res.json();
    },
  });

  const { data: optionStats } = useQuery<OptionsSummary>({
    queryKey: ["/api/options/stats/summary", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/options/stats/summary?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("options");
      return res.json();
    },
  });

  const historyRange = chartRange === "1d" || chartRange === "1w" ? "1m" : chartRange === "all" ? "all" : chartRange;
  const { data: history } = useQuery<{ points: HistoryPoint[] }>({
    queryKey: ["/api/portfolio-history", portfolioParam, historyRange],
    queryFn: async () => {
      const params = new URLSearchParams({ portfolio: portfolioParam, range: historyRange });
      const res = await fetch(`/api/portfolio-history?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("history");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: ytdHistory } = useQuery<{
    points: Array<{ portfolioCumulativePct: number; sp500CumulativePct: number }>;
  }>({
    queryKey: ["/api/portfolio-history", portfolioParam, "ytd", "benchmark"],
    queryFn: async () => {
      const params = new URLSearchParams({ portfolio: portfolioParam, range: "ytd", includeSp500: "1" });
      const res = await fetch(`/api/portfolio-history?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("ytd");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: news = [] } = useQuery<NewsItem[]>({
    queryKey: ["/api/news/portfolio", portfolioParam],
    enabled: isVisible("news"),
    queryFn: async () => {
      const res = await fetch(`/api/news/portfolio?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items ?? data.news ?? data) as NewsItem[];
    },
  });

  const { data: earnings = [] } = useQuery<EarningsItem[]>({
    queryKey: ["/api/holdings/next-earnings", portfolioParam],
    enabled: isVisible("earnings"),
    queryFn: async () => {
      const res = await fetch(`/api/holdings/next-earnings?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: macro = [] } = useQuery<MacroItem[]>({
    queryKey: ["/api/macro-events/upcoming"],
    enabled: isVisible("macroEvent"),
    queryFn: async () => {
      const res = await fetch("/api/macro-events/upcoming", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

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

  const metrics = useMemo(() => {
    const stockRealized = convertPrice(realized?.realizedGainTotal ?? realized?.totalRealized ?? 0, "EUR");
    const dividendGain = dividends?.totalNet ?? 0;
    const optionsRealized = parseFloat(String(optionStats?.totalRealizedGain ?? "0")) || 0;

    let stockValue = 0;
    let totalInvested = 0;
    let dailyChange = 0;

    for (const holding of holdings) {
      const quote = quotes[holding.ticker];
      const shares = parseFloat(holding.shares);
      const invested = pnlInvestedForDisplay(holding);
      totalInvested += invested;
      const cur = getTickerCurrency(holding.ticker);
      if (quote && Number.isFinite(quote.price) && quote.price > 0) {
        stockValue += shares * convertPrice(quote.price, cur);
        dailyChange += shares * convertPrice(quote.change, cur);
      } else {
        stockValue += convertPrice(parseFloat(holding.totalInvested), resolveHoldingCostCurrency(holding));
      }
    }

    const unrealized = stockValue - totalInvested;
    const totalProfit = unrealized + stockRealized + optionsRealized + dividendGain;
    const totalValue = stockValue + cashValue;
    const dailyPct = stockValue - dailyChange > 0 ? (dailyChange / (stockValue - dailyChange)) * 100 : 0;
    const live = getUsMarketSessionState() === "LIVE";

    return {
      totalValue,
      stockValue,
      cashValue,
      totalInvested,
      unrealized,
      stockRealized,
      dividendGain,
      optionsRealized,
      totalProfit,
      totalProfitPercent: totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0,
      dailyChange: live ? dailyChange : 0,
      dailyChangePercent: live ? dailyPct : 0,
    };
  }, [
    holdings,
    quotes,
    realized,
    dividends,
    optionStats,
    cashValue,
    convertPrice,
    getTickerCurrency,
    resolveHoldingCostCurrency,
    pnlInvestedForDisplay,
  ]);

  const enrichedHoldings = useMemo(() => {
    const rows = holdings.map((h) => {
      const quote = quotes[h.ticker];
      const shares = parseFloat(h.shares);
      const cur = getTickerCurrency(h.ticker);
      const invested = pnlInvestedForDisplay(h);
      const value =
        quote && quote.price > 0
          ? shares * convertPrice(quote.price, cur)
          : convertPrice(parseFloat(h.totalInvested), resolveHoldingCostCurrency(h));
      const gain = value - invested;
      const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
      const dayPct = quote?.changePercent ?? 0;
      const avg = convertPrice(parseFloat(h.averageCost || "0"), resolveHoldingCostCurrency(h));
      const price = quote && quote.price > 0 ? convertPrice(quote.price, cur) : 0;
      return { holding: h, value, gain, gainPct, dayPct, avg, price, shares };
    });

    const dir = mobileAssetsSortOrder === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (mobileAssetsSortBy === "value") return (a.value - b.value) * dir;
      if (mobileAssetsSortBy === "netProfit") return (a.gain - b.gain) * dir;
      if (mobileAssetsSortBy === "gainPercent") return (a.gainPct - b.gainPct) * dir;
      return holdingName(a.holding).localeCompare(holdingName(b.holding), "sk") * dir;
    });
    return rows;
  }, [
    holdings,
    quotes,
    mobileAssetsSortBy,
    mobileAssetsSortOrder,
    convertPrice,
    getTickerCurrency,
    resolveHoldingCostCurrency,
    pnlInvestedForDisplay,
  ]);

  const movers = useMemo(() => {
    const list = enrichedHoldings
      .filter((r) => Number.isFinite(r.dayPct) && r.dayPct !== 0)
      .map((r) => ({
        ticker: r.holding.ticker,
        pct: r.dayPct,
        amount: r.shares * convertPrice(quotes[r.holding.ticker]?.change ?? 0, getTickerCurrency(r.holding.ticker)),
      }));
    const gainers = [...list].sort((a, b) => b.pct - a.pct).slice(0, 5);
    const losers = [...list].sort((a, b) => a.pct - b.pct).slice(0, 5);
    return { gainers, losers };
  }, [enrichedHoldings, quotes, convertPrice, getTickerCurrency]);

  const topPosition = useMemo(() => {
    if (metrics.stockValue <= 0) return null;
    const top = [...enrichedHoldings].sort((a, b) => b.value - a.value)[0];
    if (!top) return null;
    return {
      ticker: top.holding.ticker,
      pct: (top.value / metrics.stockValue) * 100,
    };
  }, [enrichedHoldings, metrics.stockValue]);

  const ytd = useMemo(() => {
    const pts = ytdHistory?.points ?? [];
    const last = pts[pts.length - 1];
    if (!last) return null;
    return {
      portfolio: last.portfolioCumulativePct,
      sp500: last.sp500CumulativePct,
      alpha: last.portfolioCumulativePct - last.sp500CumulativePct,
    };
  }, [ytdHistory]);

  const allocation = useMemo(() => {
    const total = metrics.stockValue || 1;
    return [...enrichedHoldings]
      .sort((a, b) => b.value - a.value)
      .slice(0, 4)
      .map((r) => ({
        ticker: r.holding.ticker,
        pct: (r.value / total) * 100,
      }));
  }, [enrichedHoldings, metrics.stockValue]);

  const refreshQuotes = useCallback(async () => {
    if (tickers.length === 0) return;
    await queryClient.fetchQuery({
      queryKey: ["/api/quotes", tickers],
      queryFn: () => fetchQuotes(tickers, true),
    });
  }, [queryClient, tickers]);

  const chartPoints = history?.points ?? [];
  const chartProfit =
    chartPoints.length > 0
      ? chartPoints[chartPoints.length - 1]!.totalValue >= chartPoints[chartPoints.length - 1]!.netInvested
      : metrics.totalProfit >= 0;

  const renderWidget = (id: DashboardWidgetId) => {
    if (!editing && !isVisible(id)) return null;

    const frame = (body: ReactNode, opts?: { skipChrome?: boolean }) => (
      <div key={id} className="relative">
        {editing && !opts?.skipChrome ? (
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              aria-label={visible[id] ? "Skryť" : "Zobraziť"}
              className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)]"
              onClick={() => toggleVisible(id)}
            >
              {visible[id] ? <Eye className="size-4" /> : <EyeOff className="size-4 text-[var(--rd-text-tertiary)]" />}
            </button>
            <p className="text-xs font-medium text-[var(--rd-text-secondary)]">
              {DASHBOARD_WIDGET_META[id].label}
            </p>
          </div>
        ) : null}
        <div className={editing && !opts?.skipChrome && !visible[id] ? "opacity-40" : undefined}>{body}</div>
      </div>
    );

    switch (id) {
      case "summary":
        return frame(
          <Card>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--rd-text-tertiary)]">
                  Celková hodnota
                </p>
                <p className="mt-1 font-mono text-[36px] font-bold leading-10 tracking-[-0.02em]">
                  {mask(formatCurrency(metrics.totalValue))}
                </p>
              </div>
              <IconButton label="Obnoviť kotácie" onClick={() => void refreshQuotes()} spinning={quotesFetching}>
                <RefreshCw className={`size-[18px] ${quotesFetching ? "animate-spin" : ""}`} />
              </IconButton>
            </div>
            <div className="mt-3 space-y-2">
              <KvRow label="Celkový profit" value={mask(signedMoney(formatCurrency, metrics.totalProfit))} tone={toneOf(metrics.totalProfit)} />
              <KvRow label="" value={signedPct(metrics.totalProfitPercent)} tone={toneOf(metrics.totalProfitPercent)} />
              <KvRow label="Denná zmena" value={mask(signedMoney(formatCurrency, metrics.dailyChange))} tone={toneOf(metrics.dailyChange)} />
              <KvRow label="" value={signedPct(metrics.dailyChangePercent)} tone={toneOf(metrics.dailyChangePercent)} />
              <KvRow label="Nerealizovaný zisk" value={mask(signedMoney(formatCurrency, metrics.unrealized))} tone={toneOf(metrics.unrealized)} />
              <KvRow label="Hotovosť" value={mask(formatCurrency(metrics.cashValue))} />
            </div>
            {isVisible("chart") || editing ? (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap gap-1">
                  {CHART_RANGES.map((r) => (
                    <Chip key={r.v} active={chartRange === r.v} onClick={() => setChartRange(r.v)}>
                      {r.label}
                    </Chip>
                  ))}
                </div>
                <div className="h-40 w-full">
                  {chartPoints.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartPoints}>
                        <defs>
                          <linearGradient id="rd-dash-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={chartProfit ? "var(--rd-profit)" : "var(--rd-loss)"} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={chartProfit ? "var(--rd-profit)" : "var(--rd-loss)"} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide />
                        <YAxis hide domain={["dataMin", "dataMax"]} />
                        <RTooltip
                          contentStyle={{
                            background: "var(--rd-bg-surface-raised)",
                            border: "1px solid var(--rd-border-subtle)",
                            borderRadius: 10,
                            fontSize: 12,
                          }}
                          labelFormatter={(v) => {
                            try {
                              return format(new Date(String(v)), "d. M. yyyy", { locale: sk });
                            } catch {
                              return String(v);
                            }
                          }}
                          formatter={(value: number) => [mask(formatCurrency(value)), "Hodnota"]}
                        />
                        <Area
                          type="monotone"
                          dataKey="totalValue"
                          stroke={chartProfit ? "var(--rd-profit)" : "var(--rd-loss)"}
                          fill="url(#rd-dash-fill)"
                          strokeWidth={2}
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-[var(--rd-text-tertiary)]">
                      Graf sa načítava…
                    </div>
                  )}
                </div>
                <p className="mt-2 font-mono text-sm text-[var(--rd-text-secondary)]">
                  Za obdobie · {mask(signedMoney(formatCurrency, metrics.totalProfit))} · {signedPct(metrics.totalProfitPercent)}
                </p>
              </div>
            ) : null}
          </Card>,
        );

      case "chart":
        return null;

      case "realizedDividends":
        return frame(
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="text-left" onClick={() => setLocation("/profit")}>
              <StatTile
                label="Realizovaný zisk"
                value={mask(formatCurrency(metrics.stockRealized))}
                tone={metrics.stockRealized >= 0 ? "Up" : "Down"}
              />
            </button>
            <button type="button" className="text-left" onClick={() => setLocation("/dividends")}>
              <StatTile
                label="Dividendy (spolu)"
                value={mask(signedMoney(formatCurrency, metrics.dividendGain))}
                tone="Up"
                sub="Detail ›"
              />
            </button>
          </div>,
        );

      case "ytdBenchmark":
        return frame(
          <Card>
            <SectionHeader title="YTD vs S&P 500" />
            {ytd ? (
              <>
                <p className="font-mono text-sm text-[var(--rd-profit)]">Alpha {signedPct(ytd.alpha)}</p>
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-[var(--rd-text-secondary)]">Moje YTD</span>
                      <span className="font-mono">{signedPct(ytd.portfolio)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--rd-bg-surface-hover)]">
                      <div
                        className="h-full rounded-full bg-[var(--rd-profit)]"
                        style={{ width: `${Math.min(100, Math.max(0, Math.abs(ytd.portfolio)))}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-[var(--rd-text-secondary)]">S&P 500 YTD</span>
                      <span className="font-mono">{signedPct(ytd.sp500)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--rd-bg-surface-hover)]">
                      <div
                        className="h-full rounded-full bg-[var(--rd-chart-4)]"
                        style={{ width: `${Math.min(100, Math.max(0, Math.abs(ytd.sp500)))}%` }}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--rd-text-tertiary)]">YTD porovnanie sa načítava…</p>
            )}
          </Card>,
        );

      case "earnings":
      case "topPosition":
      case "macroEvent":
        return frame(
          <Card>
            <SectionHeader title="Na radare" />
            <div className="space-y-3">
              {(editing || isVisible("earnings")) ? (
                <div className={`flex items-center gap-3 ${editing && !isVisible("earnings") ? "opacity-40" : ""}`}>
                  {editing ? (
                    <button
                      type="button"
                      aria-label="Earnings"
                      className="inline-flex size-8 items-center justify-center"
                      onClick={() => toggleVisible("earnings")}
                    >
                      {isVisible("earnings") ? <Eye className="size-4" /> : <EyeOff className="size-4 text-[var(--rd-text-tertiary)]" />}
                    </button>
                  ) : (
                    <Badge label="Earnings" tone="Info" />
                  )}
                  <div className="min-w-0 flex-1">
                    {editing ? <p className="text-xs text-[var(--rd-text-tertiary)]">Earnings</p> : null}
                    <p className="font-mono text-sm">{earnings[0]?.ticker || "—"}</p>
                    <p className="text-xs text-[var(--rd-text-tertiary)]">
                      {earnings[0]?.date
                        ? format(new Date(earnings[0].date), "d. MMM yyyy", { locale: sk })
                        : "Žiadne nadchádzajúce"}
                    </p>
                  </div>
                </div>
              ) : null}
              {(editing || (isVisible("topPosition") && topPosition)) ? (
                <div className={`flex items-center gap-3 ${editing && !isVisible("topPosition") ? "opacity-40" : ""}`}>
                  {editing ? (
                    <button
                      type="button"
                      aria-label="Top pozícia"
                      className="inline-flex size-8 items-center justify-center"
                      onClick={() => toggleVisible("topPosition")}
                    >
                      {isVisible("topPosition") ? <Eye className="size-4" /> : <EyeOff className="size-4 text-[var(--rd-text-tertiary)]" />}
                    </button>
                  ) : (
                    <Badge label="Top pozícia" tone="Profit" />
                  )}
                  <div className="min-w-0 flex-1">
                    {editing ? <p className="text-xs text-[var(--rd-text-tertiary)]">Top pozícia</p> : null}
                    <p className="font-mono text-sm">{topPosition?.ticker || "—"}</p>
                    <p className="font-mono text-xs text-[var(--rd-text-secondary)]">
                      {topPosition ? `${topPosition.pct.toFixed(2)}%` : "—"}
                    </p>
                  </div>
                </div>
              ) : null}
              {(editing || isVisible("macroEvent")) ? (
                <div className={`flex items-center gap-3 ${editing && !isVisible("macroEvent") ? "opacity-40" : ""}`}>
                  {editing ? (
                    <button
                      type="button"
                      aria-label="Makro"
                      className="inline-flex size-8 items-center justify-center"
                      onClick={() => toggleVisible("macroEvent")}
                    >
                      {isVisible("macroEvent") ? <Eye className="size-4" /> : <EyeOff className="size-4 text-[var(--rd-text-tertiary)]" />}
                    </button>
                  ) : (
                    <Badge label="Makro" tone="Warning" />
                  )}
                  <div className="min-w-0 flex-1">
                    {editing ? <p className="text-xs text-[var(--rd-text-tertiary)]">Makro udalosť</p> : null}
                    <p className="truncate text-sm">{macro[0]?.title || "—"}</p>
                    <p className="text-xs text-[var(--rd-text-tertiary)]">
                      {macro[0]?.date
                        ? format(new Date(macro[0].date), "d. MMM yyyy", { locale: sk })
                        : "Bez najbližšej udalosti"}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>,
          { skipChrome: true },
        );

      case "dailyGainers":
        return frame(
          <Card>
            <SectionHeader title="Denné pohyby" />
            <p className="text-xs text-[var(--rd-text-tertiary)]">
              Zmena podľa režimu trhu (RTH vs pre/post market).
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className={editing && !isVisible("dailyGainers") ? "opacity-40" : undefined}>
                <div className="mb-2 flex items-center gap-1">
                  {editing ? (
                    <button
                      type="button"
                      aria-label="Najlepšie"
                      className="inline-flex size-7 items-center justify-center"
                      onClick={() => toggleVisible("dailyGainers")}
                    >
                      {isVisible("dailyGainers") ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-[var(--rd-text-tertiary)]" />}
                    </button>
                  ) : null}
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rd-text-tertiary)]">
                    Najlepšie
                  </p>
                </div>
                {(editing || isVisible("dailyGainers")) && movers.gainers.length === 0 ? (
                  <p className="text-xs text-[var(--rd-text-tertiary)]">—</p>
                ) : null}
                {(editing || isVisible("dailyGainers") ? movers.gainers : []).map((m, i) => (
                  <button
                    key={m.ticker}
                    type="button"
                    className="flex w-full items-center gap-2 py-2 text-left"
                    onClick={() => setLocation(`/asset/${encodeURIComponent(m.ticker)}`)}
                  >
                    <span className="w-4 font-mono text-xs text-[var(--rd-text-tertiary)]">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">{m.ticker}</span>
                    <Delta trend="Up" value={signedPct(m.pct)} />
                  </button>
                ))}
              </div>
              <div className={editing && !isVisible("dailyLosers") ? "opacity-40" : undefined}>
                <div className="mb-2 flex items-center gap-1">
                  {editing ? (
                    <button
                      type="button"
                      aria-label="Najhoršie"
                      className="inline-flex size-7 items-center justify-center"
                      onClick={() => toggleVisible("dailyLosers")}
                    >
                      {isVisible("dailyLosers") ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-[var(--rd-text-tertiary)]" />}
                    </button>
                  ) : null}
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rd-text-tertiary)]">
                    Najhoršie
                  </p>
                </div>
                {(editing || isVisible("dailyLosers") ? movers.losers : []).map((m, i) => (
                  <button
                    key={m.ticker}
                    type="button"
                    className="flex w-full items-center gap-2 py-2 text-left"
                    onClick={() => setLocation(`/asset/${encodeURIComponent(m.ticker)}`)}
                  >
                    <span className="w-4 font-mono text-xs text-[var(--rd-text-tertiary)]">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">{m.ticker}</span>
                    <Delta trend="Down" value={signedPct(m.pct)} />
                  </button>
                ))}
              </div>
            </div>
          </Card>,
          { skipChrome: true },
        );

      case "dailyLosers":
        return null;

      case "holdings":
        return frame(
          <Card className="gap-0 p-0">
            <div className="flex items-start gap-2 p-4 pb-2">
              <div className="min-w-0 flex-1">
                <SectionHeader title="Prehľad aktív" />
                <p className="text-xs text-[var(--rd-text-tertiary)]">Vaše aktuálne držané akcie</p>
              </div>
              <button
                type="button"
                aria-label="Zobrazenie"
                className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--rd-border-subtle)]"
                onClick={() => setViewOpen(true)}
              >
                <LayoutList className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Zoradiť"
                className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--rd-border-subtle)]"
                onClick={() => {
                  setDraftSortBy(mobileAssetsSortBy);
                  setDraftSortOrder(mobileAssetsSortOrder);
                  setSortOpen(true);
                }}
              >
                <ArrowDownUp className="size-4" />
              </button>
            </div>
            {holdingsLoading ? (
              <p className="px-4 pb-4 text-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
            ) : enrichedHoldings.length === 0 ? (
              <div className="p-4">
                <EmptyState title="Žiadne pozície" body="Importuj transakcie alebo pridaj nákup v Histórii." />
              </div>
            ) : (
              <div className="divide-y divide-[var(--rd-border-subtle)] px-4">
                {enrichedHoldings.slice(0, holdingsLimit).map((row) => {
                  const h = row.holding;
                  if (mobileAssetsView === "simple") {
                    return (
                      <button
                        key={h.id || h.ticker}
                        type="button"
                        className="w-full text-left"
                        onClick={() => setLocation(`/asset/${encodeURIComponent(h.ticker)}`)}
                      >
                        <HoldingRowSimple
                          ticker={h.ticker}
                          name={holdingName(h)}
                          assetType={simpleBadge(h)}
                          value={mask(formatCurrency(row.value))}
                          lot={`${formatShareQuantity(row.shares)} @ ${mask(formatCurrency(row.avg))}`}
                          dayChange={signedPct(row.dayPct)}
                          dayTrend={trendFromNumber(row.dayPct)}
                          pl={mask(signedMoney(formatCurrency, row.gain))}
                        />
                      </button>
                    );
                  }
                  return (
                    <HoldingRow
                      key={h.id || h.ticker}
                      ticker={h.ticker}
                      name={holdingName(h)}
                      qty={`${formatShareQuantity(row.shares)} ks`}
                      value={mask(formatCurrency(row.value))}
                      delta={`${signedPct(row.gainPct)} · ${mask(signedMoney(formatCurrency, row.gain))}`}
                      trend={trendFromNumber(row.gain)}
                      onTickerClick={() => setLocation(`/asset/${encodeURIComponent(h.ticker)}`)}
                    />
                  );
                })}
              </div>
            )}
            {enrichedHoldings.length > holdingsLimit ? (
              <button
                type="button"
                className="w-full border-t border-[var(--rd-border-subtle)] py-3 text-center text-sm font-medium text-[var(--rd-profit)]"
                onClick={() => setHoldingsLimit((n) => n + 12)}
              >
                Viac · ďalších {enrichedHoldings.length - holdingsLimit}
              </button>
            ) : null}
          </Card>,
        );

      case "allocation":
        return frame(
          <Card>
            <div className="flex items-center justify-between gap-2">
              <SectionHeader title="Alokácia" />
              <button
                type="button"
                className="text-sm font-medium text-[var(--rd-profit)]"
                onClick={() => setLocation("/allocation")}
              >
                Viac
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {allocation.map((a) => (
                <div key={a.ticker} className="flex items-center gap-2">
                  <Avatar ticker={a.ticker} />
                  <p className="min-w-0 flex-1 font-mono text-sm">{a.ticker}</p>
                  <p className="font-mono text-sm text-[var(--rd-text-secondary)]">{a.pct.toFixed(1)}%</p>
                </div>
              ))}
              {allocation.length === 0 ? (
                <p className="text-xs text-[var(--rd-text-tertiary)]">Bez alokácie</p>
              ) : null}
            </div>
          </Card>,
        );

      case "news":
        return frame(
          <Card className="gap-0">
            <div className="pb-2">
              <SectionHeader title="Novinky k vašim aktívam" />
            </div>
            {(Array.isArray(news) ? news : []).slice(0, 5).map((item, idx) => (
              <button
                key={`${item.ticker}-${idx}`}
                type="button"
                className="w-full text-left"
                onClick={item.link ? () => window.open(item.link, "_blank", "noopener,noreferrer") : undefined}
              >
                <NewsRow
                  ticker={item.ticker}
                  headline={item.title}
                  meta={[item.publishedAt, item.publisher].filter(Boolean).join(" · ")}
                />
              </button>
            ))}
            {(!news || news.length === 0) ? (
              <p className="py-3 text-xs text-[var(--rd-text-tertiary)]">Žiadne novinky</p>
            ) : null}
          </Card>,
        );

      case "aiMacroAudit":
        return frame(
          <Card>
            <div className="flex items-center justify-between gap-2">
              <SectionHeader title="AI Macro Audit" />
              <button type="button" className="text-sm font-medium text-[var(--rd-ai)]" onClick={() => setLocation("/ai-macro-audit")}>
                Viac
              </button>
            </div>
            <p className="text-xs text-[var(--rd-text-secondary)]">
              Health score a makro riziká · {overline}
            </p>
            <Button variant="Secondary" className="mt-3 w-full" onClick={() => setLocation("/ai-macro-audit")}>
              Otvoriť AI Macro Audit
            </Button>
          </Card>,
        );

      case "optionsInsight":
        return frame(
          <Card>
            <SectionHeader title="Opcie" />
            <p className="text-sm text-[var(--rd-text-secondary)]">
              {metrics.optionsRealized
                ? `Realizovaný zisk z opcií: ${mask(signedMoney(formatCurrency, metrics.optionsRealized))}`
                : "Opcie nie sú v portfóliu"}
            </p>
            <Button variant="Ghost" className="mt-2 w-full" onClick={() => setLocation("/options")}>
              Prejsť na Opcie
            </Button>
          </Card>,
        );

      default:
        return null;
    }
  };

  // Collapse related classic widgets into single redesign cards (first slot wins).
  let radarRendered = false;
  let moversRendered = false;
  const widgets = order.map((id) => {
    if (id === "earnings" || id === "topPosition" || id === "macroEvent") {
      if (radarRendered) return null;
      if (!editing && !isVisible("earnings") && !isVisible("topPosition") && !isVisible("macroEvent")) {
        return null;
      }
      radarRendered = true;
      return renderWidget("earnings");
    }
    if (id === "dailyGainers" || id === "dailyLosers") {
      if (moversRendered) return null;
      if (!editing && !isVisible("dailyGainers") && !isVisible("dailyLosers")) return null;
      moversRendered = true;
      return renderWidget("dailyGainers");
    }
    if (id === "chart") return null;
    return renderWidget(id);
  });

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      {editing ? (
        <header className="flex items-center gap-3 bg-[var(--rd-bg-base)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--rd-text-tertiary)]">
              Režim úprav
            </p>
            <h1 className="text-[22px] font-bold leading-7">Úprava prehľadu</h1>
          </div>
          <Button variant="Ghost" onClick={() => resetLayout()}>
            Predvolené
          </Button>
          <Button onClick={() => setEditing(false)}>
            <Check className="size-4" />
            Hotovo
          </Button>
        </header>
      ) : (
        <TopBar
          overline={overline}
          title="Prehľad"
          onOverlineClick={() => setPickerOpen(true)}
          trailing={
            <div className="flex items-center gap-1">
              <HelpButton
                title="Prehľad"
                body="Súhrn portfólia, graf, držané aktíva a widgety. Poradie a viditeľnosť upravíš perom."
              />
              <button
                type="button"
                aria-label={hideAmounts ? "Zobraziť sumy" : "Skryť sumy"}
                className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)]"
                onClick={() => toggleHideAmounts()}
              >
                {hideAmounts ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button
                type="button"
                aria-label="Upraviť prehľad"
                className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)]"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
              </button>
            </div>
          }
        />
      )}

      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />

      <PageBody>
        {editing ? (
          <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
            Oko skryje/zobrazí widget. Poradie zatiaľ uprav v klasickom režime alebo v Nastaveniach.
          </p>
        ) : null}
        {widgets}
      </PageBody>

      <Dialog open={sortOpen} title="Zoradiť aktíva" onClose={() => setSortOpen(false)}>
        <div className="mt-3 space-y-2">
          {(
            [
              ["name", "Názov"],
              ["value", "Hodnota"],
              ["netProfit", "Zisk/strata"],
              ["gainPercent", "Zisk %"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="flex min-h-11 w-full items-center justify-between rounded-[var(--rd-radius-sm)] px-2 text-sm"
              onClick={() => setDraftSortBy(value)}
            >
              <span>{label}</span>
              {draftSortBy === value ? <Check className="size-4 text-[var(--rd-profit)]" /> : null}
            </button>
          ))}
          <div className="flex gap-2 pt-2">
            <Chip active={draftSortOrder === "asc"} onClick={() => setDraftSortOrder("asc")}>
              Vzostupne
            </Chip>
            <Chip active={draftSortOrder === "desc"} onClick={() => setDraftSortOrder("desc")}>
              Zostupne
            </Chip>
          </div>
          <Button
            className="mt-3 w-full"
            onClick={() => {
              setMobileAssetsSortBy(draftSortBy);
              setMobileAssetsSortOrder(draftSortOrder);
              setSortOpen(false);
            }}
          >
            Použiť
          </Button>
        </div>
      </Dialog>

      <Dialog open={viewOpen} title="Zobrazenie aktív" onClose={() => setViewOpen(false)}>
        <div className="mt-3 space-y-2">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between rounded-[var(--rd-radius-sm)] px-2 text-sm"
            onClick={() => {
              setMobileAssetsView("detailed");
              setViewOpen(false);
            }}
          >
            <span>Podrobné</span>
            {mobileAssetsView === "detailed" ? <Check className="size-4 text-[var(--rd-profit)]" /> : null}
          </button>
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between rounded-[var(--rd-radius-sm)] px-2 text-sm"
            onClick={() => {
              setMobileAssetsView("simple");
              setViewOpen(false);
            }}
          >
            <span>Jednoduché</span>
            {mobileAssetsView === "simple" ? <Check className="size-4 text-[var(--rd-profit)]" /> : null}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
