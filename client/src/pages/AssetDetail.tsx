import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { format, parse, parseISO, subMonths, subYears, startOfDay } from "date-fns";
import { sk } from "date-fns/locale";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceLine,
} from "recharts";
import { ArrowLeft, ExternalLink, TrendingDown, TrendingUp, Clock, Shield, Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CompanyLogo } from "@/components/CompanyLogo";
import { BrokerLogo } from "@/components/BrokerLogo";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useIsMobile } from "@/hooks/use-mobile";
import { HelpTip } from "@/components/HelpTip";
import { AnalystRatingsCard } from "@/components/AnalystRatingsCard";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import type { BrokerCode, Currency, Transaction } from "@shared/schema";
import { isPokemonTicker } from "@shared/pokemonTcg";
import type { TradeCurrency } from "@shared/transactionEur";
import type { QuoteCurrency } from "@shared/tickerCurrency";
import { cn, formatShareQuantity } from "@/lib/utils";

const PRICE_CHART_RANGE_OPTIONS = [
  { v: "1m" as const, label: "1M" },
  { v: "3m" as const, label: "3M" },
  { v: "6m" as const, label: "6M" },
  { v: "1y" as const, label: "1R" },
  { v: "5y" as const, label: "5R" },
  { v: "all" as const, label: "Všetko" },
];
type PriceChartRange = (typeof PRICE_CHART_RANGE_OPTIONS)[number]["v"];

function filterPriceSeriesByRange(
  series: Array<{ date: string; price: number }>,
  range: PriceChartRange,
): Array<{ date: string; price: number }> {
  if (series.length === 0 || range === "all") return series;
  const last = parseISO(series[series.length - 1].date + "T12:00:00Z");
  let start: Date;
  switch (range) {
    case "1m":
      start = subMonths(last, 1);
      break;
    case "3m":
      start = subMonths(last, 3);
      break;
    case "6m":
      start = subMonths(last, 6);
      break;
    case "1y":
      start = subYears(last, 1);
      break;
    case "5y":
      start = subYears(last, 5);
      break;
    default:
      return series;
  }
  const cutoff = format(startOfDay(start), "yyyy-MM-dd");
  return series.filter((d) => d.date >= cutoff);
}

type PositionRow = {
  portfolioId: string | null;
  portfolioName: string;
  brokerCode: string | null;
  shares: number;
  averageCost: number;
  totalInvested: number;
  costCurrency: TradeCurrency;
};

type DividendPayment = {
  id: string;
  date: string;
  portfolioId: string | null;
  portfolioName: string;
  gross: number;
  tax: number;
  net: number;
  currency: string;
};

type AssetDetailResponse = {
  ticker: string;
  companyName: string;
  costCurrency: TradeCurrency;
  positions: PositionRow[];
  portfolios: { id: string; name: string }[];
  totals: { shares: number; totalInvested: number; averageCost: number };
  dividends: {
    totalGross: number;
    totalTax: number;
    totalNet: number;
    paymentCount: number;
  };
  dividendPayments: DividendPayment[];
  marketTransactions: Transaction[];
  transactions: Transaction[];
  quote: {
    price: number;
    change: number;
    changePercent: number;
  } | null;
  imageUrl?: string | null;
  priceNote?: string | null;
  prices: Record<string, number>;
  /** Najbližší očakávaný dátum výsledkov (Yahoo calendarEvents), YYYY-MM-DD. */
  nextEarnings: { date: string } | null;
};

type EarningsQuarterRow = {
  year: number;
  quarter: number;
  periodEnd: string | null;
  label: string;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprise: number | null;
  epsSurprisePercent: number | null;
  revenue: number | null;
  netIncome: number | null;
  reportedDate: string | null;
};

type EarningsYearGroup = {
  year: number;
  revenue: number | null;
  netIncome: number | null;
  profitMargin: number | null;
  quarters: EarningsQuarterRow[];
};

type EarningsHistoryResponse = {
  ticker: string;
  currency: string | null;
  source: "finnhub" | "alphavantage" | "yahoo" | null;
  years: EarningsYearGroup[];
};

type OpenFifoLotRow = {
  acquiredAt: string;
  remainingShares: number;
  pricePerShareLocal: number;
  purchaseCurrency: string;
  eurPerUnitAtPurchase: number;
  currentPriceAvailable: boolean;
  currentPnl: number;
  currentPnlEur: number;
  taxFree: boolean;
  daysToTaxFree: number | null;
  inTaxFreeCountdown: boolean;
  daysHeld: number;
};

type FifoLotWithMeta = OpenFifoLotRow & {
  portfolioName: string;
  portfolioId: string | null;
};

function alignMarkerToChart(
  txDate: Date,
  sortedAscDates: string[],
  prices: Record<string, number>
): { date: string; price: number } | null {
  const key = format(txDate, "yyyy-MM-dd");
  let best: string | null = null;
  for (const d of sortedAscDates) {
    if (d <= key) best = d;
  }
  if (!best) return null;
  const p = prices[best];
  return p != null ? { date: best, price: p } : null;
}

function txnCurrency(tx: Transaction): QuoteCurrency {
  const oc = (tx.originalCurrency || tx.currency || "EUR").toUpperCase();
  if (oc === "USD" || oc === "GBP" || oc === "CZK" || oc === "PLN" || oc === "HKD" || oc === "EUR") {
    return oc;
  }
  return "EUR";
}

function formatAmountInCurrency(value: number, ccy: Currency | TradeCurrency | QuoteCurrency): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: ccy,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactMoney(value: number, currencyHint?: string | null): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const ccy = currencyHint && /^[A-Z]{3}$/.test(currencyHint) ? ` ${currencyHint}` : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)} bil.${ccy}`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} mld.${ccy}`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)} mil.${ccy}`;
  return `${sign}${abs.toLocaleString("sk-SK", { maximumFractionDigits: 0 })}${ccy}`;
}

function formatEps(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function surpriseTone(pct: number | null): "beat" | "miss" | "flat" | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 0.05) return "beat";
  if (pct < -0.05) return "miss";
  return "flat";
}

function codeToCurrency(c: string): "EUR" | "USD" | "GBP" | "CZK" | "PLN" {
  const x = (c || "EUR").toUpperCase();
  if (x === "USD" || x === "GBP" || x === "CZK" || x === "PLN" || x === "EUR") return x;
  return "EUR";
}

export default function AssetDetail() {
  const params = useParams();
  const rawTicker = (params as { ticker?: string }).ticker ?? "";
  const ticker = rawTicker ? decodeURIComponent(rawTicker) : "";
  const [, setLocation] = useLocation();
  const { currency, convertPrice, convertAverageCostPrice, getTickerCurrency, resolveHoldingCostCurrency, formatCurrency, formatAverageCostCurrency } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const isMobile = useIsMobile();
  const [tradePortfolioFilter, setTradePortfolioFilter] = useState<string>("all");
  const [priceChartRange, setPriceChartRange] = useState<PriceChartRange>("1y");
  /** Aktuálna cena: true = v mene zobrazenia (EUR), false = v mene kotácie (USD). */
  const [quoteInPreferredCurrency, setQuoteInPreferredCurrency] = useState(true);

  const mask = (s: string) => (hideAmounts ? "••••••" : s);

  const { data, isLoading, error } = useQuery<AssetDetailResponse>({
    queryKey: ["/api/assets", ticker],
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}`, { credentials: "include" });
      if (res.status === 404) {
        throw new Error("NOT_FOUND");
      }
      if (!res.ok) throw new Error("Failed to fetch asset detail");
      return res.json();
    },
    enabled: !!ticker,
  });

  const {
    data: earningsHistory,
    isLoading: earningsHistoryLoading,
    isError: earningsHistoryError,
  } = useQuery<EarningsHistoryResponse>({
    queryKey: ["/api/assets", ticker, "earnings-history"],
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}/earnings-history`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("earnings-history");
      return res.json();
    },
    enabled: !!ticker && !!data && data.ticker !== "CASH",
    staleTime: 60 * 60 * 1000,
  });

  const lotQueries = useQueries({
    queries: (data?.positions ?? []).map((pos) => {
      const pathSeg = pos.portfolioId == null ? "unassigned" : pos.portfolioId;
      return {
        queryKey: ["/api/portfolios", pathSeg, "asset-lots", ticker] as const,
        queryFn: async () => {
          const u = encodeURIComponent(ticker);
          const res = await fetch(
            `/api/portfolios/${pathSeg === "unassigned" ? "unassigned" : encodeURIComponent(pathSeg)}/asset-lots?ticker=${u}`,
            { credentials: "include" },
          );
          if (!res.ok) throw new Error("asset-lots");
          return res.json() as Promise<{
            currency: string;
            lots: OpenFifoLotRow[];
          }>;
        },
        enabled: !!ticker && !!data && data.ticker !== "CASH" && (data?.positions?.length ?? 0) > 0,
        staleTime: 60 * 1000,
      };
    }),
  });

  const fifoLotRows: FifoLotWithMeta[] = useMemo(() => {
    if (!data?.positions) return [];
    const out: FifoLotWithMeta[] = [];
    data.positions.forEach((pos, i) => {
      const q = lotQueries[i];
      if (!q?.data?.lots?.length) return;
      for (const lot of q.data.lots) {
        out.push({ ...lot, portfolioName: pos.portfolioName, portfolioId: pos.portfolioId });
      }
    });
    return out;
  }, [data?.positions, lotQueries]);

  const anyLotsLoading = lotQueries.some((q) => q.isLoading);
  const lotsError = lotQueries.find((q) => q.isError);

  const chartData = useMemo(() => {
    if (!data?.prices) return [];
    const keys = Object.keys(data.prices).sort();
    return keys.map((d) => ({ date: d, price: data.prices[d] }));
  }, [data?.prices]);

  const sortedAscDates = useMemo(() => chartData.map((d) => d.date), [chartData]);

  const tradeMarkers = useMemo(() => {
    if (!data?.marketTransactions || !data.prices) return [];
    const out: Array<{
      date: string;
      price: number;
      kind: "BUY" | "SELL";
      key: string;
    }> = [];
    for (const tx of data.marketTransactions) {
      if (tx.type !== "BUY" && tx.type !== "SELL") continue;
      if (tradePortfolioFilter !== "all") {
        if (tradePortfolioFilter === "unassigned") {
          if (tx.portfolioId != null) continue;
        } else if (tx.portfolioId !== tradePortfolioFilter) {
          continue;
        }
      }
      const d = parseISO(typeof tx.transactionDate === "string" ? tx.transactionDate : String(tx.transactionDate));
      const aligned = alignMarkerToChart(d, sortedAscDates, data.prices);
      if (!aligned) continue;
      out.push({
        ...aligned,
        kind: tx.type as "BUY" | "SELL",
        key: `${tx.id}-${tx.type}`,
      });
    }
    return out;
  }, [data?.marketTransactions, data?.prices, sortedAscDates, tradePortfolioFilter]);

  const filteredChartData = useMemo(
    () => filterPriceSeriesByRange(chartData, priceChartRange),
    [chartData, priceChartRange],
  );

  const priceRangeCutoffIso = useMemo(() => {
    if (priceChartRange === "all" || chartData.length === 0) return null;
    const filtered = filterPriceSeriesByRange(chartData, priceChartRange);
    if (filtered.length === 0) return null;
    return filtered[0].date;
  }, [chartData, priceChartRange]);

  const tradeMarkersInRange = useMemo(() => {
    if (!priceRangeCutoffIso) return tradeMarkers;
    return tradeMarkers.filter((m) => m.date >= priceRangeCutoffIso);
  }, [tradeMarkers, priceRangeCutoffIso]);

  const periodPriceReturnPct = useMemo(() => {
    if (filteredChartData.length < 2) return null;
    const a = filteredChartData[0].price;
    const b = filteredChartData[filteredChartData.length - 1].price;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
    return ((b - a) / a) * 100;
  }, [filteredChartData]);

  const positionRoiPct = useMemo(() => {
    if (!data || data.totals.shares <= 0) return null;
    const q = data.quote;
    if (!q || !Number.isFinite(q.price) || !Number.isFinite(data.totals.averageCost)) return null;
    const avg = data.totals.averageCost;
    if (avg <= 0) return null;
    return ((q.price - avg) / avg) * 100;
  }, [data]);

  const sortedTxDesc = useMemo(() => {
    if (!data?.transactions) return [];
    return [...data.transactions].sort(
      (a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime()
    );
  }, [data?.transactions]);

  const portfolioNameById = useMemo(() => {
    const m = new Map<string, string>();
    data?.portfolios?.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [data?.portfolios]);

  const tradePortfolioOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    const used = new Set<string>();
    let hasUnassigned = false;
    for (const tx of data?.marketTransactions ?? []) {
      if (tx.type !== "BUY" && tx.type !== "SELL") continue;
      if (!tx.portfolioId) {
        hasUnassigned = true;
        continue;
      }
      if (used.has(tx.portfolioId)) continue;
      used.add(tx.portfolioId);
      out.push({
        value: tx.portfolioId,
        label: portfolioNameById.get(tx.portfolioId) ?? tx.portfolioId,
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label, "sk"));
    if (hasUnassigned) out.push({ value: "unassigned", label: "Nezaradené" });
    return out;
  }, [data?.marketTransactions, portfolioNameById]);

  const formatTxnValue = (tx: Transaction): string => {
    const cur = txnCurrency(tx);
    if (tx.type === "DIVIDEND") {
      const gross = parseFloat(tx.shares) * parseFloat(tx.pricePerShare);
      return mask(formatCurrency(convertPrice(gross, cur)));
    }
    if (tx.type === "TAX") {
      const v = parseFloat(tx.shares) * parseFloat(tx.pricePerShare);
      return mask(formatCurrency(convertPrice(v, cur)));
    }
    const gross = parseFloat(tx.shares) * parseFloat(tx.pricePerShare);
    return mask(formatCurrency(convertPrice(gross, cur)));
  };

  const typeLabel = (t: string) => {
    switch (t) {
      case "BUY":
        return "Nákup";
      case "SELL":
        return "Predaj";
      case "DIVIDEND":
        return "Dividenda";
      case "TAX":
        return "Daň";
      default:
        return t;
    }
  };

  if (!ticker) {
    return (
      <div className="w-full">
        <p className="text-muted-foreground">Neplatný ticker.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/")}>
          Späť na prehľad
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error instanceof Error && error.message === "NOT_FOUND") {
    return (
      <div className="w-full space-y-4">
        <p className="text-muted-foreground">Pre tento ticker nemáte v aplikácii žiadne dáta.</p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          Späť na prehľad
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full space-y-4">
        <p className="text-destructive">Nepodarilo sa načítať detail aktíva.</p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          Späť na prehľad
        </Button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const quote = data.quote;
  const quoteCurrency = getTickerCurrency(data.ticker);
  const costCurrency = data.costCurrency ?? resolveHoldingCostCurrency({ ticker: data.ticker });
  const changePositive = quote != null && quote.change >= 0;
  const canToggleQuoteCurrency = quoteCurrency !== currency;
  const formatQuoteAmount = (amount: number) =>
    quoteInPreferredCurrency
      ? formatCurrency(convertPrice(amount, quoteCurrency))
      : formatAmountInCurrency(amount, quoteCurrency);

  const formatRoiPct = (p: number | null) =>
    p == null || !Number.isFinite(p) ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;

  const investedPref = convertPrice(data.totals.totalInvested, costCurrency);
  const holdingValuePref =
    quote != null && Number.isFinite(quote.price) && data.totals.shares > 0
      ? convertPrice(quote.price * data.totals.shares, quoteCurrency)
      : null;
  const totalReturnPref =
    holdingValuePref != null ? holdingValuePref - investedPref : null;


  return (
    <div className="flex flex-col gap-3 pb-8">
      {/* Mobile header */}
      <div className="md:hidden space-y-1.5 min-w-0">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2 h-8 w-fit" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
          Späť na prehľad
        </Button>
        <div className="flex items-start gap-2.5">
          {data.imageUrl && isPokemonTicker(data.ticker) ? (
            <img
              src={data.imageUrl}
              alt={data.companyName}
              className="h-11 w-11 shrink-0 rounded-md object-contain bg-muted"
            />
          ) : (
            <CompanyLogo
              ticker={data.ticker}
              companyName={data.companyName}
              imageUrl={data.imageUrl}
              size="md"
              className="shrink-0"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate" data-testid="asset-detail-title">
              {data.companyName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              {isPokemonTicker(data.ticker) ? (
                <span>{data.priceNote || "Pokémon TCG"}</span>
              ) : (
                <>
                  <span className="font-mono">{data.ticker}</span>
                  <a
                    href={`https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Yahoo Finance
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop back + hero */}
      <div className="hidden md:block min-w-0" data-testid="desktop-asset-header">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 -ml-2 h-7 w-fit px-2 text-xs text-muted-foreground mb-1.5"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Portfólio
        </Button>
      </div>

      <Card className="border-border bg-card shadow-sm" data-testid="asset-hero-summary">
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-col gap-3">
            <div className="hidden md:flex items-center gap-2.5 min-w-0">
              {data.imageUrl && isPokemonTicker(data.ticker) ? (
                <img
                  src={data.imageUrl}
                  alt={data.companyName}
                  className="h-10 w-10 shrink-0 rounded-md object-contain bg-muted"
                />
              ) : (
                <CompanyLogo
                  ticker={data.ticker}
                  companyName={data.companyName}
                  imageUrl={data.imageUrl}
                  size="md"
                  className="shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <h1
                  className="text-base font-semibold truncate leading-tight"
                  data-testid="asset-detail-title-desktop"
                >
                  {data.companyName}
                </h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {isPokemonTicker(data.ticker) ? (
                    <span>{data.priceNote || "Pokémon TCG"}</span>
                  ) : (
                    <>
                      <span className="font-mono">{data.ticker}</span>
                      <a
                        href={`https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        Yahoo Finance
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>
              {data.ticker !== "CASH" && canToggleQuoteCurrency && (
                <div className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("font-medium tabular-nums", !quoteInPreferredCurrency && "text-foreground")}>
                    {quoteCurrency}
                  </span>
                  <Switch
                    checked={quoteInPreferredCurrency}
                    onCheckedChange={(checked) => setQuoteInPreferredCurrency(checked === true)}
                    className="scale-[0.72] origin-center"
                    aria-label={
                      quoteInPreferredCurrency
                        ? `Zobraziť cenu v ${quoteCurrency}`
                        : `Zobraziť cenu v ${currency}`
                    }
                    data-testid="switch-quote-display-currency"
                  />
                  <span className={cn("font-medium tabular-nums", quoteInPreferredCurrency && "text-foreground")}>
                    {currency}
                  </span>
                </div>
              )}
            </div>

            {data.ticker !== "CASH" && canToggleQuoteCurrency && (
              <div className="md:hidden flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                <span className={cn("font-medium tabular-nums", !quoteInPreferredCurrency && "text-foreground")}>
                  {quoteCurrency}
                </span>
                <Switch
                  checked={quoteInPreferredCurrency}
                  onCheckedChange={(checked) => setQuoteInPreferredCurrency(checked === true)}
                  className="scale-[0.72] origin-center"
                  aria-label={
                    quoteInPreferredCurrency
                      ? `Zobraziť cenu v ${quoteCurrency}`
                      : `Zobraziť cenu v ${currency}`
                  }
                  data-testid="switch-quote-display-currency-mobile"
                />
                <span className={cn("font-medium tabular-nums", quoteInPreferredCurrency && "text-foreground")}>
                  {currency}
                </span>
              </div>
            )}

            {data.ticker !== "CASH" ? (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 md:gap-3">
                <div className="min-w-0 rounded-md bg-muted/25 px-2.5 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">Aktuálna cena</div>
                  {quote ? (
                    <div className="text-lg md:text-2xl font-semibold leading-tight tracking-tight truncate mt-0.5">
                      {mask(formatQuoteAmount(quote.price))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground mt-0.5">Kotácia nedostupná</div>
                  )}
                </div>
                <div className="min-w-0 rounded-md bg-muted/25 px-2.5 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">Dnes</div>
                  {quote ? (
                    <div
                      className={`text-lg md:text-2xl font-semibold leading-tight tracking-tight mt-0.5 flex items-baseline gap-1 flex-wrap ${
                        changePositive ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1 min-w-0">
                        {changePositive ? (
                          <TrendingUp className="h-4 w-4 shrink-0" />
                        ) : (
                          <TrendingDown className="h-4 w-4 shrink-0" />
                        )}
                        <span className="truncate">{mask(formatQuoteAmount(quote.change))}</span>
                      </span>
                      <span className="text-xs md:text-sm font-medium">
                        ({changePositive ? "+" : ""}
                        {(quote.changePercent ?? 0).toFixed(2)}%)
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground mt-0.5">—</div>
                  )}
                </div>
                <div className="min-w-0 rounded-md bg-muted/25 px-2.5 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">Vaša pozícia</div>
                  <div className="text-lg md:text-2xl font-semibold leading-tight tracking-tight truncate mt-0.5">
                    {holdingValuePref == null ? "—" : mask(formatCurrency(holdingValuePref))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {formatShareQuantity(data.totals.shares)} ks
                  </p>
                </div>
                <div className="min-w-0 rounded-md bg-muted/25 px-2.5 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">Celkový výnos</div>
                  <div
                    className={`text-lg md:text-2xl font-semibold leading-tight tracking-tight mt-0.5 flex flex-wrap items-baseline gap-x-1 ${
                      totalReturnPref == null
                        ? "text-muted-foreground"
                        : totalReturnPref >= 0
                          ? "text-green-500"
                          : "text-red-500"
                    }`}
                  >
                    <span className="truncate">
                      {totalReturnPref == null
                        ? "—"
                        : mask(
                            `${totalReturnPref >= 0 ? "+" : "-"}${formatCurrency(Math.abs(totalReturnPref))}`,
                          )}
                    </span>
                    {positionRoiPct != null && (
                      <span className="text-xs md:text-sm font-medium">
                        · {mask(formatRoiPct(positionRoiPct))}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    Investované: {mask(formatCurrency(investedPref))}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
                <div className="rounded-md bg-muted/25 px-2.5 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">Počet kusov</div>
                  <div className="text-lg md:text-2xl font-semibold mt-0.5">
                    {formatShareQuantity(data.totals.shares)}
                  </div>
                </div>
                <div className="rounded-md bg-muted/25 px-2.5 py-2">
                  <div className="text-[11px] font-medium text-muted-foreground">Celkom investované</div>
                  <div className="text-lg md:text-2xl font-semibold mt-0.5">
                    {mask(formatCurrency(convertPrice(data.totals.totalInvested, costCurrency)))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Chart + position details */}
      <div className="grid gap-3 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 min-w-0">
      <Card>
        <CardHeader className="p-3 pb-1.5 space-y-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <CardTitle className="text-sm md:text-base font-semibold">Vývoj ceny a obchody</CardTitle>
                <HelpTip title="Návratnosť a graf">
                  <p>
                    <strong>ROI pozície</strong> je pomer aktuálnej kotácie k váženému priemernému nákupu (v mene
                    titulu). Nezahŕňa dividendy ani realizované zisky z predajov.
                  </p>
                  <p>
                    <strong>Zmena v období</strong> je čistá zmena uzatváracej ceny od prvého po posledný deň v grafe
                    pre zvolené obdobie — teda vývoj ceny akcie, nie vášho portfólia.
                  </p>
                  <p>Čiaru „Priem. nákup“ vidíte len pri otvorenej pozícii.</p>
                </HelpTip>
              </div>
              <CardDescription className="text-[11px] md:text-xs mt-0.5">
                {data.totals.shares > 0 && data.totals.averageCost > 0 ? (
                  <>
                    Priem. nákup{" "}
                    {mask(
                      formatAverageCostCurrency(
                        convertAverageCostPrice(data.totals.averageCost, costCurrency),
                      ),
                    )}
                    {" · "}
                  </>
                ) : null}
                zelené = nákup, červené = predaj
              </CardDescription>
            </div>
            <select
              id="asset-trade-portfolio-filter"
              aria-label="Obchody podľa portfólia"
              value={tradePortfolioFilter}
              onChange={(e) => setTradePortfolioFilter(e.target.value)}
              className="h-7 w-full sm:w-[180px] rounded-md border bg-background px-2 text-xs shrink-0"
              data-testid="select-asset-trade-portfolio-filter"
            >
              <option value="all">Všetky portfóliá</option>
              {tradePortfolioOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-2 space-y-2.5">
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Historické ceny nie sú k dispozícii (alebo ide o hotovosť).
            </p>
          ) : (
            <>
              <div
                className={cn(
                  "w-full min-w-0 overflow-x-auto overscroll-x-contain pb-0.5 sm:overflow-visible [-webkit-overflow-scrolling:touch]",
                )}
              >
                <ToggleGroup
                  type="single"
                  value={priceChartRange}
                  onValueChange={(v) => v && setPriceChartRange(v as PriceChartRange)}
                  className="flex w-max min-w-full flex-nowrap justify-start gap-0.5 sm:w-full sm:flex-wrap"
                >
                  {PRICE_CHART_RANGE_OPTIONS.map((o) => (
                    <ToggleGroupItem
                      key={o.v}
                      value={o.v}
                      className="shrink-0 text-[11px] h-7 px-2 data-[state=on]:z-10"
                    >
                      {o.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {data.ticker !== "CASH" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:hidden">
                  <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      ROI pozície (vs. priem. nákup)
                    </div>
                    <div
                      className={cn(
                        "text-xl font-semibold tabular-nums",
                        positionRoiPct == null
                          ? "text-muted-foreground"
                          : positionRoiPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-500",
                      )}
                    >
                      {data.totals.shares <= 0 ? (
                        <span className="text-sm font-normal text-muted-foreground">Bez otvorenej pozície</span>
                      ) : positionRoiPct == null ? (
                        <span className="text-sm font-normal text-muted-foreground">Kotácia nedostupná</span>
                      ) : (
                        mask(formatRoiPct(positionRoiPct))
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      Zmena ceny v období (graf)
                    </div>
                    <div
                      className={cn(
                        "text-xl font-semibold tabular-nums",
                        periodPriceReturnPct == null
                          ? "text-muted-foreground"
                          : periodPriceReturnPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-500",
                      )}
                    >
                      {mask(formatRoiPct(periodPriceReturnPct))}
                    </div>
                  </div>
                </div>
              )}

              {filteredChartData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Pre zvolené obdobie nie sú dáta — skráťte rozsah alebo zvoľte „Všetko“.
                </p>
              ) : (
                <div
                  className={cn(
                    "relative w-full overflow-hidden rounded-lg",
                    isMobile ? "h-[240px]" : "h-[280px]",
                  )}
                  data-testid="asset-price-chart"
                >
                  <div className="chart-fade-grid" aria-hidden />
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={filteredChartData}
                      margin={{
                        top: 8,
                        right: isMobile ? 4 : 12,
                        left: isMobile ? -6 : 0,
                        bottom: 0,
                      }}
                    >
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        minTickGap={isMobile ? 20 : 28}
                        tickFormatter={(v) => {
                          try {
                            return format(parseISO(v as string), "MMM yy", { locale: sk });
                          } catch {
                            return String(v);
                          }
                        }}
                      />
                      <YAxis
                        domain={["auto", "auto"]}
                        tick={{ fontSize: 10 }}
                        width={isMobile ? 44 : 56}
                        tickFormatter={(v) => Number(v).toFixed(0)}
                      />
                      <RechartsTooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0].payload as { date: string; price: number };
                          return (
                            <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md max-w-[220px]">
                              <div className="font-medium">
                                {format(parseISO(row.date), "d. MMM yyyy", { locale: sk })}
                              </div>
                              <div className="text-muted-foreground text-[10px]">{row.date}</div>
                              <div className="mt-1 font-medium">
                                {mask(formatQuoteAmount(row.price))}
                              </div>
                            </div>
                          );
                        }}
                      />
                      {data.totals.shares > 0 && data.totals.averageCost > 0 && (
                        <ReferenceLine
                          y={data.totals.averageCost}
                          stroke="hsl(var(--muted-foreground))"
                          strokeDasharray="6 4"
                          label={{
                            value: "Priem. nákup",
                            position: "insideTopRight",
                            fill: "hsl(var(--muted-foreground))",
                            fontSize: 10,
                          }}
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="hsl(var(--primary))"
                        dot={false}
                        strokeWidth={2.25}
                        isAnimationActive={!isMobile}
                      />
                      {tradeMarkersInRange.map((m) => (
                        <ReferenceDot
                          key={m.key}
                          x={m.date}
                          y={m.price}
                          r={isMobile ? 4 : 5}
                          fill={m.kind === "BUY" ? "hsl(160 65% 52%)" : "hsl(350 65% 62%)"}
                          stroke="#fff"
                          strokeWidth={1}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
        </div>
        <div className="min-w-0">
          <Card className="border-border bg-card shadow-sm" data-testid="asset-position-details">
            <CardHeader className="p-3 pb-1.5">
              <CardTitle className="text-sm md:text-base font-semibold">Detail pozície</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-0">
              <div className="divide-y divide-border/60">
                <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Kusy</span>
                  <span className="font-semibold tabular-nums text-sm">
                    {formatShareQuantity(data.totals.shares)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Priem. nákup</span>
                  <span className="font-semibold tabular-nums text-sm">
                    {mask(
                      formatAverageCostCurrency(
                        convertAverageCostPrice(data.totals.averageCost, costCurrency),
                      ),
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Nákladová báza</span>
                  <span className="font-semibold tabular-nums text-sm">
                    {mask(formatCurrency(convertPrice(data.totals.totalInvested, costCurrency)))}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">ROI pozície</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums text-sm",
                      positionRoiPct == null
                        ? "text-muted-foreground"
                        : positionRoiPct >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-500",
                    )}
                  >
                    {data.totals.shares <= 0
                      ? "—"
                      : positionRoiPct == null
                        ? "—"
                        : mask(formatRoiPct(positionRoiPct))}
                  </span>
                </div>
                {periodPriceReturnPct != null && (
                  <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="text-xs text-muted-foreground">Zmena v období</span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums text-sm",
                        periodPriceReturnPct >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-500",
                      )}
                    >
                      {mask(formatRoiPct(periodPriceReturnPct))}
                    </span>
                  </div>
                )}
              </div>

              {data.ticker !== "CASH" && (
                <div
                  className={cn(
                    "mt-2.5 rounded-md px-2.5 py-2",
                    data.nextEarnings
                      ? "border border-amber-500/25 bg-amber-500/[0.06] dark:bg-amber-500/10"
                      : "border border-dashed border-muted-foreground/25",
                  )}
                  title={
                    data.nextEarnings
                      ? "Očakávaný dátum (Yahoo alebo Finnhub), môže sa zmeniť."
                      : "Yahoo často blokuje API; so FINNHUB_API_KEY na serveri sa použije záložný kalendár Finnhub."
                  }
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                    <Calendar
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        data.nextEarnings
                          ? "text-amber-600 dark:text-amber-400"
                          : "opacity-70",
                      )}
                    />
                    Najbližšie earnings
                  </div>
                  {data.nextEarnings ? (
                    <div className="text-sm font-semibold mt-0.5 tabular-nums">
                      {format(parse(data.nextEarnings.date, "yyyy-MM-dd", new Date()), "d. MMM yyyy", {
                        locale: sk,
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      Dátum sa nepodarilo načítať.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3 items-start",
          data.ticker !== "CASH" && "md:grid-cols-2",
        )}
      >
        <div className="min-w-0">
          <Card className="h-full">
            <CardHeader className="p-3 pb-1.5">
              <CardTitle className="text-sm md:text-base font-semibold">Podľa portfólia</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1">
              {data.positions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Momentálne nemáte otvorenú pozíciu (všetko predané).
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Portfólio</TableHead>
                      <TableHead className="text-right">Kusy</TableHead>
                      <TableHead className="text-right">Priem. nákup</TableHead>
                      <TableHead className="text-right">Investované</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.positions.map((p) => {
                      const positionCostCurrency = p.costCurrency ?? costCurrency;
                      return (
                        <TableRow key={p.portfolioId ?? "none"}>
                          <TableCell>
                            <div className="flex items-center gap-2 min-w-0">
                              <BrokerLogo brokerCode={p.brokerCode as BrokerCode | null} size="xs" />
                              <span className="truncate">{p.portfolioName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatShareQuantity(p.shares)}
                          </TableCell>
                          <TableCell className="text-right">
                            {mask(
                              formatAverageCostCurrency(
                                convertAverageCostPrice(p.averageCost, positionCostCurrency),
                              ),
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {mask(formatCurrency(convertPrice(p.totalInvested, positionCostCurrency)))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {data.ticker !== "CASH" && (
          <div className="min-w-0">
            <Card className="h-full" data-testid="asset-earnings-history">
              <CardHeader className="p-3 pb-1.5">
                <CardTitle className="text-sm md:text-base font-semibold">Výsledky (earnings)</CardTitle>
                <CardDescription className="text-[11px] md:text-xs">
                  EPS a ukazovatele podľa rokov / kvartálov
                </CardDescription>
              </CardHeader>
              <CardContent className="p-3 pt-0 max-h-[420px] overflow-y-auto">
                {earningsHistoryLoading ? (
                  <Skeleton className="h-28 w-full" />
                ) : earningsHistoryError ? (
                  <p className="text-sm text-destructive">Históriu earnings sa nepodarilo načítať.</p>
                ) : !earningsHistory?.years?.length ? (
                  <p className="text-sm text-muted-foreground">
                    Pre tento ticker nie sú dostupné historické výsledky (bežné pri ETF, kryptomenách
                    alebo keď Yahoo/Finnhub neodpovie).
                  </p>
                ) : (
                  <Accordion
                    type="multiple"
                    defaultValue={
                      earningsHistory.years[0] ? [String(earningsHistory.years[0].year)] : []
                    }
                    className="w-full"
                  >
                    {earningsHistory.years.map((yearGroup) => {
                      return (
                        <AccordionItem key={yearGroup.year} value={String(yearGroup.year)}>
                          <AccordionTrigger
                            className="py-2.5 hover:no-underline text-left"
                            data-testid={`earnings-year-${yearGroup.year}`}
                          >
                            <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-2">
                              <span className="font-semibold tabular-nums">{yearGroup.year}</span>
                              {yearGroup.revenue != null && (
                                <span className="text-xs text-muted-foreground">
                                  Tržby {formatCompactMoney(yearGroup.revenue, earningsHistory.currency)}
                                </span>
                              )}
                              {yearGroup.netIncome != null && (
                                <span className="text-xs text-muted-foreground">
                                  Zisk {formatCompactMoney(yearGroup.netIncome, earningsHistory.currency)}
                                </span>
                              )}
                              {yearGroup.quarters.length > 0 && (
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {yearGroup.quarters.length}{" "}
                                  {yearGroup.quarters.length === 1 ? "kvartál" : "kvartály"}
                                </Badge>
                              )}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            {yearGroup.quarters.length === 0 ? (
                              <p className="text-xs text-muted-foreground pb-1">
                                Kvartálne EPS pre tento rok nie sú v zdroji dostupné
                                {yearGroup.revenue != null || yearGroup.netIncome != null
                                  ? " — vyššie sú len ročné súhrny."
                                  : "."}
                              </p>
                            ) : (
                              <Accordion type="multiple" className="w-full border rounded-md px-3">
                                {yearGroup.quarters.map((q) => {
                                  const tone = surpriseTone(q.epsSurprisePercent);
                                  return (
                                    <AccordionItem
                                      key={`${q.year}-Q${q.quarter}`}
                                      value={`Q${q.quarter}`}
                                      className="border-b last:border-b-0"
                                    >
                                      <AccordionTrigger
                                        className="py-2 hover:no-underline text-sm"
                                        data-testid={`earnings-quarter-${q.year}-Q${q.quarter}`}
                                      >
                                        <div className="flex flex-1 flex-wrap items-center gap-2 pr-2">
                                          <span className="font-medium">{q.label}</span>
                                          {tone === "beat" && (
                                            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">
                                              Beat
                                              {q.epsSurprisePercent != null
                                                ? ` +${q.epsSurprisePercent.toFixed(1)}%`
                                                : ""}
                                            </Badge>
                                          )}
                                          {tone === "miss" && (
                                            <Badge variant="destructive" className="text-[10px]">
                                              Miss
                                              {q.epsSurprisePercent != null
                                                ? ` ${q.epsSurprisePercent.toFixed(1)}%`
                                                : ""}
                                            </Badge>
                                          )}
                                          {tone === "flat" && q.epsSurprisePercent != null && (
                                            <Badge variant="secondary" className="text-[10px]">
                                              {q.epsSurprisePercent >= 0 ? "+" : ""}
                                              {q.epsSurprisePercent.toFixed(1)}%
                                            </Badge>
                                          )}
                                          {q.epsActual != null && (
                                            <span className="text-xs text-muted-foreground tabular-nums">
                                              EPS {formatEps(q.epsActual)}
                                            </span>
                                          )}
                                        </div>
                                      </AccordionTrigger>
                                      <AccordionContent>
                                        <div className="grid grid-cols-2 gap-2 text-sm pb-1">
                                          <div>
                                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              EPS skutočné
                                            </div>
                                            <div className="font-semibold tabular-nums">
                                              {formatEps(q.epsActual)}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              EPS odhad
                                            </div>
                                            <div className="font-semibold tabular-nums">
                                              {formatEps(q.epsEstimate)}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              Surprise
                                            </div>
                                            <div
                                              className={cn(
                                                "font-semibold tabular-nums",
                                                tone === "beat" && "text-emerald-600",
                                                tone === "miss" && "text-red-500",
                                              )}
                                            >
                                              {q.epsSurprise != null ? formatEps(q.epsSurprise) : "—"}
                                              {q.epsSurprisePercent != null
                                                ? ` (${q.epsSurprisePercent >= 0 ? "+" : ""}${q.epsSurprisePercent.toFixed(2)}%)`
                                                : ""}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              Tržby
                                            </div>
                                            <div className="font-semibold tabular-nums">
                                              {q.revenue != null
                                                ? formatCompactMoney(q.revenue, earningsHistory.currency)
                                                : "—"}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              Čistý zisk
                                            </div>
                                            <div className="font-semibold tabular-nums">
                                              {q.netIncome != null
                                                ? formatCompactMoney(q.netIncome, earningsHistory.currency)
                                                : "—"}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              Koniec obdobia
                                            </div>
                                            <div className="font-semibold tabular-nums">
                                              {q.periodEnd
                                                ? format(
                                                    parse(q.periodEnd, "yyyy-MM-dd", new Date()),
                                                    "d. M. yyyy",
                                                    { locale: sk },
                                                  )
                                                : "—"}
                                            </div>
                                          </div>
                                          {q.reportedDate && (
                                            <div className="col-span-2">
                                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                                Dátum reportu
                                              </div>
                                              <div className="font-semibold tabular-nums">
                                                {format(
                                                  parse(q.reportedDate, "yyyy-MM-dd", new Date()),
                                                  "d. M. yyyy",
                                                  { locale: sk },
                                                )}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </AccordionContent>
                                    </AccordionItem>
                                  );
                                })}
                              </Accordion>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                )}
                {earningsHistory?.source && (
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Zdroj:{" "}
                    {earningsHistory.source === "yahoo"
                      ? "Yahoo Finance"
                      : earningsHistory.source === "finnhub"
                        ? "Finnhub"
                        : "Alpha Vantage"}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {data.ticker !== "CASH" && !isPokemonTicker(data.ticker) && (
        <AnalystRatingsCard
          ticker={data.ticker}
          formatPrice={(amount) => mask(formatQuoteAmount(amount))}
        />
      )}

      {data.ticker !== "CASH" && data.positions.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-1.5">
            <CardTitle className="text-sm md:text-base font-semibold">Otvorené pozície (FIFO loty)</CardTitle>
            <CardDescription className="text-[11px] md:text-xs">
              FIFO nákupné dávky · nerealizovaný PnL · oslobodenie orient. 365 dní
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            {anyLotsLoading && fifoLotRows.length === 0 ? (
              <Skeleton className="h-32 w-full" />
            ) : lotsError ? (
              <p className="text-sm text-destructive">Loty sa nepodarilo načítať.</p>
            ) : fifoLotRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Žiadne otvorené nákupné dávky (všetko môže byť predané, alebo chýba cena z trhu).
              </p>
            ) : (
              <div className="space-y-2">
                <div className="md:hidden space-y-2">
                  {fifoLotRows.map((row, idx) => {
                    const pnlClass =
                      !row.currentPriceAvailable
                        ? "text-muted-foreground"
                        : row.currentPnl > 0
                          ? "text-emerald-600"
                          : row.currentPnl < 0
                            ? "text-red-500"
                            : "";
                    return (
                      <div
                        key={`${row.portfolioId ?? "n"}-${row.acquiredAt}-${idx}-${row.remainingShares}-mobile`}
                        className="rounded-lg border p-2.5"
                      >
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div className="min-w-0 col-span-1">
                            <div className="text-[10px] text-muted-foreground">Portfólio</div>
                            <div className="font-medium truncate">{row.portfolioName}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Nákup</div>
                            <div>
                              {format(parseISO(row.acquiredAt + "T12:00:00Z"), "d. M. yyyy", {
                                locale: sk,
                              })}
                            </div>
                          </div>

                          <div className="col-span-1 text-right">
                            <div className="text-[10px] text-muted-foreground">Kusy</div>
                            <div className="font-mono">{formatShareQuantity(row.remainingShares)}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Nákup / ks</div>
                            <div>
                              {mask(
                                formatAverageCostCurrency(
                                  convertAverageCostPrice(
                                    row.pricePerShareLocal,
                                    codeToCurrency(row.purchaseCurrency),
                                  ),
                                ),
                              )}
                            </div>
                          </div>

                          <div className="col-span-1 text-right">
                            <div className="text-[10px] text-muted-foreground">Aktuálny PnL</div>
                            <div className={`font-medium ${pnlClass}`}>
                              {!row.currentPriceAvailable ? "—" : mask(formatCurrency(row.currentPnl))}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1">Kurz EUR</div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {row.eurPerUnitAtPurchase.toFixed(5)}
                            </div>
                          </div>
                        </div>

                        <div className="pt-1.5 mt-1.5 border-t border-border/60">
                          {row.taxFree ? (
                            <div className="inline-flex items-center gap-1 flex-wrap">
                              <Badge
                                className="bg-emerald-600/90 text-white hover:bg-emerald-600 border-0"
                                title="Orientačný časový test (1 rok) — detail u daňového poradcu"
                              >
                                <Shield className="h-3 w-3 mr-0.5 inline" />
                                Tax free
                              </Badge>
                            </div>
                          ) : row.inTaxFreeCountdown && row.daysToTaxFree != null ? (
                            <div
                              className="inline-flex items-center gap-1 text-amber-600"
                              title={`Cca ${row.daysToTaxFree} d. do 365 dní držby`}
                            >
                              <Clock className="h-4 w-4 shrink-0 motion-safe:animate-pulse" aria-hidden />
                              <span className="text-xs">o {row.daysToTaxFree} d.</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground" title="Držba v dňoch (orient.)">
                              ⏳ {Math.floor(row.daysHeld)} d.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Portfólio</TableHead>
                        <TableHead>Dátum nákupu</TableHead>
                        <TableHead className="text-right">Kusy</TableHead>
                        <TableHead className="text-right">Nákup / ks</TableHead>
                        <TableHead className="text-right">Kurz nákupu (EUR/1)</TableHead>
                        <TableHead className="text-right">Aktuálny PnL</TableHead>
                        <TableHead>Stav</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fifoLotRows.map((row, idx) => {
                        const pnlClass =
                          !row.currentPriceAvailable
                            ? "text-muted-foreground"
                            : row.currentPnl > 0
                              ? "text-emerald-600"
                              : row.currentPnl < 0
                                ? "text-red-500"
                                : "";
                        return (
                          <TableRow
                            key={`${row.portfolioId ?? "n"}-${row.acquiredAt}-${idx}-${row.remainingShares}`}
                          >
                            <TableCell className="max-w-[140px] truncate">{row.portfolioName}</TableCell>
                            <TableCell>
                              {format(
                                parseISO(row.acquiredAt + "T12:00:00Z"),
                                "d. M. yyyy",
                                { locale: sk },
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatShareQuantity(row.remainingShares)}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {mask(
                                formatAverageCostCurrency(
                                  convertAverageCostPrice(
                                    row.pricePerShareLocal,
                                    codeToCurrency(row.purchaseCurrency),
                                  ),
                                ),
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs font-mono text-muted-foreground">
                              {row.eurPerUnitAtPurchase.toFixed(5)}
                            </TableCell>
                            <TableCell className={`text-right text-sm font-medium ${pnlClass}`}>
                              {!row.currentPriceAvailable
                                ? "—"
                                : mask(formatCurrency(row.currentPnl))}
                            </TableCell>
                            <TableCell>
                              {row.taxFree ? (
                                <div className="inline-flex items-center gap-1 flex-wrap">
                                  <Badge
                                    className="bg-emerald-600/90 text-white hover:bg-emerald-600 border-0"
                                    title="Orientačný časový test (1 rok) — detail u daňového poradcu"
                                  >
                                    <Shield className="h-3 w-3 mr-0.5 inline" />
                                    Tax free
                                  </Badge>
                                </div>
                              ) : row.inTaxFreeCountdown && row.daysToTaxFree != null ? (
                                <div
                                  className="inline-flex items-center gap-1 text-amber-600"
                                  title={`Cca ${row.daysToTaxFree} d. do 365 dní držby`}
                                >
                                  <Clock
                                    className="h-4 w-4 shrink-0 motion-safe:animate-pulse"
                                    aria-hidden
                                  />
                                  <span className="text-xs">
                                    o {row.daysToTaxFree} d.
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground" title="Držba v dňoch (orient.)">
                                  ⏳ {Math.floor(row.daysHeld)} d.
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.dividends.paymentCount > 0 && (
        <Card>
          <CardHeader className="p-3 pb-1.5">
            <CardTitle className="text-sm md:text-base font-semibold">Dividendy</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-1 space-y-3">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-md bg-muted/25 px-2.5 py-2 min-w-0">
                <div className="text-[11px] text-muted-foreground">Hrubá ({currency})</div>
                <div className="font-semibold text-sm truncate">{mask(formatCurrency(data.dividends.totalGross))}</div>
              </div>
              <div className="rounded-md bg-muted/25 px-2.5 py-2 min-w-0">
                <div className="text-[11px] text-muted-foreground">Daň ({currency})</div>
                <div className="font-semibold text-sm truncate">{mask(formatCurrency(data.dividends.totalTax))}</div>
              </div>
              <div className="rounded-md bg-muted/25 px-2.5 py-2 min-w-0">
                <div className="text-[11px] text-muted-foreground">Čistá ({currency})</div>
                <div className="font-semibold text-sm text-green-600 dark:text-green-400 truncate">
                  {mask(formatCurrency(data.dividends.totalNet))}
                </div>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dátum</TableHead>
                  <TableHead>Portfólio</TableHead>
                  <TableHead className="text-right">Hrubá</TableHead>
                  <TableHead className="text-right">Čistá</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dividendPayments.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {format(parseISO(typeof row.date === "string" ? row.date : String(row.date)), "d. MMM yyyy", {
                        locale: sk,
                      })}
                    </TableCell>
                    <TableCell className="truncate max-w-[180px]">{row.portfolioName}</TableCell>
                    <TableCell className="text-right">
                      {mask(formatCurrency(convertPrice(row.gross, codeToCurrency(row.currency))))}
                    </TableCell>
                    <TableCell className="text-right">
                      {mask(formatCurrency(convertPrice(row.net, codeToCurrency(row.currency))))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="p-3 pb-1.5">
          <CardTitle className="text-sm md:text-base font-semibold">História transakcií</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-1 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dátum</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Portfólio</TableHead>
                <TableHead className="text-right">Ks</TableHead>
                <TableHead className="text-right">Cena / ks</TableHead>
                <TableHead className="text-right">Suma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTxDesc.map((tx) => {
                const pName = tx.portfolioId ? portfolioNameById.get(tx.portfolioId) ?? "—" : "—";
                return (
                  <TableRow key={tx.id}>
                    <TableCell className="whitespace-nowrap">
                      {format(
                        parseISO(typeof tx.transactionDate === "string" ? tx.transactionDate : String(tx.transactionDate)),
                        "d.M.yyyy",
                        { locale: sk }
                      )}
                    </TableCell>
                    <TableCell>
                      {typeLabel(tx.type)}
                      {tx.tcgCertNumber ? (
                        <div className="text-[10px] text-muted-foreground">Cert. {tx.tcgCertNumber}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate">{pName}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {tx.type === "DIVIDEND" || tx.type === "TAX"
                        ? "—"
                        : formatShareQuantity(parseFloat(tx.shares))}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {tx.type === "TAX"
                        ? "—"
                        : mask(formatCurrency(convertPrice(parseFloat(tx.pricePerShare), txnCurrency(tx))))}
                    </TableCell>
                    <TableCell className="text-right">{formatTxnValue(tx)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
