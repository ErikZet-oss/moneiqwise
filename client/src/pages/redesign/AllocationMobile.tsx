import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { Holding } from "@shared/schema";
import { CASH_INTEREST_DISPLAY_NAME, CASH_INTEREST_TICKER } from "@shared/tickerCurrency";
import { isPokemonTicker, POKEMON_GROUP_TICKER } from "@shared/pokemonTcg";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button, Card, Chip, EmptyState, Select, TopBar } from "@/redesign/ui";
import { CHART_COLORS, PageBody, PortfolioSwitcher } from "./mobileChrome";

type AssetType = "AKCIA" | "ETF" | "KRYPTO" | "DLHOPIS" | "KOMODITA" | "FOND" | "HOTOVOST" | "INE";
type Slice = { name: string; value: number };
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
];

const COUNTRY_OPTIONS = ["USA", "Európa", "Ázia", "Južná Amerika"];

function aggregate(rows: Slice[]): Slice[] {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.name, (map.get(row.name) ?? 0) + row.value);
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

function DonutCard({
  title,
  subtitle,
  slices,
  total,
  mode,
  formatCurrency,
  mask,
}: {
  title: string;
  subtitle: string;
  slices: Slice[];
  total: number;
  mode: "percent" | "value";
  formatCurrency: (n: number) => string;
  mask: (s: string) => string;
}) {
  const top = slices.slice(0, 5);
  const rest = slices.slice(5).reduce((sum, slice) => sum + slice.value, 0);
  const chart = rest > 0 ? [...top, { name: "Ostatné", value: rest }] : top;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? slices : chart;
  const pct = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const label = (value: number) =>
    mode === "percent" ? `${pct(value)}%` : mask(formatCurrency(value));

  return (
    <Card className="gap-2">
      <div className="flex flex-col gap-1">
        <p className="rd-type-h2">{title}</p>
        <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{subtitle}</p>
      </div>
      {chart.length === 0 ? (
        <p className="text-xs text-[var(--rd-text-secondary)]">Zatiaľ nie je čo rozložiť.</p>
      ) : (
        <>
          <div className="flex w-full items-start justify-center">
            <div className="relative size-[148px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chart} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
                    {chart.map((slice, index) => (
                      <Cell key={slice.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--rd-text-tertiary)]">
                  Celkom
                </p>
                <p className="font-mono text-[11px] font-medium leading-[14px] text-[var(--rd-text-primary)]">
                  {mask(formatCurrency(total))}
                </p>
              </div>
            </div>
          </div>
          <ul className="flex w-full flex-col gap-2">
            {visible.map((slice, index) => {
              const color = CHART_COLORS[index % CHART_COLORS.length];
              const widthPct = pct(slice.value);
              return (
                <li key={slice.name} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <i className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="min-w-0 flex-1 truncate text-[11px] leading-[14px] text-[var(--rd-text-secondary)]">
                      {slice.name}
                    </span>
                    <span className="font-mono text-[11px] font-medium leading-[14px] text-[var(--rd-text-primary)]">
                      {label(slice.value)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--rd-bg-surface-hover)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, widthPct))}%`, background: color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {slices.length > 5 ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="self-start text-[13px] font-medium text-[var(--rd-profit)]"
        >
          {expanded ? "Zobraziť menej" : `+${slices.length - 5} ďalších`}
        </button>
      ) : null}
    </Card>
  );
}

export default function AllocationMobile() {
  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
  const { toast } = useToast();
  const { portfolios, selectedPortfolio, isAllPortfolios, getQueryParam, isLoading } = usePortfolio();
  const { hideAmounts } = useChartSettings();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<"percent" | "value">("percent");
  const [editorRows, setEditorRows] = useState<Record<string, EditorRow>>({});
  const portfolioParam = getQueryParam();
  const mask = (value: string) => (hideAmounts ? "••••••" : value);
  const overline = isAllPortfolios ? "Všetky portfóliá" : selectedPortfolio?.name ?? "Portfólio";

  const { data: holdings, isLoading: holdingsLoading } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${portfolioParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
  });

  const { data: quotes } = useQuery<Record<string, { ticker: string; price: number }>>({
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
      return data.quotes;
    },
  });

  const equityTickers = useMemo(() => {
    if (!holdings?.length) return [];
    return Array.from(new Set(holdings.map((h) => h.ticker.toUpperCase()).filter((t) => t !== "CASH"))).sort();
  }, [holdings]);

  const { data: profilesData } = useQuery({
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
      return res.json() as Promise<{ profiles: Record<string, { sector: string; country: string; assetType: AssetType }> }>;
    },
  });

  const { data: userMetadataData } = useQuery({
    queryKey: ["/api/stocks/metadata", equityTickers.join(",")],
    enabled: equityTickers.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ tickers: equityTickers.join(",") });
      const res = await fetch(`/api/stocks/metadata?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Metadata failed");
      return res.json() as Promise<{ metadata: Record<string, { sector: string | null; country: string | null; assetType: AssetType | null }> }>;
    },
  });

  const profiles = profilesData?.profiles ?? {};
  const userMetadata = userMetadataData?.metadata ?? {};

  useEffect(() => {
    const next: Record<string, EditorRow> = {};
    for (const ticker of equityTickers) {
      const meta = userMetadata[ticker];
      next[ticker] = { sector: meta?.sector ?? "", country: meta?.country ?? "", assetType: meta?.assetType ?? "" };
    }
    setEditorRows(next);
  }, [equityTickers, userMetadataData]);

  const saveMetadata = useMutation({
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
      toast({ title: "Uložené", description: "Metadáta aktív boli uložené." });
    },
    onError: (err: Error) => {
      toast({ title: "Chyba", description: err.message || "Nepodarilo sa uložiť metadáta aktíva.", variant: "destructive" });
    },
  });

  const cashValue = useMemo(() => {
    if (isAllPortfolios) {
      return portfolios.reduce((sum, portfolio) => sum + convertPrice(parseFloat(portfolio.cashBalance ?? "0") || 0, "EUR"), 0);
    }
    return convertPrice(parseFloat(selectedPortfolio?.cashBalance ?? "0") || 0, "EUR");
  }, [isAllPortfolios, portfolios, selectedPortfolio, convertPrice]);

  const groups = useMemo(() => {
    const sectorRows: Slice[] = [];
    const countryRows: Slice[] = [];
    const typeRows: Slice[] = [];
    const tickerValues = new Map<string, number>();
    let total = cashValue > 0.005 ? cashValue : 0;
    if (cashValue > 0.005) {
      tickerValues.set("Hotovosť", cashValue);
      sectorRows.push({ name: "Hotovosť", value: cashValue });
      countryRows.push({ name: "—", value: cashValue });
      typeRows.push({ name: "Hotovosť", value: cashValue });
    }
    for (const holding of holdings ?? []) {
      const key = holding.ticker.toUpperCase();
      const shares = parseFloat(holding.shares);
      if (!Number.isFinite(shares) || shares <= 0 || key === "CASH") continue;
      const quote = quotes?.[holding.ticker] ?? quotes?.[key];
      const pokemon = isPokemonTicker(key);
      if (!quote && !pokemon) continue;
      const price = quote?.price ?? (Number.isFinite(parseFloat(holding.averageCost)) ? parseFloat(holding.averageCost) : 0);
      if (!(price > 0)) continue;
      const value = convertPrice(shares * price, getTickerCurrency(holding.ticker));
      total += value;
      const name =
        key === CASH_INTEREST_TICKER
          ? CASH_INTEREST_DISPLAY_NAME
          : pokemon
            ? holding.companyName || "Pokémon TCG"
            : holding.ticker;
      const bucket = isAllPortfolios && pokemon ? POKEMON_GROUP_TICKER : name;
      tickerValues.set(bucket, (tickerValues.get(bucket) ?? 0) + value);
      const profile = profiles[key] ?? profiles[holding.ticker] ?? { sector: "Neznáme", country: "Neznáme", assetType: "AKCIA" as AssetType };
      sectorRows.push({ name: profile.sector || "Neznáme", value });
      countryRows.push({ name: profile.country || "Neznáme", value });
      typeRows.push({ name: ASSET_TYPE_LABELS[profile.assetType] ?? "Iné", value });
    }
    return {
      total,
      byTicker: Array.from(tickerValues.entries()).map(([name, value]) => ({ name: name === POKEMON_GROUP_TICKER ? "Pokémon TCG" : name, value })).sort((a, b) => b.value - a.value),
      bySector: aggregate(sectorRows),
      byCountry: aggregate(countryRows),
      byType: aggregate(typeRows),
    };
  }, [holdings, quotes, profiles, cashValue, convertPrice, getTickerCurrency, isAllPortfolios]);

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline={overline} title="Rozloženie" onOverlineClick={() => setPickerOpen(true)} />
      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Podľa tickerov, sektorov, krajín a typu aktíva. Sektor, krajinu a typ vieš manuálne prepísať nižšie.
        </p>
        <div className="flex gap-1">
          <Chip active={mode === "percent"} onClick={() => setMode("percent")}>
            Percentá
          </Chip>
          <Chip active={mode === "value"} onClick={() => setMode("value")}>
            {`Hodnoty (${currency})`}
          </Chip>
        </div>
        {holdingsLoading || isLoading ? (
          <Card>
            <p className="text-sm text-[var(--rd-text-secondary)]">Načítavam rozloženie…</p>
          </Card>
        ) : groups.total <= 0 ? (
          <EmptyState
            title="Prázdne rozloženie"
            body="Po nákupe aktív sa tu zobrazia podiely podľa tickeru, sektoru, krajiny a typu."
          />
        ) : (
          <>
            <DonutCard
              title="Podľa akcií"
              subtitle="Každý ticker + hotovosť"
              slices={groups.byTicker}
              total={groups.total}
              mode={mode}
              formatCurrency={formatCurrency}
              mask={mask}
            />
            <DonutCard
              title="Podľa sektorov"
              subtitle="Odvetvie podľa Yahoo"
              slices={groups.bySector}
              total={groups.total}
              mode={mode}
              formatCurrency={formatCurrency}
              mask={mask}
            />
            <DonutCard
              title="Podľa krajín"
              subtitle="Krajina sídla emitenta"
              slices={groups.byCountry}
              total={groups.total}
              mode={mode}
              formatCurrency={formatCurrency}
              mask={mask}
            />
            <DonutCard
              title="Podľa typu"
              subtitle="Akcia, ETF, krypto…"
              slices={groups.byType}
              total={groups.total}
              mode={mode}
              formatCurrency={formatCurrency}
              mask={mask}
            />
          </>
        )}

        {equityTickers.length > 0 ? (
          <Card className="gap-3">
            <div className="flex flex-col gap-1">
              <p className="rd-type-h2">Manuálne metadáta aktív</p>
              <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
                Prepíše sektor, krajinu a typ z Yahoo pre vybraný ticker (prázdne = použije sa Yahoo).
              </p>
            </div>
            <Button onClick={() => saveMetadata.mutate(editorRows)} disabled={saveMetadata.isPending}>
              {saveMetadata.isPending ? "Ukladám…" : "Uložiť všetko"}
            </Button>
            {equityTickers.map((ticker) => {
              const row = editorRows[ticker] ?? { sector: "", country: "", assetType: "" as const };
              const set = (patch: Partial<EditorRow>) =>
                setEditorRows((prev) => ({ ...prev, [ticker]: { ...row, ...patch } }));
              return (
                <div key={ticker} className="flex flex-col gap-2 border-t border-[var(--rd-border-subtle)] pt-3">
                  <p className="font-mono text-sm font-medium">{ticker}</p>
                  <Select
                    label="Sektor"
                    value={row.sector || "auto"}
                    onChange={(value) => set({ sector: value === "auto" ? "" : value })}
                    options={[
                      { value: "auto", label: "Automaticky" },
                      ...SECTOR_OPTIONS.map((option) => ({ value: option, label: option })),
                    ]}
                  />
                  <Select
                    label="Krajina"
                    value={row.country || "auto"}
                    onChange={(value) => set({ country: value === "auto" ? "" : value })}
                    options={[
                      { value: "auto", label: "Automaticky" },
                      ...COUNTRY_OPTIONS.map((option) => ({ value: option, label: option })),
                    ]}
                  />
                  <Select
                    label="Typ"
                    value={row.assetType || "auto"}
                    onChange={(value) => set({ assetType: value === "auto" ? "" : (value as AssetType) })}
                    options={[
                      { value: "auto", label: "Automaticky" },
                      ...Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => ({ value, label })),
                    ]}
                  />
                </div>
              );
            })}
          </Card>
        ) : null}
      </PageBody>
    </div>
  );
}
