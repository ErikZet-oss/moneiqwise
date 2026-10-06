import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from "recharts";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import type { Holding } from "@shared/schema";
import { CASH_INTEREST_TICKER } from "@shared/tickerCurrency";
import { isPokemonTicker, POKEMON_GROUP_TICKER } from "@shared/pokemonTcg";

type AssetType = "AKCIA" | "ETF" | "KRYPTO" | "DLHOPIS" | "KOMODITA" | "FOND" | "HOTOVOST" | "INE";
type AssetProfile = { sector: string; country: string; assetType: AssetType };

type Slice = { name: string; value: number; hint?: string };

type AllocationTab = "type" | "ticker" | "sector" | "region";

const TAB_OPTIONS: { id: AllocationTab; label: string }[] = [
  { id: "type", label: "Typ" },
  { id: "ticker", label: "Pozície" },
  { id: "sector", label: "Sektor" },
  { id: "region", label: "Región" },
];

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  AKCIA: "Akcia",
  ETF: "ETF",
  KRYPTO: "Krypto",
  DLHOPIS: "Dlhopis",
  KOMODITA: "Komodita",
  FOND: "Fond",
  HOTOVOST: "Hotovosť",
  INE: "Iné",
};

/** Pastel neon-ish palette for dark fintech donuts */
const SLICE_COLORS = [
  "hsl(210 85% 62%)",
  "hsl(145 68% 52%)",
  "hsl(32 92% 58%)",
  "hsl(280 58% 70%)",
  "hsl(168 72% 52%)",
  "hsl(350 68% 68%)",
  "hsl(45 85% 62%)",
  "hsl(195 75% 58%)",
];

function sliceColor(i: number): string {
  return SLICE_COLORS[i % SLICE_COLORS.length]!;
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

function tickerLabel(holding: Holding): { name: string; hint?: string } {
  const ticker = holding.ticker.trim();
  const upper = ticker.toUpperCase();
  const company = (holding.companyName || "").trim();
  if (upper === "CASH") return { name: "Hotovosť" };
  if (upper === CASH_INTEREST_TICKER) return { name: "Úrok" };
  if (isPokemonTicker(upper)) return { name: company || "Pokémon TCG" };
  const hint =
    company && company.toUpperCase() !== upper && !company.toUpperCase().includes(upper)
      ? company
      : undefined;
  return { name: ticker, hint };
}

type ActiveShapeProps = {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
};

function ActiveDonutShape(props: ActiveShapeProps) {
  const { cx = 0, cy = 0, innerRadius = 0, outerRadius = 0, startAngle = 0, endAngle = 0, fill } =
    props;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius - 2}
        outerRadius={outerRadius + 8}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        cornerRadius={10}
        style={{ filter: `drop-shadow(0 0 10px ${fill})` }}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 10}
        outerRadius={outerRadius + 14}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.35}
        cornerRadius={6}
      />
    </g>
  );
}

type Props = {
  holdings: Holding[] | undefined;
  quotes: Record<string, { price: number }> | undefined;
  cashValue: number;
  holdingsLoading?: boolean;
  isAllPortfolios?: boolean;
};

export function DashboardAllocationWidget({
  holdings,
  quotes,
  cashValue,
  holdingsLoading,
  isAllPortfolios = false,
}: Props) {
  const [, setLocation] = useLocation();
  const { convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const mask = (s: string) => (hideAmounts ? "••••••" : s);

  const [tab, setTab] = useState<AllocationTab>("type");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setChartReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const equityTickers = useMemo(() => {
    if (!holdings?.length) return [];
    return Array.from(
      new Set(holdings.map((h) => h.ticker.toUpperCase()).filter((t) => t !== "CASH")),
    ).sort();
  }, [holdings]);

  const { data: profilesData, isLoading: profilesLoading } = useQuery({
    queryKey: ["/api/stocks/asset-profiles/batch", "dashboard-allocation", equityTickers.join(",")],
    enabled: equityTickers.length > 0,
    staleTime: 12 * 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("/api/stocks/asset-profiles/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers: equityTickers }),
      });
      if (!res.ok) throw new Error("Profiles failed");
      return res.json() as Promise<{ profiles: Record<string, AssetProfile> }>;
    },
  });

  const profiles = profilesData?.profiles ?? {};

  const { byType, byTicker, bySector, byRegion, total } = useMemo(() => {
    const sectorRows: Slice[] = [];
    const regionRows: Slice[] = [];
    const typeRows: Slice[] = [];
    const tickerValues = new Map<string, number>();
    const labels = new Map<string, { name: string; hint?: string }>();
    let sum = 0;
    let cashTotal = cashValue;

    if (!holdings) {
      return {
        byType: [] as Slice[],
        byTicker: [] as Slice[],
        bySector: [] as Slice[],
        byRegion: [] as Slice[],
        total: 0,
      };
    }

    for (const h of holdings) {
      const tickerKey = h.ticker.toUpperCase();
      const shares = parseFloat(h.shares);
      if (!Number.isFinite(shares) || shares <= 0) continue;

      const quote = quotes?.[h.ticker] ?? quotes?.[tickerKey];
      if (tickerKey === "CASH") {
        const v = shares * (quote?.price ?? 1);
        cashTotal += convertPrice(v, getTickerCurrency(h.ticker));
        continue;
      }

      const pokemon = isPokemonTicker(tickerKey);
      if (!quote && !pokemon) continue;
      const tc = getTickerCurrency(h.ticker);
      const fallbackPrice = parseFloat(h.averageCost);
      const price = quote?.price ?? (Number.isFinite(fallbackPrice) ? fallbackPrice : 0);
      if (!(price > 0)) continue;
      const conv = convertPrice(shares * price, tc);
      sum += conv;

      const valueKey = isAllPortfolios && pokemon ? POKEMON_GROUP_TICKER : tickerKey;
      tickerValues.set(valueKey, (tickerValues.get(valueKey) ?? 0) + conv);
      if (!labels.has(valueKey)) {
        labels.set(
          valueKey,
          valueKey === POKEMON_GROUP_TICKER
            ? { name: "Pokémon TCG" }
            : tickerLabel(h),
        );
      }

      const pr =
        profiles[tickerKey] ??
        profiles[h.ticker] ??
        (pokemon
          ? { sector: "Zberateľstvo", country: "Európa", assetType: "INE" as AssetType }
          : { sector: "Neznáme", country: "Neznáme", assetType: "AKCIA" as AssetType });
      sectorRows.push({ name: pr.sector, value: conv });
      regionRows.push({ name: pr.country, value: conv });
      typeRows.push({ name: ASSET_TYPE_LABELS[pr.assetType] ?? "Iné", value: conv });
    }

    if (Math.abs(cashTotal) > 0.005) {
      sum += cashTotal;
      if (cashTotal > 0.005) {
        tickerValues.set("HOTOVOST", (tickerValues.get("HOTOVOST") ?? 0) + cashTotal);
        sectorRows.push({ name: "Hotovosť", value: cashTotal });
        regionRows.push({ name: "—", value: cashTotal });
        typeRows.push({ name: "Hotovosť", value: cashTotal });
      }
    }

    const byTickerSlices = Array.from(tickerValues.entries())
      .map(([key, value]) => {
        if (key === "HOTOVOST") return { name: "Hotovosť", value };
        if (key === POKEMON_GROUP_TICKER) return { name: "Pokémon TCG", value };
        const row = labels.get(key);
        return { name: row?.name ?? key, hint: row?.hint, value };
      })
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);

    return {
      byType: aggregateSlices(typeRows),
      byTicker: byTickerSlices,
      bySector: aggregateSlices(sectorRows),
      byRegion: aggregateSlices(regionRows),
      total: sum,
    };
  }, [
    holdings,
    quotes,
    profiles,
    cashValue,
    convertPrice,
    getTickerCurrency,
    isAllPortfolios,
  ]);

  const slices = useMemo(() => {
    switch (tab) {
      case "ticker":
        return byTicker;
      case "sector":
        return bySector;
      case "region":
        return byRegion;
      default:
        return byType;
    }
  }, [tab, byType, byTicker, bySector, byRegion]);

  const chartData = useMemo(
    () =>
      slices.slice(0, 8).map((s, i) => ({
        ...s,
        fill: sliceColor(i),
      })),
    [slices],
  );

  useEffect(() => {
    setActiveIndex(null);
  }, [tab]);

  const active = activeIndex != null ? chartData[activeIndex] : null;
  const activePct =
    active && total > 0 ? (active.value / total) * 100 : null;

  const loading = holdingsLoading || (equityTickers.length > 0 && profilesLoading);

  return (
    <Card className="h-full overflow-hidden" data-testid="card-dashboard-allocation">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2">
        <CardTitle className="text-base font-semibold">Alokácia</CardTitle>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors"
          onClick={() => setLocation("/allocation")}
          data-testid="button-allocation-see-more"
        >
          Viac
          <ExternalLink className="h-3 w-3" />
        </button>
      </CardHeader>
      <CardContent className="p-4 pt-1 space-y-3">
        <div
          className="flex gap-1 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 scrollbar-none"
          role="tablist"
          aria-label="Rozdelenie alokácie"
        >
          {TAB_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={tab === opt.id}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                tab === opt.id
                  ? "bg-white/10 text-foreground shadow-sm ring-1 ring-white/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5",
              )}
              onClick={() => setTab(opt.id)}
              data-testid={`button-allocation-tab-${opt.id}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Skeleton className="h-[200px] w-[200px] rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            Zatiaľ nie sú dáta na alokáciu
          </div>
        ) : (
          <>
            <div className="relative mx-auto h-[220px] w-full max-w-[260px]">
              {!chartReady ? (
                <div className="h-full w-full rounded-full bg-muted/30 animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <defs>
                      {chartData.map((s, i) => (
                        <linearGradient
                          key={`alloc-grad-${i}`}
                          id={`alloc-grad-${i}`}
                          x1="0"
                          y1="0"
                          x2="1"
                          y2="1"
                        >
                          <stop offset="0%" stopColor={s.fill} stopOpacity={1} />
                          <stop offset="100%" stopColor={s.fill} stopOpacity={0.72} />
                        </linearGradient>
                      ))}
                    </defs>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius="62%"
                      outerRadius="84%"
                      paddingAngle={3.5}
                      cornerRadius={12}
                      stroke="transparent"
                      strokeWidth={0}
                      isAnimationActive
                      animationDuration={650}
                      activeIndex={activeIndex ?? undefined}
                      activeShape={ActiveDonutShape}
                      onMouseEnter={(_, index) => setActiveIndex(index)}
                      onMouseLeave={() => setActiveIndex(null)}
                      onClick={(_, index) =>
                        setActiveIndex((prev) => (prev === index ? null : index))
                      }
                      style={{ cursor: "pointer", outline: "none" }}
                    >
                      {chartData.map((_, i) => (
                        <Cell
                          key={`cell-${i}`}
                          fill={`url(#alloc-grad-${i})`}
                          className="outline-none transition-opacity"
                          style={{
                            opacity:
                              activeIndex == null || activeIndex === i ? 1 : 0.35,
                            filter:
                              activeIndex === i
                                ? undefined
                                : "drop-shadow(0 2px 6px rgba(0,0,0,0.35))",
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}

              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                <div className="rounded-full bg-background/40 dark:bg-black/35 backdrop-blur-[2px] px-4 py-3 min-w-[7.5rem]">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
                    {active ? active.name : "Celková hodnota"}
                  </p>
                  <p className="text-lg font-semibold tabular-nums tracking-tight mt-0.5 truncate max-w-[140px]">
                    {mask(formatCurrency(active ? active.value : total))}
                  </p>
                  {activePct != null && (
                    <p className="text-xs font-medium text-muted-foreground tabular-nums mt-0.5">
                      {activePct.toFixed(1)} %
                    </p>
                  )}
                </div>
              </div>
            </div>

            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" data-testid="list-allocation-legend">
              {chartData.slice(0, 6).map((slice, i) => {
                const pct = total > 0 ? (slice.value / total) * 100 : 0;
                const isActive = activeIndex === i;
                return (
                  <li key={`${slice.name}-${i}`}>
                    <button
                      type="button"
                      className={cn(
                        "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                        isActive ? "bg-white/10" : "hover:bg-white/5",
                      )}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseLeave={() => setActiveIndex(null)}
                      onClick={() => setActiveIndex((prev) => (prev === i ? null : i))}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_8px_currentColor]"
                        style={{ backgroundColor: slice.fill, color: slice.fill }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {slice.name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {pct.toFixed(0)}%
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
