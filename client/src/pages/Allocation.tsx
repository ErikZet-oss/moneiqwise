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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useToast } from "@/hooks/use-toast";
import type { Holding } from "@shared/schema";
import { CASH_INTEREST_DISPLAY_NAME, CASH_INTEREST_TICKER } from "@shared/tickerCurrency";
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

/** Krátky ticker s burzovou príponou; celý názov emitenta je v `hint` (tooltip). */
function allocationAssetLabel(holding: Holding): { name: string; hint?: string } {
  const ticker = holding.ticker.trim();
  const tickerUpper = ticker.toUpperCase();
  const company = (holding.companyName || "").trim();

  if (tickerUpper === "CASH") return { name: "Hotovosť" };
  if (tickerUpper === CASH_INTEREST_TICKER) return { name: CASH_INTEREST_DISPLAY_NAME };

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

      if (!quote) continue;
      const tc = getTickerCurrency(h.ticker);
      const rawVal = shares * quote.price;
      const conv = convertPrice(rawVal, tc);
      sum += conv;

      tickerValues.set(tickerKey, (tickerValues.get(tickerKey) ?? 0) + conv);

      const pr =
        profiles[tickerKey] ??
        profiles[h.ticker] ??
        { sector: "Neznáme", country: "Neznáme", assetType: "AKCIA" as AssetType };
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
  ]);

  const renderTooltip = (props: {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number; payload?: Slice }>;
  }) => {
    if (!props.active || !props.payload?.length) return null;
    const row = props.payload[0];
    const name = row.name ?? row.payload?.name;
    const hint = row.payload?.hint;
    const value = row.value ?? row.payload?.value ?? 0;
    const pct = totalMarket > 0 ? (value / totalMarket) * 100 : 0;
    return (
      <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg">
        <div className="font-medium">{hint ? `${name} — ${hint}` : name}</div>
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
    <div className="flex flex-col gap-3 md:gap-6 max-w-7xl mx-auto pb-10 -mx-6 px-0 md:mx-auto md:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-2.5 md:px-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <PieChartIcon className="h-6 w-6 md:h-7 md:w-7 text-primary" />
            Rozloženie portfólia
          </h1>
          <p className="text-muted-foreground text-xs mt-1">
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
        <div className="grid gap-3 md:gap-6 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="p-2.5 md:p-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full mt-2" />
              </CardHeader>
              <CardContent className="p-2.5 pt-0 md:p-4 md:pt-0">
                <Skeleton className="h-[280px] w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : empty ? (
        <Card>
          <CardContent className="py-8 md:py-12 px-2.5 md:px-6 text-center text-muted-foreground">
            Žiadne pozície ani hotovosť na zobrazenie rozloženia.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:gap-6 md:grid-cols-2 xl:grid-cols-4">
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
        <CardHeader className="p-2.5 md:p-4">
          <CardTitle className="text-sm font-medium">Manuálne metadáta aktív</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Prepíše sektor, krajinu a typ z Yahoo pre vybraný ticker (necháš prázdne = použije sa Yahoo).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-2.5 pt-0 md:p-4 md:pt-0">
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
                    className="grid gap-2 rounded-md border p-2.5 md:p-3 sm:grid-cols-[120px_1fr_1fr_170px] sm:items-center"
                  >
                    <div className="font-medium">{ticker}</div>
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
  const [showAllLegendItems, setShowAllLegendItems] = useState(false);
  const chartData = data.map((d) => ({ ...d }));

  const innerR = narrow ? "44%" : "48%";
  const outerR = narrow ? "88%" : "88%";
  const mobileLegendLimit = denseLegend ? 10 : 8;
  const hasMoreLegendItems = narrow && chartData.length > mobileLegendLimit;
  const visibleLegendSlices =
    narrow && !showAllLegendItems ? chartData.slice(0, mobileLegendLimit) : chartData;

  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden border-border/80 shadow-sm",
        "bg-card/80 backdrop-blur-[2px]"
      )}
    >
      <CardHeader className="p-2 md:p-4 pb-1.5 space-y-0.5">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-[11px] md:text-sm leading-snug">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 md:gap-4 p-2 pt-0 md:p-4 md:pt-0 pb-3 md:pb-6">
        {chartData.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Nedostatok dát
          </div>
        ) : (
          <>
            <div className="text-center">
              <span className="text-[10px] md:text-[11px] uppercase tracking-wide text-muted-foreground">
                Celkom
              </span>
              <div className="text-base md:text-2xl font-semibold tabular-nums leading-tight tracking-tight">
                {mask(formatCurrency(total))}
              </div>
            </div>

            <div className="flex justify-center w-full min-w-0 -mx-0.5">
              <div
                className={cn(
                  "w-full aspect-square max-h-[min(68vw,240px)] sm:max-w-[320px] sm:max-h-[300px]",
                  !chartReady && "opacity-0 pointer-events-none"
                )}
              >
                {chartReady ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={160} minHeight={160}>
                    <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
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
              slices={visibleLegendSlices}
              total={total}
              displayMode={displayMode}
              mask={mask}
              formatCurrency={formatCurrency}
              dense={denseLegend}
            />
            {hasMoreLegendItems && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => setShowAllLegendItems((prev) => !prev)}
                >
                  {showAllLegendItems
                    ? "Zobraziť menej"
                    : `Zobraziť viac (${chartData.length - mobileLegendLimit})`}
                </Button>
              </div>
            )}
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
  const narrow = useIsNarrowScreen();

  return (
    <div
      className={cn(
        "rounded-lg border border-border/70 bg-muted/25",
        narrow ? "px-1 py-1 space-y-0" : "rounded-xl px-1.5 py-2 sm:px-3 space-y-1",
      )}
      role="list"
    >
      {slices.map((slice, i) => {
        const pct = total > 0 ? (slice.value / total) * 100 : 0;
        const valueStr = mask(formatCurrency(slice.value));
        const pctStr = `${pct.toFixed(1)} %`;

        if (narrow) {
          return (
            <div
              key={`${slice.name}-${i}`}
              role="listitem"
              className="flex items-center gap-1.5 rounded px-1 py-0.5 min-h-[22px]"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-sm ring-1 ring-border/50"
                style={{ backgroundColor: sliceFill(i) }}
                aria-hidden
              />
              <span
                className="min-w-0 flex-1 truncate text-[11px] font-medium leading-none"
                title={slice.hint ? `${slice.name} — ${slice.hint}` : slice.name}
              >
                {slice.name}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums leading-none whitespace-nowrap">
                <span className={displayMode === "value" ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {valueStr}
                </span>
                <span className="text-muted-foreground/80 mx-0.5">·</span>
                <span className={displayMode === "percent" ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {pctStr}
                </span>
              </span>
            </div>
          );
        }

        return (
          <div
            key={`${slice.name}-${i}`}
            role="listitem"
            className={cn(
              "flex items-center justify-between gap-2 rounded-md hover:bg-muted/60 transition-colors",
              dense ? "px-1.5 py-1" : "px-1.5 py-1.5",
            )}
          >
            <span className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-border/60"
                style={{ backgroundColor: sliceFill(i) }}
                aria-hidden
              />
              <span
                className="truncate text-sm font-medium leading-tight"
                title={slice.hint ? `${slice.name} — ${slice.hint}` : slice.name}
              >
                {slice.name}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs tabular-nums leading-tight whitespace-nowrap">
              <span className={displayMode === "value" ? "text-foreground font-medium" : "text-muted-foreground"}>
                {valueStr}
              </span>
              <span className="text-muted-foreground/70 mx-1">·</span>
              <span className={displayMode === "percent" ? "text-foreground font-medium" : "text-muted-foreground"}>
                {pctStr}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
