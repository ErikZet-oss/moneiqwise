import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  LineChart,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { cn } from "@/lib/utils";
import type { Holding } from "@shared/schema";

const RANGE_OPTIONS = [
  { v: "1m", label: "1M" },
  { v: "6m", label: "6M" },
  { v: "ytd", label: "YTD" },
  { v: "1y", label: "1R" },
  { v: "all", label: "Všetko" },
] as const;

type RangeVal = (typeof RANGE_OPTIONS)[number]["v"];

interface HistoryPoint {
  date: string;
  totalValue: number;
  netInvested: number;
  portfolioCumulativePct: number;
  sp500CumulativePct: number;
}

interface PortfolioHistoryRes {
  points: HistoryPoint[];
  startIso: string;
  endIso: string;
  currency: string;
  methodNote: string;
  range: RangeVal;
  portfolio: string;
  benchmark: string;
}

interface StockQuote {
  ticker: string;
  price: number;
}

type Slice = { name: string; value: number };

function sliceFill(i: number): string {
  const n = (i % 5) + 1;
  return `hsl(var(--chart-${n}))`;
}

function aggregateSlices(rows: Slice[]): Slice[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.name, (m.get(r.name) ?? 0) + r.value);
  }
  return Array.from(m.entries())
    .map(([name, value]) => ({ name, value }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

interface PnlRes {
  currency: string;
  realizedCapitalGain: number;
  unrealizedPriceGain: number;
  unrealizedFxGain: number;
  unrealizedCrossComponent?: number;
  residualUnrealized: number;
  dividendNet: number;
}

function useChartReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

function RangeToggle({
  value,
  onChange,
  className,
}: {
  value: RangeVal;
  onChange: (r: RangeVal) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as RangeVal)}
      className={cn("flex flex-wrap justify-start gap-1", className)}
    >
      {RANGE_OPTIONS.map((o) => (
        <ToggleGroupItem key={o.v} value={o.v} className="text-xs sm:text-sm px-2.5">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default function Grafy() {
  const { formatCurrency, convertPrice, getTickerCurrency } = useCurrency();
  const { getQueryParam, portfolios, selectedPortfolio, isAllPortfolios, isLoading: pLoading } =
    usePortfolio();
  const { hideAmounts } = useChartSettings();
  const mask = (s: string) => (hideAmounts ? "••••••" : s);
  const chartReady = useChartReady();
  const portfolioParam = getQueryParam();

  const [range, setRange] = useState<RangeVal>("1y");

  const { data: history, isLoading: histLoading, error: histErr } = useQuery<PortfolioHistoryRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, range],
    queryFn: async () => {
      const u = new URLSearchParams();
      u.set("portfolio", portfolioParam);
      u.set("range", range);
      const res = await fetch(`/api/portfolio-history?${u.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("História zlyhala");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: pnl, isLoading: pnlLoading } = useQuery<PnlRes>({
    queryKey: ["/api/pnl-breakdown", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/pnl-breakdown?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("PnL zlyhalo");
      return res.json();
    },
  });

  const { data: holdings, isLoading: hLoading } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${portfolioParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Holdings");
      return res.json();
    },
  });

  const { data: quotes } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/quotes-allocation", holdings?.map((h) => h.ticker)],
    enabled: !!holdings && holdings.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const tickers = Array.from(new Set(holdings!.map((h) => h.ticker)));
      const res = await fetch("/api/stocks/quotes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) throw new Error("Quotes");
      const data = await res.json();
      return data.quotes as Record<string, StockQuote>;
    },
  });

  const equityTickers = useMemo(() => {
    if (!holdings?.length) return [];
    return Array.from(
      new Set(holdings.map((h) => h.ticker.toUpperCase()).filter((t) => t !== "CASH"))
    ).sort();
  }, [holdings]);

  const { data: profilesData, isLoading: profLoading } = useQuery({
    queryKey: ["/api/stocks/asset-profiles/batch", equityTickers.join(",")],
    enabled: equityTickers.length > 0,
    staleTime: 12 * 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("/api/stocks/asset-profiles/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers: equityTickers }),
      });
      if (!res.ok) throw new Error("Profily");
      return res.json() as Promise<{
        profiles: Record<string, { sector: string; country: string }>;
      }>;
    },
  });
  const profiles = profilesData?.profiles ?? {};

  const [allocMode, setAllocMode] = useState<"ticker" | "sector" | "currency">("ticker");

  const cashValueConv = useMemo(() => {
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

  const { totalMkt, allocRows } = useMemo(() => {
    const tRows: Slice[] = [];
    const sRows: Slice[] = [];
    const cRows: Slice[] = [];
    let sum = 0;
    let cashTotal = cashValueConv;

    if (holdings === undefined) {
      return {
        totalMkt: 0,
        allocRows: [] as Slice[],
      };
    }

    if (!holdings.length) {
      const m =
        cashTotal > 0.005
          ? { name: "Hotovosť", value: cashTotal, rows: [{ name: "Hotovosť", value: cashTotal }] }
          : { name: "—", value: 0, rows: [] as Slice[] };
      return {
        totalMkt: m.value,
        allocRows: m.rows,
      };
    }

    for (const h of holdings) {
      const t = h.ticker.toUpperCase();
      const shares = parseFloat(h.shares);
      if (!Number.isFinite(shares) || shares <= 0) continue;

      const quote = quotes?.[t];
      if (t === "CASH") {
        const v = shares * (quote?.price ?? 1);
        const tc = getTickerCurrency(t);
        cashTotal += convertPrice(v, tc);
        continue;
      }
      if (!quote?.price) continue;
      const v0 = shares * quote.price;
      const tc = getTickerCurrency(t);
      const v = convertPrice(v0, tc);
      sum += v;
      tRows.push({ name: t, value: v });
      const p = profiles[t];
      sRows.push({ name: p?.sector && p.sector !== "N/A" ? p.sector : "Nezistené", value: v });
      cRows.push({ name: tc || "—", value: v });
    }

    if (cashTotal > 0.005) {
      tRows.push({ name: "Hotovosť", value: cashTotal });
      sRows.push({ name: "Hotovosť", value: cashTotal });
      cRows.push({ name: "Hotovosť (EUR/účet)", value: cashTotal });
    }
    const bt = aggregateSlices(tRows);
    const bs = aggregateSlices(sRows);
    const bc = aggregateSlices(cRows);
    const tot = sum + (cashTotal > 0.005 ? cashTotal : 0);
    const rows = allocMode === "ticker" ? bt : allocMode === "sector" ? bs : bc;
    return { totalMkt: tot, allocRows: rows };
  }, [holdings, quotes, profiles, getTickerCurrency, convertPrice, cashValueConv, allocMode]);

  const pnlStack = useMemo(() => {
    if (!pnl) return null;
    const cap =
      pnl.realizedCapitalGain +
      pnl.unrealizedPriceGain +
      (pnl.unrealizedCrossComponent ?? 0) +
      pnl.residualUnrealized;
    return [
      {
        name: "Rozklad",
        Kapitálový: cap,
        Dividendy: pnl.dividendNet,
        FX: pnl.unrealizedFxGain,
      },
    ];
  }, [pnl]);

  const points = history?.points ?? [];
  const last = points[points.length - 1];
  const inProfit = last
    ? last.totalValue + 1e-6 >= last.netInvested
    : true;
  const fillId = inProfit ? "ok" : "loss";

  const successChartData = useMemo(
    () => points.map((p) => ({ ...p, fillTop: p.totalValue })),
    [points],
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="h-7 w-7 text-primary" />
          Grafy
        </h1>
        <p className="text-muted-foreground text-sm max-w-3xl">
          Dáta z toho istého oceňovania a tokov (MTM, vklady/výbery) ako TWR. Benchmark: S&amp;P 500 (^GSPC)
          v rovnakom časovom režime.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Rozsah dátumov</p>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      {history?.methodNote && (
        <p className="text-xs text-muted-foreground max-w-4xl">{history.methodNote}</p>
      )}

      {histErr && (
        <Card className="border-destructive/50">
          <CardContent className="pt-4 text-destructive text-sm">
            Nepodarilo sa načítať históriu portfólia. Skontrolujte pripojenie a skúste znova.
          </CardContent>
        </Card>
      )}

      {/* 1) Success chart */}
      <Card>
        <CardHeader>
          <CardTitle>Celková hodnota vs. investované</CardTitle>
          <CardDescription>
            Plocha pod trhovou krivkou: farba podľa zisku oproti tokom na konci rozsahu. Schodíky = čisté vklady
            mínus výbery.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[320px] w-full min-w-0">
          {histLoading || pLoading || !chartReady ? (
            <Skeleton className="h-full w-full" />
          ) : points.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nedostatok dát (žiadne transakcie v rozsahu alebo ceny).</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={successChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                    {inProfit ? (
                      <>
                        <stop offset="0%" stopColor="hsl(142, 60%, 45%)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(142, 50%, 45%)" stopOpacity={0.05} />
                      </>
                    ) : (
                      <>
                        <stop offset="0%" stopColor="hsl(0, 60%, 55%)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(0, 40%, 55%)" stopOpacity={0.04} />
                      </>
                    )}
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d) => d.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    mask(
                      new Intl.NumberFormat("sk-SK", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(v),
                    )
                  }
                />
                <RTooltip
                  content={({ active, label, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as HistoryPoint;
                    return (
                      <div className="rounded-md border bg-background/95 p-2 text-xs shadow-md">
                        <p className="font-medium mb-1">{String(label)}</p>
                        <p>
                          Celková hodnota:{" "}
                          <span className="font-mono">
                            {mask(formatCurrency(row.totalValue))}
                          </span>
                        </p>
                        <p>
                          Čisté invest.:{" "}
                          <span className="font-mono">
                            {mask(formatCurrency(row.netInvested))}
                          </span>
                        </p>
                        <p className="text-muted-foreground">
                          Oproti vkladom: {mask(formatCurrency(row.totalValue - row.netInvested))}
                        </p>
                      </div>
                    );
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="fillTop"
                  name="Celková hodnota (MTM+hotovosť)"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  connectNulls
                  fillOpacity={1}
                  fill={`url(#${fillId})`}
                  baseLine={0}
                />
                <Line
                  type="stepAfter"
                  dataKey="netInvested"
                  name="Čisté vklady − výbery"
                  dot={false}
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 2) TWR vs S&P % */}
      <Card>
        <CardHeader>
          <CardTitle>Výkon v % oproti S&amp;P 500</CardTitle>
          <CardDescription>
            Kumulatívny % od prvého zobrazeného dňa v rozsahu: reťazenie segmentov výnosu (po odpoč. tokov) v
            portfóliu; index výnos (uzávierky) voči tomu istému prvému dňu.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] w-full min-w-0">
          {histLoading || !chartReady ? (
            <Skeleton className="h-full w-full" />
          ) : points.length < 2 ? (
            <p className="text-muted-foreground text-sm">Nedostatok dát pre porovnanie v %.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                />
                <RTooltip
                  content={({ active, label, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as HistoryPoint;
                    return (
                      <div className="rounded-md border bg-background/95 p-2 text-xs shadow-md">
                        <p className="font-medium mb-1">{String(label)}</p>
                        <p>Portfólio: {row.portfolioCumulativePct.toFixed(2)}%</p>
                        <p>S&amp;P 500: {row.sp500CumulativePct.toFixed(2)}%</p>
                      </div>
                    );
                  }}
                />
                <Legend />
                <Line
                  dataKey="portfolioCumulativePct"
                  name="Portfólio (kum. % v rozsahu)"
                  dot={false}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                />
                <Line
                  dataKey="sp500CumulativePct"
                  name="S&P 500"
                  dot={false}
                  stroke="hsl(var(--chart-3))"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rozpad zisku (FIFO / FX)</CardTitle>
            <CardDescription>Kapitálové zložky, dividendy (netto), nereal. FX. Z API P&amp;L.</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px] w-full min-w-0">
            {pnlLoading || !chartReady ? (
              <Skeleton className="h-full w-full" />
            ) : !pnlStack ? (
              <p className="text-muted-foreground text-sm">—</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlStack} layout="vertical" margin={{ top: 6, right: 12, left: 0, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={0} tick={false} />
                  <RTooltip
                    formatter={(v: number) => [mask(formatCurrency(v)), ""]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend />
                  <Bar dataKey="Kapitálový" name="Kapitálový zisk (real.+nereal.+kríž+rez.)" stackId="a" fill="hsl(var(--chart-1))" />
                  <Bar dataKey="Dividendy" name="Dividendy (netto)" stackId="a" fill="hsl(var(--chart-2))" />
                  <Bar dataKey="FX" name="Nereal. FX" stackId="a" fill="hsl(var(--chart-4))" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Alokácia rizika</CardTitle>
                <CardDescription>Podiel podľa titulu, sektora alebo meny.</CardDescription>
              </div>
              <ToggleGroup
                type="single"
                value={allocMode}
                onValueChange={(v) => v && setAllocMode(v as "ticker" | "sector" | "currency")}
                className="flex flex-wrap justify-end gap-1"
              >
                <ToggleGroupItem value="ticker" className="text-xs">
                  Titul
                </ToggleGroupItem>
                <ToggleGroupItem value="sector" className="text-xs">
                  Sektor
                </ToggleGroupItem>
                <ToggleGroupItem value="currency" className="text-xs">
                  Mena
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </CardHeader>
          <CardContent className="h-[280px] w-full min-w-0">
            {hLoading || (equityTickers.length > 0 && profLoading) || !chartReady ? (
              <Skeleton className="h-full w-full" />
            ) : totalMkt <= 0 ? (
              <p className="text-muted-foreground text-sm">Bez oceňovanej pozície.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocRows}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="48%"
                    outerRadius="80%"
                    paddingAngle={1}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {allocRows.map((_, i) => (
                      <Cell key={i} fill={sliceFill(i)} />
                    ))}
                  </Pie>
                  <RTooltip
                    formatter={(v: number) => [
                      `${mask(formatCurrency(v))} (${((v / totalMkt) * 100).toFixed(1)}%)`,
                      "",
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
