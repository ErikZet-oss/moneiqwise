import { useMemo, useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Sector,
} from "recharts";
import { PieChartIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useToast } from "@/hooks/use-toast";
import type { Holding } from "@shared/schema";
import { CASH_INTEREST_DISPLAY_NAME, CASH_INTEREST_TICKER } from "@shared/tickerCurrency";
import { isPokemonTicker, POKEMON_GROUP_TICKER } from "@shared/pokemonTcg";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";

type AssetType = "AKCIA" | "ETF" | "KRYPTO" | "DLHOPIS" | "KOMODITA" | "FOND" | "HOTOVOST" | "INE";
type AssetProfile = { sector: string; country: string; assetType: AssetType };
type UserMetadata = { sector: string | null; country: string | null; assetType: AssetType | null };
type EditorRow = { sector: string; country: string; assetType: AssetType | "" };

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

/** Same pastel palette as DashboardAllocationWidget */
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

const SECTOR_OPTIONS = [
  "Technológie",
  "Financie",
  "Zdravotníctvo",
  "Priemysel",
  "Energetika",
  "Nehnuteľnosti",
  "Komunikácie",
  "Spotrebný tovar - cyklický",
  "Spotrebný tovar - defenzívny",
  "Materiály",
  "Utility",
  "Hotovosť",
  "Nezaradené",
] as const;

const COUNTRY_OPTIONS = [
  "USA",
  "Európa",
  "Ázia",
  "Južná Amerika",
] as const;

interface StockQuote {
  ticker: string;
  price: number;
}

type Slice = { name: string; value: number; hint?: string };

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

/** Krátky ticker s burzovou príponou; celý názov emitenta je v `hint` (tooltip). */
function allocationAssetLabel(holding: Holding): { name: string; hint?: string } {
  const ticker = holding.ticker.trim();
  const tickerUpper = ticker.toUpperCase();
  const company = (holding.companyName || "").trim();

  if (tickerUpper === "CASH") return { name: "Hotovosť" };
  if (tickerUpper === CASH_INTEREST_TICKER) return { name: CASH_INTEREST_DISPLAY_NAME };
  if (isPokemonTicker(tickerUpper)) return { name: company || "Pokémon TCG" };

  const hint =
    company && company.toUpperCase() !== tickerUpper && !company.toUpperCase().includes(tickerUpper)
      ? company
      : undefined;

  return { name: ticker, hint };
}

function aggregateTickerSlices(holdings: Holding[], valueByTickerKey: Map<string, number>): Slice[] {
  const labels = new Map<string, { name: string; hint?: string }>();
  for (const h of holdings) {
    const key = h.ticker.toUpperCase();
    if (!labels.has(key)) labels.set(key, allocationAssetLabel(h));
  }
  return Array.from(valueByTickerKey.entries())
    .map(([key, value]) => {
      if (key === "HOTOVOST") return { name: "Hotovosť", value };
      if (key === POKEMON_GROUP_TICKER) return { name: "Pokémon TCG", value };
      const row = labels.get(key);
      return { name: row?.name ?? key, hint: row?.hint, value };
    })
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Recharts na úzkom mobile vie mať šírku 0 – počkáme na stabilný layout. */
function useChartReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
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

export default function Allocation() {
  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { toast } = useToast();
  const {
    portfolios,
    selectedPortfolio,
    isAllPortfolios,
    getQueryParam,
    isLoading: portfoliosLoading,
  } = usePortfolio();
  const { hideAmounts } = useChartSettings();
  const mask = (s: string) => (hideAmounts ? "••••••" : s);

  const portfolioParam = getQueryParam();

  const [displayMode, setDisplayMode] = useState<"percent" | "value">("percent");
  const chartReady = useChartReady();
  const [editorRows, setEditorRows] = useState<Record<string, EditorRow>>({});

  const { data: holdings, isLoading: holdingsLoading } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${portfolioParam}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch holdings");
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
      if (!res.ok) throw new Error("Quotes failed");
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

  const { data: profilesData, isLoading: profilesLoading } = useQuery({
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
      if (!res.ok) throw new Error("Profiles failed");
      return res.json() as Promise<{
        profiles: Record<string, AssetProfile>;
      }>;
    },
  });

  const { data: userMetadataData, isLoading: metadataLoading } = useQuery({
    queryKey: ["/api/stocks/metadata", equityTickers.join(",")],
    enabled: equityTickers.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("tickers", equityTickers.join(","));
      const res = await fetch(`/api/stocks/metadata?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Metadata failed");
      return res.json() as Promise<{ metadata: Record<string, UserMetadata> }>;
    },
  });

  const profiles = profilesData?.profiles ?? {};
  const userMetadata = userMetadataData?.metadata ?? {};

  useEffect(() => {
    if (!equityTickers.length) {
      setEditorRows({});
      return;
    }
    const next: Record<string, EditorRow> = {};
    for (const ticker of equityTickers) {
      const m = userMetadata[ticker];
      next[ticker] = {
        sector: m?.sector ?? "",
        country: m?.country ?? "",
        assetType: m?.assetType ?? "",
      };
    }
    setEditorRows(next);
  }, [equityTickers, userMetadataData]);

  const saveMetadataMutation = useMutation({
    mutationFn: async (rows: Record<string, EditorRow>) => {
      await Promise.all(
        Object.entries(rows).map(async ([ticker, row]) => {
          await apiRequest("PUT", `/api/stocks/metadata/${encodeURIComponent(ticker)}`, {
            sector: row.sector.trim() || null,
            country: row.country.trim() || null,
            assetType: row.assetType || null,
          });
        }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stocks/metadata"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stocks/asset-profiles/batch"] });
      toast({
        title: "Uložené",
        description: "Metadáta aktív boli uložené.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Chyba",
        description: err.message || "Nepodarilo sa uložiť metadáta aktíva.",
        variant: "destructive",
      });
    },
  });

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

  const { byTicker, bySector, byCountry, byType, totalMarket } = useMemo(() => {
    const sectorRows: Slice[] = [];
    const countryRows: Slice[] = [];
    const typeRows: Slice[] = [];
    const tickerValues = new Map<string, number>();
    let sum = 0;
    let cashTotal = cashValueConv;

    if (holdings === undefined) {
      return {
        byTicker: [] as Slice[],
        bySector: [] as Slice[],
        byCountry: [] as Slice[],
        byType: [] as Slice[],
        totalMarket: 0,
      };
    }

    if (!holdings.length) {
      const onlyCash =
        cashTotal > 0.005
          ? {
              byTicker: [{ name: "Hotovosť", value: cashTotal }] as Slice[],
              bySector: [{ name: "Hotovosť", value: cashTotal }] as Slice[],
              byCountry: [{ name: "—", value: cashTotal }] as Slice[],
              byType: [{ name: "Hotovosť", value: cashTotal }] as Slice[],
              totalMarket: cashTotal,
            }
          : {
              byTicker: [] as Slice[],
              bySector: [] as Slice[],
              byCountry: [] as Slice[],
              byType: [] as Slice[],
              totalMarket: 0,
            };
      return onlyCash;
    }

    for (const h of holdings) {
      const tickerKey = h.ticker.toUpperCase();
      const shares = parseFloat(h.shares);
      if (!Number.isFinite(shares) || shares <= 0) continue;

      const quote = quotes?.[h.ticker] ?? quotes?.[tickerKey];
      if (tickerKey === "CASH") {
        const v = shares * (quote?.price ?? 1);
        const tc = getTickerCurrency(h.ticker);
        cashTotal += convertPrice(v, tc);
        continue;
      }

      const pokemon = isPokemonTicker(tickerKey);
      if (!quote && !pokemon) continue;
      const tc = getTickerCurrency(h.ticker);
      const fallbackPrice = parseFloat(h.averageCost);
      const price = quote?.price ?? (Number.isFinite(fallbackPrice) ? fallbackPrice : 0);
      if (!(price > 0)) continue;
      const rawVal = shares * price;
      const conv = convertPrice(rawVal, tc);
      sum += conv;

      const valueKey = isAllPortfolios && pokemon ? POKEMON_GROUP_TICKER : tickerKey;
      tickerValues.set(valueKey, (tickerValues.get(valueKey) ?? 0) + conv);

      const pr =
        profiles[tickerKey] ??
        profiles[h.ticker] ??
        (pokemon
          ? { sector: "Zberateľstvo", country: "Európa", assetType: "INE" as AssetType }
          : { sector: "Neznáme", country: "Neznáme", assetType: "AKCIA" as AssetType });
      sectorRows.push({ name: pr.sector, value: conv });
      countryRows.push({ name: pr.country, value: conv });
      typeRows.push({ name: ASSET_TYPE_LABELS[pr.assetType] ?? "Iné", value: conv });
    }

    if (Math.abs(cashTotal) > 0.005) {
      sum += cashTotal;
      if (cashTotal > 0.005) {
        tickerValues.set("HOTOVOST", (tickerValues.get("HOTOVOST") ?? 0) + cashTotal);
        sectorRows.push({ name: "Hotovosť", value: cashTotal });
        countryRows.push({ name: "—", value: cashTotal });
        typeRows.push({ name: "Hotovosť", value: cashTotal });
      }
    }

    const byTicker = aggregateTickerSlices(holdings, tickerValues);

    return {
      byTicker,
      bySector: aggregateSlices(sectorRows),
      byCountry: aggregateSlices(countryRows),
      byType: aggregateSlices(typeRows),
      totalMarket: sum,
    };
  }, [
    holdings,
    quotes,
    profiles,
    cashValueConv,
    convertPrice,
    getTickerCurrency,
    isAllPortfolios,
  ]);

  const loading =
    portfoliosLoading ||
    holdingsLoading ||
    (equityTickers.length > 0 && profilesLoading);

  const empty =
    !holdingsLoading &&
    (!holdings?.length || holdings.length === 0) &&
    cashValueConv <= 0;

  return (
    <div className="flex flex-col gap-3 md:gap-5 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-semibold text-foreground flex items-center gap-2 truncate">
            <PieChartIcon className="h-5 w-5 md:h-6 md:w-6 text-primary shrink-0" />
            Rozloženie portfólia
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Podľa tickerov, sektorov, krajín a typu aktíva. Sektor/krajina/typ vieš manuálne prepísať
            nižšie pre presnejšie koláče.
          </p>
        </div>
        <ToggleGroup
          type="single"
          value={displayMode}
          onValueChange={(v) => {
            if (v === "percent" || v === "value") setDisplayMode(v);
          }}
          className="justify-start shrink-0"
        >
          <ToggleGroupItem value="percent" aria-label="Percentá" className="text-xs">
            Percentá
          </ToggleGroupItem>
          <ToggleGroupItem value="value" aria-label="Hodnoty" className="text-xs">
            Hodnoty ({currency})
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {loading ? (
        <div className="grid gap-3 md:gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-border bg-card shadow-sm">
              <CardHeader className="px-3 py-2.5 md:px-4 md:py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full mt-2" />
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0 md:px-4 md:pb-4">
                <Skeleton className="h-[240px] w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : empty ? (
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="py-8 md:py-12 px-3 md:px-6 text-center text-muted-foreground text-sm">
            Žiadne pozície ani hotovosť na zobrazenie rozloženia.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:gap-5 md:grid-cols-2 xl:grid-cols-4">
          <AllocationPieCard
            chartId="ticker"
            title="Podľa akcií"
            description="Každý ticker + hotovosť"
            data={byTicker}
            total={totalMarket}
            displayMode={displayMode}
            mask={mask}
            formatCurrency={formatCurrency}
            denseLegend
            chartReady={chartReady}
          />
          <AllocationPieCard
            chartId="sector"
            title="Podľa sektorov"
            description="Odvetvie podľa Yahoo"
            data={bySector}
            total={totalMarket}
            displayMode={displayMode}
            mask={mask}
            formatCurrency={formatCurrency}
            chartReady={chartReady}
          />
          <AllocationPieCard
            chartId="country"
            title="Podľa krajín"
            description="Krajina sídla emitenta"
            data={byCountry}
            total={totalMarket}
            displayMode={displayMode}
            mask={mask}
            formatCurrency={formatCurrency}
            chartReady={chartReady}
          />
          <AllocationPieCard
            chartId="type"
            title="Podľa typu"
            description="Akcia, ETF, krypto…"
            data={byType}
            total={totalMarket}
            displayMode={displayMode}
            mask={mask}
            formatCurrency={formatCurrency}
            chartReady={chartReady}
          />
        </div>
      )}

      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="px-3 py-2.5 md:px-4 md:py-3 space-y-1">
          <CardTitle className="text-sm md:text-base font-semibold">Manuálne metadáta aktív</CardTitle>
          <CardDescription className="text-xs">
            Prepíše sektor, krajinu a typ z Yahoo pre vybraný ticker (necháš prázdne = použije sa Yahoo).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3 pt-0 md:px-4 md:pb-4">
          {metadataLoading && equityTickers.length > 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : equityTickers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žiadne otvorené tickery na úpravu.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-end">
                <Button
                  disabled={saveMetadataMutation.isPending}
                  onClick={() => saveMetadataMutation.mutate(editorRows)}
                >
                  Uložiť všetko
                </Button>
              </div>
              {equityTickers.map((ticker) => {
                const row = editorRows[ticker] ?? { sector: "", country: "", assetType: "" };
                return (
                  <div
                    key={ticker}
                    className="grid gap-2 rounded-lg border border-border/70 p-2.5 md:p-3 sm:grid-cols-[120px_1fr_1fr_170px] sm:items-center"
                  >
                    <div className="font-medium text-sm">{ticker}</div>
                    <Select
                      value={row.sector || "none"}
                      onValueChange={(v) =>
                        setEditorRows((prev) => ({
                          ...prev,
                          [ticker]: { ...row, sector: v === "none" ? "" : v },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sektor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Automaticky</SelectItem>
                        {SECTOR_OPTIONS.map((sector) => (
                          <SelectItem key={sector} value={sector}>
                            {sector}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={row.country || "none"}
                      onValueChange={(v) =>
                        setEditorRows((prev) => ({
                          ...prev,
                          [ticker]: { ...row, country: v === "none" ? "" : v },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Krajina" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Automaticky</SelectItem>
                        {COUNTRY_OPTIONS.map((country) => (
                          <SelectItem key={country} value={country}>
                            {country}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={row.assetType || "none"}
                      onValueChange={(v) =>
                        setEditorRows((prev) => ({
                          ...prev,
                          [ticker]: { ...row, assetType: v === "none" ? "" : (v as AssetType) },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Typ" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Automaticky</SelectItem>
                        {Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AllocationPieCard({
  chartId,
  title,
  description,
  data,
  total,
  displayMode,
  mask,
  formatCurrency,
  denseLegend,
  chartReady,
}: {
  chartId: string;
  title: string;
  description: string;
  data: Slice[];
  total: number;
  displayMode: "percent" | "value";
  mask: (s: string) => string;
  formatCurrency: (n: number) => string;
  denseLegend?: boolean;
  chartReady: boolean;
}) {
  const fineHover = useFineHover();
  const lastSelectAt = useRef(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showAllLegendItems, setShowAllLegendItems] = useState(false);

  const chartData = useMemo(
    () =>
      data.map((s, i) => ({
        ...s,
        fill: sliceColor(i),
      })),
    [data],
  );

  const legendLimit = denseLegend ? 12 : 10;
  const hasMoreLegendItems = chartData.length > legendLimit;
  const visibleLegendSlices =
    !showAllLegendItems && hasMoreLegendItems
      ? chartData.slice(0, legendLimit)
      : chartData;

  const selectSlice = (index: number) => {
    const now = Date.now();
    if (now - lastSelectAt.current < 320) return;
    lastSelectAt.current = now;
    setActiveIndex((prev) => (prev === index ? null : index));
  };

  useEffect(() => {
    setActiveIndex(null);
  }, [data, displayMode]);

  const active = activeIndex != null ? chartData[activeIndex] : null;
  const activePct = active && total > 0 ? (active.value / total) * 100 : null;

  return (
    <Card className="flex flex-col overflow-hidden border-border bg-card shadow-sm">
      <CardHeader className="px-3 py-2.5 md:px-4 md:py-3 space-y-0.5">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
        <CardDescription className="text-[11px] md:text-xs leading-snug">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 px-3 pb-3 pt-0 md:px-4 md:pb-4">
        {chartData.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Nedostatok dát
          </div>
        ) : (
          <>
            <div className="relative mx-auto h-[200px] w-[200px] md:h-[220px] md:w-[220px] shrink-0">
              {!chartReady ? (
                <div className="h-full w-full rounded-full bg-muted/30 animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <defs>
                      {chartData.map((s, i) => (
                        <linearGradient
                          key={`${chartId}-grad-${i}`}
                          id={`${chartId}-grad-${i}`}
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
                          key={`${chartId}-cell-${i}`}
                          fill={`url(#${chartId}-grad-${i})`}
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

            <ul className="space-y-0.5" data-testid={`list-allocation-legend-${chartId}`}>
              {visibleLegendSlices.map((slice, i) => {
                const pct = total > 0 ? (slice.value / total) * 100 : 0;
                const isActive = activeIndex === i;
                const valueLabel =
                  displayMode === "value"
                    ? mask(formatCurrency(slice.value))
                    : `${pct.toFixed(0)}%`;
                return (
                  <li key={`${slice.name}-${i}`}>
                    <button
                      type="button"
                      className={cn(
                        "w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
                        isActive ? "bg-white/10" : "hover:bg-white/5",
                      )}
                      title={slice.hint ? `${slice.name} — ${slice.hint}` : slice.name}
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
                        {valueLabel}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {hasMoreLegendItems && (
              <button
                type="button"
                className="self-start px-1.5 text-[10px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
                onClick={() => setShowAllLegendItems((prev) => !prev)}
              >
                {showAllLegendItems
                  ? "Zobraziť menej"
                  : `+${chartData.length - legendLimit} ďalších`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
