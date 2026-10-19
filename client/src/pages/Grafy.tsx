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
import { Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useMobileRedesign } from "@/hooks/useMobileUi";
import GrafyMobile from "@/pages/redesign/GrafyMobile";
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
      <div
        role="group"
        aria-labelledby="grafy-range-label"
        className="inline-flex w-max items-center rounded-lg border border-border bg-background p-[3px]"
      >
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={value === o.v}
            onClick={() => onChange(o.v)}
            className={cn(
              "h-[30px] shrink-0 rounded-md px-3 text-[12px] font-medium transition-colors",
              value === o.v ? "bg-secondary text-foreground" : "text-tertiary hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GrafyClassic() {
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
    : {
        wrapperStyle: { fontSize: 11, paddingBottom: 8 },
        iconSize: 8,
        verticalAlign: "top" as const,
        align: "left" as const,
      };
  const tooltipBoxClass = "rounded-lg border border-border bg-popover px-3 py-2.5 text-[11px] leading-4 shadow-lg";
  const axisProps = { axisLine: false, tickLine: false, stroke: "hsl(var(--muted-foreground))" };
  const benchmarkStroke = "var(--rd-chart-benchmark, hsl(var(--chart-3)))";

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
          Grafy
          <HelpTip title="Stránka Grafy">
            <p>
              Časové série hodnoty portfólia a porovnanie výkonu s indexom S&amp;P 500. Metodika zodpovedá TWR na
              dashboarde (oceňovanie MTM, vklady a výbery ako toky).
            </p>
          </HelpTip>
        </h1>
        <p className="text-xs md:text-[13px] text-muted-foreground max-w-3xl leading-relaxed md:leading-[18px]">
          Dáta z toho istého oceňovania a tokov (MTM, vklady/výbery) ako TWR. Benchmark: S&amp;P 500 (^GSPC)
          v rovnakom časovom režime.
        </p>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="space-y-3 p-4 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
          <CardTitle className="text-sm font-medium flex items-center gap-1 flex-wrap">
            Zobrazenie
            <HelpTip title="Filtre grafu">
              <p>
                Portfólio určuje, ktoré transakcie sa zarátajú do série (alebo všetky naraz). Obdobie skracuje časovú
                os; výber portfólia je zdieľaný s bočným panelom.
              </p>
            </HelpTip>
          </CardTitle>
          <CardDescription className="text-xs">
            Vyberte portfólio a časové obdobie. Nastavenie portfólia je rovnaké ako v bočnom paneli.
          </CardDescription>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end lg:flex-nowrap lg:shrink-0">
            <div className="space-y-1.5 w-full sm:w-auto sm:min-w-[200px] sm:flex-1 sm:max-w-xs lg:w-[200px] lg:flex-none">
              <div className="flex items-center gap-1 text-[11px] font-medium leading-none text-muted-foreground">
                <Label htmlFor="grafy-portfolio">Portfólio</Label>
                <HelpTip title="Výber portfólia">
                  <p>Jedno portfólio alebo agregácia „všetky“. Rovnaká voľba ako v navigácii vľavo.</p>
                </HelpTip>
              </div>
              <Select
                value={portfolioSelectValue}
                onValueChange={(id) => setSelectedPortfolioId(id === "all" ? "all" : id)}
              >
                <SelectTrigger id="grafy-portfolio" className="w-full md:h-9 md:text-[13px]">
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
            <div className="space-y-1.5 w-full min-w-0 sm:flex-1 sm:min-w-[240px] lg:w-auto lg:flex-none">
              <div className="flex items-center gap-1 text-[11px] font-medium leading-none text-muted-foreground">
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
          </div>
          {history?.methodNote && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground dark:bg-background">
              <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[hsl(var(--chart-3))] dark:text-[var(--rd-info)]" />
              <span className="min-w-0 flex-1">{history.methodNote}</span>
              <HelpTip title="Poznámka k metodike">
                <p>Stručné vysvetlenie výpočtu z backendu pre zobrazenú sériu a menu.</p>
              </HelpTip>
            </div>
          )}
        </CardHeader>
      </Card>

      {histErr && (
        <Card className="border-destructive/50">
          <CardContent className="pt-4 text-destructive text-sm">
            Nepodarilo sa načítať históriu portfólia. Skontrolujte pripojenie a skúste znova.
          </CardContent>
        </Card>
      )}

      {/* 1) Success chart */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1 flex-wrap">
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
          <p className="self-start rounded-md bg-muted px-2 py-1 text-[10px] font-semibold uppercase leading-3 tracking-[0.5px] text-muted-foreground tabular-nums md:self-end dark:bg-[var(--rd-profit-dim)] dark:!text-[var(--rd-profit)]">
            ATH portfólia:{" "}
            {athPoint
              ? `${mask(formatCurrency(athPoint.totalValue))} (${new Date(athPoint.date).toLocaleDateString("sk-SK")})`
              : "Nedostatok dát"}
          </p>
        </CardHeader>
        <CardContent className="relative h-[260px] sm:h-[320px] w-full min-w-0 overflow-hidden px-3 sm:px-6">
          <div className="chart-fade-grid rounded-lg" aria-hidden />
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
                        <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.05} />
                      </>
                    ) : (
                      <>
                        <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.04} />
                      </>
                    )}
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} className="stroke-muted" opacity={0.5} />
                <XAxis
                  dataKey="date"
                  {...axisProps}
                  tick={xAxisTick}
                  tickFormatter={(d) => d.slice(5)}
                  minTickGap={isMobile ? 28 : 14}
                  interval="preserveStartEnd"
                />
                <YAxis
                  {...axisProps}
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
                      <div className={tooltipBoxClass}>
                        <p className="mb-1.5 font-medium text-muted-foreground">{String(label)}</p>
                        <p className="flex items-center gap-1.5">
                          <span className="size-1.5 rounded-full bg-primary" />
                          Celková hodnota:{" "}
                          <span className="font-semibold tabular-nums">
                            {mask(formatCurrency(row.totalValue))}
                          </span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <span className="size-1.5 rounded-full bg-muted-foreground" />
                          Čisté invest.:{" "}
                          <span className="font-semibold tabular-nums">
                            {mask(formatCurrency(row.netInvested))}
                          </span>
                        </p>
                        <p className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="size-1.5 rounded-full bg-primary/60" />
                          Oproti vkladom:{" "}
                          <span className="font-semibold tabular-nums text-foreground">
                            {mask(formatCurrency(row.totalValue - row.netInvested))}
                          </span>
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
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 2) TWR vs S&P % */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1 flex-wrap">
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
        <CardContent className="relative h-[240px] sm:h-[300px] w-full min-w-0 overflow-hidden px-3 sm:px-6">
          <div className="chart-fade-grid rounded-lg" aria-hidden />
          {histLoading || pLoading || !chartReady ? (
            <Skeleton className="h-full w-full" />
          ) : points.length < 2 ? (
            <p className="text-muted-foreground text-sm">Nedostatok dát pre porovnanie v %.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={chartMargin}>
                <CartesianGrid vertical={false} className="stroke-muted" opacity={0.5} />
                <XAxis
                  dataKey="date"
                  {...axisProps}
                  tick={xAxisTick}
                  tickFormatter={(d) => d.slice(5)}
                  minTickGap={isMobile ? 28 : 14}
                  interval="preserveStartEnd"
                />
                <YAxis
                  {...axisProps}
                  tick={yAxisTick}
                  width={isMobile ? 40 : undefined}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                />
                <RTooltip
                  content={({ active, label, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as HistoryPoint;
                    return (
                      <div className={tooltipBoxClass}>
                        <p className="mb-1.5 font-medium text-muted-foreground">{String(label)}</p>
                        <p className="flex items-center gap-1.5">
                          <span className="size-1.5 rounded-full bg-primary" />
                          Portfólio:{" "}
                          <span className="font-semibold tabular-nums">{row.portfolioCumulativePct.toFixed(2)}%</span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <span className="size-1.5 rounded-full" style={{ backgroundColor: benchmarkStroke }} />
                          S&amp;P 500:{" "}
                          <span className="font-semibold tabular-nums">{row.sp500CumulativePct.toFixed(2)}%</span>
                        </p>
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
                  stroke={benchmarkStroke}
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Grafy() {
  const redesign = useMobileRedesign();
  return redesign ? <GrafyMobile /> : <GrafyClassic />;
}
