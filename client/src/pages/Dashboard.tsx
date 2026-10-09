import { Fragment, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { format, parse, parseISO, startOfDay } from "date-fns";
import { sk } from "date-fns/locale";
import { queryClient } from "@/lib/queryClient";
import { fetchUpcomingEnvelope } from "@/lib/upcomingEvents";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Wallet,
  Banknote,
  Newspaper,
  ExternalLink,
  HelpCircle,
  Loader2,
  RefreshCw,
  Moon,
  Calendar,
  ChevronDown,
  ChevronRight,
  LayoutList,
  ArrowDownUp,
  Sparkles,
} from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio, type Portfolio } from "@/hooks/usePortfolio";
import { useChartSettings, type MobileAssetsSortBy, type MobileAssetsView } from "@/hooks/useChartSettings";
import {
  detectAnalystRatingPopupChanges,
  type AnalystRatingUpdateRow,
} from "@/lib/analystRatingSeen";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileRedesign } from "@/hooks/useMobileUi";
import DashboardMobile from "@/pages/redesign/DashboardMobile";
import { CompanyLogo } from "@/components/CompanyLogo";
import { AssetThumb } from "@/components/AssetThumb";
import { BrokerLogo } from "@/components/BrokerLogo";
import { MobilePortfolioChart } from "@/components/MobilePortfolioChart";
import { DesktopPortfolioChart } from "@/components/DesktopPortfolioChart";
import { DashboardAllocationWidget } from "@/components/DashboardAllocationWidget";
import { DashboardAiMacroAuditWidget } from "@/components/DashboardAiMacroAuditWidget";
import { DashboardWidgetFrame } from "@/components/DashboardWidgetFrame";
import type { HoldingWithCostCurrency } from "@shared/holdingCostCurrency";
import { isPhysicalSilverTicker } from "@shared/physicalMetal";
import {
  isPokemonGroupTicker,
  isPokemonHolding,
  isPokemonTicker,
  isSealedPokemonHolding,
  POKEMON_GROUP_TICKER,
  pokemonCategoryLabel,
} from "@shared/pokemonTcg";
import { CASH_INTEREST_DISPLAY_NAME, CASH_INTEREST_TICKER } from "@shared/tickerCurrency";
import {
  getExtendedSessionLabel,
  getQuoteRefreshIntervalMs,
  getQuoteStaleTimeMs,
  getUsMarketSessionState,
  shouldShowExtendedQuote,
  shouldUseExtendedQuotes,
} from "@/lib/usMarketSession";
import { formatShareQuantity } from "@/lib/utils";

/** Krátky typ v mobile „jednoduché“ zobrazení (badge ako XTB). */
function mobileSimpleAssetBadgeLabel(holding: HoldingWithCostCurrency): string {
  const t = holding.ticker.toUpperCase();
  if (t === CASH_INTEREST_TICKER) return "Hotovosť";
  if (isPhysicalSilverTicker(t)) return "Striebro";
  if (isPokemonGroupTicker(t)) return "Pokémon";
  if (isPokemonTicker(t)) return pokemonCategoryLabel(holding.tcgCategory);
  const name = (holding.companyName || "").toLowerCase();
  if (/\betf\b/.test(name) || /\betc\b/.test(name) || /\betf\b/.test(t)) return "ETF";
  return "Akcie";
}

function mobileSimpleAssetDisplayName(holding: HoldingWithCostCurrency): string {
  if (holding.ticker.toUpperCase() === CASH_INTEREST_TICKER) return CASH_INTEREST_DISPLAY_NAME;
  return (holding.companyName || holding.ticker).trim() || holding.ticker;
}

function HoldingMark({ holding, size }: { holding: HoldingWithCostCurrency; size: "sm" | "md" }) {
  if (isPokemonGroupTicker(holding.ticker)) {
    return <BrokerLogo brokerCode="pokemon" size={size === "md" ? "sm" : "xs"} />;
  }
  if (isPokemonTicker(holding.ticker) && holding.tcgImageUrl) {
    return <AssetThumb src={holding.tcgImageUrl} alt={holding.companyName || "Pokémon"} size={size} />;
  }
  return (
    <CompanyLogo
      ticker={holding.ticker}
      companyName={holding.companyName}
      imageUrl={holding.tcgImageUrl}
      size={size === "md" ? "md" : "xs"}
    />
  );
}

function assetTickerLabel(holding: HoldingWithCostCurrency): string {
  if (isPokemonGroupTicker(holding.ticker)) return "Pokémon TCG";
  if (!isPokemonTicker(holding.ticker)) return holding.ticker;
  if (holding.tcgCategory === "GRADED_CARD" && holding.tcgGradeCompany) {
    return `${holding.tcgGradeCompany} ${holding.tcgGradeValue ?? ""}`.trim();
  }
  return pokemonCategoryLabel(holding.tcgCategory);
}

type MobileOpenFifoLot = {
  acquiredAt: string;
  remainingShares: number;
  pricePerShareLocal: number;
  purchaseCurrency: string;
  investedAmountEur?: number;
  investedAmount: number;
  currentPnl: number;
  currentPriceAvailable: boolean;
};

function canExpandMobileHoldingLots(holding: HoldingWithCostCurrency): boolean {
  const t = holding.ticker.toUpperCase();
  if (isPokemonGroupTicker(t)) return false;
  if (t === "CASH" || t === CASH_INTEREST_TICKER) return false;
  const shares = parseFloat(holding.shares);
  return Number.isFinite(shares) && shares > 0;
}

function MobileHoldingBuyLotsPanel({
  portfolioId,
  allPortfolios,
  ticker,
  currentPrice,
  shares,
  investedDisplay,
  maskAmount,
  formatShareQuantityFn,
  formatAverageCostCurrencyFn,
  convertAverageCostPriceFn,
  convertPriceFn,
  formatPercentFn,
  getChangeColorFn,
}: {
  portfolioId: string | null | undefined;
  /** Pri agregovanom zobrazení „Všetky portfóliá“ holding nemá portfolioId. */
  allPortfolios: boolean;
  ticker: string;
  /** Aktuálna trhová cena / ks v zobrazovacej mene. */
  currentPrice: number | null;
  shares: number;
  investedDisplay: number;
  maskAmount: (s: string) => string;
  formatShareQuantityFn: (n: number) => string;
  formatAverageCostCurrencyFn: (n: number) => string;
  convertAverageCostPriceFn: (
    price: number,
    fromCurrency: "EUR" | "USD" | "GBP" | "CZK" | "PLN",
  ) => number;
  convertPriceFn: (
    price: number,
    fromCurrency: "EUR" | "USD" | "GBP" | "CZK" | "PLN",
  ) => number;
  formatPercentFn: (value: number) => string;
  getChangeColorFn: (value: number) => string;
}) {
  const pathSeg =
    allPortfolios || portfolioId === "all"
      ? "all"
      : portfolioId == null || portfolioId === ""
        ? "unassigned"
        : portfolioId;
  const { data, isLoading, isError } = useQuery<{ lots: MobileOpenFifoLot[] }>({
    queryKey: ["/api/portfolios", pathSeg, "asset-lots", ticker],
    queryFn: async () => {
      const u = encodeURIComponent(ticker);
      const res = await fetch(
        `/api/portfolios/${pathSeg === "unassigned" || pathSeg === "all" ? pathSeg : encodeURIComponent(pathSeg)}/asset-lots?ticker=${u}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("asset-lots");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const lots = data?.lots ?? [];

  if (isLoading) {
    return (
      <div className="mt-1.5 pl-5 space-y-1" data-testid={`lots-loading-${ticker}`}>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="mt-1.5 pl-5 text-[9px] text-destructive">Nákupy sa nepodarilo načítať.</p>
    );
  }

  if (lots.length === 0) {
    return (
      <p className="mt-1.5 pl-5 text-[9px] text-muted-foreground">Žiadne otvorené nákupné dávky.</p>
    );
  }

  // Jedna dávka = celá pozícia → rovnaký náklad ako riadok holdingu (žiadne dvojité %).
  const singleLotCoversPosition =
    lots.length === 1 &&
    Math.abs(lots[0]!.remainingShares - shares) <= Math.max(1e-4, shares * 1e-2);

  return (
    <div className="mt-1.5 pl-5 space-y-1" data-testid={`lots-panel-${ticker}`}>
      {lots.map((lot, idx) => {
        const ccyRaw = (lot.purchaseCurrency || "EUR").toUpperCase();
        const ccy =
          ccyRaw === "USD" || ccyRaw === "GBP" || ccyRaw === "CZK" || ccyRaw === "PLN" || ccyRaw === "EUR"
            ? ccyRaw
            : "EUR";
        const openPrice = convertAverageCostPriceFn(lot.pricePerShareLocal, ccy);
        // Vždy EUR náklad → UI mena (rovnaký convertPrice ako hodnota pozície).
        const investedRawEur =
          lot.investedAmountEur != null && Number.isFinite(lot.investedAmountEur)
            ? lot.investedAmountEur
            : null;
        const investedFromLot =
          investedRawEur != null ? convertPriceFn(investedRawEur, "EUR") : null;
        const invested =
          singleLotCoversPosition && investedDisplay > 0 ? investedDisplay : investedFromLot;
        const lotValue =
          currentPrice != null && Number.isFinite(currentPrice)
            ? lot.remainingShares * currentPrice
            : null;
        const lotGain =
          lotValue != null && invested != null ? lotValue - invested : null;
        const lotGainPercent =
          lotGain != null && invested != null && Math.abs(invested) > 1e-9
            ? (lotGain / invested) * 100
            : null;
        let dateLabel = lot.acquiredAt;
        try {
          dateLabel = format(parseISO(`${lot.acquiredAt}T12:00:00Z`), "d. M. yyyy", { locale: sk });
        } catch {
          /* keep ISO */
        }
        return (
          <div
            key={`${lot.acquiredAt}-${lot.remainingShares}-${idx}`}
            className="flex items-center justify-between gap-2 text-[9px] text-muted-foreground tabular-nums"
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Badge
                variant="secondary"
                className="shrink-0 px-1 py-0 text-[8px] font-normal leading-none bg-emerald-500/15 text-emerald-600 border-emerald-500/25"
              >
                Nákup
              </Badge>
              <span className="truncate">{dateLabel}</span>
            </span>
            <span className="shrink-0 text-right inline-flex items-center gap-1.5">
              <span>
                <span className="text-foreground">{formatShareQuantityFn(lot.remainingShares)}</span>
                {" @ "}
                <span className="text-foreground">{maskAmount(formatAverageCostCurrencyFn(openPrice))}</span>
              </span>
              {lotGainPercent != null ? (
                <span className={`font-medium ${getChangeColorFn(lotGainPercent)}`}>
                  {formatPercentFn(lotGainPercent)}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface RealizedGainSummary {
  totalRealized: number;
  closeTradeNetEur?: number;
  realizedGainTotal?: number;
  realizedYTD: number;
  realizedThisMonth: number;
  realizedToday: number;
  transactionCount: number;
}

interface DividendSummary {
  totalGross?: number;
  totalNet: number;
  totalTax?: number;
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
  unrealizedCrossComponent?: number;
  residualUnrealized: number;
  dividendNet: number;
  projectedDividendNext12m?: number;
  dividendNetYtdCalendarYear?: number;
  method: { realized: string; costEur: string };
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

type SortField = "ticker" | "companyName" | "shares" | "avgCost" | "currentPrice" | "value" | "gainLoss" | "gainLossPercent";
type SortDirection = "asc" | "desc";

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  quoteDate?: string | null;
  marketState?: string | null;
  isMarketOpen?: boolean | null;
  preMarketPrice?: number | null;
  preMarketChange?: number | null;
  preMarketChangePercent?: number | null;
}

type OwnershipAlertItem = {
  id: string;
  date: string | null;
  actorName: string;
  shares: number | null;
  value: number | null;
  kind: "INSIDER" | "INSTITUTION";
  action: "BUY" | "SELL";
  note: string | null;
};

type OwnershipAlertResponse = {
  ticker: string;
  currency: string | null;
  items: OwnershipAlertItem[];
  source: "yahoo" | null;
};

type PortfolioNotificationKind =
  | "ownership"
  | "ath"
  | "earnings"
  | "dividend"
  | "macro"
  | "move-up"
  | "move-down";

type PortfolioNotificationItem = {
  id: string;
  kind: PortfolioNotificationKind;
  title: string;
  subtitle: string;
  dateIso: string | null;
  tone: "default" | "positive" | "negative" | "warning";
  infoUrl?: string;
};

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

function formatNotificationDateIso(value: string | null): string {
  if (!value) return "bez dátumu";
  try {
    return format(parseISO(value), "d. M. yyyy", { locale: sk });
  } catch {
    return value;
  }
}

function formatOwnershipCount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} mld`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)} mil`;
  return value.toLocaleString("sk-SK", { maximumFractionDigits: 0 });
}

type PortfolioQuoteCurrency = "EUR" | "USD" | "GBP" | "CZK" | "PLN" | "HKD";

function sortHoldingsArray(
  holdings: HoldingWithCostCurrency[] | undefined,
  quotes: Record<string, StockQuote> | undefined,
  sortField: SortField,
  sortDirection: SortDirection,
  convertPrice: (amount: number, sourceCurrency: PortfolioQuoteCurrency) => number,
  convertAverageCostPrice: (amount: number, sourceCurrency: PortfolioQuoteCurrency) => number,
  getTickerCurrency: (ticker: string) => PortfolioQuoteCurrency,
  resolveHoldingCostCurrency: (holding: Pick<HoldingWithCostCurrency, "ticker" | "costCurrency">) => PortfolioQuoteCurrency,
  pnlInvestedForDisplay: (holding: Pick<HoldingWithCostCurrency, "totalInvested" | "pnlInvestedEur" | "ticker" | "costCurrency">) => number,
): HoldingWithCostCurrency[] {
  if (!holdings) return [];
  if (!quotes) return [...holdings];

  return [...holdings].sort((a, b) => {
    let aValue: number | string;
    let bValue: number | string;

    const aShares = parseFloat(a.shares);
    const bShares = parseFloat(b.shares);
    const aAvgCost = parseFloat(a.averageCost);
    const bAvgCost = parseFloat(b.averageCost);
    const aTickerCurrency = getTickerCurrency(a.ticker);
    const bTickerCurrency = getTickerCurrency(b.ticker);
    const aCostCurrency = resolveHoldingCostCurrency(a);
    const bCostCurrency = resolveHoldingCostCurrency(b);
    const aQuote = quotes[a.ticker];
    const bQuote = quotes[b.ticker];
    const aAvgCostPortfolio = convertPrice(aAvgCost, aCostCurrency);
    const bAvgCostPortfolio = convertPrice(bAvgCost, bCostCurrency);
    const aAvgCostSort = convertAverageCostPrice(aAvgCost, aCostCurrency);
    const bAvgCostSort = convertAverageCostPrice(bAvgCost, bCostCurrency);
    const aCurrentPrice = aQuote ? convertPrice(aQuote.price, aTickerCurrency) : aAvgCostPortfolio;
    const bCurrentPrice = bQuote ? convertPrice(bQuote.price, bTickerCurrency) : bAvgCostPortfolio;
    const aCurrentValue = aShares * aCurrentPrice;
    const bCurrentValue = bShares * bCurrentPrice;
    const aInvested = parseFloat(a.totalInvested);
    const bInvested = parseFloat(b.totalInvested);
    const aInvestedDisplay = pnlInvestedForDisplay(a);
    const bInvestedDisplay = pnlInvestedForDisplay(b);
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
        aValue = aAvgCostSort;
        bValue = bAvgCostSort;
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
      case "gainLossPercent":
        aValue = aInvestedDisplay > 0 ? (aGainLoss / aInvestedDisplay) * 100 : 0;
        bValue = bInvestedDisplay > 0 ? (bGainLoss / bInvestedDisplay) * 100 : 0;
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
}

function buildPokemonGroupHolding(
  children: HoldingWithCostCurrency[],
  quotes: Record<string, StockQuote> | undefined,
): { holding: HoldingWithCostCurrency; quote: StockQuote } {
  let shares = 0;
  let invested = 0;
  let pnl = 0;
  let marketEur = 0;
  for (const holding of children) {
    const qty = parseFloat(holding.shares);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    shares += qty;
    const cost = parseFloat(holding.totalInvested);
    if (Number.isFinite(cost)) invested += cost;
    pnl +=
      holding.pnlInvestedEur != null && Number.isFinite(holding.pnlInvestedEur)
        ? holding.pnlInvestedEur
        : Number.isFinite(cost)
          ? cost
          : 0;
    const quote = quotes?.[holding.ticker];
    const avg = parseFloat(holding.averageCost);
    const priceEur = quote && Number.isFinite(quote.price) ? quote.price : Number.isFinite(avg) ? avg : 0;
    marketEur += qty * priceEur;
  }
  const avgCost = shares > 0 ? invested / shares : 0;
  const unit = shares > 0 ? marketEur / shares : 0;
  return {
    holding: {
      id: "pokemon-group",
      userId: children[0]?.userId ?? "",
      portfolioId: null,
      ticker: POKEMON_GROUP_TICKER,
      companyName: `Pokémon TCG (${children.length})`,
      shares: String(shares),
      averageCost: String(avgCost),
      totalInvested: String(invested),
      updatedAt: new Date(),
      tcgCategory: null,
      tcgProductName: "Pokémon TCG",
      tcgSetName: null,
      tcgGradeCompany: null,
      tcgGradeValue: null,
      tcgImageUrl: null,
      tcgCardmarketId: null,
      tcgExternalId: null,
      costCurrency: "EUR",
      pnlInvestedEur: pnl,
      openAvgPriceLocal: avgCost,
      openPriceCurrency: "EUR",
    },
    quote: {
      ticker: POKEMON_GROUP_TICKER,
      price: unit,
      change: 0,
      changePercent: 0,
      marketState: "CLOSED",
      isMarketOpen: false,
      preMarketPrice: null,
      preMarketChange: null,
      preMarketChangePercent: null,
    },
  };
}

function collapsePokemonInAllPortfolios(
  sorted: HoldingWithCostCurrency[],
  quotes: Record<string, StockQuote> | undefined,
  groupPokemon: boolean,
  sortField: SortField,
  sortDirection: SortDirection,
  convertPrice: (amount: number, sourceCurrency: PortfolioQuoteCurrency) => number,
  convertAverageCostPrice: (amount: number, sourceCurrency: PortfolioQuoteCurrency) => number,
  getTickerCurrencyFn: (ticker: string) => PortfolioQuoteCurrency,
  resolveCostCurrency: (holding: Pick<HoldingWithCostCurrency, "ticker" | "costCurrency">) => PortfolioQuoteCurrency,
  investedForDisplay: (holding: Pick<HoldingWithCostCurrency, "totalInvested" | "pnlInvestedEur" | "ticker" | "costCurrency">) => number,
): {
  rows: HoldingWithCostCurrency[];
  children: HoldingWithCostCurrency[];
  quotes: Record<string, StockQuote> | undefined;
} {
  if (!groupPokemon) return { rows: sorted, children: [], quotes };
  const children = sorted.filter(
    (holding) => isPokemonHolding(holding) && !isPokemonGroupTicker(holding.ticker),
  );
  const rest = sorted.filter((holding) => !isPokemonHolding(holding));
  if (children.length === 0) return { rows: rest, children: [], quotes };
  const group = buildPokemonGroupHolding(children, quotes);
  const merged = { ...(quotes ?? {}), [POKEMON_GROUP_TICKER]: group.quote };
  const sortedRows = sortHoldingsArray(
    rest,
    merged,
    sortField,
    sortDirection,
    convertPrice,
    convertAverageCostPrice,
    getTickerCurrencyFn,
    resolveCostCurrency,
    investedForDisplay,
  );
  const rows = [group.holding, ...sortedRows];
  const orderedChildren = [...children].sort((a, b) =>
    (a.companyName || "").localeCompare(b.companyName || "", "sk"),
  );
  return { rows, children: orderedChildren, quotes: merged };
}

function flattenPokemonGroup(
  rows: HoldingWithCostCurrency[],
  children: HoldingWithCostCurrency[],
  open: boolean,
): HoldingWithCostCurrency[] {
  if (!open || children.length === 0) return rows;
  const out: HoldingWithCostCurrency[] = [];
  for (const row of rows) {
    out.push(row);
    if (isPokemonGroupTicker(row.ticker)) out.push(...children);
  }
  return out;
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

interface PortfolioHistoryYtdPoint {
  date: string;
  portfolioCumulativePct: number;
  sp500CumulativePct: number;
}

interface PortfolioHistoryYtdRes {
  points: PortfolioHistoryYtdPoint[];
  startIso?: string;
}

interface PortfolioHistoryAllRes {
  points: Array<{ date: string; totalValue: number }>;
}

const ATH_VALUE_EPS = 1e-6;

type AthReachedPortfolio = {
  id: string;
  name: string;
  brokerCode: Portfolio["brokerCode"];
  previousAthDate: string | null;
};

function findPreviousAthDate(
  points: Array<{ date: string; totalValue: number }>,
  todayIso: string,
): string | null {
  if (points.length < 2) return null;
  const lastPoint = points[points.length - 1];
  const endIdx =
    lastPoint?.date && String(lastPoint.date).startsWith(todayIso)
      ? points.length - 1
      : points.length;
  let runningMax = Number.NEGATIVE_INFINITY;
  let lastAthDate: string | null = null;
  for (let i = 0; i < endIdx; i++) {
    const p = points[i];
    const v = p?.totalValue;
    if (!Number.isFinite(v)) continue;
    if (v > runningMax + ATH_VALUE_EPS) {
      runningMax = v;
      lastAthDate = p.date;
    } else if (Math.abs(v - runningMax) <= ATH_VALUE_EPS) {
      lastAthDate = p.date;
    }
  }
  return Number.isFinite(runningMax) ? lastAthDate : null;
}

function portfolioReachedAthToday(
  points: Array<{ date: string; totalValue: number }>,
  todayIso: string,
): boolean {
  if (points.length < 2) return false;
  const lastPoint = points[points.length - 1];
  if (!lastPoint?.date || !String(lastPoint.date).startsWith(todayIso)) return false;
  const last = lastPoint.totalValue;
  if (!Number.isFinite(last)) return false;
  let prevMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i++) {
    const v = points[i]?.totalValue;
    if (Number.isFinite(v)) prevMax = Math.max(prevMax, v);
  }
  if (!Number.isFinite(prevMax)) return false;
  return last > prevMax + ATH_VALUE_EPS;
}

function parseAthCelebrateFromStorage(
  raw: string,
  portfolios: Portfolio[],
  todayIso: string,
  historyById?: Record<string, PortfolioHistoryAllRes>,
): AthReachedPortfolio[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    const fromSnapshot = (item: unknown): AthReachedPortfolio | null => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const portfolio = portfolios.find((p) => p.id === id);
      if (!portfolio) return null;
      const previousAthDate =
        typeof o.previousAthDate === "string"
          ? o.previousAthDate
          : historyById
            ? findPreviousAthDate(historyById[id]?.points ?? [], todayIso)
            : null;
      return {
        id: portfolio.id,
        name: portfolio.name,
        brokerCode: portfolio.brokerCode,
        previousAthDate,
      };
    };

    if (typeof parsed[0] === "string") {
      return parsed
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter((v) => v.length > 0)
        .map((name) => portfolios.find((p) => p.name === name))
        .filter((p): p is Portfolio => !!p)
        .map((p) => ({
          id: p.id,
          name: p.name,
          brokerCode: p.brokerCode,
          previousAthDate: historyById
            ? findPreviousAthDate(historyById[p.id]?.points ?? [], todayIso)
            : null,
        }));
    }

    return parsed.map(fromSnapshot).filter((p): p is AthReachedPortfolio => p !== null);
  } catch {
    return [];
  }
}

interface HoldingsNextEarningsRes {
  next: { ticker: string; companyName: string; date: string; session?: "BMO" | "AMC" } | null;
  all: Array<{ ticker: string; companyName: string; date: string; session?: "BMO" | "AMC" }>;
}

type DashboardCalendarEventType = "earnings" | "dividend" | "macro";

interface DashboardCalendarEvent {
  type: DashboardCalendarEventType;
  date: string;
  title: string;
  subtitle: string;
  ticker?: string;
  session?: "BMO" | "AMC" | null;
  infoUrl: string;
}

interface UpcomingDividendsCalendarRes {
  next: unknown;
  all?: Array<{
    ticker: string;
    companyName: string;
    date: string;
    kind: "ex_dividend" | "payout";
    confirmed: boolean;
  }>;
}

interface UpcomingMacroEventsRes {
  next: { code: string; shortLabel: string; date: string; title: string } | null;
  all: Array<{ code: string; shortLabel: string; date: string; title: string }>;
}

function DashboardClassic() {
  const [, setLocation] = useLocation();
  const { currency, convertPrice, convertAverageCostPrice, getTickerCurrency, resolveHoldingCostCurrency, pnlInvestedForDisplay, formatCurrency, formatAverageCostCurrency } = useCurrency();
  const { getQueryParam, selectedPortfolio, isAllPortfolios, portfolios } = usePortfolio();
  const {
    hideAmounts,
    showNews,
    showDailyMovers,
    dailyMoversCount,
    showAthPopup,
    showCalendarEventsPopup,
    showAnalystRatingPopup,
    mobileAssetsSortBy,
    mobileAssetsSortOrder,
    mobileAssetsView,
    setMobileAssetsSortBy,
    setMobileAssetsSortOrder,
    setMobileAssetsView,
  } = useChartSettings();
  const {
    order: dashboardOrder,
    visible: dashboardVisible,
    editing: dashboardEditing,
    isVisible: isDashboardWidgetVisible,
    toggleVisible: toggleDashboardWidget,
    reorder: reorderDashboardWidgets,
  } = useDashboardLayout();
  const isMobileViewport = useIsMobile();
  const dashboardDnDSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 1000, tolerance: 12 } }),
  );
  const handleDashboardDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      reorderDashboardWidgets(String(active.id), String(over.id));
    },
    [reorderDashboardWidgets],
  );
  const [sortField, setSortField] = useState<SortField>("ticker");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [mobileEarningsIndex, setMobileEarningsIndex] = useState(0);
  const [mobileTopPositionIndex, setMobileTopPositionIndex] = useState(0);
  const [mobileMacroEventIndex, setMobileMacroEventIndex] = useState(0);
  const [athDialogOpen, setAthDialogOpen] = useState(false);
  const [athReachedPortfolios, setAthReachedPortfolios] = useState<AthReachedPortfolio[]>([]);
  const [athPopupEvaluated, setAthPopupEvaluated] = useState(false);
  const [calendarTodayDialogOpen, setCalendarTodayDialogOpen] = useState(false);
  const [todayCalendarEvents, setTodayCalendarEvents] = useState<DashboardCalendarEvent[]>([]);
  const calendarPopupHandledRef = useRef(false);
  const [analystRatingDialogOpen, setAnalystRatingDialogOpen] = useState(false);
  const [analystRatingChanges, setAnalystRatingChanges] = useState<AnalystRatingUpdateRow[]>([]);
  const analystRatingPopupHandledRef = useRef(false);
  const [athDontShowAgainToday, setAthDontShowAgainToday] = useState(false);
  const [mobileAssetsSortDialogOpen, setMobileAssetsSortDialogOpen] = useState(false);
  const [mobileAssetsViewPopoverOpen, setMobileAssetsViewPopoverOpen] = useState(false);
  const [expandedMobileHoldingId, setExpandedMobileHoldingId] = useState<string | null>(null);
  const [pokemonGroupOpen, setPokemonGroupOpen] = useState(false);
  const [draftMobileSortBy, setDraftMobileSortBy] = useState<MobileAssetsSortBy>("name");
  const [draftMobileSortOrder, setDraftMobileSortOrder] = useState<SortDirection>("asc");
  const maskAmount = (amount: string) => hideAmounts ? "••••••" : amount;
  const premarketMoonClass = "text-amber-600 dark:text-amber-400";

  const portfolioParam = getQueryParam();

  useEffect(() => {
    setPokemonGroupOpen(false);
  }, [isAllPortfolios]);

  useEffect(() => {
    calendarPopupHandledRef.current = false;
    analystRatingPopupHandledRef.current = false;
  }, [portfolioParam]);

  useEffect(() => {
    if (portfolios.length === 0) return;
    try {
      const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
      const raw = sessionStorage.getItem(`mw-dash-ath-celebrate-${todayIso}`);
      if (!raw) return;
      const restored = parseAthCelebrateFromStorage(raw, portfolios, todayIso);
      if (restored.length > 0) setAthReachedPortfolios(restored);
    } catch {
      /* ignore */
    }
  }, [portfolios]);

  useEffect(() => {
    if (showAthPopup) {
      setAthPopupEvaluated(false);
    }
  }, [showAthPopup]);

  useEffect(() => {
    if (showCalendarEventsPopup) {
      calendarPopupHandledRef.current = false;
    }
  }, [showCalendarEventsPopup]);

  useEffect(() => {
    if (showAnalystRatingPopup) {
      analystRatingPopupHandledRef.current = false;
    }
  }, [showAnalystRatingPopup]);

  /** Drží ťažké dotazy (P&L, poplatky, …) až po idle — menej paralelných requestov pri prvom načítaní, menej „stránka nereaguje“. */
  const [dashboardSecondaryReady, setDashboardSecondaryReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) setDashboardSecondaryReady(true);
    };
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(run, { timeout: 1500 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(run, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);
  
  const { data: holdings, isLoading: holdingsLoading } = useQuery<HoldingWithCostCurrency[]>({
    queryKey: ["/api/holdings", portfolioParam],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
  });

  const pokemonHoldingCount = holdings?.filter((holding) => isPokemonHolding(holding)).length ?? 0;
  const previousPokemonCount = useRef<number | null>(null);
  useEffect(() => {
    if (!isAllPortfolios) {
      previousPokemonCount.current = pokemonHoldingCount;
      return;
    }
    if (previousPokemonCount.current != null && pokemonHoldingCount > previousPokemonCount.current) {
      setPokemonGroupOpen(true);
    }
    previousPokemonCount.current = pokemonHoldingCount;
  }, [isAllPortfolios, pokemonHoldingCount]);

  const {
    data: quotesData,
    dataUpdatedAt,
    isFetching: quotesFetching,
  } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/quotes", holdings?.map(h => h.ticker)],
    enabled: !!holdings && holdings.length > 0,
    staleTime: getQuoteStaleTimeMs(),
    refetchInterval: () => getQuoteRefreshIntervalMs(),
    queryFn: async () => {
      if (!holdings || holdings.length === 0) return {};
      const tickers = holdings.map(h => h.ticker);
      const refresh = shouldUseExtendedQuotes(getUsMarketSessionState());
      return fetchDashboardQuotesBatch(tickers, refresh);
    },
  });
  
  const quotes = quotesData;

  const moversTickers = useMemo(() => {
    if (!holdings || holdings.length === 0) return [];
    const set = new Set<string>();
    for (const h of holdings) {
      if (h.ticker) set.add(h.ticker);
    }
    return Array.from(set).sort();
  }, [holdings]);

  const tickerDisplayNames = useMemo(() => {
    const map = new Map<string, string>();
    if (!holdings) return map;
    for (const h of holdings) {
      if (!map.has(h.ticker)) {
        const label =
          h.ticker.toUpperCase() === CASH_INTEREST_TICKER
            ? CASH_INTEREST_DISPLAY_NAME
            : (h.companyName || h.ticker).trim() || h.ticker;
        map.set(h.ticker, label);
      }
    }
    return map;
  }, [holdings]);

  const { usSessionState, moversUseExtendedQuotes } = (() => {
    const state = getUsMarketSessionState();
    const moversUseExtendedQuotes = shouldUseExtendedQuotes(state);
    return { usSessionState: state, moversUseExtendedQuotes };
  })();

  const dailyMovers = useMemo(() => {
    type MoverRow = {
      ticker: string;
      name: string;
      pct: number;
      dayValueEur: number | null;
      useExtended: boolean;
    };
    if (!quotesData || !holdings || moversTickers.length === 0) {
      return {
        gainers: [] as MoverRow[],
        losers: [] as MoverRow[],
      };
    }
    const sharesByTicker = new Map<string, number>();
    for (const h of holdings) {
      const sh = parseFloat(h.shares);
      if (!Number.isFinite(sh) || sh <= 0) continue;
      sharesByTicker.set(h.ticker, (sharesByTicker.get(h.ticker) ?? 0) + sh);
    }

    const num = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? "")));

    const rows = moversTickers
      .map((t) => {
        const q = quotesData[t];
        const shares = sharesByTicker.get(t) ?? 0;
        let pct: number;
        let dayValueEur: number | null = null;

        const extPct = num(q?.preMarketChangePercent);
        const extCh = num(q?.preMarketChange);
        const regPct = num(q?.changePercent);
        const regCh = num(q?.change);
        const useExtendedForTicker =
          shouldShowExtendedQuote(usSessionState, q?.marketState, extPct);
        pct = useExtendedForTicker && Number.isFinite(extPct) ? extPct : regPct;
        const ch = useExtendedForTicker && Number.isFinite(extCh) ? extCh : regCh;
        if (shares > 0 && Number.isFinite(ch)) {
          dayValueEur = shares * convertPrice(ch, getTickerCurrency(t));
        }

        return {
          ticker: t,
          name: tickerDisplayNames.get(t) ?? t,
          pct: Number.isFinite(pct) ? pct : NaN,
          dayValueEur,
          useExtended: useExtendedForTicker,
        };
      })
      .filter((r) => Number.isFinite(r.pct));

    const gainers = [...rows]
      .filter((r) => r.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, dailyMoversCount);
    const losers = [...rows]
      .filter((r) => r.pct < 0)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, dailyMoversCount);

    return { gainers, losers };
  }, [
    quotesData,
    moversTickers,
    tickerDisplayNames,
    holdings,
    convertPrice,
    getTickerCurrency,
    usSessionState,
    moversUseExtendedQuotes,
    dailyMoversCount,
  ]);

  const formatSignedDayPct = (value: number) => {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };

  type DailyMoverRowData = {
    ticker: string;
    name: string;
    pct: number;
    dayValueEur: number | null;
    useExtended?: boolean;
  };

  const renderDailyMoverRow = (
    row: DailyMoverRowData,
    idx: number,
    pctColorClass: string,
    rowTestId: string,
    valueTestId: string,
  ) => (
    <div key={row.ticker} className="border-b border-border/60 last:border-0" data-testid={rowTestId}>
      {/* Mobile — názov ako v Prehľade aktív; jedna riadková výška vľavo */}
      <div className="flex gap-2 items-center py-2 md:hidden">
        <span className="text-[9px] text-muted-foreground tabular-nums shrink-0 w-3">
          {idx + 1}.
        </span>
        <div className="shrink-0">
          <CompanyLogo ticker={row.ticker} companyName={row.name} size="xs" />
        </div>
        <div className="min-w-0 flex-1 pr-1">
          <span className="font-semibold text-xs leading-tight truncate block" data-testid={`${rowTestId}-ticker`}>
            {(row.name || "").trim() || row.ticker}
          </span>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end justify-center gap-0.5 max-w-[46%]">
          <div
            className={`text-[10px] font-medium tabular-nums leading-tight inline-flex flex-wrap items-center justify-end gap-x-1 ${
              row.dayValueEur != null && Number.isFinite(row.dayValueEur)
                ? getChangeColor(row.dayValueEur)
                : pctColorClass
            }`}
          >
            {row.useExtended && (
              <Moon className={`h-2.5 w-2.5 shrink-0 ${premarketMoonClass}`} aria-hidden />
            )}
            {row.dayValueEur != null && Number.isFinite(row.dayValueEur) ? (
              <>
                <span data-testid={valueTestId}>
                  {row.dayValueEur >= 0 ? "+" : ""}
                  {maskAmount(formatCurrency(row.dayValueEur))}
                </span>
                <span className="whitespace-nowrap">({formatSignedDayPct(row.pct)})</span>
              </>
            ) : (
              <span className="whitespace-nowrap">{formatSignedDayPct(row.pct)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex items-center justify-between gap-2 py-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs text-muted-foreground tabular-nums w-5 shrink-0">{idx + 1}.</span>
          <CompanyLogo ticker={row.ticker} companyName={row.name} size="xs" />
          <div className="min-w-0 flex flex-col gap-0.5">
            <span className="font-medium text-sm truncate" data-testid={`${rowTestId}-ticker-desktop`}>
              {row.ticker}
            </span>
            <div className="text-xs text-muted-foreground truncate">{row.name}</div>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end justify-center gap-0 leading-none">
          <span className="inline-flex items-center justify-end gap-1">
            {row.useExtended && (
              <Moon className={`h-3.5 w-3.5 shrink-0 ${premarketMoonClass}`} aria-hidden />
            )}
            <span className={`text-sm font-semibold tabular-nums leading-tight ${pctColorClass}`}>
              {formatSignedDayPct(row.pct)}
            </span>
          </span>
          {row.dayValueEur != null && Number.isFinite(row.dayValueEur) && (
            <span
              className={`text-[10px] font-medium tabular-nums leading-tight mt-0.5 ${getChangeColor(row.dayValueEur)}`}
              data-testid={valueTestId}
            >
              {row.dayValueEur >= 0 ? "+" : ""}
              {maskAmount(formatCurrency(row.dayValueEur))}
            </span>
          )}
        </div>
      </div>
    </div>
  );

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
      const res = await fetch(`/api/realized-gains?portfolio=${portfolioParam}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch realized gains");
      return res.json();
    },
    enabled: dashboardSecondaryReady,
  });

  const { data: dividends } = useQuery<DividendSummary>({
    queryKey: ["/api/dividends", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      return res.json();
    },
    enabled: dashboardSecondaryReady,
  });

  const { data: optionStats } = useQuery<OptionStats>({
    queryKey: ["/api/options/stats/summary", portfolioParam],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(
        `/api/options/stats/summary?portfolio=${encodeURIComponent(portfolioParam)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch options stats");
      return res.json();
    },
    enabled: dashboardSecondaryReady,
  });

  const { data: optionTrades } = useQuery<OptionTrade[]>({
    queryKey: ["/api/options", portfolioParam],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(`/api/options?portfolio=${encodeURIComponent(portfolioParam)}`);
      if (!res.ok) throw new Error("Failed to fetch options");
      return res.json();
    },
    enabled: dashboardSecondaryReady,
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
    enabled: dashboardSecondaryReady,
  });

  const { data: ytdHistory } = useQuery<PortfolioHistoryYtdRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, "ytd"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("portfolio", portfolioParam);
      params.set("range", "ytd");
      const res = await fetch(`/api/portfolio-history?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("ytd history");
      return res.json();
    },
    staleTime: 15 * 60 * 1000,
    enabled: dashboardSecondaryReady,
  });

  const { data: athHistoryByPortfolio } = useQuery<Record<string, PortfolioHistoryAllRes>>({
    queryKey: ["/api/portfolio-history", "ath-check", portfolios.map((p) => p.id).join(",")],
    enabled: showAthPopup && portfolios.length > 0 && !athPopupEvaluated,
    queryFn: async () => {
      const out: Record<string, PortfolioHistoryAllRes> = {};
      await Promise.all(
        portfolios.map(async (p) => {
          const params = new URLSearchParams();
          params.set("portfolio", p.id);
          params.set("range", "all");
          const res = await fetch(`/api/portfolio-history?${params.toString()}`, {
            credentials: "include",
          });
          if (!res.ok) {
            out[p.id] = { points: [] };
            return;
          }
          out[p.id] = (await res.json()) as PortfolioHistoryAllRes;
        }),
      );
      return out;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });

  const { data: news, isLoading: newsLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/news?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    enabled:
      dashboardSecondaryReady &&
      (showNews || isDashboardWidgetVisible("news")) &&
      !!holdings &&
      holdings.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: holdingsNextEarnings,
    dataUpdatedAt: earningsUpdatedAt,
    isFetched: earningsCalendarFetched,
  } = useQuery({
    queryKey: ["/api/holdings/next-earnings", portfolioParam],
    queryFn: () =>
      fetchUpcomingEnvelope<HoldingsNextEarningsRes["all"][number]>(
        `/api/holdings/next-earnings?portfolio=${encodeURIComponent(portfolioParam)}`,
      ),
    staleTime: 45 * 60 * 1000,
    refetchOnMount: "always",
    enabled: dashboardSecondaryReady,
  });

  const { data: upcomingDividendsCalendar, isFetched: dividendsCalendarFetched } =
    useQuery({
      queryKey: ["/api/dividends/upcoming", portfolioParam, "dashboard-popup"],
      queryFn: () =>
        fetchUpcomingEnvelope<NonNullable<UpcomingDividendsCalendarRes["all"]>[number]>(
          `/api/dividends/upcoming?portfolio=${encodeURIComponent(portfolioParam)}`,
        ),
      staleTime: 45 * 60 * 1000,
      refetchOnMount: "always",
      enabled: dashboardSecondaryReady,
    });

  const {
    data: upcomingMacroEvents,
    dataUpdatedAt: macroEventsUpdatedAt,
    isFetched: macroCalendarFetched,
  } = useQuery({
    queryKey: ["/api/macro-events/upcoming"],
    queryFn: () =>
      fetchUpcomingEnvelope<UpcomingMacroEventsRes["all"][number]>("/api/macro-events/upcoming"),
    staleTime: 30 * 60 * 1000,
    refetchOnMount: "always",
    enabled: dashboardSecondaryReady,
  });

  const {
    data: analystRatingUpdatesRes,
    isFetched: analystRatingUpdatesFetched,
  } = useQuery<{ updates: AnalystRatingUpdateRow[] }>({
    queryKey: ["/api/holdings/analyst-rating-updates", portfolioParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/holdings/analyst-rating-updates?portfolio=${encodeURIComponent(portfolioParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("analyst rating updates");
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
    enabled: dashboardSecondaryReady && showAnalystRatingPopup,
  });

  const ownershipAlertTickers = useMemo(() => {
    if (!holdings || holdings.length === 0) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of holdings) {
      const sh = parseFloat(h.shares);
      const t = (h.ticker || "").toUpperCase();
      if (!Number.isFinite(sh) || sh <= 0) continue;
      if (!t || t === "CASH" || isPokemonTicker(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 15) break;
    }
    return out;
  }, [holdings]);

  const ownershipAlertQueries = useQueries({
    queries: ownershipAlertTickers.map((ticker) => ({
      queryKey: ["/api/assets", ticker, "ownership-activity", "alerts", portfolioParam],
      queryFn: async () => {
        const res = await fetch(
          `/api/assets/${encodeURIComponent(ticker)}/ownership-activity?includeAll=1`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("ownership activity");
        return res.json() as Promise<OwnershipAlertResponse>;
      },
      enabled: dashboardSecondaryReady,
      staleTime: 30 * 60 * 1000,
    })),
  });

  const mergedDashboardCalendarEvents = useMemo(() => {
    const out: DashboardCalendarEvent[] = [];
    for (const e of holdingsNextEarnings?.all ?? []) {
      const t = e.ticker.toUpperCase();
      out.push({
        type: "earnings",
        date: e.date,
        title: `${t} — výsledky`,
        subtitle: e.companyName || t,
        ticker: t,
        session: e.session ?? null,
        infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(t)}`,
      });
    }
    for (const d of upcomingDividendsCalendar?.all ?? []) {
      const t = d.ticker.toUpperCase();
      out.push({
        type: "dividend",
        date: d.date,
        title: d.kind === "ex_dividend" ? `${t} — ex-dividend` : `${t} — výplata dividendy`,
        subtitle: d.kind === "ex_dividend" ? "Posledná šanca pred ex-dátumom" : "Dátum výplaty",
        ticker: t,
        infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(t)}`,
      });
    }
    for (const m of upcomingMacroEvents?.all ?? []) {
      out.push({
        type: "macro",
        date: m.date,
        title: m.shortLabel,
        subtitle: m.title,
        infoUrl: "https://finance.yahoo.com/calendar/economic",
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }, [holdingsNextEarnings?.all, upcomingDividendsCalendar?.all, upcomingMacroEvents?.all]);

  const ownershipAlertRows = useMemo(() => {
    const rows: Array<
      OwnershipAlertItem & {
        ticker: string;
        companyName: string;
        currency: string | null;
      }
    > = [];
    ownershipAlertQueries.forEach((q, idx) => {
      const ticker = ownershipAlertTickers[idx];
      if (!ticker) return;
      const payload = q.data;
      if (!payload?.items?.length) return;
      const companyName = tickerDisplayNames.get(ticker) ?? ticker;
      for (const item of payload.items.slice(0, 6)) {
        rows.push({
          ...item,
          ticker,
          companyName,
          currency: payload.currency ?? null,
        });
      }
    });
    rows.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : -Infinity;
      const tb = b.date ? Date.parse(b.date) : -Infinity;
      if (tb !== ta) return tb - ta;
      return (b.value ?? -Infinity) - (a.value ?? -Infinity);
    });
    return rows.slice(0, 12);
  }, [ownershipAlertQueries, ownershipAlertTickers, tickerDisplayNames]);

  useEffect(() => {
    setMobileEarningsIndex(0);
  }, [earningsUpdatedAt]);

  const mobileEarningsItems = holdingsNextEarnings?.all ?? [];
  const currentMobileEarnings =
    mobileEarningsItems.length > 0
      ? mobileEarningsItems[mobileEarningsIndex % mobileEarningsItems.length]
      : null;

  const mobileTopPositions = useMemo(() => {
    if (!holdings || holdings.length === 0) return [];
    return holdings
      .filter((h) => {
        const sh = parseFloat(h.shares);
        return Number.isFinite(sh) && sh > 0;
      })
      .map((h) => {
        const shares = parseFloat(h.shares);
        const q = quotes?.[h.ticker]?.price;
        const avgCost = parseFloat(h.averageCost);
        const tickerCcy = getTickerCurrency(h.ticker);
        const price =
          typeof q === "number" && Number.isFinite(q) && q > 0
            ? q
            : Number.isFinite(avgCost)
              ? avgCost
              : 0;
        const value = shares * convertPrice(price, tickerCcy);
        return {
          ticker: h.ticker,
          companyName: h.companyName,
          shares,
          value,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [holdings, quotes, getTickerCurrency, convertPrice]);

  useEffect(() => {
    setMobileTopPositionIndex(0);
  }, [holdings, quotes]);

  const currentMobileTopPosition =
    mobileTopPositions.length > 0
      ? mobileTopPositions[mobileTopPositionIndex % mobileTopPositions.length]
      : null;
  const mobileTopPositionsTotalValue = useMemo(
    () => mobileTopPositions.reduce((sum, p) => sum + p.value, 0),
    [mobileTopPositions],
  );
  const currentMobileTopPositionPct =
    currentMobileTopPosition && mobileTopPositionsTotalValue > 0
      ? (currentMobileTopPosition.value / mobileTopPositionsTotalValue) * 100
      : 0;
  const mobileMacroEvents = upcomingMacroEvents?.all ?? [];
  const currentMobileMacroEvent =
    mobileMacroEvents.length > 0
      ? mobileMacroEvents[mobileMacroEventIndex % mobileMacroEvents.length]
      : null;

  useEffect(() => {
    setMobileMacroEventIndex(0);
  }, [macroEventsUpdatedAt]);

  useEffect(() => {
    if (!showAthPopup) {
      setAthDialogOpen(false);
      setAthPopupEvaluated(true);
      return;
    }
    if (!athHistoryByPortfolio || athPopupEvaluated) return;
    const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
    const reachedAth: AthReachedPortfolio[] = [];
    for (const p of portfolios) {
      const points = athHistoryByPortfolio[p.id]?.points ?? [];
      if (!portfolioReachedAthToday(points, todayIso)) continue;
      reachedAth.push({
        id: p.id,
        name: p.name,
        brokerCode: p.brokerCode,
        previousAthDate: findPreviousAthDate(points, todayIso),
      });
    }
    if (reachedAth.length > 0) {
      let allowAthDialog = true;
      try {
        sessionStorage.setItem(`mw-dash-ath-celebrate-${todayIso}`, JSON.stringify(reachedAth));
      } catch {
        /* ignore */
      }
      try {
        const suppressKey = `mw-dash-ath-suppress-${todayIso}`;
        if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(suppressKey)) {
          allowAthDialog = false;
        }
      } catch {
        /* ignore */
      }
      setAthReachedPortfolios(reachedAth);
      if (allowAthDialog) setAthDialogOpen(true);
    }
    setAthPopupEvaluated(true);
  }, [athHistoryByPortfolio, athPopupEvaluated, portfolios, showAthPopup]);

  const prevAthDialogOpenRef = useRef(false);
  useEffect(() => {
    if (athDialogOpen && !prevAthDialogOpenRef.current) {
      setAthDontShowAgainToday(false);
    }
    prevAthDialogOpenRef.current = athDialogOpen;
  }, [athDialogOpen]);

  const handleAthDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      if (athDontShowAgainToday) {
        try {
          const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
          sessionStorage.setItem(`mw-dash-ath-suppress-${todayIso}`, "1");
        } catch {
          /* ignore */
        }
      }
      setAthDontShowAgainToday(false);
    }
    setAthDialogOpen(open);
  }, [athDontShowAgainToday]);

  useEffect(() => {
    if (!showCalendarEventsPopup) {
      setCalendarTodayDialogOpen(false);
      calendarPopupHandledRef.current = true;
      return;
    }
    if (portfolios.length > 0 && !athPopupEvaluated) return;
    if (!earningsCalendarFetched || !dividendsCalendarFetched || !macroCalendarFetched) return;
    if (calendarPopupHandledRef.current) return;

    const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
    const todayEvents = mergedDashboardCalendarEvents.filter((e) => e.date === todayIso);
    if (todayEvents.length === 0) {
      calendarPopupHandledRef.current = true;
      return;
    }

    const storageKey = `mw-dash-cal-popup-${todayIso}-${portfolioParam}`;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(storageKey)) {
        calendarPopupHandledRef.current = true;
        return;
      }
    } catch {
      /* ignore */
    }

    if (athDialogOpen) return;

    calendarPopupHandledRef.current = true;
    const sortedToday = [...todayEvents].sort((a, b) => {
      const w = (t: DashboardCalendarEventType) => (t === "macro" ? 0 : t === "dividend" ? 1 : 2);
      return w(a.type) - w(b.type) || a.title.localeCompare(b.title);
    });
    setTodayCalendarEvents(sortedToday);
    setCalendarTodayDialogOpen(true);
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
  }, [
    athDialogOpen,
    athPopupEvaluated,
    portfolios.length,
    earningsCalendarFetched,
    dividendsCalendarFetched,
    macroCalendarFetched,
    mergedDashboardCalendarEvents,
    portfolioParam,
    showCalendarEventsPopup,
  ]);

  useEffect(() => {
    if (!showAnalystRatingPopup) {
      setAnalystRatingDialogOpen(false);
      analystRatingPopupHandledRef.current = true;
      return;
    }
    if (portfolios.length > 0 && !athPopupEvaluated) return;
    if (athDialogOpen || calendarTodayDialogOpen) return;
    if (!analystRatingUpdatesFetched) return;
    if (analystRatingPopupHandledRef.current) return;

    const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
    const storageKey = `mw-dash-analyst-popup-${todayIso}-${portfolioParam}`;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(storageKey)) {
        analystRatingPopupHandledRef.current = true;
        return;
      }
    } catch {
      /* ignore */
    }

    const changed = detectAnalystRatingPopupChanges(analystRatingUpdatesRes?.updates ?? []);
    analystRatingPopupHandledRef.current = true;
    if (changed.length === 0) return;

    setAnalystRatingChanges(changed);
    setAnalystRatingDialogOpen(true);
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
  }, [
    analystRatingUpdatesFetched,
    analystRatingUpdatesRes?.updates,
    athDialogOpen,
    athPopupEvaluated,
    calendarTodayDialogOpen,
    portfolioParam,
    portfolios.length,
    showAnalystRatingPopup,
  ]);

  const formatRelativeTime = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    if (diff < 60) return "Práve teraz";
    if (diff < 3600) return `pred ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `pred ${Math.floor(diff / 3600)} h`;
    if (diff < 604800) return `pred ${Math.floor(diff / 86400)} d`;
    return new Date(timestamp * 1000).toLocaleDateString("sk-SK");
  };

  const athForCurrentSelection = useMemo(() => {
    if (athReachedPortfolios.length === 0) return false;
    if (isAllPortfolios) return true;
    const currentId = selectedPortfolio?.id;
    if (!currentId) return false;
    return athReachedPortfolios.some((p) => p.id === currentId);
  }, [athReachedPortfolios, isAllPortfolios, selectedPortfolio?.id]);

  const athReachedPortfoliosForDialog = useMemo(() => {
    if (athReachedPortfolios.length === 0) return [];
    const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
    if (!athHistoryByPortfolio) return athReachedPortfolios;
    return athReachedPortfolios.map((p) => {
      if (p.previousAthDate) return p;
      const points = athHistoryByPortfolio[p.id]?.points ?? [];
      return {
        ...p,
        previousAthDate: findPreviousAthDate(points, todayIso),
      };
    });
  }, [athReachedPortfolios, athHistoryByPortfolio]);
  const dashboardPortfolioLabel = isAllPortfolios
    ? "Všetky portfóliá"
    : selectedPortfolio?.name ?? "Vybrané portfólio";

  const importantNotifications = useMemo<PortfolioNotificationItem[]>(() => {
    const items: PortfolioNotificationItem[] = [];
    const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
    const ownershipCutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const calendarHorizonIso = format(
      new Date(startOfDay(new Date()).getTime() + 7 * 24 * 60 * 60 * 1000),
      "yyyy-MM-dd",
    );

    for (const row of ownershipAlertRows) {
      const eventMs = row.date ? Date.parse(row.date) : NaN;
      if (Number.isFinite(eventMs) && eventMs < ownershipCutoffMs) continue;
      const actorKindLabel = row.kind === "INSIDER" ? "Insider" : "Inštitúcia";
      const actionLabel = row.action === "BUY" ? "nákup" : "predaj";
      const sharesLabel = row.shares != null ? `${formatOwnershipCount(row.shares)} ks` : "počet ks —";
      const valueLabel =
        row.value != null
          ? `${formatOwnershipCount(row.value)}${row.currency ? ` ${row.currency}` : ""}`
          : "hodnota —";
      items.push({
        id: `ownership-${row.id}`,
        kind: "ownership",
        title: `${row.ticker}: ${actorKindLabel} ${actionLabel}`,
        subtitle: `${row.actorName} · ${sharesLabel} · ${valueLabel}`,
        dateIso: row.date,
        tone: row.action === "BUY" ? "positive" : "warning",
        infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(row.ticker)}`,
      });
    }

    const athRows = isAllPortfolios
      ? athReachedPortfoliosForDialog
      : athReachedPortfoliosForDialog.filter((p) => p.id === selectedPortfolio?.id);
    for (const p of athRows) {
      items.push({
        id: `ath-${p.id}`,
        kind: "ath",
        title: `${p.name} dosiahlo ATH`,
        subtitle: p.previousAthDate
          ? `Predchádzajúce ATH: ${format(parse(p.previousAthDate, "yyyy-MM-dd", new Date()), "d. M. yyyy", {
              locale: sk,
            })}`
          : "Prvé zachytené ATH",
        dateIso: todayIso,
        tone: "positive",
      });
    }

    for (const ev of mergedDashboardCalendarEvents
      .filter((e) => e.date >= todayIso && e.date <= calendarHorizonIso)
      .slice(0, 8)) {
      const label =
        ev.type === "earnings" ? "Earnings" : ev.type === "dividend" ? "Dividenda" : "Makro udalosť";
      items.push({
        id: `calendar-${ev.type}-${ev.date}-${ev.title}`,
        kind: ev.type,
        title: `${label}: ${ev.title}`,
        subtitle: ev.subtitle,
        dateIso: ev.date,
        tone: ev.type === "macro" ? "warning" : "default",
        infoUrl: ev.infoUrl,
      });
    }

    if (holdings && quotes) {
      const seen = new Set<string>();
      for (const h of holdings) {
        const ticker = (h.ticker || "").toUpperCase();
        if (!ticker || seen.has(ticker)) continue;
        seen.add(ticker);
        const shares = parseFloat(h.shares);
        if (!Number.isFinite(shares) || shares <= 0) continue;
        if (ticker === "CASH" || isPokemonTicker(ticker)) continue;
        const pct = Number(quotes[ticker]?.changePercent);
        if (!Number.isFinite(pct) || Math.abs(pct) < 5) continue;
        const rising = pct >= 0;
        items.push({
          id: `move-${ticker}`,
          kind: rising ? "move-up" : "move-down",
          title: `${ticker} ${rising ? "rastie" : "klesá"} ${Math.abs(pct).toFixed(2)}%`,
          subtitle: (h.companyName || ticker).trim(),
          dateIso: todayIso,
          tone: rising ? "positive" : "negative",
          infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`,
        });
      }
    }

    const rank = (n: PortfolioNotificationItem) => {
      switch (n.kind) {
        case "move-down":
          return 0;
        case "ownership":
          return 1;
        case "move-up":
          return 2;
        case "ath":
          return 3;
        case "earnings":
          return 4;
        case "dividend":
          return 5;
        case "macro":
          return 6;
        default:
          return 10;
      }
    };

    return items
      .sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        const ta = a.dateIso ? Date.parse(a.dateIso) : -Infinity;
        const tb = b.dateIso ? Date.parse(b.dateIso) : -Infinity;
        return tb - ta;
      })
      .slice(0, 30);
  }, [
    athReachedPortfoliosForDialog,
    holdings,
    isAllPortfolios,
    mergedDashboardCalendarEvents,
    ownershipAlertRows,
    quotes,
    selectedPortfolio?.id,
  ]);

  const importantNotificationCount = importantNotifications.length;

  const calculateOpenOptionsValue = () => {
    if (!optionTrades) return { 
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

  // Hotovosť = disponibilné EUR (vklady/výbery mínus nákupy + predaje + dividendy/dane; GET /api/portfolios).
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
    const hasOptions =
      !!optionStats && Number.isFinite(Number(optionStats.totalTrades)) && Number(optionStats.totalTrades) > 0;
    
    const stockRealizedGain = convertPrice(
      realizedGains?.realizedGainTotal ?? realizedGains?.totalRealized ?? 0,
      "EUR",
    );
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
        totalProfitPercent: 0,
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
        const quoteCurrency = getTickerCurrency(holding.ticker);
        const costCurrency = resolveHoldingCostCurrency(holding);
        const investedForPnl = pnlInvestedForDisplay(holding);
        
        totalInvested += investedForPnl;
        
        if (quote && Number.isFinite(quote.price) && quote.price > 0) {
          const convertedPrice = convertPrice(quote.price, quoteCurrency);
          const convertedChange = convertPrice(quote.change, quoteCurrency);
          const currentValue = shares * convertedPrice;
          stockValue += currentValue;
          dailyChange += shares * convertedChange;
        } else {
          stockValue += convertPrice(invested, costCurrency);
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

  const metrics = useMemo(
    () => calculatePortfolioMetrics(),
    [
      holdings,
      quotes,
      isAllPortfolios,
      optionStats,
      optionTrades,
      realizedGains,
      dividends,
      cashValue,
      convertPrice,
      getTickerCurrency,
      resolveHoldingCostCurrency,
      pnlInvestedForDisplay,
    ],
  );

  const preOpenPreview = useMemo(() => {
    if (!holdings || holdings.length === 0 || !quotes) {
      return { available: false, amount: 0, percent: 0 };
    }

    const usSession = getUsMarketSessionState();
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

    if (!hasPreOpenData) {
      return { available: false, amount: 0, percent: 0 };
    }

    const amount = totalPreOpen - totalCurrent;
    const percent = totalCurrent > 0 ? (amount / totalCurrent) * 100 : 0;
    return { available: true, amount, percent };
  }, [holdings, quotes, convertPrice, getTickerCurrency]);

  const ytdComparison = useMemo(() => {
    const points = ytdHistory?.points ?? [];
    if (points.length === 0) return null;
    const last = points[points.length - 1];
    if (!last) return null;
    const portfolio = Number.isFinite(last.portfolioCumulativePct) ? last.portfolioCumulativePct : 0;
    const sp500 = Number.isFinite(last.sp500CumulativePct) ? last.sp500CumulativePct : 0;
    return {
      portfolio,
      sp500,
      alpha: portfolio - sp500,
      yearLabel: ytdHistory?.startIso?.slice(0, 4) ?? String(new Date().getFullYear()),
    };
  }, [ytdHistory]);

  const displayedDailyChange = usSessionState === "LIVE" ? metrics.dailyChange : 0;
  const displayedDailyChangePercent = usSessionState === "LIVE" ? metrics.dailyChangePercent : 0;
  const moversContextText = moversUseExtendedQuotes
    ? isAllPortfolios
      ? "Mimo hlavnej relácie US: pred/po obchode z držaných akcií vo všetkých portfóliách (zobrazia sa len tituly s dostupnou pred/po-obchodnou kotáciou)."
      : `Mimo hlavnej relácie US: pred/po obchode z držaných akcií v portfóliu „${selectedPortfolio?.name ?? "vybrané"}“ (zobrazia sa len tituly s dostupnou pred/po-obchodnou kotáciou).`
    : isAllPortfolios
      ? "Počas hlavnej relácie US: denná zmena RTH z držaných akcií vo všetkých portfóliách."
      : `Počas hlavnej relácie US: denná zmena RTH z držaných akcií v portfóliu „${selectedPortfolio?.name ?? "vybrané"}“.`;

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

  const openMobileAssetsSortDialog = useCallback(() => {
    setDraftMobileSortBy(mobileAssetsSortBy);
    setDraftMobileSortOrder(mobileAssetsSortOrder);
    setMobileAssetsSortDialogOpen(true);
  }, [mobileAssetsSortBy, mobileAssetsSortOrder]);

  const applyMobileAssetsSort = useCallback(() => {
    setMobileAssetsSortBy(draftMobileSortBy);
    setMobileAssetsSortOrder(draftMobileSortOrder);
    setMobileAssetsSortDialogOpen(false);
  }, [draftMobileSortBy, draftMobileSortOrder, setMobileAssetsSortBy, setMobileAssetsSortOrder]);

  const sortedHoldingsDesktop = useMemo(
    () =>
      sortHoldingsArray(
        holdings,
        quotes,
        sortField,
        sortDirection,
        convertPrice,
        convertAverageCostPrice,
        getTickerCurrency,
        resolveHoldingCostCurrency,
        pnlInvestedForDisplay,
      ),
    [holdings, quotes, sortField, sortDirection, convertPrice, convertAverageCostPrice, getTickerCurrency, resolveHoldingCostCurrency, pnlInvestedForDisplay],
  );

  const mobileSortField: SortField =
    mobileAssetsSortBy === "value"
      ? "value"
      : mobileAssetsSortBy === "netProfit"
        ? "gainLoss"
        : mobileAssetsSortBy === "gainPercent"
          ? "gainLossPercent"
          : "companyName";

  const sortedHoldingsMobile = useMemo(
    () =>
      sortHoldingsArray(
        holdings,
        quotes,
        mobileSortField,
        mobileAssetsSortOrder,
        convertPrice,
        convertAverageCostPrice,
        getTickerCurrency,
        resolveHoldingCostCurrency,
        pnlInvestedForDisplay,
      ),
    [holdings, quotes, mobileSortField, mobileAssetsSortOrder, convertPrice, convertAverageCostPrice, getTickerCurrency, resolveHoldingCostCurrency, pnlInvestedForDisplay],
  );

  const collapsedDesktop = useMemo(
    () =>
      collapsePokemonInAllPortfolios(
        sortedHoldingsDesktop,
        quotes,
        isAllPortfolios,
        sortField,
        sortDirection,
        convertPrice,
        convertAverageCostPrice,
        getTickerCurrency,
        resolveHoldingCostCurrency,
        pnlInvestedForDisplay,
      ),
    [
      sortedHoldingsDesktop,
      quotes,
      isAllPortfolios,
      sortField,
      sortDirection,
      convertPrice,
      convertAverageCostPrice,
      getTickerCurrency,
      resolveHoldingCostCurrency,
      pnlInvestedForDisplay,
    ],
  );

  const collapsedMobile = useMemo(
    () =>
      collapsePokemonInAllPortfolios(
        sortedHoldingsMobile,
        quotes,
        isAllPortfolios,
        mobileSortField,
        mobileAssetsSortOrder,
        convertPrice,
        convertAverageCostPrice,
        getTickerCurrency,
        resolveHoldingCostCurrency,
        pnlInvestedForDisplay,
      ),
    [
      sortedHoldingsMobile,
      quotes,
      isAllPortfolios,
      mobileSortField,
      mobileAssetsSortOrder,
      convertPrice,
      convertAverageCostPrice,
      getTickerCurrency,
      resolveHoldingCostCurrency,
      pnlInvestedForDisplay,
    ],
  );

  const flatHoldingsDesktop = useMemo(
    () => flattenPokemonGroup(collapsedDesktop.rows, collapsedDesktop.children, pokemonGroupOpen),
    [collapsedDesktop, pokemonGroupOpen],
  );

  const flatHoldingsMobile = useMemo(
    () => flattenPokemonGroup(collapsedMobile.rows, collapsedMobile.children, pokemonGroupOpen),
    [collapsedMobile, pokemonGroupOpen],
  );

  const pokemonChildIds = useMemo(() => {
    const ids = new Set<string>();
    for (const holding of collapsedDesktop.children) ids.add(holding.id);
    for (const holding of collapsedMobile.children) ids.add(holding.id);
    return ids;
  }, [collapsedDesktop.children, collapsedMobile.children]);

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

  const renderGainersCard = () => (
    <Card data-testid="dashboard-daily-gainers">
      <CardHeader className="p-2.5 md:p-6">
        <CardTitle className="text-base md:text-lg flex items-center gap-2 flex-wrap">
          <TrendingUp className="h-4 w-4 text-green-500" />
          Najlepšie (%)
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center rounded-sm p-0.5 text-muted-foreground hover:bg-muted"
                aria-label="Info: denné najsilnejšie"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px]">
              <p className="text-xs">{moversContextText}</p>
            </TooltipContent>
          </Tooltip>
          {moversUseExtendedQuotes && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400"
                  aria-label="Mimo hlavnej relácie"
                >
                  <Moon className={`h-3.5 w-3.5 ${premarketMoonClass}`} />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px]">
                <p className="text-xs">
                  Počas hlavnej relácie US (15:30–22:00 SEČ v pracovný deň) je rebríček z{" "}
                  <span className="font-medium">dennej zmeny RTH</span>. Mimo toho sa použije predobchodná alebo
                  poobchodná zmena oproti záverečnej cene RTH, ak ju máme v kotácii.
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Zmena podľa režimu trhu (RTH vs pre/post market).
        </CardDescription>
      </CardHeader>
      <CardContent className="p-2.5 pt-0 md:p-6 md:pt-0">
        {quotesFetching && !quotesData ? (
          <>
            {Array.from({ length: dailyMoversCount }, (_, i) => (
              <Skeleton key={i} className="h-9 md:h-10 w-full" />
            ))}
          </>
        ) : dailyMovers.gainers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {moversUseExtendedQuotes
              ? "Žiadna držaná akcia nemá v pluse pred/po-obchodný pohyb (alebo kotácia neposiela údaje)."
              : "Žiadna z držaných akcií v hlavnej relácii dnes nebola v pluse."}
          </p>
        ) : (
          dailyMovers.gainers.map((row, idx) =>
            renderDailyMoverRow(
              row,
              idx,
              "text-green-500",
              `dashboard-gainer-${idx}`,
              `dashboard-gainer-value-${idx}`,
            ),
          )
        )}
      </CardContent>
    </Card>
  );

  const renderLosersCard = () => (
    <Card data-testid="dashboard-daily-losers">
      <CardHeader className="p-2.5 md:p-6">
        <CardTitle className="text-base md:text-lg flex items-center gap-2 flex-wrap">
          <TrendingDown className="h-4 w-4 text-red-500" />
          Najhoršie (%)
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center rounded-sm p-0.5 text-muted-foreground hover:bg-muted"
                aria-label="Info: denné najslabšie"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px]">
              <p className="text-xs">{moversContextText}</p>
            </TooltipContent>
          </Tooltip>
          {moversUseExtendedQuotes && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400"
                  aria-label="Mimo hlavnej relácie"
                >
                  <Moon className={`h-3.5 w-3.5 ${premarketMoonClass}`} />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px]">
                <p className="text-xs">
                  Počas hlavnej relácie US (15:30–22:00 SEČ v pracovný deň) je rebríček z{" "}
                  <span className="font-medium">dennej zmeny RTH</span>. Mimo toho sa použije predobchodná alebo
                  poobchodná zmena oproti záverečnej cene RTH, ak ju máme v kotácii.
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Zmena podľa režimu trhu (RTH vs pre/post market).
        </CardDescription>
      </CardHeader>
      <CardContent className="p-2.5 pt-0 md:p-6 md:pt-0">
        {quotesFetching && !quotesData ? (
          <>
            {Array.from({ length: dailyMoversCount }, (_, i) => (
              <Skeleton key={i} className="h-9 md:h-10 w-full" />
            ))}
          </>
        ) : dailyMovers.losers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {moversUseExtendedQuotes
              ? "Žiadna držaná akcia nemá v mínuse pred/po-obchodný pohyb (alebo kotácia neposiela údaje)."
              : "Žiadna z držaných akcií v hlavnej relácii dnes nebola v mínuse."}
          </p>
        ) : (
          dailyMovers.losers.map((row, idx) =>
            renderDailyMoverRow(
              row,
              idx,
              "text-red-500",
              `dashboard-loser-${idx}`,
              `dashboard-loser-value-${idx}`,
            ),
          )
        )}
      </CardContent>
    </Card>
  );

  const pairMoversDesktop =
    isDashboardWidgetVisible("dailyGainers") &&
    isDashboardWidgetVisible("dailyLosers") &&
    !dashboardEditing;
  const moversFirstId =
    dashboardOrder.indexOf("dailyGainers") <= dashboardOrder.indexOf("dailyLosers")
      ? "dailyGainers"
      : "dailyLosers";
  const moversHasContent =
    (portfolios.length > 0 && moversTickers.length > 0) || dashboardEditing;

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
    <div className="flex flex-col gap-3 md:gap-5">
      <div className="hidden md:flex items-center gap-2 min-w-0" data-testid="desktop-portfolio-header">
        {!isAllPortfolios && <BrokerLogo brokerCode={selectedPortfolio?.brokerCode} size="sm" />}
        <h1
          className="text-lg md:text-xl font-semibold text-foreground truncate min-w-0"
          data-testid="text-desktop-portfolio-name"
        >
          {dashboardPortfolioLabel}
        </h1>
        {athForCurrentSelection && (
          <span
            className="shrink-0 inline-flex items-center gap-0.5 text-sm motion-safe:animate-bounce"
            title="ATH dnes"
            data-testid="badge-desktop-portfolio-ath-confetti"
          >
            <span aria-hidden>🎉</span>
            <span aria-hidden>✨</span>
          </span>
        )}
      </div>

      <Dialog open={showAthPopup && athDialogOpen} onOpenChange={handleAthDialogOpenChange}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Nové ATH portfólia</DialogTitle>
            <DialogDescription>
              {athReachedPortfoliosForDialog.length === 1
                ? "Portfólio dosiahlo nové maximum hodnoty."
                : `${athReachedPortfoliosForDialog.length} portfóliá dosiahli nové maximum hodnoty.`}
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border rounded-md border border-border/60">
            {athReachedPortfoliosForDialog.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
                data-testid="badge-ath-portfolio-name"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <BrokerLogo brokerCode={p.brokerCode} size="sm" />
                  <span className="text-sm font-medium truncate">{p.name}</span>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-muted-foreground leading-tight">Posledné ATH</p>
                  <p className="text-xs font-medium tabular-nums leading-tight">
                    {p.previousAthDate
                      ? format(parse(p.previousAthDate, "yyyy-MM-dd", new Date()), "d. MMM yyyy", {
                          locale: sk,
                        })
                      : "Prvé ATH"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-start gap-2">
            <Checkbox
              id="ath-popup-dont-show-today"
              checked={athDontShowAgainToday}
              onCheckedChange={(v) => setAthDontShowAgainToday(v === true)}
              data-testid="checkbox-ath-dont-show-today"
            />
            <Label
              htmlFor="ath-popup-dont-show-today"
              className="text-xs text-muted-foreground font-normal leading-snug cursor-pointer"
            >
              Dnes už nezobrazovať (do polnoci v tomto okne prehliadača)
            </Label>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCalendarEventsPopup && calendarTodayDialogOpen}
        onOpenChange={setCalendarTodayDialogOpen}
      >
        <DialogContent className="max-w-md max-h-[min(85vh,520px)] flex flex-col gap-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 shrink-0 text-primary" />
              Dnešné udalosti v kalendári
            </DialogTitle>
            <DialogDescription>
              Na dnes máte v trhovom kalendári tieto udalosti (podľa zvoleného portfólia a makro dát).
            </DialogDescription>
          </DialogHeader>
          <ul className="mt-3 space-y-3 overflow-y-auto pr-1 text-sm" data-testid="list-dashboard-calendar-today">
            {todayCalendarEvents.map((ev, idx) => (
              <li
                key={`${ev.date}-${ev.type}-${ev.title}-${idx}`}
                className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {ev.type === "earnings" && (
                    <Badge className="bg-blue-600 hover:bg-blue-600 text-[10px]">Earnings</Badge>
                  )}
                  {ev.type === "dividend" && (
                    <Badge className="bg-green-600 hover:bg-green-600 text-[10px]">Dividendy</Badge>
                  )}
                  {ev.type === "macro" && (
                    <Badge className="bg-orange-600 hover:bg-orange-600 text-[10px]">Makro</Badge>
                  )}
                  {ev.session === "BMO" && (
                    <span className="text-[10px] text-muted-foreground">Pred otvorením (BMO)</span>
                  )}
                  {ev.session === "AMC" && (
                    <span className="text-[10px] text-muted-foreground">Po zatvorení (AMC)</span>
                  )}
                </div>
                <p className="font-medium leading-snug">{ev.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{ev.subtitle}</p>
                <a
                  href={ev.infoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
                >
                  Otvoriť zdroj
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showAnalystRatingPopup && analystRatingDialogOpen}
        onOpenChange={setAnalystRatingDialogOpen}
      >
        <DialogContent className="max-w-md max-h-[min(85vh,520px)] flex flex-col gap-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
              Zmeny analyst ratingov
            </DialogTitle>
            <DialogDescription>
              Analytik zmenil ohodnotenie aktíva vo vašom portfóliu.
            </DialogDescription>
          </DialogHeader>
          <ul
            className="mt-3 space-y-3 overflow-y-auto pr-1 text-sm"
            data-testid="list-dashboard-analyst-rating-changes"
          >
            {analystRatingChanges.map((row) => {
              const ch = row.latestChange;
              const action = (ch?.action ?? "").toLowerCase();
              const actionLabel =
                action === "up"
                  ? "Upgrade"
                  : action === "down"
                    ? "Downgrade"
                    : action === "init"
                      ? "Init"
                      : action === "main" || action === "reit"
                        ? "Maintain"
                        : ch?.action || "Zmena";
              const gradeLine =
                ch?.fromGrade || ch?.toGrade
                  ? `${ch?.fromGrade || "—"} → ${ch?.toGrade || "—"}`
                  : null;
              const targetLine =
                ch?.priceTarget != null
                  ? `${ch.priceTarget.toLocaleString("sk-SK", {
                      maximumFractionDigits: 2,
                    })}${row.currency ? ` ${row.currency}` : ""}`
                  : null;
              return (
                <li
                  key={`${row.ticker}-${ch?.date ?? ""}-${ch?.firm ?? ""}`}
                  className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium leading-snug truncate">
                        {row.companyName}{" "}
                        <span className="font-mono text-xs text-muted-foreground">{row.ticker}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {ch?.firm || "Analytik"}
                        {ch?.date
                          ? ` · ${format(parse(ch.date, "yyyy-MM-dd", new Date()), "d. MMM yyyy", {
                              locale: sk,
                            })}`
                          : ""}
                      </p>
                      <p className="text-xs mt-1">
                        <span className="font-medium">{actionLabel}</span>
                        {gradeLine ? <span className="text-muted-foreground"> · {gradeLine}</span> : null}
                      </p>
                      {targetLine && (
                        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                          Target {targetLine}
                          {ch?.priorPriceTarget != null
                            ? ` (pred: ${ch.priorPriceTarget.toLocaleString("sk-SK", {
                                maximumFractionDigits: 2,
                              })})`
                            : ""}
                        </p>
                      )}
                    </div>
                    {row.recommendationKey && (
                      <Badge variant="outline" className="shrink-0 capitalize text-[10px]">
                        {row.recommendationKey.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
                    onClick={() => {
                      setAnalystRatingDialogOpen(false);
                      setLocation(`/asset/${encodeURIComponent(row.ticker)}`);
                    }}
                  >
                    Otvoriť detail aktíva
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>

      {dashboardEditing && (
        <p className="text-[11px] text-muted-foreground px-0.5 -mt-1 mb-0.5" data-testid="dashboard-edit-hint">
          Oko skryje/zobrazí widget, ⋯ otvorí nastavenia, ťahaním zmeňte poradie.
        </p>
      )}

      <DndContext
        sensors={dashboardDnDSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDashboardDragEnd}
      >
        <SortableContext items={dashboardOrder} strategy={verticalListSortingStrategy}>
          {dashboardOrder.map((widgetId) => {
            const visible = isDashboardWidgetVisible(widgetId);
            if (widgetId === "summary") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                >
                  <>
      <MobilePortfolioChart 
        totalValue={metrics.totalValue}
        totalInvested={metrics.totalInvested}
        dailyChange={metrics.dailyChange}
        dailyChangePercent={metrics.dailyChangePercent}
        totalProfit={metrics.totalProfit}
        totalProfitPercent={metrics.totalProfitPercent}
        unrealizedGain={metrics.unrealizedGain}
        cashValue={metrics.cashValue}
        onRefreshQuotes={refreshDashboardQuotes}
        quotesRefreshing={quotesFetching}
        athCelebrationActive={athForCurrentSelection}
        importantNotifications={importantNotifications}
        importantNotificationCount={importantNotificationCount}
      />

      <div
        className={cn(
          "hidden md:grid gap-3 md:grid-cols-2 lg:grid-cols-3",
          (() => {
            const n =
              2 +
              (isDashboardWidgetVisible("earnings") ? 1 : 0) +
              (isDashboardWidgetVisible("topPosition") ? 1 : 0) +
              (isDashboardWidgetVisible("macroEvent") ? 1 : 0) +
              (isDashboardWidgetVisible("ytdBenchmark") ? 1 : 0);
            if (n >= 6) return "xl:grid-cols-6";
            if (n === 5) return "xl:grid-cols-5";
            if (n === 4) return "xl:grid-cols-4";
            return "xl:grid-cols-3";
          })(),
        )}
      >
        {(() => {
          const boxClass =
            "h-full min-h-[148px] border-border bg-card shadow-sm flex flex-col overflow-hidden";
          const headClass =
            "flex flex-row items-center justify-between gap-2 space-y-0 px-3 py-2.5 min-h-[44px] shrink-0";
          const titleClass =
            "text-xs font-medium text-muted-foreground truncate min-w-0 flex items-center gap-1";
          const actionClass =
            "h-7 w-7 shrink-0 inline-flex items-center justify-center text-muted-foreground";
          const bodyClass =
            "flex flex-1 flex-col justify-between gap-2 px-3 pb-3 pt-0 min-h-0";
          const primaryClass =
            "text-xl font-semibold leading-tight tracking-tight tabular-nums truncate";
          const metaClass = "text-xs text-muted-foreground truncate";
          const footClass = "space-y-0.5 min-w-0";

          return (
            <>
        <Card className={boxClass} data-testid="card-total-value">
          <CardHeader className={headClass}>
            <CardTitle className={titleClass}>
              Celková hodnota
              {metrics.optionsIncluded && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                  + opcie
                </Badge>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px]">
                  <p className="font-semibold mb-1">Celková hodnota portfólia</p>
                  <p className="text-xs">Súčet aktuálnej trhovej hodnoty všetkých vašich pozícií. Pri opciách sa počíta hodnota prémia otvorených pozícií.</p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            <div className={actionClass}>
              {holdings && holdings.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
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
              ) : null}
            </div>
          </CardHeader>
          <CardContent className={bodyClass}>
            <div className="min-w-0 space-y-0.5">
              <div className={primaryClass} data-testid="text-total-value">
                {maskAmount(formatCurrency(metrics.totalValue))}
              </div>
              <p className={`${metaClass} tabular-nums ${getChangeColor(displayedDailyChange)}`}>
                Dnes {displayedDailyChange >= 0 ? "+" : ""}
                {maskAmount(formatCurrency(displayedDailyChange))}
                <span className="ml-1">({formatPercent(displayedDailyChangePercent)})</span>
              </p>
            </div>
            <div className={footClass}>
              <p className={metaClass}>
                Investované: {maskAmount(formatCurrency(metrics.totalInvested))}
              </p>
              {shouldUseExtendedQuotes(usSessionState) && (
                <p className={`${metaClass} inline-flex items-center gap-1`} data-testid="text-pre-open-preview">
                  <Moon className={`h-3 w-3 ${premarketMoonClass}`} />
                  {getExtendedSessionLabel(usSessionState)}{" "}
                  {preOpenPreview.available ? (
                    <>
                      <span className={getChangeColor(preOpenPreview.amount)}>
                        {preOpenPreview.amount >= 0 ? "+" : ""}
                        {maskAmount(formatCurrency(preOpenPreview.amount))}
                      </span>
                      <span className={`ml-1 ${getChangeColor(preOpenPreview.percent)}`}>
                        ({formatPercent(preOpenPreview.percent)})
                      </span>
                    </>
                  ) : (
                    "bez dát"
                  )}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className={boxClass} data-testid="card-total-profit">
          <CardHeader className={headClass}>
            <CardTitle className={titleClass}>
              Celkový profit
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-[300px]">
                  <p className="font-semibold mb-1">Celkový profit (P&L)</p>
                  <p className="text-xs mb-2">
                    Pre akcie: kapitálový zisk (FIFO, náklad v EUR v deň D), FX a dividendy z API. Celková suma hore stále zahŕňa opcie, ak ich máš.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            <div className={actionClass}>{getChangeIcon(metrics.totalProfit)}</div>
          </CardHeader>
          <CardContent className={bodyClass}>
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className={`${primaryClass} ${getChangeColor(metrics.totalProfit)}`} data-testid="text-total-profit">
                  {maskAmount(formatCurrency(metrics.totalProfit))}
                </span>
                <span className={`text-xs font-medium shrink-0 tabular-nums ${getChangeColor(metrics.totalProfitPercent || 0)}`} data-testid="text-total-profit-percent">
                  {formatPercent(metrics.totalProfitPercent || 0)}
                </span>
              </div>
            </div>
            <div className={footClass}>
              <p className={metaClass}>
                Nerealizovaný {maskAmount(formatCurrency(metrics.unrealizedGain))}
              </p>
            </div>
          </CardContent>
        </Card>

        {isDashboardWidgetVisible("earnings") && (
          <Card className={boxClass} data-testid="card-desktop-next-earnings">
            <CardHeader className={headClass}>
              <CardTitle className={titleClass}>Earnings</CardTitle>
              <div className={actionClass}>
                {mobileEarningsItems.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Ďalší earnings"
                    onClick={() =>
                      setMobileEarningsIndex((prev) => (prev + 1) % mobileEarningsItems.length)
                    }
                    data-testid="button-desktop-next-earnings-next"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className={bodyClass}>
              {currentMobileEarnings ? (
                <button
                  type="button"
                  className="flex flex-1 flex-col justify-between gap-2 w-full text-left min-w-0"
                  onClick={() =>
                    setLocation(`/asset/${encodeURIComponent(currentMobileEarnings.ticker)}`)
                  }
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CompanyLogo
                      ticker={currentMobileEarnings.ticker}
                      companyName={currentMobileEarnings.companyName}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className={`${primaryClass} text-lg`}>{currentMobileEarnings.ticker}</p>
                      <p className={metaClass}>{currentMobileEarnings.companyName}</p>
                    </div>
                  </div>
                  <div className={footClass}>
                    <p className="text-xs font-medium tabular-nums truncate">
                      {format(
                        parse(currentMobileEarnings.date, "yyyy-MM-dd", new Date()),
                        "d. MMM yyyy",
                        { locale: sk },
                      )}
                    </p>
                  </div>
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">Žiadny najbližší earnings</p>
              )}
            </CardContent>
          </Card>
        )}

        {isDashboardWidgetVisible("topPosition") && (
          <Card className={boxClass} data-testid="card-desktop-top-position">
            <CardHeader className={headClass}>
              <CardTitle className={titleClass}>Top pozícia</CardTitle>
              <div className={actionClass}>
                {mobileTopPositions.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Ďalšia pozícia"
                    onClick={() =>
                      setMobileTopPositionIndex((prev) => (prev + 1) % mobileTopPositions.length)
                    }
                    data-testid="button-desktop-top-position-next"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className={bodyClass}>
              {currentMobileTopPosition ? (
                <button
                  type="button"
                  className="flex flex-1 flex-col justify-between gap-2 w-full text-left min-w-0"
                  onClick={() =>
                    setLocation(`/asset/${encodeURIComponent(currentMobileTopPosition.ticker)}`)
                  }
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CompanyLogo
                      ticker={currentMobileTopPosition.ticker}
                      companyName={currentMobileTopPosition.companyName}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className={`${primaryClass} text-lg`}>{currentMobileTopPosition.ticker}</p>
                      <p className={metaClass}>
                        {currentMobileTopPosition.companyName || "Bez názvu"}
                      </p>
                    </div>
                  </div>
                  <div className={footClass}>
                    <p className="text-xs font-semibold tabular-nums text-primary truncate">
                      {currentMobileTopPositionPct.toFixed(1)}%
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {maskAmount(formatCurrency(currentMobileTopPosition.value))}
                      </span>
                    </p>
                  </div>
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">Žiadna top pozícia</p>
              )}
            </CardContent>
          </Card>
        )}

        {isDashboardWidgetVisible("macroEvent") && (
          <Card className={boxClass} data-testid="card-desktop-next-macro">
            <CardHeader className={headClass}>
              <CardTitle className={titleClass}>Udalosť</CardTitle>
              <div className={actionClass}>
                {mobileMacroEvents.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Ďalšia makro udalosť"
                    onClick={() =>
                      setMobileMacroEventIndex((prev) => (prev + 1) % mobileMacroEvents.length)
                    }
                    data-testid="button-desktop-next-macro-event-next"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className={bodyClass}>
              {currentMobileMacroEvent ? (
                <>
                  <div className="min-w-0 space-y-0.5">
                    <p className={`${primaryClass} text-lg`}>{currentMobileMacroEvent.shortLabel}</p>
                    <p className={`${metaClass} line-clamp-2`}>{currentMobileMacroEvent.title}</p>
                  </div>
                  <div className={footClass}>
                    <p className="text-xs font-medium tabular-nums truncate">
                      {format(
                        parse(currentMobileMacroEvent.date, "yyyy-MM-dd", new Date()),
                        "d. MMM yyyy",
                        { locale: sk },
                      )}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Žiadna makro udalosť</p>
              )}
            </CardContent>
          </Card>
        )}

        {isDashboardWidgetVisible("ytdBenchmark") && (
          <Card className={boxClass} data-testid="card-ytd-benchmark">
            <CardHeader className={headClass}>
              <CardTitle className={titleClass}>
                YTD vs S&amp;P 500
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[300px]">
                    <p className="font-semibold mb-1">Porovnanie od začiatku roka</p>
                    <p className="text-xs">
                      Porovnávame výkonnosť vášho portfólia voči S&amp;P 500 v rovnakom YTD intervale. Alpha je rozdiel
                      portfólia mínus index.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
              <div className={actionClass} aria-hidden />
            </CardHeader>
            <CardContent className={bodyClass}>
              {ytdComparison ? (
                <>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span
                        className={`${primaryClass} ${getChangeColor(ytdComparison.alpha)}`}
                        data-testid="text-ytd-alpha"
                      >
                        {formatPercent(ytdComparison.alpha)}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">Alpha</span>
                    </div>
                    <p className={metaClass}>
                      YTD {ytdComparison.yearLabel ?? new Date().getFullYear()}
                    </p>
                  </div>
                  <div className={footClass}>
                    <p className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground truncate">Portfólio</span>
                      <span className={`font-semibold tabular-nums shrink-0 ${getChangeColor(ytdComparison.portfolio)}`}>
                        {formatPercent(ytdComparison.portfolio)}
                      </span>
                    </p>
                    <p className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground truncate">S&amp;P 500</span>
                      <span className={`font-semibold tabular-nums shrink-0 ${getChangeColor(ytdComparison.sp500)}`}>
                        {formatPercent(ytdComparison.sp500)}
                      </span>
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className={`${primaryClass} text-muted-foreground`}>—</p>
                    <p className={metaClass}>YTD {new Date().getFullYear()}</p>
                  </div>
                  <p className={metaClass}>YTD dáta sa načítavajú…</p>
                </>
              )}
            </CardContent>
          </Card>
        )}
            </>
          );
        })()}
      </div>

                  </>
                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "chart") {
              const allocationVisible = isDashboardWidgetVisible("allocation");
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={isMobileViewport}
                  emptyHint="Na mobile je graf v súhrne — oko ho zapína/vypína"
                >
      <div
        className={`hidden md:grid gap-4 ${
          allocationVisible ? "lg:grid-cols-3" : ""
        }`}
      >
        <div className={allocationVisible ? "lg:col-span-2 min-w-0" : "min-w-0"}>
          <DesktopPortfolioChart
            totalValue={metrics.totalValue}
            totalInvested={metrics.totalInvested}
            totalProfit={metrics.totalProfit}
            totalProfitPercent={metrics.totalProfitPercent}
          />
        </div>
        {allocationVisible ? (
          <div className="lg:col-span-1 min-w-0">
            <DashboardAllocationWidget
              holdings={holdings}
              quotes={quotes}
              cashValue={metrics.cashValue}
              holdingsLoading={holdingsLoading}
              isAllPortfolios={isAllPortfolios}
            />
          </div>
        ) : null}
      </div>
                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "allocation") {
              const chartAlsoVisible = isDashboardWidgetVisible("chart");
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={chartAlsoVisible && !isMobileViewport}
                  emptyHint="Na webe je alokácia vedľa grafu"
                >
                  <div className={chartAlsoVisible ? "md:hidden" : undefined}>
                    <DashboardAllocationWidget
                      holdings={holdings}
                      quotes={quotes}
                      cashValue={metrics.cashValue}
                      holdingsLoading={holdingsLoading}
                      isAllPortfolios={isAllPortfolios}
                    />
                  </div>
                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "realizedDividends") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={!isMobileViewport}
                  emptyHint="Tento box je na mobile"
                >
                  <div className="md:hidden grid gap-1.5 grid-cols-2">
                    <div className="bg-card rounded-lg p-2.5 border">
                      <div className="flex items-center justify-between gap-1">
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 min-w-0">
                          <span className="truncate">Realizovaný zisk</span>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex rounded-sm p-0.5 hover:bg-muted shrink-0"
                                aria-label="Info: realizovaný zisk"
                              >
                                <HelpCircle className="h-2.5 w-2.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="max-w-[280px] p-3" align="start">
                              <p className="font-semibold mb-1 text-sm">Realizovaný zisk</p>
                              <p className="text-xs">
                                Akcie: zisk/strata z predajov (FIFO) a z hot. riadkov XTB close trade. Plus realizácia opcií, ak sú v celku vyššie.
                              </p>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className={`text-xs font-semibold shrink-0 ${getChangeColor(metrics.stockRealizedGain + metrics.optionsRealizedGain)}`}>
                          {maskAmount(formatCurrency(metrics.stockRealizedGain + metrics.optionsRealizedGain))}
                        </div>
                      </div>
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="bg-card rounded-lg p-2.5 border w-full text-left"
                          aria-label="Detail dividend"
                          data-testid="button-mobile-dividends-detail"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1 min-w-0">
                              <span className="truncate">Dividendy (spolu)</span>
                              <HelpCircle className="h-2.5 w-2.5 shrink-0" />
                            </div>
                            <div className="text-xs font-semibold text-blue-500 shrink-0">
                              +{maskAmount(formatCurrency(metrics.dividendGain))}
                            </div>
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="max-w-[260px] p-3" align="start">
                        <p className="font-semibold mb-2 text-sm">Dividendy - rozpis</p>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Hrubé</span>
                            <span className="font-medium">
                              +{maskAmount(formatCurrency(dividends?.totalGross ?? (metrics.dividendGain + (dividends?.totalTax || 0))))}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Daň</span>
                            <span className="font-medium text-muted-foreground">
                              -{maskAmount(formatCurrency(dividends?.totalTax || 0))}
                            </span>
                          </div>
                          <div className="h-px bg-border my-1" />
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Čisté</span>
                            <span className="font-semibold text-blue-500">
                              +{maskAmount(formatCurrency(metrics.dividendGain))}
                            </span>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "ytdBenchmark") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={!isMobileViewport}
                  emptyHint="Na webe je v hornom riadku boxov"
                >
      <div className="md:hidden">
        <div className="bg-card rounded-lg border px-2.5 py-2" data-testid="card-ytd-benchmark-mobile">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Moje YTD</span>
            <span className={`font-semibold tabular-nums ${getChangeColor(ytdComparison?.portfolio ?? 0)}`}>
              {ytdComparison ? formatPercent(ytdComparison.portfolio) : "—"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">S&amp;P 500 YTD</span>
            <span className={`font-semibold tabular-nums ${getChangeColor(ytdComparison?.sp500 ?? 0)}`}>
              {ytdComparison ? formatPercent(ytdComparison.sp500) : "—"}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] border-t border-border/40 pt-1.5">
            <span className="font-medium text-muted-foreground">Alpha</span>
            <span className={`font-bold tabular-nums ${getChangeColor(ytdComparison?.alpha ?? 0)}`}>
              {ytdComparison ? formatPercent(ytdComparison.alpha) : "—"}
            </span>
          </div>
        </div>
      </div>

                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "earnings") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={!isMobileViewport}
                  emptyHint="Na webe je v hornom riadku boxov"
                >
      <div className="md:hidden">
        {(currentMobileEarnings || dashboardEditing) ? (
          currentMobileEarnings ? (
          <div
            className="w-full flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-2.5 py-1.5 text-left transition-colors hover:bg-amber-500/12 dark:border-amber-500/25 dark:bg-amber-500/10 dark:hover:bg-amber-500/[0.14]"
            data-testid="row-mobile-next-earnings"
          >
            <button
              type="button"
              className="min-w-0 flex-1 flex items-center gap-2 text-left"
              onClick={() =>
                setLocation(`/asset/${encodeURIComponent(currentMobileEarnings.ticker)}`)
              }
            >
              <CompanyLogo
                ticker={currentMobileEarnings.ticker}
                companyName={currentMobileEarnings.companyName}
                size="xs"
                className="shrink-0"
              />
              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <Calendar className="h-3 w-3 shrink-0 text-amber-700/90 dark:text-amber-400/90" aria-hidden />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
                  Earnings
                </span>
                <span className="text-[11px] font-medium truncate min-w-0 text-foreground/90">
                  {currentMobileEarnings.ticker}
                </span>
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-amber-950 dark:text-amber-100 shrink-0">
                {format(
                  parse(currentMobileEarnings.date, "yyyy-MM-dd", new Date()),
                  "d. MMM yyyy",
                  { locale: sk },
                )}
              </span>
            </button>
            {mobileEarningsItems.length > 1 && (
              <button
                type="button"
                className="shrink-0 rounded-full p-1 text-amber-900/80 hover:bg-amber-500/20 dark:text-amber-100/90"
                aria-label="Ďalší earnings"
                onClick={() =>
                  setMobileEarningsIndex((prev) => (prev + 1) % mobileEarningsItems.length)
                }
                data-testid="button-mobile-next-earnings-next"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          ) : (
            <div className="bg-card rounded-lg border px-2.5 py-2 text-[11px] text-muted-foreground">
              Žiadny najbližší earnings
            </div>
          )
        ) : null}
      </div>

                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "topPosition") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={!isMobileViewport}
                  emptyHint="Na webe je v hornom riadku boxov"
                >
      <div className="md:hidden">
        {(currentMobileTopPosition || dashboardEditing) ? (
          currentMobileTopPosition ? (
          <div
            className="w-full flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.06] px-2.5 py-1.5 text-left transition-colors hover:bg-primary/[0.1] dark:border-primary/30 dark:bg-primary/10 dark:hover:bg-primary/[0.16]"
            data-testid="row-mobile-top-position"
          >
            <button
              type="button"
              className="min-w-0 flex-1 flex items-center gap-2 text-left"
              onClick={() =>
                setLocation(`/asset/${encodeURIComponent(currentMobileTopPosition.ticker)}`)
              }
            >
              <CompanyLogo
                ticker={currentMobileTopPosition.ticker}
                companyName={currentMobileTopPosition.companyName}
                size="xs"
                className="shrink-0"
              />
              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
                  Pozícia
                </span>
                <span className="text-[11px] font-medium truncate min-w-0 text-foreground/90">
                  {currentMobileTopPosition.ticker}
                </span>
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-foreground shrink-0">
                {currentMobileTopPositionPct.toFixed(2)}%
              </span>
            </button>
            {mobileTopPositions.length > 1 && (
              <button
                type="button"
                className="shrink-0 rounded-full p-1 text-primary/90 hover:bg-primary/20"
                aria-label="Ďalšia pozícia"
                onClick={() =>
                  setMobileTopPositionIndex((prev) => (prev + 1) % mobileTopPositions.length)
                }
                data-testid="button-mobile-top-position-next"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          ) : (
            <div className="bg-card rounded-lg border px-2.5 py-2 text-[11px] text-muted-foreground">
              Žiadna top pozícia
            </div>
          )
        ) : null}
      </div>

                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "macroEvent") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={!isMobileViewport}
                  emptyHint="Na webe je v hornom riadku boxov"
                >
      <div className="md:hidden">
        {(currentMobileMacroEvent || dashboardEditing) ? (
          currentMobileMacroEvent ? (
          <div
            className="w-full flex items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.08] px-2.5 py-1.5 text-left transition-colors hover:bg-sky-500/[0.13] dark:border-sky-500/35 dark:bg-sky-500/10 dark:hover:bg-sky-500/[0.16]"
            data-testid="row-mobile-next-macro-event"
          >
            <div className="min-w-0 flex-1 flex items-center gap-1.5">
              <Calendar className="h-3 w-3 shrink-0 text-sky-700/90 dark:text-sky-300/90" aria-hidden />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
                Udalosť
              </span>
              <span className="text-[11px] font-medium truncate min-w-0 text-foreground/90">
                {currentMobileMacroEvent.shortLabel}
              </span>
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-sky-950 dark:text-sky-100 shrink-0">
              {format(
                parse(currentMobileMacroEvent.date, "yyyy-MM-dd", new Date()),
                "d. MMM yyyy",
                { locale: sk },
              )}
            </span>
            {mobileMacroEvents.length > 1 && (
              <button
                type="button"
                className="shrink-0 rounded-full p-1 text-sky-900/85 hover:bg-sky-500/25 dark:text-sky-100/90"
                aria-label="Ďalšia makro udalosť"
                onClick={() =>
                  setMobileMacroEventIndex((prev) => (prev + 1) % mobileMacroEvents.length)
                }
                data-testid="button-mobile-next-macro-event-next"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          ) : (
            <div className="bg-card rounded-lg border px-2.5 py-2 text-[11px] text-muted-foreground">
              Žiadna makro udalosť
            </div>
          )
        ) : null}
      </div>

                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "optionsInsight") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={!isMobileViewport}
                  emptyHint="Tento box je na mobile"
                >
      <div className="md:hidden">
        {(metrics.optionsIncluded || dashboardEditing) ? (
          metrics.optionsIncluded ? (
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
          ) : (
            <div className="bg-card rounded-lg border px-2.5 py-2 text-[11px] text-muted-foreground">
              Opcie nie sú v portfóliu
            </div>
          )
        ) : null}
      </div>

                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "news") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                >
                  {(holdings && holdings.length > 0) || dashboardEditing ? (
                    <>
<Card>
          <CardHeader className="p-2.5 md:p-4 pb-2">
            <div className="flex items-center gap-1.5">
              <Newspaper className="h-4 w-4 text-muted-foreground shrink-0" />
              <CardTitle className="text-sm font-medium md:text-base">Novinky k vašim aktívam</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-2.5 pt-0 md:p-4 md:pt-0">
            {newsLoading ? (
              <div className="flex gap-2 overflow-hidden">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="min-w-[210px] sm:min-w-[240px] p-2 rounded-md border bg-card">
                    <Skeleton className="h-3 w-10 mb-1.5" />
                    <Skeleton className="h-3 w-full mb-1" />
                    <Skeleton className="h-3 w-4/5 mb-1.5" />
                    <Skeleton className="h-2.5 w-20" />
                  </div>
                ))}
              </div>
            ) : news && news.length > 0 ? (
              <ScrollArea className="w-full whitespace-nowrap">
                <div className="flex gap-2 pb-2">
                  {news.map((article, index) => (
                    <a
                      key={index}
                      href={article.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-[210px] max-w-[210px] sm:min-w-[240px] sm:max-w-[260px] p-2 md:p-2.5 rounded-md border bg-card hover-elevate transition-all group block"
                      data-testid={`link-news-${index}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Badge
                          variant="outline"
                          className="text-[9px] font-normal flex items-center gap-1 px-1 py-0 h-5 leading-none"
                        >
                          <CompanyLogo ticker={article.ticker} companyName="" size="xs" />
                          {article.ticker}
                        </Badge>
                        <ExternalLink className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
                      </div>
                      <h4 className="text-xs font-semibold leading-snug line-clamp-2 whitespace-normal mb-1.5 group-hover:text-primary transition-colors">
                        {article.title}
                      </h4>
                      <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground tabular-nums">
                        <span className="shrink-0">{formatRelativeTime(article.publishedAt)}</span>
                        <span aria-hidden>•</span>
                        <span className="truncate">{article.publisher}</span>
                      </div>
                    </a>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            ) : (
              <div className="text-center py-3 text-muted-foreground text-xs">
                Žiadne novinky k dispozícii
              </div>
            )}
          </CardContent>
        </Card>
                    </>
                  ) : null}
                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "dailyGainers") {
              const isFirstInPair = moversFirstId === "dailyGainers";
              const skipDesktopPaired = pairMoversDesktop && !isFirstInPair;
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={skipDesktopPaired && !isMobileViewport}
                  emptyHint="Na desktope v páre s Najhoršie"
                >
                  {moversHasContent ? (
                    pairMoversDesktop ? (
                      isFirstInPair ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          {renderGainersCard()}
                          <div className="hidden md:block">{renderLosersCard()}</div>
                        </div>
                      ) : (
                        <div className="md:hidden">{renderGainersCard()}</div>
                      )
                    ) : (
                      renderGainersCard()
                    )
                  ) : null}
                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "dailyLosers") {
              const isFirstInPair = moversFirstId === "dailyLosers";
              const skipDesktopPaired = pairMoversDesktop && !isFirstInPair;
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                  empty={skipDesktopPaired && !isMobileViewport}
                  emptyHint="Na desktope v páre s Najlepšie"
                >
                  {moversHasContent ? (
                    pairMoversDesktop ? (
                      isFirstInPair ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          {renderLosersCard()}
                          <div className="hidden md:block">{renderGainersCard()}</div>
                        </div>
                      ) : (
                        <div className="md:hidden">{renderLosersCard()}</div>
                      )
                    ) : (
                      renderLosersCard()
                    )
                  ) : null}
                </DashboardWidgetFrame>
              );
            }
            if (widgetId === "aiMacroAudit") {
              return (
                <DashboardWidgetFrame
                  key={widgetId}
                  id={widgetId}
                  editing={dashboardEditing}
                  visible={visible}
                  onToggleVisible={() => toggleDashboardWidget(widgetId)}
                >
                  <DashboardAiMacroAuditWidget />
                </DashboardWidgetFrame>
              );
            }
            return (
              <DashboardWidgetFrame
                key={widgetId}
                id={widgetId}
                editing={dashboardEditing}
                visible={visible}
                onToggleVisible={() => toggleDashboardWidget(widgetId)}
              >
      <Card>
        <CardHeader className="p-2.5 md:p-6">
          <CardTitle className="text-base md:text-lg">Prehľad aktív</CardTitle>
          <CardDescription className="text-xs md:text-sm">Vaše aktuálne držané akcie ({currency})</CardDescription>
        </CardHeader>
        <CardContent className="p-2.5 pt-0 md:p-6 md:pt-0">
          {!holdings || holdings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-holdings">
              <p>Zatiaľ nemáte žiadne akcie.</p>
              <p className="text-sm">Pridajte svoju prvú transakciu v sekcii História (tlačidlo Pridať transakciu).</p>
            </div>
          ) : (
            <>
              <Dialog open={mobileAssetsSortDialogOpen} onOpenChange={setMobileAssetsSortDialogOpen}>
                <DialogContent className="max-w-[min(100vw-1.5rem,24rem)] gap-0 p-0 sm:max-w-md overflow-hidden">
                  <DialogHeader className="p-5 pb-3 border-b border-border">
                    <DialogTitle className="text-base">Zoradiť podľa</DialogTitle>
                    <DialogDescription className="sr-only">
                      Vyberte kritérium a poradie zoradenia zoznamu aktív na mobile.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="px-5 pt-3 pb-1">
                    <RadioGroup
                      value={draftMobileSortBy}
                      onValueChange={(v) => setDraftMobileSortBy(v as MobileAssetsSortBy)}
                      className="gap-0"
                    >
                      <label
                        htmlFor="mobile-sort-name"
                        className="flex cursor-pointer items-center gap-3 border-b border-border py-3 first:pt-0"
                      >
                        <RadioGroupItem value="name" id="mobile-sort-name" />
                        <span className="text-sm font-normal">Názov</span>
                      </label>
                      <label
                        htmlFor="mobile-sort-value"
                        className="flex cursor-pointer items-center gap-3 border-b border-border py-3"
                      >
                        <RadioGroupItem value="value" id="mobile-sort-value" />
                        <span className="text-sm font-normal">Hodnota</span>
                      </label>
                      <label
                        htmlFor="mobile-sort-profit"
                        className="flex cursor-pointer items-center gap-3 border-b border-border py-3"
                      >
                        <RadioGroupItem value="netProfit" id="mobile-sort-profit" />
                        <span className="text-sm font-normal">Čistý zisk</span>
                      </label>
                      <label htmlFor="mobile-sort-gain-pct" className="flex cursor-pointer items-center gap-3 py-3">
                        <RadioGroupItem value="gainPercent" id="mobile-sort-gain-pct" />
                        <span className="text-sm font-normal">% zhodnotenia</span>
                      </label>
                    </RadioGroup>
                  </div>
                  <Separator />
                  <div className="px-5 pt-3 pb-1">
                    <p className="text-sm font-semibold mb-1">Poradie</p>
                    <RadioGroup
                      value={draftMobileSortOrder}
                      onValueChange={(v) => setDraftMobileSortOrder(v as SortDirection)}
                      className="gap-0"
                    >
                      <label
                        htmlFor="mobile-order-asc"
                        className="flex cursor-pointer items-center gap-3 border-b border-border py-3 first:pt-0"
                      >
                        <RadioGroupItem value="asc" id="mobile-order-asc" />
                        <span className="text-sm font-normal">Vzostupne</span>
                      </label>
                      <label htmlFor="mobile-order-desc" className="flex cursor-pointer items-center gap-3 py-3">
                        <RadioGroupItem value="desc" id="mobile-order-desc" />
                        <span className="text-sm font-normal">Zostupne</span>
                      </label>
                    </RadioGroup>
                  </div>
                  <DialogFooter className="flex-col gap-2 border-t border-border bg-muted/30 p-4 sm:flex-col">
                    <Button type="button" className="w-full" onClick={applyMobileAssetsSort}>
                      Použiť
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => setMobileAssetsSortDialogOpen(false)}
                    >
                      Zrušiť
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className="md:hidden flex gap-2 border-b border-border pb-2 mb-2">
                <Popover open={mobileAssetsViewPopoverOpen} onOpenChange={setMobileAssetsViewPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 gap-1.5 text-xs font-medium"
                      aria-label="Zmeniť zobrazenie zoznamu aktív"
                    >
                      <LayoutList className="h-4 w-4 shrink-0" aria-hidden />
                      Zobrazenie
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="start">
                    <p className="text-sm font-semibold mb-2">Zobrazenie</p>
                    <RadioGroup
                      value={mobileAssetsView}
                      onValueChange={(v) => {
                        setMobileAssetsView(v as MobileAssetsView);
                        setMobileAssetsViewPopoverOpen(false);
                      }}
                      className="gap-0"
                    >
                      <label
                        htmlFor="mobile-view-detailed"
                        className="flex cursor-pointer items-center gap-3 border-b border-border py-2.5 first:pt-0"
                      >
                        <RadioGroupItem value="detailed" id="mobile-view-detailed" />
                        <span className="text-sm font-normal">Podrobné</span>
                      </label>
                      <label
                        htmlFor="mobile-view-simple"
                        className="flex cursor-pointer items-center gap-3 border-b border-border py-2.5"
                      >
                        <RadioGroupItem value="simple" id="mobile-view-simple" />
                        <span className="text-sm font-normal">Jednoduché</span>
                      </label>
                      <label htmlFor="mobile-view-compact" className="flex cursor-pointer items-center gap-3 py-2.5">
                        <RadioGroupItem value="compact" id="mobile-view-compact" />
                        <span className="text-sm font-normal">Kompaktné</span>
                      </label>
                    </RadioGroup>
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 h-9 gap-1.5 text-xs font-medium"
                  aria-label="Zoradiť zoznam aktív"
                  onClick={openMobileAssetsSortDialog}
                >
                  <ArrowDownUp className="h-4 w-4 shrink-0" aria-hidden />
                  Zoradiť
                </Button>
              </div>

              {/* Mobile view - compact list */}
              <div className="md:hidden space-y-1">
                {flatHoldingsMobile.map((holding) => {
                  const quote = (collapsedMobile.quotes ?? quotes)?.[holding.ticker];
                  const isPokemonGroup = isPokemonGroupTicker(holding.ticker);
                  const isPokemonChild = pokemonChildIds.has(holding.id);
                  const hideMarketSession = isPokemonTicker(holding.ticker);
                  const shares = parseFloat(holding.shares);
                  const quoteCurrency = getTickerCurrency(holding.ticker);
                  const costCurrency = resolveHoldingCostCurrency(holding);
                  const openAvgLocal =
                    holding.openAvgPriceLocal != null &&
                    Number.isFinite(holding.openAvgPriceLocal) &&
                    holding.openAvgPriceLocal > 0
                      ? holding.openAvgPriceLocal
                      : null;
                  const openAvgCcy = holding.openPriceCurrency ?? costCurrency;
                  const avgCostPortfolio = convertPrice(
                    openAvgLocal ?? parseFloat(holding.averageCost),
                    openAvgLocal != null ? openAvgCcy : costCurrency,
                  );
                  const avgCostForDisplay = convertAverageCostPrice(
                    openAvgLocal ?? parseFloat(holding.averageCost),
                    openAvgLocal != null ? openAvgCcy : costCurrency,
                  );
                  const investedDisplay = pnlInvestedForDisplay(holding);
                  const marketPrice =
                    quote && Number.isFinite(quote.price) && quote.price > 0
                      ? convertPrice(quote.price, quoteCurrency)
                      : null;
                  const regularPrice = marketPrice ?? avgCostPortfolio;
                  const preMarketPrice =
                    quote?.preMarketPrice != null ? convertPrice(quote.preMarketPrice, quoteCurrency) : null;
                  const showPremarketPrice =
                    shouldShowExtendedQuote(
                      usSessionState,
                      quote?.marketState,
                      quote?.preMarketChangePercent,
                    ) &&
                    preMarketPrice != null &&
                    Number.isFinite(preMarketPrice) &&
                    preMarketPrice > 0;
                  const showOffHoursDailyChange = shouldShowExtendedQuote(
                    usSessionState,
                    quote?.marketState,
                    quote?.preMarketChangePercent,
                  );
                  // P&L %: pri zatvorenom trhu vždy RTH close; pre/post/overnight len v extended session.
                  const useExtendedForValuation =
                    shouldUseExtendedQuotes(usSessionState) && showPremarketPrice;
                  const valuationPrice = useExtendedForValuation
                    ? (preMarketPrice as number)
                    : regularPrice;
                  const currentPrice = regularPrice;
                  const currentValue = shares * valuationPrice;
                  const gainLoss = currentValue - investedDisplay;
                  const gainLossPercent = investedDisplay > 0 ? (gainLoss / investedDisplay) * 100 : 0;
                  const canExpandLots = canExpandMobileHoldingLots(holding);
                  const isLotsExpanded = expandedMobileHoldingId === holding.id;

                  const openAssetDetail = () => {
                    if (isPokemonGroup) {
                      setPokemonGroupOpen((open) => !open);
                      return;
                    }
                    setLocation(`/asset/${encodeURIComponent(holding.ticker)}`);
                  };

                  const toggleLotsExpand = () => {
                    if (!canExpandLots) return;
                    setExpandedMobileHoldingId((prev) => (prev === holding.id ? null : holding.id));
                  };

                  const simpleAfterHoursEl =
                    !hideMarketSession && showOffHoursDailyChange && quote ? (
                      <span
                        className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${getChangeColor(quote.preMarketChange ?? 0)}`}
                      >
                        <Moon className={`h-2.5 w-2.5 shrink-0 ${premarketMoonClass}`} aria-hidden />
                        {formatPercent(quote.preMarketChangePercent ?? 0)}
                      </span>
                    ) : null;

                  return (
                    <div
                      key={holding.id}
                      role="button"
                      tabIndex={0}
                      className={`py-2 border-b last:border-b-0 cursor-pointer hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors${isPokemonChild ? " ml-3 border-l-2 border-primary/30" : ""}`}
                      data-testid={`row-holding-${holding.ticker}`}
                      aria-expanded={isPokemonGroup ? pokemonGroupOpen : canExpandLots ? isLotsExpanded : undefined}
                      onClick={() => {
                        if (isPokemonGroup) {
                          setPokemonGroupOpen((open) => !open);
                          return;
                        }
                        toggleLotsExpand();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (isPokemonGroup) {
                            setPokemonGroupOpen((open) => !open);
                            return;
                          }
                          toggleLotsExpand();
                        }
                      }}
                    >
                      {mobileAssetsView === "compact" ? (
                        <div className="flex items-center gap-2 min-h-[30px]">
                          {canExpandLots || isPokemonGroup ? (
                            <ChevronDown
                              className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${(isPokemonGroup ? pokemonGroupOpen : isLotsExpanded) ? "" : "-rotate-90"}`}
                              aria-hidden
                            />
                          ) : (
                            <span className="w-3 shrink-0" aria-hidden />
                          )}
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left text-xs font-semibold hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAssetDetail();
                            }}
                            data-testid={`button-mobile-asset-name-${holding.ticker}`}
                          >
                            {assetTickerLabel(holding)}
                          </button>
                          <span className={`w-[62px] shrink-0 text-right text-[11px] font-medium tabular-nums ${getChangeColor(gainLoss)}`}>
                            {formatPercent(gainLossPercent)}
                          </span>
                          <span className={`w-[78px] shrink-0 text-right text-[11px] font-medium tabular-nums ${getChangeColor(gainLoss)}`}>
                            {gainLoss > 0 ? "+" : ""}
                            {maskAmount(formatCurrency(gainLoss))}
                          </span>
                          <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums">
                            {maskAmount(formatCurrency(currentValue))}
                          </span>
                        </div>
                      ) : mobileAssetsView === "simple" ? (
                        <div className="flex gap-2 items-start">
                          <div className="shrink-0 pt-0.5 flex items-center gap-0.5">
                            {canExpandLots || isPokemonGroup ? (
                              <ChevronDown
                                className={`h-3 w-3 text-muted-foreground transition-transform ${(isPokemonGroup ? pokemonGroupOpen : isLotsExpanded) ? "" : "-rotate-90"}`}
                                aria-hidden
                              />
                            ) : (
                              <span className="w-3" aria-hidden />
                            )}
                            <HoldingMark holding={holding} size="sm" />
                          </div>
                          <div className="min-w-0 flex-1 flex flex-col gap-0.5 pr-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <button
                                type="button"
                                className="font-semibold text-xs leading-tight truncate text-left hover:text-primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openAssetDetail();
                                }}
                                data-testid={`button-mobile-asset-name-${holding.ticker}`}
                              >
                                {mobileSimpleAssetDisplayName(holding)}
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-1.5 text-[11px] text-muted-foreground tabular-nums min-w-0">
                              <span className="truncate min-w-0">
                                {formatShareQuantity(shares)} ks /{" "}
                                {maskAmount(formatAverageCostCurrency(avgCostForDisplay))}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-0.5 max-w-[50%]">
                            <div className="text-xs font-semibold tabular-nums leading-tight">
                              {maskAmount(formatCurrency(currentValue))}
                            </div>
                            <div
                              className={`flex items-center gap-1.5 text-[11px] font-medium tabular-nums leading-tight ${getChangeColor(gainLoss)}`}
                            >
                              <span>
                                {gainLoss > 0 ? "+" : ""}
                                {maskAmount(formatCurrency(gainLoss))}
                              </span>
                              <span className="whitespace-nowrap">{formatPercent(gainLossPercent)}</span>
                              {simpleAfterHoursEl}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {canExpandLots || isPokemonGroup ? (
                                <ChevronDown
                                  className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${(isPokemonGroup ? pokemonGroupOpen : isLotsExpanded) ? "" : "-rotate-90"}`}
                                  aria-hidden
                                />
                              ) : (
                                <span className="w-3 shrink-0" aria-hidden />
                              )}
                              <HoldingMark holding={holding} size="sm" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    className="font-semibold text-xs hover:text-primary truncate text-left"
                                    data-testid={`button-mobile-asset-name-${holding.ticker}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openAssetDetail();
                                    }}
                                  >
                                    {isSealedPokemonHolding(holding) ? holding.companyName : assetTickerLabel(holding)}
                                  </button>
                                  <span className="text-[9px] text-muted-foreground">
                                    {formatShareQuantity(shares)} ks
                                  </span>
                                </div>
                                {isSealedPokemonHolding(holding) ? null : (
                                  <p className="text-[9px] text-muted-foreground truncate">{holding.companyName}</p>
                                )}
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
                              <span>
                                Priem:{" "}
                                <span className="text-foreground">{maskAmount(formatAverageCostCurrency(avgCostForDisplay))}</span>
                              </span>
                              <span className="inline-flex flex-col">
                                <span>
                                  Cena:{" "}
                                  <span className="text-foreground">{maskAmount(formatCurrency(currentPrice))}</span>
                                  {usSessionState === "LIVE" && quote && !hideMarketSession && (
                                    <span className={`ml-0.5 ${getChangeColor(quote.change)}`}>
                                      {formatPercent(quote.changePercent)}
                                    </span>
                                  )}
                                </span>
                                {showPremarketPrice && (
                                  <span className="mt-0.5 inline-flex items-center gap-0.5 text-[8px] text-muted-foreground">
                                    <Moon className={`h-2.5 w-2.5 ${premarketMoonClass}`} />
                                    {maskAmount(formatCurrency(preMarketPrice))}
                                  </span>
                                )}
                                {showOffHoursDailyChange && (
                                  <span
                                    className={`mt-0.5 inline-flex items-center gap-0.5 text-[8px] ${getChangeColor(quote?.preMarketChange ?? 0)}`}
                                  >
                                    <Moon className={`h-2.5 w-2.5 ${premarketMoonClass}`} />
                                    {formatPercent(quote?.preMarketChangePercent ?? 0)}
                                  </span>
                                )}
                              </span>
                            </div>
                            <span className={getChangeColor(gainLoss)}>{maskAmount(formatCurrency(gainLoss))}</span>
                          </div>
                        </>
                      )}
                      {isLotsExpanded && canExpandLots ? (
                        <MobileHoldingBuyLotsPanel
                          portfolioId={holding.portfolioId}
                          allPortfolios={isAllPortfolios}
                          ticker={holding.ticker}
                          currentPrice={Number.isFinite(valuationPrice) ? valuationPrice : null}
                          shares={shares}
                          investedDisplay={investedDisplay}
                          maskAmount={maskAmount}
                          formatShareQuantityFn={formatShareQuantity}
                          formatAverageCostCurrencyFn={formatAverageCostCurrency}
                          convertAverageCostPriceFn={convertAverageCostPrice}
                          convertPriceFn={convertPrice}
                          formatPercentFn={formatPercent}
                          getChangeColorFn={getChangeColor}
                        />
                      ) : null}
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
                      <TableHead 
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("gainLossPercent")}
                        data-testid="sort-gainloss-percent"
                      >
                        <div className="flex items-center justify-end">
                          Zisk/Strata %
                          {getSortIcon("gainLossPercent")}
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flatHoldingsDesktop.map((holding) => {
                      const quote = (collapsedDesktop.quotes ?? quotes)?.[holding.ticker];
                      const isPokemonGroup = isPokemonGroupTicker(holding.ticker);
                      const isPokemonChild = pokemonChildIds.has(holding.id);
                      const hideMarketSession = isPokemonTicker(holding.ticker);
                      const shares = parseFloat(holding.shares);
                      const quoteCurrency = getTickerCurrency(holding.ticker);
                      const costCurrency = resolveHoldingCostCurrency(holding);
                      const openAvgLocal =
                        holding.openAvgPriceLocal != null &&
                        Number.isFinite(holding.openAvgPriceLocal) &&
                        holding.openAvgPriceLocal > 0
                          ? holding.openAvgPriceLocal
                          : null;
                      const openAvgCcy = holding.openPriceCurrency ?? costCurrency;
                      const avgCostPortfolio = convertPrice(
                        openAvgLocal ?? parseFloat(holding.averageCost),
                        openAvgLocal != null ? openAvgCcy : costCurrency,
                      );
                      const avgCostForDisplay = convertAverageCostPrice(
                        openAvgLocal ?? parseFloat(holding.averageCost),
                        openAvgLocal != null ? openAvgCcy : costCurrency,
                      );
                      const investedDisplay = pnlInvestedForDisplay(holding);
                      const marketPrice =
                        quote && Number.isFinite(quote.price) && quote.price > 0
                          ? convertPrice(quote.price, quoteCurrency)
                          : null;
                      const currentPrice = marketPrice ?? avgCostPortfolio;
                      const preMarketPrice =
                        quote?.preMarketPrice != null ? convertPrice(quote.preMarketPrice, quoteCurrency) : null;
                      const showPremarketPrice =
                        shouldShowExtendedQuote(
                          usSessionState,
                          quote?.marketState,
                          quote?.preMarketChangePercent,
                        ) &&
                        preMarketPrice != null &&
                        Number.isFinite(preMarketPrice) &&
                        preMarketPrice > 0;
                      const showOffHoursDailyChange = shouldShowExtendedQuote(
                        usSessionState,
                        quote?.marketState,
                        quote?.preMarketChangePercent,
                      );
                      const useExtendedForValuation =
                        shouldUseExtendedQuotes(usSessionState) && showPremarketPrice;
                      const valuationPrice = useExtendedForValuation
                        ? (preMarketPrice as number)
                        : currentPrice;
                      const currentValue = shares * currentPrice;
                      const gainLoss = currentValue - investedDisplay;
                      const gainLossPercent = investedDisplay > 0 ? (gainLoss / investedDisplay) * 100 : 0;
                      const canExpandLots = canExpandMobileHoldingLots(holding);
                      const isLotsExpanded = expandedMobileHoldingId === holding.id;

                      return (
                        <Fragment key={holding.id}>
                        <TableRow
                          data-testid={`row-holding-${holding.ticker}`}
                          className={`cursor-pointer hover:bg-muted/50${isPokemonChild ? " bg-muted/20" : ""}`}
                          aria-expanded={
                            isPokemonGroup ? pokemonGroupOpen : canExpandLots ? isLotsExpanded : undefined
                          }
                          onClick={() => {
                            if (isPokemonGroup) {
                              setPokemonGroupOpen((open) => !open);
                              return;
                            }
                            setLocation(`/asset/${encodeURIComponent(holding.ticker)}`);
                          }}
                        >
                          <TableCell>
                            <div className={`flex items-center gap-2${isPokemonChild ? " pl-6" : ""}`}>
                              {isPokemonGroup || canExpandLots ? (
                                <button
                                  type="button"
                                  className="shrink-0 inline-flex items-center justify-center rounded p-0.5 hover:bg-muted"
                                  aria-label={
                                    isPokemonGroup
                                      ? pokemonGroupOpen
                                        ? "Zbaliť Pokémon TCG"
                                        : "Rozbaliť Pokémon TCG"
                                      : isLotsExpanded
                                        ? "Skryť nákupy"
                                        : "Zobraziť nákupy"
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isPokemonGroup) {
                                      setPokemonGroupOpen((open) => !open);
                                      return;
                                    }
                                    setExpandedMobileHoldingId((prev) =>
                                      prev === holding.id ? null : holding.id,
                                    );
                                  }}
                                >
                                  <ChevronDown
                                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                                      (isPokemonGroup ? pokemonGroupOpen : isLotsExpanded) ? "" : "-rotate-90"
                                    }`}
                                    aria-hidden
                                  />
                                </button>
                              ) : (
                                <span className="w-5 shrink-0" aria-hidden />
                              )}
                              <HoldingMark holding={holding} size="md" />
                              {isSealedPokemonHolding(holding) ? null : isPokemonTicker(holding.ticker) ? (
                                <span className="font-medium" data-testid={`link-ticker-${holding.ticker}`}>
                                  {assetTickerLabel(holding)}
                                </span>
                              ) : (
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
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{holding.companyName}</TableCell>
                          <TableCell className="text-right">{formatShareQuantity(shares)}</TableCell>
                          <TableCell className="text-right">{maskAmount(formatAverageCostCurrency(avgCostForDisplay))}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end">
                              <div className="flex items-center justify-end gap-1">
                                {maskAmount(formatCurrency(currentPrice))}
                                {usSessionState === "LIVE" && quote && !hideMarketSession && (
                                  <span className={`text-xs ${getChangeColor(quote.change)}`}>
                                    ({formatPercent(quote.changePercent)})
                                  </span>
                                )}
                              </div>
                              {showPremarketPrice && (
                                <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Moon className={`h-3 w-3 ${premarketMoonClass}`} />
                                  {maskAmount(formatCurrency(preMarketPrice))}
                                </div>
                              )}
                              {showOffHoursDailyChange && (
                                <div className={`mt-0.5 inline-flex items-center gap-1 text-[10px] ${getChangeColor(quote?.preMarketChange ?? 0)}`}>
                                  <Moon className={`h-3 w-3 ${premarketMoonClass}`} />
                                  {formatPercent(quote?.preMarketChangePercent ?? 0)}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{maskAmount(formatCurrency(currentValue))}</TableCell>
                          <TableCell className={`text-right tabular-nums ${getChangeColor(gainLoss)}`}>
                            {maskAmount(formatCurrency(gainLoss))}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${getChangeColor(gainLossPercent)}`}>
                            {formatPercent(gainLossPercent)}
                          </TableCell>
                        </TableRow>
                        {isLotsExpanded && canExpandLots ? (
                          <TableRow
                            className="hover:bg-transparent"
                            data-testid={`row-holding-lots-${holding.ticker}`}
                          >
                            <TableCell colSpan={8} className="bg-muted/25 py-2 px-4">
                              <MobileHoldingBuyLotsPanel
                                portfolioId={holding.portfolioId}
                                allPortfolios={isAllPortfolios}
                                ticker={holding.ticker}
                                currentPrice={Number.isFinite(valuationPrice) ? valuationPrice : null}
                                shares={shares}
                                investedDisplay={investedDisplay}
                                maskAmount={maskAmount}
                                formatShareQuantityFn={formatShareQuantity}
                                formatAverageCostCurrencyFn={formatAverageCostCurrency}
                                convertAverageCostPriceFn={convertAverageCostPrice}
                                convertPriceFn={convertPrice}
                                formatPercentFn={formatPercent}
                                getChangeColorFn={getChangeColor}
                              />
                            </TableCell>
                          </TableRow>
                        ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
              </DashboardWidgetFrame>
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}

export default function Dashboard() {
  const redesign = useMobileRedesign();
  return redesign ? <DashboardMobile /> : <DashboardClassic />;
}
