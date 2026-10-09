import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { format, parseISO, startOfDay, subMonths, subYears } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Area, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import type { Transaction } from "@shared/schema";
import type { QuoteCurrency } from "@shared/tickerCurrency";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import { formatShareQuantity } from "@/lib/utils";
import { Avatar, Badge, Card, Chip, EmptyState, StatTile, TransactionRow } from "@/redesign/ui";
import type { AnalystRatingsResponse } from "@/components/AnalystRatingsCard";
import { PageBody, signedMoney, signedPct, toneOf } from "./mobileChrome";

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
  { v: "all", label: "VĹˇetko" },
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
  quote: { price: number; change: number; changePercent: number } | null;
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

function filterSeries(series: Array<{ date: string; price: number }>, range: PriceRange) {
  if (series.length === 0 || range === "all") return series;
  const last = parseISO(`${series[series.length - 1]!.date}T12:00:00Z`);
  const start =
    range === "1m" ? subMonths(last, 1) :
    range === "3m" ? subMonths(last, 3) :
    range === "6m" ? subMonths(last, 6) :
    range === "1y" ? subYears(last, 1) :
    subYears(last, 5);
  const cutoff = format(startOfDay(start), "yyyy-MM-dd");
  return series.filter((point) => point.date >= cutoff);
}

function recommendationLabel(key: string | null): string {
  switch ((key ?? "").toLowerCase()) {
    case "strong_buy": return "Strong Buy";
    case "buy": return "Buy";
    case "hold": return "Hold";
    case "sell":
    case "underperform": return "Sell";
    case "strong_sell": return "Strong Sell";
    default: return key ? key.replace(/_/g, " ") : "â€”";
  }
}

export default function AssetDetailMobile() {
  const params = useParams<{ ticker?: string }>();
  const ticker = params.ticker ? decodeURIComponent(params.ticker) : "";
  const [, setLocation] = useLocation();
  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const [range, setRange] = useState<PriceRange>("1y");
  const [quoteInPreferred, setQuoteInPreferred] = useState(true);
  const [openYear, setOpenYear] = useState<number | null>(null);
  const mask = (value: string) => (hideAmounts ? "â€˘â€˘â€˘â€˘â€˘â€˘" : value);

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
    enabled: !!ticker && !!data && data.ticker !== "CASH",
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}/earnings-history`, { credentials: "include" });
      if (!res.ok) throw new Error("earnings-history");
      return res.json();
    },
  });

  const { data: ratings } = useQuery<AnalystRatingsResponse>({
    queryKey: ["/api/assets", ticker, "analyst-ratings"],
    enabled: !!ticker && !!data && data.ticker !== "CASH",
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}/analyst-ratings`, { credentials: "include" });
      if (!res.ok) throw new Error("analyst-ratings");
      return res.json();
    },
  });

  const quoteCurrency = data ? getTickerCurrency(data.ticker) : currency;
  const series = useMemo(() => {
    if (!data?.prices) return [];
    return Object.keys(data.prices)
      .sort()
      .map((date) => ({
        date,
        price: quoteInPreferred ? convertPrice(data.prices[date] ?? 0, quoteCurrency) : data.prices[date] ?? 0,
      }));
  }, [data, quoteInPreferred, convertPrice, quoteCurrency]);
  const visible = filterSeries(series, range);
  const first = visible[0]?.price ?? null;
  const last = visible[visible.length - 1]?.price ?? null;
  const periodChange = first && last ? ((last - first) / first) * 100 : null;

  if (!ticker) {
    return <PageBody><EmptyState title="NeplatnĂ˝ ticker" body="VrĂˇĹĄte sa na prehÄľad a otvorte aktĂ­vum zo zoznamu." actionLabel="SpĂ¤ĹĄ na prehÄľad" onAction={() => setLocation("/")} /></PageBody>;
  }
  if (isLoading) {
    return <PageBody><p className="text-sm text-[var(--rd-text-secondary)]">NaÄŤĂ­tavam {ticker}â€¦</p></PageBody>;
  }
  if (error instanceof Error && error.message === "NOT_FOUND") {
    return <PageBody><EmptyState title="Bez dĂˇt" body="Pre tento ticker nemĂˇte v aplikĂˇcii Ĺľiadne dĂˇta." actionLabel="SpĂ¤ĹĄ na prehÄľad" onAction={() => setLocation("/")} /></PageBody>;
  }
  if (error || !data) {
    return <PageBody><EmptyState title="Detail sa nenaÄŤĂ­tal" body="SkĂşste to znova o chvĂ­Äľu." actionLabel="SpĂ¤ĹĄ na prehÄľad" onAction={() => setLocation("/")} /></PageBody>;
  }

  const quote = data.quote;
  const costCurrency = asQuoteCurrency(data.costCurrency);
  const invested = convertPrice(data.totals.totalInvested, costCurrency);
  const value = quote && data.totals.shares > 0 ? convertPrice(quote.price * data.totals.shares, quoteCurrency) : null;
  const totalReturn = value != null ? value - invested : null;
  const returnPct = invested > 0 && totalReturn != null ? (totalReturn / invested) * 100 : null;
  const priceLabel = (amount: number) =>
    quoteInPreferred ? formatCurrency(convertPrice(amount, quoteCurrency)) : new Intl.NumberFormat("sk-SK", { style: "currency", currency: quoteCurrency }).format(amount);
  const markers = (data.marketTransactions ?? [])
    .filter((tx) => tx.type === "BUY" || tx.type === "SELL")
    .map((tx) => {
      const date = String(tx.transactionDate).slice(0, 10);
      const point = visible.find((row) => row.date >= date) ?? visible[visible.length - 1];
      return point ? { ...point, kind: tx.type } : null;
    })
    .filter((row): row is { date: string; price: number; kind: string } => row != null)
    .slice(-8);

  return (
    <div>
      <PageBody>
        <button type="button" onClick={() => setLocation("/")} className="inline-flex min-h-[40px] items-center gap-2 text-[13px] font-medium text-[var(--rd-text-secondary)]">
          <ArrowLeft className="size-4" />
          SpĂ¤ĹĄ na prehÄľad
        </button>
        <div className="flex items-start gap-3">
          <Avatar ticker={data.ticker} companyName={data.companyName} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate rd-type-h1" data-testid="asset-detail-title">{data.companyName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-[var(--rd-text-secondary)]">{data.ticker}</span>
              <a className="text-xs text-[var(--rd-profit)]" href={`https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`} target="_blank" rel="noreferrer">Yahoo Finance</a>
            </div>
          </div>
        </div>
        {quoteCurrency !== currency ? (
          <div className="flex gap-1">
            <Chip active={!quoteInPreferred} onClick={() => setQuoteInPreferred(false)}>{quoteCurrency}</Chip>
            <Chip active={quoteInPreferred} onClick={() => setQuoteInPreferred(true)}>{currency}</Chip>
          </div>
        ) : null}

        <Card className="gap-2">
          <p className="rd-type-overline text-[var(--rd-text-tertiary)]">AktuĂˇlna cena</p>
          <p className="rd-type-display-lg">{quote ? mask(priceLabel(quote.price)) : "â€”"}</p>
          {quote ? (
            <p className={`font-mono text-xs ${quote.change >= 0 ? "text-[var(--rd-profit)]" : "text-[var(--rd-loss)]"}`}>
              {signedMoney((n) => priceLabel(n), quote.change)} Â· {signedPct(quote.changePercent)} dnes
            </p>
          ) : null}
          {data.priceNote ? <p className="text-xs text-[var(--rd-text-tertiary)]">{data.priceNote}</p> : null}
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <StatTile label="VaĹˇa pozĂ­cia" value={value != null ? mask(formatCurrency(value)) : "â€”"} sub={`${formatShareQuantity(data.totals.shares)} ks`} />
          <StatTile label="CelkovĂ˝ vĂ˝nos" value={totalReturn != null ? mask(signedMoney(formatCurrency, totalReturn)) : "â€”"} sub={returnPct != null ? signedPct(returnPct) : undefined} tone={toneOf(totalReturn ?? 0) === "down" ? "Down" : "Up"} />
        </div>
        <StatTile label="InvestovanĂ©" value={mask(formatCurrency(invested))} />

        <Card>
          <p className="rd-type-h2">VĂ˝voj ceny a obchody</p>
          <div className="flex flex-wrap gap-1">
            {RANGES.map((option) => (
              <Chip key={option.v} active={range === option.v} onClick={() => setRange(option.v)}>{option.label}</Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">ROI pozĂ­cie</p>
              <p className="text-xs text-[var(--rd-text-tertiary)]">vs. priem. nĂˇkup</p>
              <p className={`rd-type-data-lg ${toneOf(returnPct ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]"}`}>{returnPct != null ? signedPct(returnPct) : "â€”"}</p>
            </div>
            <div>
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Zmena ceny</p>
              <p className="text-xs text-[var(--rd-text-tertiary)]">v obdobĂ­ (graf)</p>
              <p className={`rd-type-data-lg ${toneOf(periodChange ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]"}`}>{periodChange != null ? signedPct(periodChange) : "â€”"}</p>
            </div>
          </div>
          <div className="h-40 w-full">
            {visible.length < 2 ? (
              <p className="text-xs text-[var(--rd-text-secondary)]">Nedostatok cenovej histĂłrie.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={visible} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--rd-text-tertiary)" }} tickFormatter={(d: string) => d.slice(2, 7)} minTickGap={24} axisLine={false} tickLine={false} />
                  <YAxis hide domain={["auto", "auto"]} />
                  <RTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as { date: string; price: number };
                      return <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-2 text-xs">{row.date}<br />{mask(formatCurrency(row.price))}</div>;
                    }}
                  />
                  <Area type="monotone" dataKey="price" stroke="var(--rd-profit)" fill="var(--rd-profit)" fillOpacity={0.15} />
                  <Line type="monotone" dataKey="price" stroke="var(--rd-profit)" dot={false} strokeWidth={2} />
                  {markers.map((marker) => (
                    <ReferenceDot key={`${marker.kind}-${marker.date}`} x={marker.date} y={marker.price} r={4} fill={marker.kind === "BUY" ? "var(--rd-profit)" : "var(--rd-loss)"} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex gap-4 text-xs text-[var(--rd-text-secondary)]">
            <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--rd-text-secondary)]" /> Cena</span>
            <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--rd-profit)]" /> NĂˇkup</span>
            <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--rd-loss)]" /> Predaj</span>
          </div>
        </Card>

        <Card className="gap-2">
          <p className="rd-type-h2">Detail pozĂ­cie</p>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Kusy" value={formatShareQuantity(data.totals.shares)} />
            <StatTile label="Priem. nĂˇkup" value={mask(formatCurrency(convertPrice(data.totals.averageCost, costCurrency)))} />
            <StatTile label="NĂˇkladovĂˇ bĂˇza" value={mask(formatCurrency(invested))} />
            <StatTile label="Zmena v obdobĂ­" value={periodChange != null ? signedPct(periodChange) : "â€”"} tone={toneOf(periodChange ?? 0) === "down" ? "Down" : "Up"} />
          </div>
          <p className="text-xs text-[var(--rd-text-secondary)]">
            NajbliĹľĹˇie earnings: {data.nextEarnings?.date ? new Date(`${data.nextEarnings.date}T12:00:00`).toLocaleDateString("sk-SK") : "â€”"}
          </p>
        </Card>

        {data.positions.length > 0 ? (
          <Card className="gap-2">
            <p className="rd-type-h2">PodÄľa portfĂłlia</p>
            {data.positions.map((position) => (
              <div key={position.portfolioId ?? position.portfolioName} className="flex items-center gap-2 border-t border-[var(--rd-border-subtle)] py-2 text-sm">
                <p className="min-w-0 flex-1 truncate">{position.portfolioName}</p>
                <p className="font-mono text-xs text-[var(--rd-text-secondary)]">{formatShareQuantity(position.shares)} ks</p>
              </div>
            ))}
          </Card>
        ) : null}

        <Card>
          <p className="rd-type-h2">VĂ˝sledky (earnings)</p>
          <p className="text-xs text-[var(--rd-text-tertiary)]">EPS a ukazovatele podÄľa rokov / kvartĂˇlov</p>
          {(earnings?.years ?? []).map((year) => (
            <div key={year.year} className="border-t border-[var(--rd-border-subtle)] py-2">
              <button type="button" onClick={() => setOpenYear((prev) => (prev === year.year ? null : year.year))} className="flex min-h-[40px] w-full items-center gap-2 text-left">
                <span className="flex-1 font-semibold">{year.year}</span>
                <span className="text-xs text-[var(--rd-text-tertiary)]">{year.quarters.length} kvartĂˇlov</span>
              </button>
              {year.revenue != null ? <p className="text-xs text-[var(--rd-text-secondary)]">TrĹľby {year.revenue.toLocaleString("sk-SK")}</p> : null}
              {year.netIncome != null ? <p className="text-xs text-[var(--rd-text-secondary)]">Zisk {year.netIncome.toLocaleString("sk-SK")}</p> : null}
              {openYear === year.year
                ? year.quarters.map((quarter) => (
                    <div key={quarter.label} className="mt-2 flex items-center gap-2">
                      <p className="min-w-0 flex-1 text-sm">{quarter.label}</p>
                      {quarter.epsSurprisePercent != null ? (
                        <Badge label={`${quarter.epsSurprisePercent >= 0 ? "Beat" : "Miss"} ${signedPct(quarter.epsSurprisePercent, 1)}`} tone={quarter.epsSurprisePercent >= 0 ? "Profit" : "Loss"} />
                      ) : null}
                      <p className="font-mono text-xs">EPS {quarter.epsActual ?? "â€”"}</p>
                    </div>
                  ))
                : null}
            </div>
          ))}
          {earnings?.source ? <p className="text-xs text-[var(--rd-text-tertiary)]">Zdroj: {earnings.source}</p> : null}
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <p className="rd-type-h2">Analyst Ratings</p>
            <Badge label={recommendationLabel(ratings?.recommendationKey ?? null)} tone="Info" />
          </div>
          <p className="text-xs text-[var(--rd-text-tertiary)]">Konsenzus analytikov a cieÄľovĂ© ceny (Yahoo)</p>
          <StatTile
            label="Target (mean)"
            value={ratings?.targetMean != null ? mask(priceLabel(ratings.targetMean)) : "â€”"}
            sub={ratings?.numberOfAnalystOpinions != null ? `${ratings.numberOfAnalystOpinions} analytikov` : undefined}
          />
        </Card>

        {(data.marketTransactions ?? []).slice(0, 6).length > 0 ? (
          <Card className="gap-0">
            <p className="pb-2 rd-type-h2">Obchody</p>
            {data.marketTransactions.slice(0, 6).map((tx) => (
              <TransactionRow
                key={tx.id}
                ticker={data.ticker}
                badge={tx.type === "SELL" ? "Predaj" : tx.type === "BUY" ? "NĂˇkup" : tx.type}
                tone={tx.type === "SELL" ? "Loss" : "Profit"}
                meta={String(tx.transactionDate).slice(0, 10)}
                amount={mask(formatCurrency(convertPrice(parseFloat(tx.pricePerShare) * parseFloat(tx.shares), costCurrency)))}
                unit={`${formatShareQuantity(parseFloat(tx.shares))} ks`}
              />
            ))}
          </Card>
        ) : null}
      </PageBody>
    </div>
  );
}
