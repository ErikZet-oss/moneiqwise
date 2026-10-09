import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownUp,
  ArrowLeftRight,
  Calendar,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  Layers,
  LayoutList,
  Moon,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { HoldingWithCostCurrency } from "@shared/holdingCostCurrency";
import type { BrokerCode } from "@shared/schema";
import {
  CASH_INTEREST_DISPLAY_NAME,
  CASH_INTEREST_TICKER,
  type QuoteCurrency,
} from "@shared/tickerCurrency";
import { BrokerLogo } from "@/components/BrokerLogo";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings, type MobileAssetsSortBy } from "@/hooks/useChartSettings";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import {
  DASHBOARD_WIDGET_META,
  type DashboardWidgetId,
} from "@/lib/dashboardLayout";
import {
  buildComparisonPctSeries,
  chartBenchmarkLabel,
  chartBenchmarkStroke,
  type BenchmarkHistoryRes,
} from "@/lib/chartBenchmarks";
import {
  DashboardWidgetSettingsDialog,
  DASHBOARD_WIDGETS_WITH_SETTINGS,
} from "./DashboardWidgetSettingsDialog";
import {
  getExtendedSessionLabel,
  getQuoteRefreshIntervalMs,
  getQuoteStaleTimeMs,
  getUsMarketSessionState,
  shouldShowExtendedQuote,
  shouldUseExtendedQuotes,
} from "@/lib/usMarketSession";
import { cn, formatShareQuantity } from "@/lib/utils";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Delta,
  Dialog,
  EmptyState,
  HoldingRowExpandable,
  HoldingRowSimple,
  LotRow,
  NewsRow,
  SectionHeader,
  StatTile,
  TopBar,
  trendFromNumber,
  type DeltaTrend,
  type HoldingLot,
} from "@/redesign/ui";
import {
  CHART_COLORS,
  HelpButton,
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
  preMarketChange?: number | null;
  preMarketChangePercent?: number | null;
  marketState?: string | null;
};

function PortfolioMark({
  isAll,
  brokerCode,
  size = 28,
}: {
  isAll: boolean;
  brokerCode?: BrokerCode | null;
  size?: number;
}) {
  if (!isAll && brokerCode) {
    return <BrokerLogo brokerCode={brokerCode} size={size >= 28 ? "sm" : "xs"} />;
  }
  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Layers className={size >= 28 ? "size-4" : "size-3.5"} />
    </div>
  );
}

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

const ALLOCATION_TABS = [
  { id: "type", label: "Typ" },
  { id: "positions", label: "Pozície" },
  { id: "sector", label: "Sektor" },
  { id: "region", label: "Región" },
] as const;

function extendedSessionShortLabel(state: ReturnType<typeof getUsMarketSessionState>) {
  switch (state) {
    case "POST_MARKET":
      return "Po zatvorení";
    case "OVERNIGHT":
      return "Overnight";
    case "PRE_MARKET":
      return "Pred open";
    default:
      return getExtendedSessionLabel(state).replace(/:$/, "");
  }
}

function MetricRow({
  label,
  amount,
  amountTone = "neutral",
  pct,
  pctTrend,
}: {
  label: ReactNode;
  amount?: string;
  amountTone?: "neutral" | "up" | "down";
  pct?: string;
  pctTrend?: DeltaTrend;
}) {
  const amountClass =
    amountTone === "up"
      ? "text-[var(--rd-profit)]"
      : amountTone === "down"
        ? "text-[var(--rd-loss)]"
        : "text-[var(--rd-text-primary)]";
  return (
    <div className="flex items-center gap-1.5">
      <div className="rd-type-body-sm min-w-0 flex-1 truncate text-[var(--rd-text-secondary)]">{label}</div>
      {amount ? <p className={cn("rd-type-data-sm shrink-0", amountClass)}>{amount}</p> : null}
      {pct ? <Delta value={pct} trend={pctTrend ?? "Flat"} /> : null}
    </div>
  );
}

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
  const t = h.ticker.toUpperCase();
  if (t === CASH_INTEREST_TICKER || t === "CASH") return "Hotovosť";
  const name = (h.companyName || "").toLowerCase();
  if (/\betf\b/.test(name) || /\betc\b/.test(name)) return "ETF";
  return "Akcie";
}

function canExpandLots(h: HoldingWithCostCurrency) {
  const t = h.ticker.toUpperCase();
  if (t === "CASH" || t === CASH_INTEREST_TICKER) return false;
  const shares = parseFloat(h.shares);
  return Number.isFinite(shares) && shares > 0;
}

type OpenFifoLot = {
  acquiredAt: string;
  remainingShares: number;
  pricePerShareLocal: number;
  purchaseCurrency: string;
  investedAmountEur?: number;
};

function SimpleLotsPanel({
  portfolioPath,
  ticker,
  shares,
  currentPrice,
  investedDisplay,
  mask,
  formatAverageCostCurrency,
  convertPrice,
  convertAverageCostPrice,
}: {
  portfolioPath: string;
  ticker: string;
  shares: number;
  currentPrice: number;
  investedDisplay: number;
  mask: (s: string) => string;
  formatAverageCostCurrency: (n: number) => string;
  convertPrice: (n: number, from: QuoteCurrency) => number;
  convertAverageCostPrice: (n: number, from: QuoteCurrency) => number;
}) {
  const { data, isLoading, isError } = useQuery<{ lots: OpenFifoLot[] }>({
    queryKey: ["/api/portfolios", portfolioPath, "asset-lots", ticker],
    queryFn: async () => {
      const seg =
        portfolioPath === "all" || portfolioPath === "unassigned"
          ? portfolioPath
          : encodeURIComponent(portfolioPath);
      const res = await fetch(
        `/api/portfolios/${seg}/asset-lots?ticker=${encodeURIComponent(ticker)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("asset-lots");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return <p className="rd-type-body-sm py-1 text-[var(--rd-text-tertiary)]">Načítavam nákupy…</p>;
  }
  if (isError) {
    return <p className="rd-type-body-sm py-1 text-[var(--rd-loss)]">Nákupy sa nepodarilo načítať.</p>;
  }

  const lots = data?.lots ?? [];
  if (lots.length === 0) {
    return <p className="rd-type-body-sm py-1 text-[var(--rd-text-tertiary)]">Žiadne otvorené nákupné dávky.</p>;
  }

  const singleCovers =
    lots.length === 1 &&
    Math.abs(lots[0]!.remainingShares - shares) <= Math.max(1e-4, shares * 1e-2);

  const rows: HoldingLot[] = lots.map((lot) => {
    const ccyRaw = (lot.purchaseCurrency || "EUR").toUpperCase();
    const ccy: QuoteCurrency =
      ccyRaw === "USD" ||
      ccyRaw === "GBP" ||
      ccyRaw === "CZK" ||
      ccyRaw === "PLN" ||
      ccyRaw === "HKD" ||
      ccyRaw === "EUR"
        ? ccyRaw
        : "EUR";
    const openPrice = convertAverageCostPrice(lot.pricePerShareLocal, ccy);
    const investedEur =
      lot.investedAmountEur != null && Number.isFinite(lot.investedAmountEur)
        ? lot.investedAmountEur
        : null;
    const investedFromLot = investedEur != null ? convertPrice(investedEur, "EUR") : null;
    const invested =
      singleCovers && investedDisplay > 0 ? investedDisplay : investedFromLot;
    const lotValue =
      currentPrice > 0 && Number.isFinite(currentPrice) ? lot.remainingShares * currentPrice : null;
    const lotGain = lotValue != null && invested != null ? lotValue - invested : null;
    const lotGainPct =
      lotGain != null && invested != null && Math.abs(invested) > 1e-9
        ? (lotGain / invested) * 100
        : null;
    let dateLabel = lot.acquiredAt;
    try {
      dateLabel = format(parseISO(`${lot.acquiredAt}T12:00:00Z`), "d. M. yyyy", { locale: sk });
    } catch {
      /* keep */
    }
    return {
      date: dateLabel,
      lot: `${formatShareQuantity(lot.remainingShares)} @ ${mask(formatAverageCostCurrency(openPrice))}`,
      returnLabel: lotGainPct != null ? signedPct(lotGainPct) : "—",
      trend: trendFromNumber(lotGainPct ?? 0),
      label: "Nákup",
      tone: "Profit" as const,
    };
  });

  return (
    <>
      {rows.map((lotRow, idx) => (
        <LotRow key={`${lotRow.date}-${lotRow.lot}-${idx}`} {...lotRow} />
      ))}
    </>
  );
}

export default function DashboardMobile() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const {
    currency,
    setCurrency,
    convertPrice,
    convertAverageCostPrice,
    getTickerCurrency,
    resolveHoldingCostCurrency,
    pnlInvestedForDisplay,
    formatCurrency,
    formatAverageCostCurrency,
  } = useCurrency();
  const { getQueryParam, selectedPortfolio, isAllPortfolios, portfolios } = usePortfolio();
  const {
    hideAmounts,
    mobileAssetsSortBy,
    mobileAssetsSortOrder,
    mobileAssetsView,
    showTooltip,
    showChartBenchmark,
    chartBenchmarkId,
    dailyMoversCount,
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
  const [settingsWidgetId, setSettingsWidgetId] = useState<DashboardWidgetId | null>(null);
  const [chartRange, setChartRange] = useState<(typeof CHART_RANGES)[number]["v"]>("all");
  const [sortOpen, setSortOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [draftSortBy, setDraftSortBy] = useState<MobileAssetsSortBy>(mobileAssetsSortBy);
  const [draftSortOrder, setDraftSortOrder] = useState<"asc" | "desc">(mobileAssetsSortOrder);
  const [holdingsLimit, setHoldingsLimit] = useState(10);
  const [expandedHoldingId, setExpandedHoldingId] = useState<string | null>(null);
  const [allocationTab, setAllocationTab] = useState<(typeof ALLOCATION_TABS)[number]["id"]>("positions");

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

  const historyPoints = history?.points ?? [];
  const benchFrom = historyPoints[0]?.date;
  const benchTo = historyPoints[historyPoints.length - 1]?.date;

  const { data: benchmarkHistory } = useQuery<BenchmarkHistoryRes>({
    queryKey: ["/api/benchmark/history", chartBenchmarkId, benchFrom, benchTo],
    enabled:
      showChartBenchmark &&
      !!benchFrom &&
      !!benchTo &&
      historyPoints.length > 1 &&
      (isVisible("chart") || editing),
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({ id: chartBenchmarkId });
      if (benchFrom) params.set("from", benchFrom);
      if (benchTo) params.set("to", benchTo);
      const res = await fetch(`/api/benchmark/history?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("benchmark");
      return res.json();
    },
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
      dailyChange,
      dailyChangePercent: dailyPct,
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

  const usSessionState = getUsMarketSessionState();

  const preOpenPreview = useMemo(() => {
    if (holdings.length === 0) {
      return { available: false, amount: 0, percent: 0 };
    }

    let totalCurrent = 0;
    let totalPreOpen = 0;
    let hasPreOpenData = false;

    for (const holding of holdings) {
      const quote = quotes[holding.ticker];
      if (!quote || !(quote.price > 0)) continue;

      const shares = parseFloat(holding.shares);
      if (!Number.isFinite(shares) || shares <= 0) continue;

      const tickerCurrency = getTickerCurrency(holding.ticker);
      const regularPrice = convertPrice(quote.price, tickerCurrency);
      const showExtended = shouldShowExtendedQuote(
        usSessionState,
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
  }, [holdings, quotes, convertPrice, getTickerCurrency, usSessionState]);

  const enrichedHoldings = useMemo(() => {
    const rows = holdings.map((h) => {
      const quote = quotes[h.ticker];
      const shares = parseFloat(h.shares);
      const cur = getTickerCurrency(h.ticker);
      const invested = pnlInvestedForDisplay(h);
      const rthPrice = quote && quote.price > 0 ? convertPrice(quote.price, cur) : 0;
      const extRaw = quote?.preMarketPrice;
      const extPrice =
        extRaw != null && Number.isFinite(extRaw) && extRaw > 0 ? convertPrice(extRaw, cur) : null;
      const showExtended = shouldShowExtendedQuote(
        usSessionState,
        quote?.marketState,
        quote?.preMarketChangePercent,
      );
      const hasExtPrice = extPrice != null && Number.isFinite(extPrice) && extPrice > 0;
      const showAfterHours =
        showExtended &&
        (hasExtPrice || (quote?.preMarketChangePercent != null && Number.isFinite(quote.preMarketChangePercent)));
      const useExtValuation = shouldUseExtendedQuotes(usSessionState) && hasExtPrice;
      const price = useExtValuation ? (extPrice as number) : rthPrice;
      const value =
        price > 0
          ? shares * price
          : convertPrice(parseFloat(h.totalInvested), resolveHoldingCostCurrency(h));
      const gain = value - invested;
      const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
      const dayPct = showExtended
        ? (quote?.preMarketChangePercent ?? quote?.changePercent ?? 0)
        : (quote?.changePercent ?? 0);
      const dayTrendSource = showExtended
        ? (quote?.preMarketChange ?? quote?.preMarketChangePercent ?? 0)
        : (quote?.change ?? quote?.changePercent ?? 0);
      const avg = convertPrice(parseFloat(h.averageCost || "0"), resolveHoldingCostCurrency(h));
      const afterHoursTrend: DeltaTrend = trendFromNumber(
        quote?.preMarketChange ?? quote?.preMarketChangePercent ?? 0,
      );
      return {
        holding: h,
        value,
        gain,
        gainPct,
        dayPct,
        dayTrendSource,
        avg,
        price: rthPrice,
        valuationPrice: price,
        shares,
        invested,
        showAfterHours,
        afterHoursPrice: showAfterHours && hasExtPrice ? extPrice : null,
        afterHoursPct: showAfterHours ? (quote?.preMarketChangePercent ?? null) : null,
        afterHoursTrend,
      };
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
    usSessionState,
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
      .map((r) => {
        const q = quotes[r.holding.ticker];
        const cur = getTickerCurrency(r.holding.ticker);
        const ch = r.showAfterHours ? (q?.preMarketChange ?? 0) : (q?.change ?? 0);
        return {
          ticker: r.holding.ticker,
          pct: r.dayPct,
          amount: r.shares * convertPrice(ch, cur),
          showMoon: r.showAfterHours,
        };
      });
    const gainers = [...list].sort((a, b) => b.pct - a.pct).slice(0, dailyMoversCount);
    const losers = [...list].sort((a, b) => a.pct - b.pct).slice(0, dailyMoversCount);
    return { gainers, losers };
  }, [enrichedHoldings, quotes, convertPrice, getTickerCurrency, dailyMoversCount]);

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
        name: holdingName(r.holding),
        imageUrl: r.holding.tcgImageUrl,
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

  const chartPoints = historyPoints;
  const showBenchLine =
    showChartBenchmark && !!benchmarkHistory?.points?.length && chartPoints.length > 1;

  const chartSeries = useMemo(() => {
    if (chartPoints.length === 0) return [];
    const dates = chartPoints.map((p) => p.date);
    const values = chartPoints.map((p) => p.totalValue);
    const invested = chartPoints.map((p) => p.netInvested);

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
          totalValue: values[i]!,
          netInvested: invested[i]!,
          portfolioPct: comparison.points[i]!.portfolioPct,
          benchmarkPct: comparison.points[i]!.benchmarkPct,
        };
      });
    }

    return chartPoints.map((p) => ({
      date: p.date,
      totalValue: p.totalValue,
      netInvested: p.netInvested,
      portfolioPct: 0,
      benchmarkPct: null as number | null,
    }));
  }, [chartPoints, showBenchLine, benchmarkHistory?.points]);

  const chartProfit =
    chartSeries.length > 0
      ? showBenchLine
        ? (chartSeries[chartSeries.length - 1]!.portfolioPct ?? 0) >= 0
        : chartSeries[chartSeries.length - 1]!.totalValue >= chartSeries[chartSeries.length - 1]!.netInvested
      : metrics.totalProfit >= 0;

  const benchLabel = chartBenchmarkLabel(chartBenchmarkId);
  const benchColor = chartBenchmarkStroke("dark");
  const benchPeriodReturn = useMemo(() => {
    if (!showBenchLine || chartSeries.length === 0) return null;
    for (let i = chartSeries.length - 1; i >= 0; i -= 1) {
      const pct = chartSeries[i]!.benchmarkPct;
      if (pct != null && Number.isFinite(pct)) return pct;
    }
    return null;
  }, [chartSeries, showBenchLine]);

  const renderWidget = (id: DashboardWidgetId) => {
    if (!editing && !isVisible(id)) return null;

    const frame = (
      body: ReactNode,
      opts?: { skipChrome?: boolean; chromeId?: DashboardWidgetId; chromeLabel?: string },
    ) => {
      const chromeId = opts?.chromeId ?? id;
      const hasSettings = DASHBOARD_WIDGETS_WITH_SETTINGS.has(chromeId);
      return (
        <div key={id} className="relative">
          {editing && !opts?.skipChrome ? (
            <div className="mb-2 flex items-center gap-2">
              <p className="min-w-0 flex-1 text-xs font-medium text-[var(--rd-text-secondary)]">
                {opts?.chromeLabel ?? DASHBOARD_WIDGET_META[chromeId].label}
              </p>
              {hasSettings ? (
                <button
                  type="button"
                  aria-label={`Nastavenia: ${DASHBOARD_WIDGET_META[chromeId].label}`}
                  className="inline-flex size-[30px] items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]"
                  onClick={() => setSettingsWidgetId(chromeId)}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              ) : null}
              {!DASHBOARD_WIDGET_META[chromeId].required ? (
                <button
                  type="button"
                  aria-label={visible[chromeId] ? "Skryť" : "Zobraziť"}
                  className="inline-flex size-[30px] items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)]"
                  onClick={() => toggleVisible(chromeId)}
                >
                  {visible[chromeId] ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4 text-[var(--rd-text-tertiary)]" />
                  )}
                </button>
              ) : null}
            </div>
          ) : null}
          <div
            className={
              editing && !opts?.skipChrome && !visible[chromeId] && !DASHBOARD_WIDGET_META[chromeId].required
                ? "opacity-40"
                : undefined
            }
          >
            {body}
          </div>
        </div>
      );
    };

    switch (id) {
      case "summary": {
        const periodLabel =
          chartRange === "all"
            ? "Za celé obdobie"
            : `Za ${CHART_RANGES.find((r) => r.v === chartRange)?.label ?? chartRange}`;
        const showExtendedRow = shouldUseExtendedQuotes(usSessionState);
        return frame(
          <Card className="gap-2">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 text-left"
              onClick={() => setPickerOpen(true)}
            >
              <PortfolioMark isAll={isAllPortfolios} brokerCode={selectedPortfolio?.brokerCode} />
              <p className="min-w-0 flex-1 truncate rd-type-h2 text-[var(--rd-text-primary)]">{overline}</p>
            </button>

            <div className="flex items-center gap-1.5">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Celková hodnota</p>
              <span className="[&_button]:size-3.5 [&_svg]:size-3.5">
                <HelpButton
                  title="Celková hodnota"
                  body="Súčet aktuálnej trhovej hodnoty všetkých pozícií vrátane hotovosti."
                />
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  aria-label={hideAmounts ? "Zobraziť sumy" : "Skryť sumy"}
                  className="inline-flex text-[var(--rd-text-secondary)]"
                  onClick={() => toggleHideAmounts()}
                >
                  {hideAmounts ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 rd-type-display-hero tracking-tight">
                {mask(formatCurrency(metrics.totalValue))}
              </p>
              <button
                type="button"
                aria-label="Obnoviť kotácie"
                className="inline-flex shrink-0 text-[var(--rd-text-secondary)]"
                onClick={() => void refreshQuotes()}
              >
                <RefreshCw className={cn("size-[18px]", quotesFetching && "animate-spin")} />
              </button>
              <button
                type="button"
                aria-label="Prepnúť menu"
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] px-1.5"
                onClick={() => setCurrency(currency === "EUR" ? "USD" : "EUR")}
              >
                <span className="rd-type-data-sm text-[var(--rd-text-secondary)]">{currency}</span>
                <ArrowLeftRight className="size-3 text-[var(--rd-text-tertiary)]" />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <MetricRow
                label="Celkový profit"
                amount={mask(signedMoney(formatCurrency, metrics.totalProfit))}
                amountTone={toneOf(metrics.totalProfit)}
                pct={signedPct(metrics.totalProfitPercent)}
                pctTrend={trendFromNumber(metrics.totalProfitPercent)}
              />
              <MetricRow
                label="Denná zmena"
                amount={mask(signedMoney(formatCurrency, metrics.dailyChange))}
                amountTone={toneOf(metrics.dailyChange)}
                pct={signedPct(metrics.dailyChangePercent)}
                pctTrend={trendFromNumber(metrics.dailyChangePercent)}
              />
              <MetricRow
                label="Nerealizovaný zisk"
                amount={mask(signedMoney(formatCurrency, metrics.unrealized))}
                amountTone={toneOf(metrics.unrealized)}
              />
              <MetricRow label="Hotovosť" amount={mask(formatCurrency(metrics.cashValue))} />
              {showExtendedRow ? (
                <MetricRow
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Moon className="size-[11px] text-[var(--rd-warning)]" aria-hidden />
                      {extendedSessionShortLabel(usSessionState)}
                    </span>
                  }
                  amount={
                    preOpenPreview.available
                      ? mask(signedMoney(formatCurrency, preOpenPreview.amount))
                      : "bez dát"
                  }
                  amountTone={preOpenPreview.available ? toneOf(preOpenPreview.amount) : "neutral"}
                  pct={preOpenPreview.available ? signedPct(preOpenPreview.percent) : undefined}
                  pctTrend={
                    preOpenPreview.available ? trendFromNumber(preOpenPreview.percent) : undefined
                  }
                />
              ) : null}
            </div>

            {isVisible("chart") || editing ? (
              <div className={cn("flex flex-col gap-2", editing && !isVisible("chart") ? "opacity-40" : undefined)}>
                {editing ? (
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 text-xs font-medium text-[var(--rd-text-secondary)]">
                      {DASHBOARD_WIDGET_META.chart.label}
                    </p>
                    <button
                      type="button"
                      aria-label="Nastavenia: Graf"
                      className="inline-flex size-[30px] items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]"
                      onClick={() => setSettingsWidgetId("chart")}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={isVisible("chart") ? "Skryť graf" : "Zobraziť graf"}
                      className="inline-flex size-[30px] items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)]"
                      onClick={() => toggleVisible("chart")}
                    >
                      {isVisible("chart") ? (
                        <Eye className="size-4" />
                      ) : (
                        <EyeOff className="size-4 text-[var(--rd-text-tertiary)]" />
                      )}
                    </button>
                  </div>
                ) : null}
                {showBenchLine && benchPeriodReturn != null ? (
                  <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                    <span style={{ color: benchColor }}>{benchLabel}</span>
                    {" "}
                    <span className="rd-type-data-sm" style={{ color: benchColor }}>
                      {benchPeriodReturn >= 0 ? "+" : ""}
                      {benchPeriodReturn.toFixed(1)}%
                    </span>
                  </p>
                ) : null}
                <div className="h-[120px] w-full">
                  {chartSeries.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartSeries}>
                        <defs>
                          <linearGradient id="rd-dash-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="0%"
                              stopColor={chartProfit ? "var(--rd-profit)" : "var(--rd-loss)"}
                              stopOpacity={0.26}
                            />
                            <stop
                              offset="100%"
                              stopColor={chartProfit ? "var(--rd-profit)" : "var(--rd-loss)"}
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide />
                        <YAxis hide domain={["dataMin", "dataMax"]} />
                        {showTooltip ? (
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
                            formatter={(value: number, name: string) => {
                              if (showBenchLine) {
                                const label = name === "benchmarkPct" ? benchLabel : "Portfólio";
                                return [`${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, label];
                              }
                              return [mask(formatCurrency(value)), "Hodnota"];
                            }}
                          />
                        ) : null}
                        {showBenchLine ? (
                          <>
                            <Area
                              type="monotone"
                              dataKey="portfolioPct"
                              stroke={chartProfit ? "var(--rd-profit)" : "var(--rd-loss)"}
                              fill="url(#rd-dash-fill)"
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="benchmarkPct"
                              stroke={benchColor}
                              strokeWidth={2}
                              dot={false}
                              connectNulls
                            />
                          </>
                        ) : (
                          <Area
                            type="monotone"
                            dataKey="totalValue"
                            stroke={chartProfit ? "var(--rd-profit)" : "var(--rd-loss)"}
                            fill="url(#rd-dash-fill)"
                            strokeWidth={2}
                            dot={false}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-[var(--rd-text-tertiary)]">
                      Graf sa načítava…
                    </div>
                  )}
                </div>
                <MetricRow
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="size-[18px] text-[var(--rd-text-tertiary)]" aria-hidden />
                      {periodLabel}
                    </span>
                  }
                  amount={mask(signedMoney(formatCurrency, metrics.totalProfit))}
                  amountTone={toneOf(metrics.totalProfit)}
                  pct={signedPct(metrics.totalProfitPercent)}
                  pctTrend={trendFromNumber(metrics.totalProfitPercent)}
                />
                <div className="flex items-center justify-between gap-0.5">
                  {CHART_RANGES.map((r) => (
                    <Chip key={r.v} active={chartRange === r.v} onClick={() => setChartRange(r.v)}>
                      {r.label}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>,
        );
      }

      case "chart":
        return null;

      case "realizedDividends":
        return frame(
          <div className="flex gap-2">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setLocation("/profit")}>
              <StatTile
                label="Realizovaný zisk"
                value={mask(formatCurrency(metrics.stockRealized))}
                tone={metrics.stockRealized >= 0 ? "Up" : "Down"}
                sub={
                  <span className="inline-flex items-center gap-1">
                    <CircleHelp className="size-3" aria-hidden />
                    info
                  </span>
                }
              />
            </button>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setLocation("/dividends")}>
              <StatTile
                label="Dividendy (spolu)"
                value={mask(signedMoney(formatCurrency, metrics.dividendGain))}
                tone="Up"
                sub={
                  <span className="inline-flex items-center gap-0.5">
                    Detail
                    <ChevronRight className="size-3.5" aria-hidden />
                  </span>
                }
              />
            </button>
          </div>,
        );

      case "ytdBenchmark": {
        const barMax = ytd ? Math.max(Math.abs(ytd.portfolio), Math.abs(ytd.sp500), 1) : 1;
        return frame(
          <Card className="gap-2">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2 text-[var(--rd-text-primary)]">YTD vs S&P 500</p>
              {ytd ? (
                <Badge
                  label={`Alpha ${signedPct(ytd.alpha)}`}
                  tone={ytd.alpha >= 0 ? "Profit" : "Loss"}
                />
              ) : null}
            </div>
            {ytd ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 rd-type-body-sm text-[var(--rd-text-secondary)]">
                      Moje YTD
                    </span>
                    <span
                      className={cn(
                        "rd-type-data shrink-0",
                        ytd.portfolio >= 0 ? "text-[var(--rd-profit)]" : "text-[var(--rd-loss)]",
                      )}
                    >
                      {signedPct(ytd.portfolio)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--rd-bg-surface-hover)]">
                    <div
                      className="h-full rounded-full bg-[var(--rd-profit)]"
                      style={{
                        width: `${Math.min(100, (Math.abs(ytd.portfolio) / barMax) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 rd-type-body-sm text-[var(--rd-text-secondary)]">
                      S&P 500 YTD
                    </span>
                    <span className="rd-type-data shrink-0 text-[var(--rd-chart-benchmark)]">
                      {signedPct(ytd.sp500)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--rd-bg-surface-hover)]">
                    <div
                      className="h-full rounded-full bg-[var(--rd-chart-benchmark)]"
                      style={{
                        width: `${Math.min(100, (Math.abs(ytd.sp500) / barMax) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">YTD porovnanie sa načítava…</p>
            )}
          </Card>,
        );
      }

      case "earnings":
      case "topPosition":
      case "macroEvent":
        return frame(
          <div className="flex flex-col gap-2">
            {(editing || isVisible("earnings")) ? (
              <div
                className={`flex min-h-9 items-center gap-3 rounded-[var(--rd-radius-md)] border border-[color:color-mix(in_srgb,var(--rd-warning)_35%,transparent)] bg-[var(--rd-warning-dim)] px-3 ${
                  editing && !isVisible("earnings") ? "opacity-40" : ""
                }`}
              >
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
                  <span className="rd-type-overline shrink-0 text-[var(--rd-warning)]">Earnings</span>
                )}
                <p className="rd-type-data min-w-0 flex-1 truncate text-[var(--rd-text-primary)]">
                  {earnings[0]?.ticker || "—"}
                </p>
                <p className="rd-type-data-sm shrink-0 text-[var(--rd-text-primary)]">
                  {earnings[0]?.date
                    ? format(new Date(earnings[0].date), "d. MMM yyyy", { locale: sk })
                    : "Žiadne nadchádzajúce"}
                </p>
              </div>
            ) : null}
            {(editing || (isVisible("topPosition") && topPosition)) ? (
              <div
                className={`flex min-h-9 items-center gap-3 rounded-[var(--rd-radius-md)] border border-[color:color-mix(in_srgb,var(--rd-profit)_35%,transparent)] bg-[var(--rd-profit-dim)] px-3 ${
                  editing && !isVisible("topPosition") ? "opacity-40" : ""
                }`}
              >
                {editing ? (
                  <button
                    type="button"
                    aria-label="Pozícia"
                    className="inline-flex size-8 items-center justify-center"
                    onClick={() => toggleVisible("topPosition")}
                  >
                    {isVisible("topPosition") ? <Eye className="size-4" /> : <EyeOff className="size-4 text-[var(--rd-text-tertiary)]" />}
                  </button>
                ) : (
                  <span className="rd-type-overline shrink-0 text-[var(--rd-profit)]">Pozícia</span>
                )}
                <p className="rd-type-data min-w-0 flex-1 truncate text-[var(--rd-text-primary)]">
                  {topPosition?.ticker || "—"}
                </p>
                <p className="rd-type-data-sm shrink-0 text-[var(--rd-text-primary)]">
                  {topPosition ? `${topPosition.pct.toFixed(2)}%` : "—"}
                </p>
              </div>
            ) : null}
            {(editing || isVisible("macroEvent")) ? (
              <div
                className={`flex min-h-9 items-center gap-3 rounded-[var(--rd-radius-md)] border border-[color:color-mix(in_srgb,var(--rd-info)_35%,transparent)] bg-[var(--rd-info-dim)] px-3 ${
                  editing && !isVisible("macroEvent") ? "opacity-40" : ""
                }`}
              >
                {editing ? (
                  <button
                    type="button"
                    aria-label="Udalosť"
                    className="inline-flex size-8 items-center justify-center"
                    onClick={() => toggleVisible("macroEvent")}
                  >
                    {isVisible("macroEvent") ? <Eye className="size-4" /> : <EyeOff className="size-4 text-[var(--rd-text-tertiary)]" />}
                  </button>
                ) : (
                  <span className="rd-type-overline shrink-0 text-[var(--rd-info)]">Udalosť</span>
                )}
                <p className="rd-type-body-strong min-w-0 flex-1 truncate text-[var(--rd-text-primary)]">
                  {macro[0]?.title || "—"}
                </p>
                <p className="rd-type-data-sm shrink-0 text-[var(--rd-text-primary)]">
                  {macro[0]?.date
                    ? format(new Date(macro[0].date), "d. MMM yyyy", { locale: sk })
                    : "Bez najbližšej udalosti"}
                </p>
              </div>
            ) : null}
          </div>,
          { skipChrome: true },
        );

      case "dailyGainers": {
        const marketClosedBadge = shouldUseExtendedQuotes(usSessionState);
        const renderMoverCol = (
          title: string,
          rows: typeof movers.gainers,
          trend: "Up" | "Down",
          visibleId: "dailyGainers" | "dailyLosers",
        ) => (
          <div className={cn("min-w-0 flex-1", editing && !isVisible(visibleId) ? "opacity-40" : undefined)}>
            <div className="mb-2 flex items-center gap-1.5">
              {editing ? (
                <button
                  type="button"
                  aria-label={title}
                  className="inline-flex size-4 items-center justify-center"
                  onClick={() => toggleVisible(visibleId)}
                >
                  {isVisible(visibleId) ? (
                    <Eye className="size-3.5" />
                  ) : (
                    <EyeOff className="size-3.5 text-[var(--rd-text-tertiary)]" />
                  )}
                </button>
              ) : trend === "Up" ? (
                <TrendingUp className="size-4 text-[var(--rd-profit)]" aria-hidden />
              ) : (
                <TrendingDown className="size-4 text-[var(--rd-loss)]" aria-hidden />
              )}
              <p className="min-w-0 flex-1 rd-type-body-strong text-[var(--rd-text-primary)]">{title}</p>
              {marketClosedBadge ? (
                <span className="inline-flex items-center rounded-full bg-[var(--rd-warning-dim)] px-1.5 py-0.5">
                  <Moon className="size-2.5 text-[var(--rd-warning)]" aria-hidden />
                </span>
              ) : null}
              <span className="[&_button]:size-4 [&_svg]:size-3.5">
                <HelpButton
                  title={title}
                  body="Poradie podľa dennej zmeny. Mimo RTH sa berie pred/po-obchodná kotácia, ak je dostupná."
                />
              </span>
            </div>
            {(editing || isVisible(visibleId)) && rows.length === 0 ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">—</p>
            ) : null}
            {(editing || isVisible(visibleId) ? rows : []).map((m, i) => (
              <button
                key={m.ticker}
                type="button"
                className="flex w-full items-center gap-1.5 py-1 text-left"
                onClick={() => setLocation(`/asset/${encodeURIComponent(m.ticker)}`)}
              >
                <span className="w-3.5 shrink-0 rd-type-data-micro text-[var(--rd-text-tertiary)]">
                  {i + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate rd-type-body-strong text-[var(--rd-text-primary)]">
                  {m.ticker}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 rd-type-data-sm",
                      trend === "Up" ? "text-[var(--rd-profit)]" : "text-[var(--rd-loss)]",
                    )}
                  >
                    {m.showMoon ? (
                      <Moon className="size-2.5 text-[var(--rd-warning)]" aria-hidden />
                    ) : null}
                    {signedPct(m.pct)}
                  </span>
                  <span className="rd-type-data-micro text-[var(--rd-text-tertiary)]">
                    {mask(signedMoney(formatCurrency, m.amount))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        );
        return frame(
          <Card className="gap-2">
            <div>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <SectionHeader title="Denné pohyby" />
                </div>
                {editing ? (
                  <button
                    type="button"
                    aria-label="Nastavenia: Denné pohyby"
                    className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]"
                    onClick={() => setSettingsWidgetId("dailyGainers")}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                ) : null}
              </div>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Zmena podľa režimu trhu (RTH vs pre/post market).
              </p>
            </div>
            <div className="flex gap-2">
              {renderMoverCol("Najlepšie", movers.gainers, "Up", "dailyGainers")}
              <div className="w-px shrink-0 self-stretch bg-[var(--rd-border-subtle)]" />
              {renderMoverCol("Najhoršie", movers.losers, "Down", "dailyLosers")}
            </div>
          </Card>,
          { skipChrome: true },
        );
      }

      case "dailyLosers":
        return null;

      case "holdings":
        return frame(
          <Card className="gap-1.5 p-3">
            <div className="flex flex-col gap-0.5">
              <SectionHeader title="Prehľad aktív" />
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Vaše aktuálne držané akcie ({currency})
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="inline-flex h-[28px] items-center gap-1.5 rounded-full border border-[var(--rd-border-strong)] [background-image:var(--rd-bg-surface-gradient)] px-2 text-[12px] font-medium leading-4 text-[var(--rd-text-primary)]"
                onClick={() => setViewOpen(true)}
              >
                <LayoutList className="size-3.5" />
                Zobrazenie
              </button>
              <button
                type="button"
                className="inline-flex h-[28px] items-center gap-1.5 rounded-full border border-[var(--rd-border-strong)] [background-image:var(--rd-bg-surface-gradient)] px-2 text-[12px] font-medium leading-4 text-[var(--rd-text-primary)]"
                onClick={() => {
                  setDraftSortBy(mobileAssetsSortBy);
                  setDraftSortOrder(mobileAssetsSortOrder);
                  setSortOpen(true);
                }}
              >
                <ArrowDownUp className="size-3.5" />
                Zoradiť
              </button>
            </div>
            {holdingsLoading ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
            ) : enrichedHoldings.length === 0 ? (
              <EmptyState title="Žiadne pozície" body="Importuj transakcie alebo pridaj nákup v Histórii." />
            ) : (
              <div className="flex flex-col">
                {enrichedHoldings.slice(0, holdingsLimit).map((row, index) => {
                  const h = row.holding;
                  const rowKey = h.id || h.ticker;
                  const afterHoursPrice =
                    row.showAfterHours && row.afterHoursPrice != null
                      ? mask(formatCurrency(row.afterHoursPrice))
                      : undefined;
                  const afterHoursChange =
                    row.showAfterHours && row.afterHoursPct != null
                      ? signedPct(row.afterHoursPct)
                      : undefined;
                  const lotsPath = isAllPortfolios
                    ? "all"
                    : h.portfolioId
                      ? h.portfolioId
                      : "unassigned";
                  const expandable = canExpandLots(h);
                  const expanded = expandable && expandedHoldingId === rowKey;
                  const lotsSlot = expanded ? (
                    <SimpleLotsPanel
                      portfolioPath={lotsPath}
                      ticker={h.ticker}
                      shares={row.shares}
                      currentPrice={row.valuationPrice}
                      investedDisplay={row.invested}
                      mask={mask}
                      formatAverageCostCurrency={formatAverageCostCurrency}
                      convertPrice={convertPrice}
                      convertAverageCostPrice={convertAverageCostPrice}
                    />
                  ) : null;
                  return (
                    <div key={rowKey}>
                      {index > 0 ? <div className="h-px w-full bg-[var(--rd-border-subtle)]" /> : null}
                      {mobileAssetsView === "simple" ? (
                        <HoldingRowSimple
                          ticker={h.ticker}
                          name={holdingName(h)}
                          assetType={simpleBadge(h)}
                          value={mask(formatCurrency(row.value))}
                          lot={`${formatShareQuantity(row.shares)} @ ${mask(formatAverageCostCurrency(row.avg))}`}
                          dayChange={signedPct(row.dayPct)}
                          dayTrend={trendFromNumber(row.dayTrendSource)}
                          pl={`${mask(signedMoney(formatCurrency, row.gain))} (${signedPct(row.gainPct)})`}
                          plTrend={trendFromNumber(row.gain)}
                          imageUrl={h.tcgImageUrl}
                          expandable={expandable}
                          expanded={expanded}
                          onToggle={
                            expandable
                              ? () => setExpandedHoldingId((cur) => (cur === rowKey ? null : rowKey))
                              : undefined
                          }
                          onNameClick={() => setLocation(`/asset/${encodeURIComponent(h.ticker)}`)}
                          afterHoursPrice={afterHoursPrice}
                          afterHoursChange={afterHoursChange}
                          afterHoursTrend={row.afterHoursTrend}
                          lotsSlot={lotsSlot}
                        />
                      ) : (
                        <HoldingRowExpandable
                          ticker={h.ticker}
                          name={holdingName(h)}
                          qty={`${formatShareQuantity(row.shares)} ks`}
                          value={mask(formatCurrency(row.value))}
                          delta={signedPct(row.gainPct)}
                          trend={trendFromNumber(row.gainPct)}
                          avg={mask(formatAverageCostCurrency(row.avg))}
                          price={mask(formatCurrency(row.price))}
                          pl={mask(signedMoney(formatCurrency, row.gain))}
                          plTrend={trendFromNumber(row.gain)}
                          imageUrl={h.tcgImageUrl}
                          expanded={expanded}
                          onToggle={
                            expandable
                              ? () => setExpandedHoldingId((cur) => (cur === rowKey ? null : rowKey))
                              : undefined
                          }
                          onTickerClick={() => setLocation(`/asset/${encodeURIComponent(h.ticker)}`)}
                          afterHoursPrice={afterHoursPrice}
                          afterHoursChange={afterHoursChange}
                          afterHoursTrend={row.afterHoursTrend}
                          lotsSlot={lotsSlot}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {enrichedHoldings.length > holdingsLimit ? (
              <Button
                variant="Secondary"
                className="w-full"
                onClick={() => setHoldingsLimit((n) => n + 12)}
              >
                Viac · ďalších {enrichedHoldings.length - holdingsLimit}
              </Button>
            ) : null}
          </Card>,
        );

      case "allocation": {
        const topPct = allocation.reduce((s, a) => s + a.pct, 0);
        const otherPct = Math.max(0, 100 - topPct);
        const slices =
          allocation.length === 0
            ? []
            : [
                ...allocation.map((a, i) => ({
                  key: a.ticker,
                  label: a.ticker,
                  pct: a.pct,
                  color: CHART_COLORS[i % CHART_COLORS.length]!,
                })),
                ...(otherPct > 0.05
                  ? [
                      {
                        key: "other",
                        label: "Ostatné",
                        pct: otherPct,
                        color: CHART_COLORS[5] ?? "var(--rd-chart-6)",
                      },
                    ]
                  : []),
              ];
        let cursor = 0;
        const conic = slices
          .map((s) => {
            const start = cursor;
            cursor += s.pct;
            return `${s.color} ${start}% ${cursor}%`;
          })
          .join(", ");
        return frame(
          <Card className="gap-2">
            <SectionHeader title="Alokácia" action="Viac" onAction={() => setLocation("/allocation")} />
            <div className="flex flex-wrap gap-1">
              {ALLOCATION_TABS.map((tab) => (
                <Chip
                  key={tab.id}
                  active={allocationTab === tab.id}
                  onClick={() => {
                    if (tab.id === "positions") {
                      setAllocationTab(tab.id);
                      return;
                    }
                    setLocation("/allocation");
                  }}
                >
                  {tab.label}
                </Chip>
              ))}
            </div>
            {slices.length === 0 ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Bez alokácie</p>
            ) : (
              <div className="flex items-center gap-3">
                <div
                  className="relative size-[116px] shrink-0 rounded-full"
                  style={{
                    background: `conic-gradient(${conic || "var(--rd-border-subtle) 0 100%"})`,
                  }}
                  aria-hidden
                >
                  <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-[var(--rd-bg-surface)]">
                    <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Celkom</p>
                    <p className="rd-type-data-sm text-[var(--rd-text-primary)]">
                      {mask(formatCurrency(metrics.stockValue))}
                    </p>
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {slices.map((s) => (
                    <div key={s.key} className="flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: s.color }}
                        aria-hidden
                      />
                      <p className="min-w-0 flex-1 truncate rd-type-body-sm text-[var(--rd-text-secondary)]">
                        {s.label}
                      </p>
                      <p className="rd-type-data-sm shrink-0 text-[var(--rd-text-primary)]">
                        {s.pct.toFixed(1)}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>,
        );
      }

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
            <p className="rd-type-overline text-[var(--rd-text-tertiary)]">
              Režim úprav
            </p>
            <h1 className="rd-type-h1">Úprava prehľadu</h1>
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
            <button
              type="button"
              aria-label="Upraviť prehľad"
              className="inline-flex size-[30px] items-center justify-center text-[var(--rd-text-secondary)]"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-[18px]" />
            </button>
          }
        />
      )}

      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />

      <PageBody>
        {editing ? (
          <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
            Oko skryje/zobrazí widget. Trojbodkové menu otvorí nastavenia (napr. porovnanie s indexom).
          </p>
        ) : null}
        {widgets}
      </PageBody>

      <DashboardWidgetSettingsDialog
        widgetId={settingsWidgetId}
        onClose={() => setSettingsWidgetId(null)}
      />

      <Dialog
        open={sortOpen}
        title="Zoradiť podľa"
        body="Vyberte kritérium a poradie zoradenia zoznamu aktív na mobile."
        onClose={() => setSortOpen(false)}
        showHelpIcon={false}
      >
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            {(
              [
                ["name", "Názov"],
                ["value", "Hodnota"],
                ["netProfit", "Čistý zisk"],
                ["gainPercent", "% zhodnotenia"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="flex min-h-[40px] w-full items-center gap-3 text-left"
                onClick={() => setDraftSortBy(value)}
              >
                <span
                  className={cn(
                    "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                    draftSortBy === value
                      ? "border-[var(--rd-profit)] bg-[var(--rd-profit)]"
                      : "border-[var(--rd-border-strong)]",
                  )}
                  aria-hidden
                >
                  {draftSortBy === value ? (
                    <span className="size-1.5 rounded-full bg-[var(--rd-text-on-brand)]" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    "rd-type-body",
                    draftSortBy === value
                      ? "text-[var(--rd-text-primary)]"
                      : "text-[var(--rd-text-secondary)]",
                  )}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
          <div className="h-px bg-[var(--rd-border-subtle)]" />
          <div className="flex flex-col gap-2">
            <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Poradie</p>
            <div className="flex gap-4">
              {(
                [
                  ["asc", "Vzostupne"],
                  ["desc", "Zostupne"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="inline-flex items-center gap-2"
                  onClick={() => setDraftSortOrder(value)}
                >
                  <span
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                      draftSortOrder === value
                        ? "border-[var(--rd-profit)] bg-[var(--rd-profit)]"
                        : "border-[var(--rd-border-strong)]",
                    )}
                    aria-hidden
                  >
                    {draftSortOrder === value ? (
                      <span className="size-1.5 rounded-full bg-[var(--rd-text-on-brand)]" />
                    ) : null}
                  </span>
                  <span className="rd-type-body text-[var(--rd-text-primary)]">{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="Secondary" className="flex-1" onClick={() => setSortOpen(false)}>
              Zrušiť
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                setMobileAssetsSortBy(draftSortBy);
                setMobileAssetsSortOrder(draftSortOrder);
                setSortOpen(false);
              }}
            >
              Použiť
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={viewOpen} title="Zobrazenie" onClose={() => setViewOpen(false)} showHelpIcon={false}>
        <div className="mt-3 flex flex-col gap-1">
          {(
            [
              ["detailed", "Podrobné"],
              ["simple", "Jednoduché"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="flex min-h-[40px] w-full items-center gap-3 text-left"
              onClick={() => {
                setMobileAssetsView(value);
                setViewOpen(false);
              }}
            >
              <span
                className={cn(
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                  mobileAssetsView === value
                    ? "border-[var(--rd-profit)] bg-[var(--rd-profit)]"
                    : "border-[var(--rd-border-strong)]",
                )}
                aria-hidden
              >
                {mobileAssetsView === value ? (
                  <span className="size-1.5 rounded-full bg-[var(--rd-text-on-brand)]" />
                ) : null}
              </span>
              <span
                className={cn(
                  "rd-type-body",
                  mobileAssetsView === value
                    ? "text-[var(--rd-text-primary)]"
                    : "text-[var(--rd-text-secondary)]",
                )}
              >
                {label}
              </span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
