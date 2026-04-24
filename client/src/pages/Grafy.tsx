import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
} from "recharts";
import { Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { cn } from "@/lib/utils";

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
  const { formatCurrency, currency } = useCurrency();
  const { getQueryParam, isLoading: pLoading } = usePortfolio();
  const { hideAmounts } = useChartSettings();
  const mask = (s: string) => (hideAmounts ? "••••••" : s);
  const chartReady = useChartReady();
  const portfolioParam = getQueryParam();

  const [range, setRange] = useState<RangeVal>("1y");

  const { data: history, isLoading: histLoading, error: histErr } = useQuery<PortfolioHistoryRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, range, currency],
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
    </div>
  );
}
