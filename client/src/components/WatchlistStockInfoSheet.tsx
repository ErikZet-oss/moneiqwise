import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, fromUnixTime, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  ExternalLink,
  LineChart as LineChartIcon,
  Newspaper,
  Settings2,
  Users,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyLogo } from "@/components/CompanyLogo";
import { cn } from "@/lib/utils";

export type WatchlistInfoSection = "news" | "chart" | "statistics" | "options" | "holders";

type WatchlistInfoItem = {
  ticker: string;
  companyName: string | null;
};

type Props = {
  item: WatchlistInfoItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatPrice: (price: number, ticker: string) => string;
};

const SECTIONS: {
  id: WatchlistInfoSection;
  label: string;
  icon: typeof Newspaper;
}[] = [
  { id: "news", label: "News", icon: Newspaper },
  { id: "chart", label: "Chart", icon: LineChartIcon },
  { id: "statistics", label: "Statistics", icon: BarChart3 },
  { id: "options", label: "Options", icon: Settings2 },
  { id: "holders", label: "Holders", icon: Users },
];

const CHART_RANGES = [
  { id: "1m" as const, label: "1M" },
  { id: "3m" as const, label: "3M" },
  { id: "6m" as const, label: "6M" },
  { id: "1y" as const, label: "1R" },
  { id: "5y" as const, label: "5R" },
];

type ChartPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type ChartSummary = {
  range: string;
  interval: string;
  series: ChartPoint[];
  firstClose: number | null;
  lastClose: number | null;
  periodHigh: number | null;
  periodLow: number | null;
  changePercent: number | null;
  totalVolume: number | null;
};

function yahooQuoteUrl(ticker: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
}

function formatCompactMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

function formatPct(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

async function fetchSection(
  ticker: string,
  section: WatchlistInfoSection,
  params: { chartRange?: string; expirationIndex?: number },
) {
  const qs = new URLSearchParams({ ticker });
  if (section === "chart" && params.chartRange) qs.set("range", params.chartRange);
  if (section === "options" && params.expirationIndex != null) {
    qs.set("expiration", String(params.expirationIndex));
  }
  const res = await fetch(`/api/watchlist/stock-info/${section}?${qs.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Nepodarilo sa načítať dáta");
  }
  return res.json();
}

function SectionMenu({
  onSelect,
}: {
  onSelect: (section: WatchlistInfoSection) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className="flex items-center gap-2 rounded-lg border bg-card p-2.5 text-left active:bg-muted/40 transition-colors"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold">{label}</div>
            <div className="text-[10px] text-muted-foreground">Yahoo Finance</div>
          </div>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

function NewsContent({ articles }: { articles: Array<Record<string, unknown>> }) {
  if (articles.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Žiadne novinky.</p>;
  }
  return (
    <div className="space-y-1.5">
      {articles.map((article, index) => {
        const title = String(article.title ?? "");
        const link = String(article.link ?? "");
        const publisher = String(article.publisher ?? "Yahoo Finance");
        const publishedAt = Number(article.publishedAt ?? 0);
        const summary = String(article.summary ?? "");
        return (
          <a
            key={`${title}-${index}`}
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border bg-card p-2 active:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-1 mb-1">
              <Badge variant="outline" className="text-[9px] font-normal px-1 py-0 h-4">
                {publisher}
              </Badge>
              {publishedAt > 0 ? (
                <span className="text-[9px] text-muted-foreground">
                  {format(fromUnixTime(publishedAt), "d. MMM", { locale: sk })}
                </span>
              ) : null}
            </div>
            <p className="text-xs font-medium leading-snug line-clamp-2">{title}</p>
            {summary ? (
              <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{summary}</p>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

function formatVolume(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatAxisPrice(value: number): string {
  if (value >= 1000) return Number(value).toFixed(0);
  if (value >= 100) return Number(value).toFixed(1);
  return Number(value).toFixed(2);
}

function formatChartDateLabel(date: string, range: string): string {
  try {
    const parsed = parseISO(date);
    if (range === "1m") return format(parsed, "d.M. HH:mm", { locale: sk });
    if (range === "5y") return format(parsed, "MMM yy", { locale: sk });
    return format(parsed, "d.M.yy", { locale: sk });
  } catch {
    return date;
  }
}

function ChartContent({
  chart,
  formatPrice,
  ticker,
}: {
  chart: ChartSummary;
  formatPrice: (price: number, ticker: string) => string;
  ticker: string;
}) {
  const { series, range, changePercent, periodHigh, periodLow, lastClose, totalVolume } = chart;

  const chartData = useMemo(
    () =>
      series.map((p) => ({
        ...p,
        label: formatChartDateLabel(p.date, range),
      })),
    [series, range],
  );

  if (chartData.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Graf nie je k dispozícii.</p>;
  }

  const isUp = (changePercent ?? 0) >= 0;
  const strokeColor = isUp ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)";
  const fillId = isUp ? "watchlistChartUp" : "watchlistChartDown";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border bg-card p-2">
          <div className="text-[9px] text-muted-foreground">Posledná cena</div>
          <div className="text-xs font-semibold tabular-nums">
            {lastClose != null ? formatPrice(lastClose, ticker) : "—"}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-2">
          <div className="text-[9px] text-muted-foreground">Zmena v období</div>
          <div
            className={cn(
              "text-xs font-semibold tabular-nums",
              isUp ? "text-green-500" : "text-red-500",
            )}
          >
            {formatPct(changePercent)}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-2">
          <div className="text-[9px] text-muted-foreground">High</div>
          <div className="text-xs font-medium tabular-nums">
            {periodHigh != null ? formatPrice(periodHigh, ticker) : "—"}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-2">
          <div className="text-[9px] text-muted-foreground">Low</div>
          <div className="text-xs font-medium tabular-nums">
            {periodLow != null ? formatPrice(periodLow, ticker) : "—"}
          </div>
        </div>
      </div>

      <div className="text-[9px] text-muted-foreground">
        Objem v období:{" "}
        <span className="text-foreground font-medium tabular-nums">{formatVolume(totalVolume)}</span>
      </div>

      <div className="h-56 w-full rounded-lg border bg-card/40 p-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 6, left: -4, bottom: 0 }}>
            <defs>
              <linearGradient id="watchlistChartUp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(142 76% 36%)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="hsl(142 76% 36%)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="watchlistChartDown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted/60" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9 }}
              interval="preserveStartEnd"
              minTickGap={18}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 9 }}
              width={46}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatAxisPrice}
            />
            <RechartsTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as ChartPoint & { label: string };
                return (
                  <div className="rounded-md border bg-background px-2.5 py-2 text-[10px] shadow-md max-w-[220px]">
                    <div className="font-medium">
                      {format(parseISO(row.date), "d. MMM yyyy", { locale: sk })}
                      {range === "1m" ? ` ${format(parseISO(row.date), "HH:mm")}` : ""}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
                      <span className="text-muted-foreground">Open</span>
                      <span className="text-right font-medium">{formatPrice(row.open, ticker)}</span>
                      <span className="text-muted-foreground">High</span>
                      <span className="text-right font-medium">{formatPrice(row.high, ticker)}</span>
                      <span className="text-muted-foreground">Low</span>
                      <span className="text-right font-medium">{formatPrice(row.low, ticker)}</span>
                      <span className="text-muted-foreground">Close</span>
                      <span className="text-right font-medium">{formatPrice(row.close, ticker)}</span>
                      <span className="text-muted-foreground">Vol</span>
                      <span className="text-right font-medium">{formatVolume(row.volume)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke="none"
              fill={`url(#${fillId})`}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke={strokeColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatisticsContent({ metrics }: { metrics: Record<string, string> }) {
  const entries = Object.entries(metrics);
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Štatistiky nie sú k dispozícii.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-lg border bg-card p-2 min-w-0">
          <div className="text-[9px] text-muted-foreground truncate">{key}</div>
          <div className="text-xs font-medium tabular-nums truncate">{value}</div>
        </div>
      ))}
    </div>
  );
}

function OptionsContent({
  data,
  expirationIndex,
  onExpirationChange,
  formatPrice,
  ticker,
}: {
  data: Record<string, unknown>;
  expirationIndex: number;
  onExpirationChange: (index: number) => void;
  formatPrice: (price: number, ticker: string) => string;
  ticker: string;
}) {
  const [side, setSide] = useState<"calls" | "puts">("calls");
  const expirations = (data.expirations as string[] | undefined) ?? [];
  const rows = ((side === "calls" ? data.calls : data.puts) as Array<Record<string, unknown>> | undefined) ?? [];
  const spotPrice = typeof data.spotPrice === "number" ? data.spotPrice : null;

  return (
    <div className="space-y-2">
      {spotPrice != null ? (
        <div className="text-[10px] text-muted-foreground">
          Spot: <span className="text-foreground font-medium tabular-nums">{formatPrice(spotPrice, ticker)}</span>
        </div>
      ) : null}
      {expirations.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {expirations.slice(0, 8).map((exp, index) => (
            <button
              key={exp}
              type="button"
              onClick={() => onExpirationChange(index)}
              className={cn(
                "shrink-0 rounded-md border px-2 py-1 text-[10px] tabular-nums transition-colors",
                expirationIndex === index
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground",
              )}
            >
              {format(new Date(`${exp}T12:00:00`), "d.M.yy")}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1">
        {(["calls", "puts"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSide(value)}
            className={cn(
              "flex-1 rounded-md border py-1.5 text-[10px] font-medium transition-colors",
              side === value
                ? value === "calls"
                  ? "border-green-600/40 bg-green-500/10 text-green-600"
                  : "border-red-600/40 bg-red-500/10 text-red-600"
                : "border-border text-muted-foreground",
            )}
          >
            {value === "calls" ? "Calls" : "Puts"}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">Options chain nie je k dispozícii.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-[10px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Strike</th>
                <th className="px-2 py-1.5 text-right font-medium">Last</th>
                <th className="px-2 py-1.5 text-right font-medium">Bid</th>
                <th className="px-2 py-1.5 text-right font-medium">Ask</th>
                <th className="px-2 py-1.5 text-right font-medium">Vol</th>
                <th className="px-2 py-1.5 text-right font-medium">OI</th>
                <th className="px-2 py-1.5 text-right font-medium">IV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.contractSymbol)} className="border-t">
                  <td className="px-2 py-1.5 tabular-nums font-medium">{Number(row.strike).toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{numCell(row.lastPrice)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{numCell(row.bid)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{numCell(row.ask)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{numCell(row.volume, 0)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{numCell(row.openInterest, 0)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {row.impliedVolatility != null ? `${(Number(row.impliedVolatility) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function numCell(value: unknown, digits = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return digits === 0 ? String(Math.round(n)) : n.toFixed(digits);
}

function HoldersContent({ data }: { data: Record<string, unknown> }) {
  const [tab, setTab] = useState<"institutions" | "funds" | "insiders">("institutions");
  const breakdown = (data.breakdown as Record<string, number | null> | undefined) ?? {};
  const rows =
    ((tab === "institutions"
      ? data.institutions
      : tab === "funds"
        ? data.funds
        : data.insiders) as Array<Record<string, unknown>> | undefined) ?? [];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border bg-card p-2">
          <div className="text-[9px] text-muted-foreground">Insider Own</div>
          <div className="text-xs font-medium tabular-nums">{formatPct(breakdown.insidersPercentHeld ?? null)}</div>
        </div>
        <div className="rounded-lg border bg-card p-2">
          <div className="text-[9px] text-muted-foreground">Inst Own</div>
          <div className="text-xs font-medium tabular-nums">
            {formatPct(breakdown.institutionsPercentHeld ?? null)}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-2">
          <div className="text-[9px] text-muted-foreground">Inst Float</div>
          <div className="text-xs font-medium tabular-nums">
            {formatPct(breakdown.institutionsFloatPercentHeld ?? null)}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-2">
          <div className="text-[9px] text-muted-foreground">Institutions</div>
          <div className="text-xs font-medium tabular-nums">
            {breakdown.institutionsCount != null ? Math.round(breakdown.institutionsCount).toLocaleString("sk-SK") : "—"}
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        {(
          [
            { id: "institutions", label: "Institutions" },
            { id: "funds", label: "Funds" },
            { id: "insiders", label: "Insiders" },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 rounded-md border py-1.5 text-[10px] font-medium transition-colors",
              tab === id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">Zoznam držiteľov nie je k dispozícii.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row, index) => {
            const pctHeld = typeof row.pctHeld === "number" ? row.pctHeld : null;
            const value = typeof row.value === "number" ? row.value : null;
            return (
            <div key={`${String(row.name)}-${index}`} className="rounded-lg border bg-card p-2">
              <div className="text-xs font-medium leading-snug">{String(row.name ?? "—")}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                <span>
                  {pctHeld != null ? "Držba" : "Podiel"}{" "}
                  <span className="text-foreground font-medium tabular-nums">
                    {pctHeld != null
                      ? formatPct(pctHeld)
                      : value != null
                        ? `${Math.round(value).toLocaleString("sk-SK")} ks`
                        : "—"}
                  </span>
                </span>
                {pctHeld != null ? (
                  <span>
                    Hodnota{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {formatCompactMoney(value)}
                    </span>
                  </span>
                ) : null}
                {row.reportDate ? (
                  <span>
                    Report{" "}
                    <span className="text-foreground font-medium tabular-nums">{String(row.reportDate)}</span>
                  </span>
                ) : null}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function WatchlistStockInfoSheet({ item, open, onOpenChange, formatPrice }: Props) {
  const [activeSection, setActiveSection] = useState<WatchlistInfoSection | null>(null);
  const [chartRange, setChartRange] = useState<(typeof CHART_RANGES)[number]["id"]>("6m");
  const [expirationIndex, setExpirationIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setActiveSection(null);
      setChartRange("6m");
      setExpirationIndex(0);
    }
  }, [open]);

  const sectionLabel = SECTIONS.find((s) => s.id === activeSection)?.label ?? "";

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["/api/watchlist/stock-info", item?.ticker, activeSection, chartRange, expirationIndex],
    enabled: open && !!item && !!activeSection,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      fetchSection(item!.ticker, activeSection!, {
        chartRange,
        expirationIndex,
      }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-xl p-4 pt-5">
        {item ? (
          <>
            <SheetHeader className="space-y-1 text-left pr-8">
              <div className="flex items-center gap-2">
                {activeSection ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 -ml-1 shrink-0"
                    onClick={() => setActiveSection(null)}
                    aria-label="Späť na menu"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                ) : null}
                <CompanyLogo ticker={item.ticker} companyName={item.companyName ?? item.ticker} size="sm" />
                <div className="min-w-0">
                  <SheetTitle className="text-base leading-tight">{item.ticker}</SheetTitle>
                  <SheetDescription className="text-[10px] truncate">
                    {activeSection ? sectionLabel : item.companyName || "Yahoo Finance"}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="mt-3">
              {!activeSection ? (
                <SectionMenu onSelect={setActiveSection} />
              ) : isLoading || (isFetching && !data) ? (
                <div className="space-y-2 py-2">
                  <Skeleton className="h-24 w-full rounded-lg" />
                  <Skeleton className="h-24 w-full rounded-lg" />
                </div>
              ) : isError ? (
                <div className="rounded-lg border bg-card p-3 text-center space-y-2">
                  <p className="text-xs text-destructive">{(error as Error).message}</p>
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => refetch()}>
                    Skúsiť znova
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeSection === "chart" ? (
                    <div className="flex gap-1 overflow-x-auto pb-0.5">
                      {CHART_RANGES.map((range) => (
                        <button
                          key={range.id}
                          type="button"
                          onClick={() => setChartRange(range.id)}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors",
                            chartRange === range.id
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {range.label}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {activeSection === "news" ? (
                    <NewsContent articles={(data?.news as Array<Record<string, unknown>> | undefined) ?? []} />
                  ) : null}
                  {activeSection === "chart" ? (
                    <ChartContent
                      chart={(data?.chart as ChartSummary | undefined) ?? {
                        range: chartRange,
                        interval: "1d",
                        series: [],
                        firstClose: null,
                        lastClose: null,
                        periodHigh: null,
                        periodLow: null,
                        changePercent: null,
                        totalVolume: null,
                      }}
                      formatPrice={formatPrice}
                      ticker={item.ticker}
                    />
                  ) : null}
                  {activeSection === "statistics" ? (
                    <StatisticsContent
                      metrics={
                        ((data?.statistics as { metrics?: Record<string, string> } | undefined)?.metrics ??
                          {}) as Record<string, string>
                      }
                    />
                  ) : null}
                  {activeSection === "options" ? (
                    <OptionsContent
                      data={(data?.options as Record<string, unknown> | undefined) ?? {}}
                      expirationIndex={expirationIndex}
                      onExpirationChange={setExpirationIndex}
                      formatPrice={formatPrice}
                      ticker={item.ticker}
                    />
                  ) : null}
                  {activeSection === "holders" ? (
                    <HoldersContent data={(data?.holders as Record<string, unknown> | undefined) ?? {}} />
                  ) : null}

                  <a
                    href={yahooQuoteUrl(item.ticker)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline pt-1"
                  >
                    Otvoriť na Yahoo Finance
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
