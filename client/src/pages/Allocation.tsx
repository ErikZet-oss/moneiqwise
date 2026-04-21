import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { PieChartIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import type { Holding } from "@shared/schema";

interface StockQuote {
  ticker: string;
  price: number;
}

type Slice = { name: string; value: number };

const CHART_FILLS = [
  "hsl(142, 76%, 42%)",
  "hsl(0, 72%, 55%)",
  "hsl(220, 70%, 55%)",
  "hsl(280, 62%, 58%)",
  "hsl(32, 88%, 52%)",
  "hsl(175, 58%, 42%)",
  "hsl(340, 72%, 52%)",
  "hsl(48, 92%, 48%)",
  "hsl(204, 78%, 52%)",
  "hsl(268, 58%, 54%)",
];

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

export default function Allocation() {
  const { currency, convertPrice, getTickerCurrency, formatCurrency } = useCurrency();
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
        profiles: Record<string, { sector: string; country: string }>;
      }>;
    },
  });

  const profiles = profilesData?.profiles ?? {};

  const cashValueConv = useMemo(() => {
    if (isAllPortfolios) {
      return portfolios.reduce((sum, p) => {
        const n = parseFloat(p.cashBalance ?? "0");
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
    if (selectedPortfolio) {
      const n = parseFloat(selectedPortfolio.cashBalance ?? "0");
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }, [isAllPortfolios, portfolios, selectedPortfolio]);

  const { byTicker, bySector, byCountry, totalMarket } = useMemo(() => {
    const sectorRows: Slice[] = [];
    const countryRows: Slice[] = [];
    const tickerRows: Slice[] = [];
    let sum = 0;
    let cashTotal = cashValueConv;

    if (holdings === undefined) {
      return {
        byTicker: [] as Slice[],
        bySector: [] as Slice[],
        byCountry: [] as Slice[],
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
              totalMarket: cashTotal,
            }
          : {
              byTicker: [] as Slice[],
              bySector: [] as Slice[],
              byCountry: [] as Slice[],
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

      const pr = profiles[t] ?? { sector: "Neznáme", country: "Neznáme" };
      sectorRows.push({ name: pr.sector, value: conv });
      countryRows.push({ name: pr.country, value: conv });
    }

    if (cashTotal > 0.005) {
      sum += cashTotal;
      tickerRows.push({ name: "Hotovosť", value: cashTotal });
      sectorRows.push({ name: "Hotovosť", value: cashTotal });
      countryRows.push({ name: "—", value: cashTotal });
    }

    return {
      byTicker: aggregateSlices(tickerRows),
      bySector: aggregateSlices(sectorRows),
      byCountry: aggregateSlices(countryRows),
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
      <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
        <div className="font-medium">{name}</div>
        <div className="text-muted-foreground">
          {mask(formatCurrency(value))}
          {" · "}
          {pct.toFixed(1)} %
        </div>
      </div>
    );
  };

  const labelFormatter = (entry: Slice) => {
    if (totalMarket <= 0) return "";
    const pct = (entry.value / totalMarket) * 100;
    if (displayMode === "percent") {
      return pct < 3 ? "" : `${pct.toFixed(0)}%`;
    }
    return pct < 3 ? "" : mask(formatCurrency(entry.value));
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
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PieChartIcon className="h-7 w-7 text-primary" />
            Rozloženie portfólia
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Koláčové grafy podľa akcií, sektorov a krajín (dáta o sektoroch a krajinách z Yahoo
            Finance). Zohľadňuje aktívne portfólium v hornom výbere.
          </p>
        </div>
        <ToggleGroup
          type="single"
          value={displayMode}
          onValueChange={(v) => {
            if (v === "percent" || v === "value") setDisplayMode(v);
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="percent" aria-label="Percentá">
            Percentá
          </ToggleGroupItem>
          <ToggleGroupItem value="value" aria-label="Hodnoty">
            Hodnoty v {currency}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
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
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <AllocationPieCard
            title="Podľa akcií"
            description="Hodnota pozícií podľa tickerov + hotovosť na účte brokera."
            data={byTicker}
            total={totalMarket}
            mask={mask}
            formatCurrency={formatCurrency}
            renderTooltip={renderTooltip}
            labelFormatter={labelFormatter}
          />
          <AllocationPieCard
            title="Podľa sektorov"
            description="Súhrn podľa odvetvia (akcie a ETF podľa Yahoo)."
            data={bySector}
            total={totalMarket}
            mask={mask}
            formatCurrency={formatCurrency}
            renderTooltip={renderTooltip}
            labelFormatter={labelFormatter}
          />
          <AllocationPieCard
            title="Podľa krajín"
            description="Krajina sídla emitenta / burzy podľa Yahoo."
            data={byCountry}
            total={totalMarket}
            mask={mask}
            formatCurrency={formatCurrency}
            renderTooltip={renderTooltip}
            labelFormatter={labelFormatter}
          />
        </div>
      )}
    </div>
  );
}

function AllocationPieCard({
  title,
  description,
  data,
  total,
  mask,
  formatCurrency,
  renderTooltip,
  labelFormatter,
}: {
  title: string;
  description: string;
  data: Slice[];
  total: number;
  mask: (s: string) => string;
  formatCurrency: (n: number) => string;
  renderTooltip: (p: {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number; payload?: Slice }>;
  }) => import("react").ReactNode;
  labelFormatter: (entry: Slice) => string;
}) {
  const chartData = data.map((d) => ({ ...d }));

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-[320px] pt-0">
        {chartData.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            Nedostatok dát
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-2 text-center">
              Celkom: {mask(formatCurrency(total))}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="48%"
                  innerRadius={52}
                  outerRadius={92}
                  paddingAngle={1}
                  labelLine={false}
                  label={(props: Record<string, unknown>) => {
                    const name = props.name as string | undefined;
                    const value = props.value as number | undefined;
                    const entry = chartData.find((x) => x.name === name && x.value === value);
                    if (!entry) return null;
                    return labelFormatter(entry);
                  }}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={CHART_FILLS[i % CHART_FILLS.length]} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip content={renderTooltip} />
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  formatter={(value) => (
                    <span className="text-xs truncate max-w-[120px] inline-block">{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
}
