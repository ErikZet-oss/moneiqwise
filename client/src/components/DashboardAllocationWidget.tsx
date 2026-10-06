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

/** Max legend rows beside the donut; full list lives on /allocation */
const LEGEND_LIMIT = 6;

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
        innerRadius={innerRadius - 1}
        outerRadius={outerRadius + 5}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        cornerRadius={4}
        style={{ filter: `drop-shadow(0 0 10px ${fill})` }}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 7}
        outerRadius={outerRadius + 10}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.35}
        cornerRadius={3}
      />
    </g>
  );
}

/** Desktop hover only — touch + synthetic mouseenter would toggle selection off. */
function useFineHover() {
  const [fineHover, setFineHover] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFineHover(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return fineHover;
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
  const fineHover = useFineHover();
  const lastSelectAt = useRef(0);

  const selectSlice = (index: number) => {
    const now = Date.now();
    // Ignore synthetic duplicate click after touch (would toggle selection off).
    if (now - lastSelectAt.current < 320) return;
    lastSelectAt.current = now;
    setActiveIndex((prev) => (prev === index ? null : index));
  };

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
      slices.slice(0, LEGEND_LIMIT).map((s, i) => ({
        ...s,
        fill: sliceColor(i),
      })),
    [slices],
  );

  const hasMoreSlices = slices.length > LEGEND_LIMIT;

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
      <CardContent className="px-3 pb-3 pt-1 space-y-2">
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
          <div className="flex items-center gap-2 py-1">
            <Skeleton className="h-[196px] w-[196px] shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[196px] items-center justify-center text-sm text-muted-foreground">
            Zatiaľ nie sú dáta na alokáciu
          </div>
        ) : (
          <div className="flex items-center gap-1.5 sm:gap-2 -ml-1">
            <div className="relative h-[196px] w-[196px] shrink-0 -my-1">
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
                      innerRadius="56%"
                      outerRadius="92%"
                      paddingAngle={2}
                      cornerRadius={4}
                      stroke="transparent"
                      strokeWidth={0}
                      isAnimationActive
                      animationDuration={650}
                      activeIndex={activeIndex ?? undefined}
                      activeShape={ActiveDonutShape}
                      onMouseEnter={
                        fineHover ? (_, index) => setActiveIndex(index) : undefined
                      }
                      onMouseLeave={fineHover ? () => setActiveIndex(null) : undefined}
                      onClick={(_, index, e) => {
                        e?.stopPropagation?.();
                        selectSlice(index);
                      }}
                      style={{ cursor: "pointer", outline: "none", touchAction: "manipulation" }}
                    >
                      {chartData.map((_, i) => (
                        <Cell
                          key={`cell-${i}`}
                          fill={`url(#alloc-grad-${i})`}
                          className="outline-none"
                          style={{
                            opacity:
                              activeIndex == null || activeIndex === i ? 1 : 0.35,
                            filter:
                              activeIndex === i
                                ? undefined
                                : "drop-shadow(0 2px 6px rgba(0,0,0,0.35))",
                            cursor: "pointer",
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}

              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-3">
                <div className="rounded-full bg-background/40 dark:bg-black/35 backdrop-blur-[2px] px-2.5 py-2 min-w-[5.5rem]">
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground leading-tight truncate max-w-[96px]">
                    {active ? active.name : "Celkom"}
                  </p>
                  <p className="text-sm font-semibold tabular-nums tracking-tight mt-0.5 truncate max-w-[108px]">
                    {mask(formatCurrency(active ? active.value : total))}
                  </p>
                  {activePct != null && (
                    <p className="text-[10px] font-medium text-muted-foreground tabular-nums mt-0.5">
                      {activePct.toFixed(1)} %
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5 pr-0.5">
              <ul className="space-y-0.5" data-testid="list-allocation-legend">
                {chartData.map((slice, i) => {
                  const pct = total > 0 ? (slice.value / total) * 100 : 0;
                  const isActive = activeIndex === i;
                  return (
                    <li key={`${slice.name}-${i}`}>
                      <button
                        type="button"
                        className={cn(
                          "w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
                          isActive ? "bg-white/10" : "hover:bg-white/5",
                        )}
                        onMouseEnter={fineHover ? () => setActiveIndex(i) : undefined}
                        onMouseLeave={fineHover ? () => setActiveIndex(null) : undefined}
                        onClick={() => selectSlice(i)}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-sm shadow-[0_0_6px_currentColor]"
                          style={{ backgroundColor: slice.fill, color: slice.fill }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight">
                          {slice.name}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {pct.toFixed(0)}%
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hasMoreSlices && (
                <button
                  type="button"
                  className="mt-0.5 self-start px-1.5 text-[10px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
                  onClick={() => setLocation("/allocation")}
                  data-testid="button-allocation-more-slices"
                >
                  +{slices.length - LEGEND_LIMIT} ďalších v Rozložení
                </button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
