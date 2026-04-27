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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useIsMobile } from "@/hooks/use-mobile";
import { HelpTip } from "@/components/HelpTip";
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
    <div
      className={cn(
        "w-full min-w-0 overflow-x-auto overscroll-x-contain pb-0.5 sm:overflow-visible [-webkit-overflow-scrolling:touch]",
        className,
      )}
    >
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as RangeVal)}
        className="flex w-max min-w-full flex-nowrap justify-start gap-1 sm:w-full sm:flex-wrap"
      >
        {RANGE_OPTIONS.map((o) => (
          <ToggleGroupItem
            key={o.v}
            value={o.v}
            className="shrink-0 text-xs sm:text-sm px-2.5 data-[state=on]:z-10"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export default function Grafy() {
  const { formatCurrency, currency } = useCurrency();
  const {
    portfolios,
    selectedPortfolioId,
    setSelectedPortfolioId,
    getQueryParam,
    isLoading: pLoading,
  } = usePortfolio();
  const { hideAmounts } = useChartSettings();
  const isMobile = useIsMobile();
  const mask = (s: string) => (hideAmounts ? "••••••" : s);
  const chartReady = useChartReady();
  const portfolioParam = getQueryParam();

  const portfolioSelectValue = selectedPortfolioId ?? "all";

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

  const { data: athHistory } = useQuery<PortfolioHistoryRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, "all", currency, "ath-info"],
    queryFn: async () => {
      const u = new URLSearchParams();
      u.set("portfolio", portfolioParam);
      u.set("range", "all");
      const res = await fetch(`/api/portfolio-history?${u.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("ATH história zlyhala");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const points = history?.points ?? [];
  const athPoint = useMemo(() => {
    const src = athHistory?.points ?? [];
    if (src.length === 0) return null;
    let best = src[0];
    for (let i = 1; i < src.length; i++) {
      const p = src[i];
      if ((p?.totalValue ?? Number.NEGATIVE_INFINITY) > (best?.totalValue ?? Number.NEGATIVE_INFINITY)) {
        best = p;
      }
    }
    return best ?? null;
  }, [athHistory?.points]);
  const last = points[points.length - 1];
  const inProfit = last
    ? last.totalValue + 1e-6 >= last.netInvested
    : true;
  const fillId = inProfit ? "ok" : "loss";

  const successChartData = useMemo(
    () => points.map((p) => ({ ...p, fillTop: p.totalValue })),
    [points],
  );

  const chartMargin = isMobile
    ? { top: 4, right: 4, left: -12, bottom: 4 }
    : { top: 8, right: 8, left: 0, bottom: 0 };
  const xAxisTick = { fontSize: isMobile ? 9 : 11 };
  const yAxisTick = { fontSize: isMobile ? 9 : 11 };
  const legendProps = isMobile
    ? { wrapperStyle: { fontSize: 10, paddingTop: 4 }, iconSize: 8 }
    : { wrapperStyle: { fontSize: 12 }, iconSize: 10 };

  return (
    <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6 px-3 sm:px-4 md:px-6 pb-6">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2 flex-wrap">
          <Activity className="h-6 w-6 sm:h-7 sm:w-7 shrink-0 text-primary" />
          Grafy
          <HelpTip title="Stránka Grafy">
            <p>
              Časové série hodnoty portfólia a porovnanie výkonu s indexom S&amp;P 500. Metodika zodpovedá TWR na
              dashboarde (oceňovanie MTM, vklady a výbery ako toky).
            </p>
          </HelpTip>
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm max-w-3xl leading-relaxed">
          Dáta z toho istého oceňovania a tokov (MTM, vklady/výbery) ako TWR. Benchmark: S&amp;P 500 (^GSPC)
          v rovnakom časovom režime.
        </p>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="space-y-4 pb-4 pt-4 sm:pt-6">
          <CardTitle className="text-base sm:text-lg flex items-center gap-1 flex-wrap">
            Zobrazenie
            <HelpTip title="Filtre grafu">
              <p>
                Portfólio určuje, ktoré transakcie sa zarátajú do série (alebo všetky naraz). Obdobie skracuje časovú
                os; výber portfólia je zdieľaný s bočným panelom.
              </p>
            </HelpTip>
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Vyberte portfólio a časové obdobie. Nastavenie portfólia je rovnaké ako v bočnom paneli.
          </CardDescription>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-2 w-full sm:w-auto sm:min-w-[200px] sm:flex-1 sm:max-w-xs">
              <div className="flex items-center gap-1 text-sm font-medium leading-none text-muted-foreground">
                <Label htmlFor="grafy-portfolio">Portfólio</Label>
                <HelpTip title="Výber portfólia">
                  <p>Jedno portfólio alebo agregácia „všetky“. Rovnaká voľba ako v navigácii vľavo.</p>
                </HelpTip>
              </div>
              <Select
                value={portfolioSelectValue}
                onValueChange={(id) => setSelectedPortfolioId(id === "all" ? "all" : id)}
              >
                <SelectTrigger id="grafy-portfolio" className="w-full">
                  <SelectValue placeholder="Portfólio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všetky portfóliá</SelectItem>
                  {portfolios.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 w-full min-w-0 sm:flex-1 sm:min-w-[240px]">
              <div className="flex items-center gap-1 text-sm font-medium leading-none text-muted-foreground">
                <span id="grafy-range-label">Obdobie</span>
                <HelpTip title="Časové obdobie">
                  <p>
                    Rozsah dát na osi X: od posledného mesiaca po celú históriu. YTD = od 1. januára bežného roka.
                  </p>
                </HelpTip>
              </div>
              <RangeToggle value={range} onChange={setRange} />
            </div>
          </div>
        </CardHeader>
      </Card>

      {history?.methodNote && (
        <p className="text-xs text-muted-foreground max-w-4xl flex items-start gap-1.5">
          <span className="min-w-0 flex-1">{history.methodNote}</span>
          <HelpTip title="Poznámka k metodike">
            <p>Stručné vysvetlenie výpočtu z backendu pre zobrazenú sériu a menu.</p>
          </HelpTip>
        </p>
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
          <CardTitle className="flex items-center gap-1 flex-wrap">
            Celková hodnota vs. investované
            <HelpTip title="Hodnota vs. čisté vklady">
              <p>
                Modrá krivka: denná trhová hodnota (MTM + hotovosť). Sivý schodík: kumulatívne čisté vklady mínus
                výbery. Farba výplne pod krivkou: zelená ak je hodnota na konci rozsahu nad touto čiarou, inak červená.
              </p>
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Plocha pod trhovou krivkou: farba podľa zisku oproti tokom na konci rozsahu. Schodíky = čisté vklady
            mínus výbery.
          </CardDescription>
          <p className="text-[11px] text-muted-foreground">
            ATH portfólia:{" "}
            {athPoint
              ? `${mask(formatCurrency(athPoint.totalValue))} (${new Date(athPoint.date).toLocaleDateString("sk-SK")})`
              : "Nedostatok dát"}
          </p>
        </CardHeader>
        <CardContent className="h-[260px] sm:h-[320px] w-full min-w-0 px-3 sm:px-6">
          {histLoading || pLoading || !chartReady ? (
            <Skeleton className="h-full w-full" />
          ) : points.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nedostatok dát (žiadne transakcie v rozsahu alebo ceny).</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={successChartData} margin={chartMargin}>
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
                  tick={xAxisTick}
                  tickFormatter={(d) => d.slice(5)}
                  minTickGap={isMobile ? 28 : 14}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={yAxisTick}
                  width={isMobile ? 44 : undefined}
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
                <Legend {...legendProps} />
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
          <CardTitle className="flex items-center gap-1 flex-wrap">
            Výkon v % oproti S&amp;P 500
            <HelpTip title="Kumulatívny výnos v %">
              <p>
                Obe krivky začínajú na 0 % v prvý deň zobrazeného rozsahu. Portfólio: reťazenie denných výnosov po
                odpočítaní tokov (TWR). Index: vývoj uzávierok ^GSPC voči tomu istému prvému dňu.
              </p>
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Kumulatívny % od prvého zobrazeného dňa v rozsahu: reťazenie segmentov výnosu (po odpoč. tokov) v
            portfóliu; index výnos (uzávierky) voči tomu istému prvému dňu.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[240px] sm:h-[300px] w-full min-w-0 px-3 sm:px-6">
          {histLoading || pLoading || !chartReady ? (
            <Skeleton className="h-full w-full" />
          ) : points.length < 2 ? (
            <p className="text-muted-foreground text-sm">Nedostatok dát pre porovnanie v %.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={xAxisTick}
                  tickFormatter={(d) => d.slice(5)}
                  minTickGap={isMobile ? 28 : 14}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={yAxisTick}
                  width={isMobile ? 40 : undefined}
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
                <Legend {...legendProps} />
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
