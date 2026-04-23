import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PieChartIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useToast } from "@/hooks/use-toast";
import type { Holding } from "@shared/schema";
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

/** Recharts na úzkom mobile vie mať šírku 0 – počkáme na stabilný layout. */
function useChartReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

function useIsNarrowScreen() {
  const [narrow, setNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < 640 : true
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const fn = () => setNarrow(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return narrow;
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
    mutationFn: async ({ ticker, row }: { ticker: string; row: EditorRow }) => {
      await apiRequest("PUT", `/api/stocks/metadata/${encodeURIComponent(ticker)}`, {
        sector: row.sector.trim() || null,
        country: row.country.trim() || null,
        assetType: row.assetType || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stocks/metadata"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stocks/asset-profiles/batch"] });
      toast({
        title: "Uložené",
        description: "Metadáta aktíva boli uložené.",
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
    const tickerRows: Slice[] = [];
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

      if (!quote) continue;
      const tc = getTickerCurrency(t);
      const rawVal = shares * quote.price;
      const conv = convertPrice(rawVal, tc);
      sum += conv;

      tickerRows.push({ name: t, value: conv });

      const pr = profiles[t] ?? { sector: "Neznáme", country: "Neznáme", assetType: "AKCIA" as AssetType };
      sectorRows.push({ name: pr.sector, value: conv });
      countryRows.push({ name: pr.country, value: conv });
      typeRows.push({ name: ASSET_TYPE_LABELS[pr.assetType] ?? "Iné", value: conv });
    }

    if (Math.abs(cashTotal) > 0.005) {
      sum += cashTotal;
      if (cashTotal > 0.005) {
        tickerRows.push({ name: "Hotovosť", value: cashTotal });
        sectorRows.push({ name: "Hotovosť", value: cashTotal });
        countryRows.push({ name: "—", value: cashTotal });
        typeRows.push({ name: "Hotovosť", value: cashTotal });
      }
    }

    return {
      byTicker: aggregateSlices(tickerRows),
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
  ]);

  const renderTooltip = (props: {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number; payload?: Slice }>;
  }) => {
    if (!props.active || !props.payload?.length) return null;
    const row = props.payload[0];
    const name = row.name ?? row.payload?.name;
    const value = row.value ?? row.payload?.value ?? 0;
    const pct = totalMarket > 0 ? (value / totalMarket) * 100 : 0;
    return (
      <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg">
        <div className="font-medium">{name}</div>
        <div className="text-muted-foreground">
          {mask(formatCurrency(value))}
          {" · "}
          {pct.toFixed(1)} %
        </div>
      </div>
    );
  };

  const loading =
    portfoliosLoading ||
    holdingsLoading ||
    (equityTickers.length > 0 && profilesLoading);

  const empty =
    !holdingsLoading &&
    (!holdings?.length || holdings.length === 0) &&
    cashValueConv <= 0;

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PieChartIcon className="h-7 w-7 text-primary" />
            Rozloženie portfólia
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
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
          <ToggleGroupItem value="percent" aria-label="Percentá">
            Percentá
          </ToggleGroupItem>
          <ToggleGroupItem value="value" aria-label="Hodnoty">
            Hodnoty ({currency})
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-[280px] w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : empty ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Žiadne pozície ani hotovosť na zobrazenie rozloženia.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <AllocationPieCard
            title="Podľa akcií"
            description="Každý ticker + hotovosť"
            data={byTicker}
            total={totalMarket}
            displayMode={displayMode}
            mask={mask}
            formatCurrency={formatCurrency}
            renderTooltip={renderTooltip}
            denseLegend
            chartReady={chartReady}
          />
          <AllocationPieCard
            title="Podľa sektorov"
            description="Odvetvie podľa Yahoo"
            data={bySector}
            total={totalMarket}
            displayMode={displayMode}
            mask={mask}
            formatCurrency={formatCurrency}
            renderTooltip={renderTooltip}
            chartReady={chartReady}
          />
          <AllocationPieCard
            title="Podľa krajín"
            description="Krajina sídla emitenta"
            data={byCountry}
            total={totalMarket}
            displayMode={displayMode}
            mask={mask}
            formatCurrency={formatCurrency}
            renderTooltip={renderTooltip}
            chartReady={chartReady}
          />
          <AllocationPieCard
            title="Podľa typu"
            description="Akcia, ETF, krypto…"
            data={byType}
            total={totalMarket}
            displayMode={displayMode}
            mask={mask}
            formatCurrency={formatCurrency}
            renderTooltip={renderTooltip}
            chartReady={chartReady}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Manuálne metadáta aktív</CardTitle>
          <CardDescription>
            Prepíše sektor, krajinu a typ z Yahoo pre vybraný ticker (necháš prázdne = použije sa Yahoo).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {metadataLoading && equityTickers.length > 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : equityTickers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žiadne otvorené tickery na úpravu.</p>
          ) : (
            <div className="space-y-2">
              {equityTickers.map((ticker) => {
                const row = editorRows[ticker] ?? { sector: "", country: "", assetType: "" };
                return (
                  <div
                    key={ticker}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-[120px_1fr_1fr_170px_110px] sm:items-center"
                  >
                    <div className="font-medium">{ticker}</div>
                    <Input
                      value={row.sector}
                      placeholder="Sektor"
                      onChange={(e) =>
                        setEditorRows((prev) => ({
                          ...prev,
                          [ticker]: { ...row, sector: e.target.value },
                        }))
                      }
                    />
                    <Input
                      value={row.country}
                      placeholder="Krajina"
                      onChange={(e) =>
                        setEditorRows((prev) => ({
                          ...prev,
                          [ticker]: { ...row, country: e.target.value },
                        }))
                      }
                    />
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
                    <Button
                      disabled={saveMetadataMutation.isPending}
                      onClick={() => saveMetadataMutation.mutate({ ticker, row })}
                    >
                      Uložiť
                    </Button>
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
  title,
  description,
  data,
  total,
  displayMode,
  mask,
  formatCurrency,
  renderTooltip,
  denseLegend,
  chartReady,
}: {
  title: string;
  description: string;
  data: Slice[];
  total: number;
  displayMode: "percent" | "value";
  mask: (s: string) => string;
  formatCurrency: (n: number) => string;
  renderTooltip: (p: {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number; payload?: Slice }>;
  }) => import("react").ReactNode;
  /** Viac riadkov + vyšší scroll pre koláč podľa tickerov */
  denseLegend?: boolean;
  chartReady: boolean;
}) {
  const narrow = useIsNarrowScreen();
  const chartData = data.map((d) => ({ ...d }));

  const innerR = narrow ? 44 : 58;
  const outerR = narrow ? 78 : 96;

  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden border-border/80 shadow-sm",
        "bg-card/80 backdrop-blur-[2px]"
      )}
    >
      <CardHeader className="pb-3 space-y-1">
        <CardTitle className="text-lg tracking-tight">{title}</CardTitle>
        <CardDescription className="text-xs leading-snug">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0 pb-5">
        {chartData.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Nedostatok dát
          </div>
        ) : (
          <>
            <div className="text-center">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Celkom
              </span>
              <div className="text-lg font-semibold tabular-nums">{mask(formatCurrency(total))}</div>
            </div>

            <div className="flex justify-center w-full min-w-0">
              <div
                className={cn(
                  "w-full max-w-[280px] aspect-square max-h-[260px] sm:max-h-[280px]",
                  !chartReady && "opacity-0 pointer-events-none"
                )}
              >
                {chartReady ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={160} minHeight={160}>
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={innerR}
                        outerRadius={outerR}
                        paddingAngle={2}
                        strokeWidth={2}
                        stroke="hsl(var(--background))"
                        cornerRadius={4}
                        label={false}
                        isAnimationActive={true}
                      >
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={sliceFill(i)} />
                        ))}
                      </Pie>
                      <Tooltip content={renderTooltip} wrapperStyle={{ zIndex: 50 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full rounded-full bg-muted/40 animate-pulse" />
                )}
              </div>
            </div>

            <AllocationLegend
              slices={chartData}
              total={total}
              displayMode={displayMode}
              mask={mask}
              formatCurrency={formatCurrency}
              dense={denseLegend}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AllocationLegend({
  slices,
  total,
  displayMode,
  mask,
  formatCurrency,
  dense,
}: {
  slices: Slice[];
  total: number;
  displayMode: "percent" | "value";
  mask: (s: string) => string;
  formatCurrency: (n: number) => string;
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-muted/25 px-2 py-2 sm:px-3",
        dense ? "max-h-[min(260px,42vh)] sm:max-h-[220px]" : "max-h-[min(220px,38vh)] sm:max-h-[200px]",
        "overflow-y-auto overscroll-y-contain scroll-smooth space-y-1"
      )}
      role="list"
    >
      {slices.map((slice, i) => {
        const pct = total > 0 ? (slice.value / total) * 100 : 0;
        const secondary =
          displayMode === "percent"
            ? `${pct.toFixed(1)} %`
            : mask(formatCurrency(slice.value));
        const primary =
          displayMode === "percent"
            ? mask(formatCurrency(slice.value))
            : `${pct.toFixed(1)} %`;

        return (
          <div
            key={`${slice.name}-${i}`}
            role="listitem"
            className="flex items-start justify-between gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/60 transition-colors"
          >
            <span className="flex items-start gap-2 min-w-0 flex-1">
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-border/60"
                style={{ backgroundColor: sliceFill(i) }}
                aria-hidden
              />
              <span className="truncate text-sm font-medium leading-tight" title={slice.name}>
                {slice.name}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs tabular-nums leading-tight">
              <span className="block text-foreground">{secondary}</span>
              <span className="block text-muted-foreground">{primary}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
