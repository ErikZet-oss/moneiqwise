import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { format, parseISO, startOfDay, subMonths, subYears } from "date-fns";
import { sk } from "date-fns/locale";
import { ArrowLeft, Calendar, ExternalLink, Moon } from "lucide-react";
import {
  getDisplayDayChange,
  getUsMarketSessionState,
  shouldUseExtendedQuotes,
} from "@/lib/usMarketSession";
import {
  Area,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Transaction } from "@shared/schema";
import type { QuoteCurrency } from "@shared/tickerCurrency";
import { isPokemonTicker } from "@shared/pokemonTcg";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import { cn, formatShareQuantity } from "@/lib/utils";
import type { AnalystRatingsResponse } from "@/components/AnalystRatingsCard";
import { Avatar, Badge, Card, Chip, EmptyState, Select, StatTile } from "@/redesign/ui";
import { HelpButton, KvRow, PageBody, signedMoney, signedPct, toneOf } from "./mobileChrome";

function asQuoteCurrency(raw: string | null | undefined): QuoteCurrency {
  const x = (raw || "EUR").toUpperCase();
  if (x === "USD" || x === "GBP" || x === "CZK" || x === "PLN" || x === "EUR" || x === "HKD") return x;
  return "EUR";
}

const RANGES = [
  { v: "1m", label: "1M" },
  { v: "3m", label: "3M" },
  { v: "6m", label: "6M" },
  { v: "1y", label: "1R" },
  { v: "5y", label: "5R" },
  { v: "all", label: "Všetko" },
] as const;
type PriceRange = (typeof RANGES)[number]["v"];

type PositionRow = {
  portfolioId: string | null;
  portfolioName: string;
  shares: number;
  averageCost: number;
  totalInvested: number;
};

type AssetDetailResponse = {
  ticker: string;
  companyName: string;
  costCurrency: string;
  positions: PositionRow[];
  totals: { shares: number; totalInvested: number; averageCost: number };
  dividends: { totalNet: number; paymentCount: number };
  quote: {
    price: number;
    change: number;
    changePercent: number;
    preMarketPrice?: number | null;
    preMarketChange?: number | null;
    preMarketChangePercent?: number | null;
    marketState?: string | null;
  } | null;
  nextEarnings: { date: string } | null;
  prices: Record<string, number>;
  marketTransactions: Transaction[];
  priceNote?: string | null;
};

type EarningsYear = {
  year: number;
  revenue: number | null;
  netIncome: number | null;
  quarters: Array<{ label: string; epsActual: number | null; epsSurprisePercent: number | null }>;
};

type OwnershipActivityItem = {
  id: string;
  date: string | null;
  actorName: string;
  shares: number | null;
  value: number | null;
  kind: "INSIDER" | "INSTITUTION";
  note: string | null;
};

type OwnershipActivityResponse = {
  ticker: string;
  currency: string | null;
  items: OwnershipActivityItem[];
  source: "yahoo" | null;
};

type OpenFifoLotRow = {
  acquiredAt: string;
  remainingShares: number;
  pricePerShareLocal: number;
  purchaseCurrency: string;
  currentPriceAvailable: boolean;
  currentPnl: number;
  taxFree: boolean;
  daysToTaxFree: number | null;
  inTaxFreeCountdown: boolean;
  daysHeld: number;
};

function filterSeries(series: Array<{ date: string; price: number }>, range: PriceRange) {
  if (series.length === 0 || range === "all") return series;
  const last = parseISO(`${series[series.length - 1]!.date}T12:00:00Z`);
  const start =
    range === "1m"
      ? subMonths(last, 1)
      : range === "3m"
        ? subMonths(last, 3)
        : range === "6m"
          ? subMonths(last, 6)
          : range === "1y"
            ? subYears(last, 1)
            : subYears(last, 5);
  const cutoff = format(startOfDay(start), "yyyy-MM-dd");
  return series.filter((point) => point.date >= cutoff);
}

function recommendationLabel(key: string | null): string {
  switch ((key ?? "").toLowerCase()) {
    case "strong_buy":
      return "Strong Buy";
    case "buy":
      return "Buy";
    case "hold":
      return "Hold";
    case "sell":
    case "underperform":
      return "Sell";
    case "strong_sell":
      return "Strong Sell";
    default:
      return key ? key.replace(/_/g, " ") : "—";
  }
}

function recommendationTone(key: string | null): "Profit" | "Warning" | "Loss" | "Neutral" {
  switch ((key ?? "").toLowerCase()) {
    case "strong_buy":
    case "buy":
      return "Profit";
    case "hold":
      return "Warning";
    case "sell":
    case "underperform":
    case "strong_sell":
      return "Loss";
    default:
      return "Neutral";
  }
}

function formatCompactMoney(value: number, currencyHint?: string | null): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const ccy = currencyHint && /^[A-Z]{3}$/.test(currencyHint) ? ` ${currencyHint}` : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} mld.${ccy}`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)} mil.${ccy}`;
  return `${sign}${abs.toLocaleString("sk-SK", { maximumFractionDigits: 0 })}${ccy}`;
}

function formatOwnershipDate(value: string | null): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "d. M. yyyy", { locale: sk });
  } catch {
    return value;
  }
}

export default function AssetDetailMobile() {
  const params = useParams<{ ticker?: string }>();
  const ticker = params.ticker ? decodeURIComponent(params.ticker) : "";
  const [, setLocation] = useLocation();
  const {
    currency,
    convertPrice,
    getTickerCurrency,
    formatCurrency,
    convertAverageCostPrice,
    formatAverageCostCurrency,
  } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const [range, setRange] = useState<PriceRange>("1y");
  const [quoteInPreferred, setQuoteInPreferred] = useState(true);
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [portfolioFilter, setPortfolioFilter] = useState("all");
  const [lotsExpanded, setLotsExpanded] = useState(false);
  const [ownershipExpanded, setOwnershipExpanded] = useState(false);
  const mask = (value: string) => (hideAmounts ? "••••••" : value);

  const { data, isLoading, error } = useQuery<AssetDetailResponse>({
    queryKey: ["/api/assets", ticker],
    enabled: !!ticker,
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}`, { credentials: "include" });
      if (res.status === 404) throw new Error("NOT_FOUND");
      if (!res.ok) throw new Error("Failed to fetch asset detail");
      return res.json();
    },
  });

  const { data: earnings } = useQuery<{ years: EarningsYear[]; source: string | null }>({
    queryKey: ["/api/assets", ticker, "earnings-history"],
    enabled: !!ticker && !!data && data.ticker !== "CASH" && !isPokemonTicker(data.ticker),
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}/earnings-history`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("earnings-history");
      return res.json();
    },
  });

  const { data: ratings } = useQuery<AnalystRatingsResponse>({
    queryKey: ["/api/assets", ticker, "analyst-ratings"],
    enabled: !!ticker && !!data && data.ticker !== "CASH" && !isPokemonTicker(data.ticker),
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}/analyst-ratings`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("analyst-ratings");
      return res.json();
    },
  });

  const { data: ownershipActivity } = useQuery<OwnershipActivityResponse>({
    queryKey: ["/api/assets", ticker, "ownership-activity"],
    enabled: !!ticker && !!data && data.ticker !== "CASH" && !isPokemonTicker(data.ticker),
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}/ownership-activity`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("ownership-activity");
      return res.json();
    },
  });

  const lotQueries = useQueries({
    queries: (data?.positions ?? []).map((pos) => {
      const pathSeg = pos.portfolioId == null ? "unassigned" : pos.portfolioId;
      return {
        queryKey: ["/api/portfolios", pathSeg, "asset-lots", ticker] as const,
        queryFn: async () => {
          const res = await fetch(
            `/api/portfolios/${pathSeg === "unassigned" ? "unassigned" : encodeURIComponent(pathSeg)}/asset-lots?ticker=${encodeURIComponent(ticker)}`,
            { credentials: "include" },
          );
          if (!res.ok) throw new Error("asset-lots");
          return res.json() as Promise<{ lots: OpenFifoLotRow[] }>;
        },
        enabled: !!ticker && !!data && data.ticker !== "CASH" && (data?.positions?.length ?? 0) > 0,
        staleTime: 60_000,
      };
    }),
  });

  const fifoLots = useMemo(() => {
    if (!data?.positions) return [];
    const out: Array<OpenFifoLotRow & { portfolioName: string }> = [];
    data.positions.forEach((pos, i) => {
      const lots = lotQueries[i]?.data?.lots ?? [];
      for (const lot of lots) out.push({ ...lot, portfolioName: pos.portfolioName });
    });
    return out;
  }, [data?.positions, lotQueries]);

  const quoteCurrency = data ? getTickerCurrency(data.ticker) : currency;
  const series = useMemo(() => {
    if (!data?.prices) return [];
    return Object.keys(data.prices)
      .sort()
      .map((date) => ({
        date,
        price: quoteInPreferred
          ? convertPrice(data.prices[date] ?? 0, quoteCurrency)
          : (data.prices[date] ?? 0),
      }));
  }, [data, quoteInPreferred, convertPrice, quoteCurrency]);

  const visible = filterSeries(series, range);
  const first = visible[0]?.price ?? null;
  const last = visible[visible.length - 1]?.price ?? null;
  const periodChange = first && last && first !== 0 ? ((last - first) / first) * 100 : null;

  const portfolioOptions = useMemo(() => {
    const opts = [{ value: "all", label: "Všetky portfóliá" }];
    for (const pos of data?.positions ?? []) {
      opts.push({
        value: pos.portfolioId ?? "unassigned",
        label: pos.portfolioName,
      });
    }
    return opts;
  }, [data?.positions]);

  if (!ticker) {
    return (
      <PageBody>
        <EmptyState
          title="Neplatný ticker"
          body="Vráťte sa na prehľad a otvorte aktívum zo zoznamu."
          actionLabel="Späť na prehľad"
          onAction={() => setLocation("/")}
        />
      </PageBody>
    );
  }
  if (isLoading) {
    return (
      <PageBody>
        <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">Načítavam {ticker}…</p>
      </PageBody>
    );
  }
  if (error instanceof Error && error.message === "NOT_FOUND") {
    return (
      <PageBody>
        <EmptyState
          title="Bez dát"
          body="Pre tento ticker nemáte v aplikácii žiadne dáta."
          actionLabel="Späť na prehľad"
          onAction={() => setLocation("/")}
        />
      </PageBody>
    );
  }
  if (error || !data) {
    return (
      <PageBody>
        <EmptyState
          title="Detail sa nenačítal"
          body="Skúste to znova o chvíľu."
          actionLabel="Späť na prehľad"
          onAction={() => setLocation("/")}
        />
      </PageBody>
    );
  }

  const quote = data.quote;
  const usSessionState = getUsMarketSessionState();
  const dayChange = getDisplayDayChange(usSessionState, quote);
  const costCurrency = asQuoteCurrency(data.costCurrency);
  const invested = convertPrice(data.totals.totalInvested, costCurrency);
  const value =
    quote && data.totals.shares > 0
      ? convertPrice(quote.price * data.totals.shares, quoteCurrency)
      : null;
  const totalReturn = value != null ? value - invested : null;
  const returnPct = invested > 0 && totalReturn != null ? (totalReturn / invested) * 100 : null;
  const positionRoiPct =
    quote && data.totals.averageCost > 0
      ? ((quote.price - data.totals.averageCost) / data.totals.averageCost) * 100
      : null;
  const avgBuyDisplay =
    data.totals.averageCost > 0
      ? quoteInPreferred
        ? convertAverageCostPrice(data.totals.averageCost, costCurrency)
        : data.totals.averageCost
      : null;
  const priceLabel = (amount: number) =>
    quoteInPreferred
      ? formatCurrency(convertPrice(amount, quoteCurrency))
      : new Intl.NumberFormat("sk-SK", { style: "currency", currency: quoteCurrency }).format(amount);

  const markers = (data.marketTransactions ?? [])
    .filter((tx) => tx.type === "BUY" || tx.type === "SELL")
    .filter((tx) => {
      if (portfolioFilter === "all") return true;
      if (portfolioFilter === "unassigned") return tx.portfolioId == null;
      return tx.portfolioId === portfolioFilter;
    })
    .map((tx) => {
      const date = String(tx.transactionDate).slice(0, 10);
      const point = visible.find((row) => row.date >= date) ?? visible[visible.length - 1];
      return point ? { ...point, kind: tx.type as "BUY" | "SELL", id: tx.id } : null;
    })
    .filter((row): row is { date: string; price: number; kind: "BUY" | "SELL"; id: string } => row != null)
    .slice(-12);

  const rangeLabel = RANGES.find((r) => r.v === range)?.label ?? range;
  const trend = ratings?.recommendationTrend;
  const buyCount = (trend?.strongBuy ?? 0) + (trend?.buy ?? 0);
  const holdCount = trend?.hold ?? 0;
  const sellCount = (trend?.sell ?? 0) + (trend?.strongSell ?? 0);
  const totalVotes = buyCount + holdCount + sellCount;
  const ownershipRows = ownershipActivity?.items ?? [];
  const visibleOwnership = ownershipExpanded ? ownershipRows : ownershipRows.slice(0, 4);
  const visibleLots = lotsExpanded ? fifoLots : fifoLots.slice(0, 5);
  const earningsYears = earnings?.years ?? [];
  const defaultOpenYear = openYear ?? earningsYears[0]?.year ?? null;

  const nextEarningsLabel = data.nextEarnings?.date
    ? format(parseISO(`${data.nextEarnings.date}T12:00:00`), "d. MMM yyyy", { locale: sk })
    : null;

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <PageBody>
        <button
          type="button"
          onClick={() => setLocation("/")}
          className="inline-flex min-h-[40px] items-center gap-2 text-[13px] font-medium text-[var(--rd-text-secondary)]"
        >
          <ArrowLeft className="size-4" />
          Späť na prehľad
        </button>

        <div className="flex items-start gap-3">
          <Avatar ticker={data.ticker} companyName={data.companyName} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate rd-type-h1" data-testid="asset-detail-title">
              {data.companyName}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="rd-type-data-sm text-[var(--rd-text-secondary)]">{data.ticker}</span>
              <a
                className="inline-flex items-center gap-1 rd-type-body-sm text-[var(--rd-profit)]"
                href={`https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`}
                target="_blank"
                rel="noreferrer"
              >
                Yahoo Finance
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>
          </div>
          {quoteCurrency !== currency ? (
            <div className="flex shrink-0 gap-1">
              <Chip active={!quoteInPreferred} onClick={() => setQuoteInPreferred(false)}>
                {quoteCurrency}
              </Chip>
              <Chip active={quoteInPreferred} onClick={() => setQuoteInPreferred(true)}>
                {currency}
              </Chip>
            </div>
          ) : null}
        </div>

        <Card className="gap-2">
          <p className="rd-type-display-lg">
            {quote
              ? mask(
                  priceLabel(
                    dayChange.showMoon &&
                      quote.preMarketPrice != null &&
                      Number.isFinite(quote.preMarketPrice) &&
                      quote.preMarketPrice > 0
                      ? quote.preMarketPrice
                      : quote.price,
                  ),
                )
              : "—"}
          </p>
          {quote ? (
            usSessionState === "LIVE" || dayChange.showMoon || !shouldUseExtendedQuotes(usSessionState) ? (
              <p
                className={cn(
                  "inline-flex items-center gap-1 rd-type-data-sm",
                  dayChange.change >= 0 ? "text-[var(--rd-profit)]" : "text-[var(--rd-loss)]",
                )}
              >
                {dayChange.showMoon ? (
                  <Moon className="size-3 shrink-0 text-[var(--rd-warning)]" aria-hidden />
                ) : null}
                {signedMoney((n) => priceLabel(n), dayChange.change)}{" "}
                {dayChange.changePercent != null ? signedPct(dayChange.changePercent) : null}{" "}
                {dayChange.showMoon ? "mimo trhu" : "dnes"}
              </p>
            ) : (
              <p className="rd-type-data-sm text-[var(--rd-text-tertiary)]">Trh uzatvorený</p>
            )
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[var(--rd-radius-md)] border border-[var(--rd-border-subtle)] p-2 [background-image:var(--rd-bg-surface-gradient)]">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Vaša pozícia</p>
              <p className="rd-type-data-lg text-[var(--rd-text-primary)]">
                {value != null ? mask(formatCurrency(value)) : "—"}
              </p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                {formatShareQuantity(data.totals.shares)} ks
              </p>
            </div>
            <div className="rounded-[var(--rd-radius-md)] border border-[var(--rd-border-subtle)] p-2 [background-image:var(--rd-bg-surface-gradient)]">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Celkový výnos</p>
              <p
                className={cn(
                  "rd-type-data-lg",
                  toneOf(totalReturn ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]",
                )}
              >
                {totalReturn != null ? mask(signedMoney(formatCurrency, totalReturn)) : "—"}
              </p>
              <p
                className={cn(
                  "rd-type-body-sm",
                  toneOf(returnPct ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]",
                )}
              >
                {returnPct != null ? signedPct(returnPct) : "—"}
              </p>
            </div>
          </div>
          <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
            Investované <span className="rd-type-data-sm text-[var(--rd-text-primary)]">{mask(formatCurrency(invested))}</span>
          </p>
          {data.priceNote ? <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">{data.priceNote}</p> : null}
        </Card>

        <Card className="gap-2">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 rd-type-h2">Vývoj ceny a obchody</p>
            <HelpButton
              title="Vývoj ceny a obchody"
              body="Graf trhovej ceny s priemerným nákupom a značkami nákupov/predajov. ROI pozície je voči priemernej nákupnej cene."
            />
          </div>
          {portfolioOptions.length > 1 ? (
            <Select value={portfolioFilter} options={portfolioOptions} onChange={setPortfolioFilter} />
          ) : null}
          <div className="flex flex-wrap gap-1">
            {RANGES.map((option) => (
              <Chip key={option.v} active={range === option.v} onClick={() => setRange(option.v)}>
                {option.label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">ROI pozície</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">vs. priem. nákup</p>
              <p
                className={cn(
                  "rd-type-data-lg",
                  toneOf(positionRoiPct ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]",
                )}
              >
                {positionRoiPct != null ? signedPct(positionRoiPct) : "—"}
              </p>
            </div>
            <div>
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Zmena ceny</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">v období ({rangeLabel})</p>
              <p
                className={cn(
                  "rd-type-data-lg",
                  toneOf(periodChange ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]",
                )}
              >
                {periodChange != null ? signedPct(periodChange) : "—"}
              </p>
            </div>
          </div>
          <div className="h-44 w-full">
            {visible.length < 2 ? (
              <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">Nedostatok cenovej histórie.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={visible} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--rd-text-tertiary)" }}
                    tickFormatter={(d: string) => d.slice(2, 7)}
                    minTickGap={28}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide domain={["auto", "auto"]} />
                  <RTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as { date: string; price: number };
                      return (
                        <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-2 text-xs">
                          {row.date}
                          <br />
                          {mask(formatCurrency(row.price))}
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke="var(--rd-loss)"
                    fill="var(--rd-loss)"
                    fillOpacity={0.12}
                    strokeWidth={2}
                    dot={false}
                  />
                  {avgBuyDisplay != null && avgBuyDisplay > 0 ? (
                    <ReferenceLine
                      y={avgBuyDisplay}
                      stroke="var(--rd-text-primary)"
                      strokeDasharray="4 4"
                      strokeOpacity={0.55}
                      label={{
                        value: `Priem. nákup ${mask(formatCurrency(avgBuyDisplay))}`,
                        position: "insideTopRight",
                        fill: "var(--rd-text-tertiary)",
                        fontSize: 10,
                      }}
                    />
                  ) : null}
                  {markers.map((marker) => (
                    <ReferenceDot
                      key={`${marker.kind}-${marker.id}-${marker.date}`}
                      x={marker.date}
                      y={marker.price}
                      r={3.5}
                      fill={marker.kind === "BUY" ? "var(--rd-profit)" : "var(--rd-loss)"}
                      stroke="var(--rd-bg-base)"
                      strokeWidth={1}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex gap-4 rd-type-body-sm text-[var(--rd-text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-loss)]" /> Cena
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-profit)]" /> Nákup
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-loss)]" /> Predaj
            </span>
          </div>
        </Card>

        <Card className="gap-2">
          <p className="rd-type-h2">Detail pozície</p>
          <div className="flex flex-col gap-2">
            <KvRow label="Kusy" value={formatShareQuantity(data.totals.shares)} />
            <KvRow
              label="Priem. nákup"
              value={mask(
                formatAverageCostCurrency(convertAverageCostPrice(data.totals.averageCost, costCurrency)),
              )}
            />
            <KvRow label="Nákladová báza" value={mask(formatCurrency(invested))} />
            <KvRow
              label="ROI pozície"
              value={positionRoiPct != null ? signedPct(positionRoiPct) : "—"}
              tone={toneOf(positionRoiPct ?? 0)}
            />
            <KvRow
              label="Zmena v období"
              value={periodChange != null ? signedPct(periodChange) : "—"}
              tone={toneOf(periodChange ?? 0)}
            />
          </div>
          {nextEarningsLabel ? (
            <div className="flex items-center gap-2 rounded-[var(--rd-radius-sm)] border border-[var(--rd-warning)]/30 bg-[var(--rd-warning-dim)] px-3 py-2">
              <Calendar className="size-4 shrink-0 text-[var(--rd-warning)]" aria-hidden />
              <p className="rd-type-body-sm text-[var(--rd-warning)]">
                Najbližšie earnings <span className="font-semibold">{nextEarningsLabel}</span>
              </p>
            </div>
          ) : null}
          {data.positions.length > 0 ? (
            <div className="flex flex-col gap-2 pt-1">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Podľa portfólia</p>
              {data.positions.map((position) => (
                <div
                  key={position.portfolioId ?? position.portfolioName}
                  className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] p-2"
                >
                  <p className="rd-type-body-strong text-[var(--rd-text-primary)]">{position.portfolioName}</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    <div>
                      <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Kusy</p>
                      <p className="rd-type-data-sm">{formatShareQuantity(position.shares)}</p>
                    </div>
                    <div>
                      <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Priem. nákup</p>
                      <p className="rd-type-data-sm">
                        {mask(
                          formatAverageCostCurrency(
                            convertAverageCostPrice(position.averageCost, costCurrency),
                          ),
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Investované</p>
                      <p className="rd-type-data-sm">
                        {mask(formatCurrency(convertPrice(position.totalInvested, costCurrency)))}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        {data.ticker !== "CASH" && !isPokemonTicker(data.ticker) ? (
          <Card className="gap-2">
            <div>
              <p className="rd-type-h2">Výsledky</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">EPS a ukazovatele podľa rokov / kvartálov</p>
            </div>
            {earningsYears.length === 0 ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Žiadne earnings dáta.</p>
            ) : (
              earningsYears.map((year) => {
                const open = defaultOpenYear === year.year;
                return (
                  <div key={year.year} className="border-t border-[var(--rd-border-subtle)] pt-2">
                    <button
                      type="button"
                      onClick={() => setOpenYear((prev) => (prev === year.year ? null : year.year))}
                      className="flex min-h-[40px] w-full items-center gap-2 text-left"
                    >
                      <span className="flex-1 rd-type-body-strong">{year.year}</span>
                      <span className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                        {year.revenue != null ? `Tržby ${year.revenue.toLocaleString("sk-SK")}` : null}
                        {year.revenue != null && year.netIncome != null ? " · " : null}
                        {year.netIncome != null ? `Zisk ${year.netIncome.toLocaleString("sk-SK")}` : null}
                      </span>
                    </button>
                    {open
                      ? year.quarters.map((quarter) => (
                          <div key={quarter.label} className="mt-1.5 flex items-center gap-2">
                            <p className="min-w-0 flex-1 rd-type-body-sm">{quarter.label}</p>
                            {quarter.epsSurprisePercent != null ? (
                              <Badge
                                label={`${quarter.epsSurprisePercent >= 0 ? "Beat" : "Miss"} ${signedPct(quarter.epsSurprisePercent, 1)}`}
                                tone={quarter.epsSurprisePercent >= 0 ? "Profit" : "Loss"}
                              />
                            ) : null}
                            <p className="rd-type-data-sm">
                              EPS{" "}
                              {quarter.epsActual != null
                                ? quarter.epsActual.toLocaleString("sk-SK", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 4,
                                  })
                                : "—"}
                            </p>
                          </div>
                        ))
                      : null}
                  </div>
                );
              })
            )}
            {earnings?.source ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Zdroj: {earnings.source}</p>
            ) : null}
          </Card>
        ) : null}

        {data.ticker !== "CASH" && !isPokemonTicker(data.ticker) ? (
          <Card className="gap-2">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 rd-type-h2">Analyst Ratings</p>
              <Badge
                label={recommendationLabel(ratings?.recommendationKey ?? null)}
                tone={recommendationTone(ratings?.recommendationKey ?? null)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatTile
                label="Target (mean)"
                value={ratings?.targetMean != null ? mask(priceLabel(ratings.targetMean)) : "—"}
                sub={
                  ratings?.numberOfAnalystOpinions != null
                    ? `${ratings.numberOfAnalystOpinions} analytikov`
                    : undefined
                }
              />
              <StatTile
                label="vs. aktuálna cena"
                value={ratings?.upsidePercent != null ? signedPct(ratings.upsidePercent) : "—"}
                sub={quote ? `Cena: ${mask(priceLabel(quote.price))}` : undefined}
                tone={toneOf(ratings?.upsidePercent ?? 0) === "down" ? "Down" : "Up"}
              />
            </div>
            {ratings?.targetLow != null && ratings?.targetHigh != null ? (
              <div className="flex flex-col gap-1">
                <div className="relative h-1.5 rounded-full bg-[var(--rd-bg-surface-hover)]">
                  {ratings.targetMedian != null ? (
                    <span
                      className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-[var(--rd-text-primary)]"
                      style={{
                        left: `${Math.min(
                          100,
                          Math.max(
                            0,
                            ((ratings.targetMedian - ratings.targetLow) /
                              Math.max(ratings.targetHigh - ratings.targetLow, 1e-9)) *
                              100,
                          ),
                        )}%`,
                      }}
                    />
                  ) : null}
                </div>
                <div className="flex justify-between rd-type-data-micro text-[var(--rd-text-tertiary)]">
                  <span>{mask(priceLabel(ratings.targetLow))}</span>
                  <span>
                    Medián{" "}
                    {ratings.targetMedian != null ? mask(priceLabel(ratings.targetMedian)) : "—"}
                  </span>
                  <span>{mask(priceLabel(ratings.targetHigh))}</span>
                </div>
              </div>
            ) : null}
            {totalVotes > 0 ? (
              <div className="flex flex-col gap-1">
                <div className="flex h-2 overflow-hidden rounded-full">
                  <span
                    className="bg-[var(--rd-profit)]"
                    style={{ width: `${(buyCount / totalVotes) * 100}%` }}
                  />
                  <span
                    className="bg-[var(--rd-warning)]"
                    style={{ width: `${(holdCount / totalVotes) * 100}%` }}
                  />
                  <span
                    className="bg-[var(--rd-loss)]"
                    style={{ width: `${(sellCount / totalVotes) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between rd-type-data-micro text-[var(--rd-text-tertiary)]">
                  <span>
                    Buy {buyCount}
                    {trend?.strongBuy ? ` · ${trend.strongBuy} strong` : ""}
                  </span>
                  <span>Hold {holdCount}</span>
                  <span>
                    Sell {sellCount}
                    {trend?.strongSell ? ` · ${trend.strongSell} strong` : ""}
                  </span>
                </div>
              </div>
            ) : null}
            {(ratings?.history ?? []).slice(0, 4).map((row, idx) => (
              <div
                key={`${row.firm}-${row.date}-${idx}`}
                className="flex items-start gap-2 border-t border-[var(--rd-border-subtle)] pt-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="rd-type-body-strong truncate">{row.firm}</p>
                  <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                    {row.date ? formatOwnershipDate(row.date) : "—"}
                    {row.fromGrade || row.toGrade
                      ? ` · ${(row.fromGrade ?? "—")} → ${(row.toGrade ?? "—")}`
                      : null}
                  </p>
                </div>
                {row.priceTarget != null ? (
                  <p className="rd-type-data-sm shrink-0">{mask(priceLabel(row.priceTarget))}</p>
                ) : null}
              </div>
            ))}
          </Card>
        ) : null}

        {data.ticker !== "CASH" && !isPokemonTicker(data.ticker) ? (
          <Card className="gap-2">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 rd-type-h2">Nákupy insiderov a inštitúcií</p>
              {ownershipRows.length > 4 ? (
                <button
                  type="button"
                  className="rd-type-body-sm text-[var(--rd-profit)]"
                  onClick={() => setOwnershipExpanded((v) => !v)}
                >
                  {ownershipExpanded ? "Menej" : "Všetky"}
                </button>
              ) : null}
            </div>
            {ownershipRows.length === 0 ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Pre toto aktívum sa nenašli nové nákupy insiderov alebo inštitúcií.
              </p>
            ) : (
              visibleOwnership.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-col gap-1 border-t border-[var(--rd-border-subtle)] pt-2 first:border-0 first:pt-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      label={row.kind === "INSIDER" ? "Insider" : "Inštitúcia"}
                      tone={row.kind === "INSIDER" ? "AI" : "Info"}
                    />
                    <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                      {formatOwnershipDate(row.date)}
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="rd-type-body-strong truncate">{row.actorName}</p>
                      {row.note ? (
                        <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">{row.note}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="rd-type-data-sm">
                        {row.shares != null
                          ? `${formatShareQuantity(row.shares)} ks`
                          : "—"}
                      </p>
                      <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                        {row.value != null
                          ? mask(formatCompactMoney(row.value, ownershipActivity?.currency))
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>
        ) : null}

        {data.positions.length > 0 && data.ticker !== "CASH" ? (
          <Card className="gap-2">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 rd-type-h2">Otvorené pozície (FIFO loty)</p>
              {fifoLots.length > 5 ? (
                <button
                  type="button"
                  className="rd-type-body-sm text-[var(--rd-profit)]"
                  onClick={() => setLotsExpanded((v) => !v)}
                >
                  {lotsExpanded ? "Menej" : `Všetky ${fifoLots.length}`}
                </button>
              ) : null}
            </div>
            {fifoLots.length === 0 ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Žiadne otvorené nákupné dávky.
              </p>
            ) : (
              visibleLots.map((lot, idx) => {
                const openPrice = convertAverageCostPrice(
                  lot.pricePerShareLocal,
                  asQuoteCurrency(lot.purchaseCurrency),
                );
                return (
                  <div
                    key={`${lot.acquiredAt}-${lot.remainingShares}-${idx}`}
                    className="flex items-start gap-2 border-t border-[var(--rd-border-subtle)] pt-2 first:border-0 first:pt-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="rd-type-data-sm text-[var(--rd-text-secondary)]">
                        {format(parseISO(`${lot.acquiredAt}T12:00:00Z`), "d. M. yyyy", { locale: sk })}
                      </p>
                      <p className="rd-type-body-sm text-[var(--rd-text-primary)]">
                        {formatShareQuantity(lot.remainingShares)} ks @{" "}
                        {mask(formatAverageCostCurrency(openPrice))} · {lot.portfolioName}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <p
                        className={cn(
                          "rd-type-data-sm",
                          !lot.currentPriceAvailable
                            ? "text-[var(--rd-text-tertiary)]"
                            : toneOf(lot.currentPnl) === "down"
                              ? "text-[var(--rd-loss)]"
                              : "text-[var(--rd-profit)]",
                        )}
                      >
                        {!lot.currentPriceAvailable
                          ? "—"
                          : mask(signedMoney(formatCurrency, lot.currentPnl))}
                      </p>
                      {lot.taxFree ? (
                        <Badge label="Tax free" tone="Profit" />
                      ) : lot.inTaxFreeCountdown && lot.daysToTaxFree != null ? (
                        <span className="rd-type-data-micro text-[var(--rd-warning)]">
                          o {lot.daysToTaxFree} d.
                        </span>
                      ) : (
                        <span className="rd-type-data-micro text-[var(--rd-text-tertiary)]">
                          {Math.floor(lot.daysHeld)} d.
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </Card>
        ) : null}
      </PageBody>
    </div>
  );
}
