import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { Card, Chip, EmptyState, Select, TopBar } from "@/redesign/ui";
import { HelpButton, KvRow, PageBody, PortfolioSwitcher, signedPct, toneOf } from "./mobileChrome";

const RANGES = [
  { v: "1m", label: "1M" },
  { v: "6m", label: "6M" },
  { v: "ytd", label: "YTD" },
  { v: "1y", label: "1R" },
  { v: "all", label: "Všetko" },
] as const;

type RangeVal = (typeof RANGES)[number]["v"];

interface HistoryPoint {
  date: string;
  totalValue: number;
  netInvested: number;
  portfolioCumulativePct: number;
  sp500CumulativePct: number;
}

interface PortfolioHistoryRes {
  points: HistoryPoint[];
  methodNote?: string;
}

export default function GrafyMobile() {
  const { formatCurrency, currency } = useCurrency();
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId, getQueryParam, isAllPortfolios, selectedPortfolio, isLoading } =
    usePortfolio();
  const { hideAmounts } = useChartSettings();
  const [range, setRange] = useState<RangeVal>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const portfolioParam = getQueryParam();
  const mask = (value: string) => (hideAmounts ? "••••••" : value);
  const overline = isAllPortfolios ? "Všetky portfóliá" : selectedPortfolio?.name ?? "Portfólio";

  const { data: history, isLoading: histLoading, error } = useQuery<PortfolioHistoryRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, range, currency],
    queryFn: async () => {
      const params = new URLSearchParams({ portfolio: portfolioParam, range });
      const res = await fetch(`/api/portfolio-history?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("História zlyhala");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: athHistory } = useQuery<PortfolioHistoryRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, "all", currency, "ath-info"],
    queryFn: async () => {
      const params = new URLSearchParams({ portfolio: portfolioParam, range: "all" });
      const res = await fetch(`/api/portfolio-history?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("ATH história zlyhala");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const points = history?.points ?? [];
  const last = points[points.length - 1];
  const inProfit = last ? last.totalValue + 1e-6 >= last.netInvested : true;
  const athPoint = useMemo(() => {
    const src = athHistory?.points ?? [];
    return src.reduce<(typeof src)[number] | null>((best, point) => {
      if (!best || point.totalValue > best.totalValue) return point;
      return best;
    }, null);
  }, [athHistory?.points]);

  const axis = { fontSize: 10, fill: "var(--rd-text-tertiary)" };

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline={overline} title="Grafy" onOverlineClick={() => setPickerOpen(true)} />
      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <PageBody>
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 text-xs leading-4 text-[var(--rd-text-secondary)]">
            Časové série hodnoty portfólia a porovnanie výkonu s indexom S&P 500.
          </p>
          <HelpButton
            title="Stránka Grafy"
            body="Časové série hodnoty portfólia a porovnanie výkonu s indexom S&P 500. Metodika zodpovedá TWR (oceňovanie MTM, vklady a výbery ako toky)."
          />
        </div>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Zobrazenie</p>
              <HelpButton
                title="Filtre grafu"
                body="Portfólio určuje, ktoré transakcie sa zarátajú do série. Obdobie skracuje časovú os. Výber portfólia je zdieľaný s ostatnými obrazovkami."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">Vyberte portfólio a časové obdobie.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium leading-4 text-[var(--rd-text-secondary)]">Portfólio</p>
              <HelpButton title="Výber portfólia" body="Jedno portfólio alebo agregácia všetkých. Rovnaká voľba ako v hornom prepínači." />
            </div>
            <Select
              value={selectedPortfolioId || "all"}
              onChange={(id) => setSelectedPortfolioId(id)}
              options={[
                { value: "all", label: "Všetky portfóliá" },
                ...portfolios.map((portfolio) => ({ value: portfolio.id, label: portfolio.name })),
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium leading-4 text-[var(--rd-text-secondary)]">Obdobie</p>
              <HelpButton title="Časové obdobie" body="Rozsah dát na osi X. YTD je od 1. januára bežného roka." />
            </div>
            <div className="flex flex-wrap gap-1">
              {RANGES.map((option) => (
                <Chip key={option.v} active={range === option.v} onClick={() => setRange(option.v)}>
                  {option.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 text-xs leading-4 text-[var(--rd-text-tertiary)]">
              {history?.methodNote || "Dáta z rovnakého oceňovania a tokov (MTM, vklady/výbery) ako TWR."}
            </p>
            <HelpButton title="Poznámka k metodike" body="Stručné vysvetlenie výpočtu z backendu pre zobrazenú sériu a menu." />
          </div>
        </Card>

        {error ? (
          <EmptyState title="História sa nenačítala" body="Skontrolujte pripojenie a skúste znova." />
        ) : null}

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Celková hodnota vs. investované</p>
              <HelpButton
                title="Hodnota vs. čisté vklady"
                body="Krivka je denná trhová hodnota. Schodík sú kumulatívne čisté vklady mínus výbery. Farba plochy závisí od toho, či je hodnota nad touto čiarou."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              Plocha pod krivkou: farba podľa zisku oproti tokom. Schodíky = čisté vklady mínus výbery.
            </p>
          </div>
          <div className="h-40 w-full">
            {histLoading || isLoading ? (
              <p className="text-xs text-[var(--rd-text-tertiary)]">Načítavam graf…</p>
            ) : points.length === 0 ? (
              <p className="text-xs text-[var(--rd-text-secondary)]">Nedostatok dát v zvolenom rozsahu.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rd-value-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={inProfit ? "var(--rd-profit)" : "var(--rd-loss)"} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={inProfit ? "var(--rd-profit)" : "var(--rd-loss)"} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--rd-border-subtle)" vertical={false} />
                  <XAxis dataKey="date" tick={axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={28} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <RTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as HistoryPoint;
                      return (
                        <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-2 text-xs">
                          <p>{row.date}</p>
                          <p>Hodnota: {mask(formatCurrency(row.totalValue))}</p>
                          <p>Čisté vklady: {mask(formatCurrency(row.netInvested))}</p>
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="totalValue" stroke="var(--rd-profit)" strokeWidth={2} fill="url(#rd-value-fill)" />
                  <Line type="stepAfter" dataKey="netInvested" stroke="var(--rd-chart-6)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex gap-3 text-xs text-[var(--rd-text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-profit)]" /> Trhová hodnota
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-chart-6)]" /> Čisté vklady
            </span>
          </div>
          <div className="h-px w-full bg-[var(--rd-border-subtle)]" />
          <KvRow
            label="ATH portfólia"
            value={athPoint ? format(parseISO(athPoint.date), "d. MMM yyyy", { locale: sk }) : "Nedostatok dát"}
          />
        </Card>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Výkon v % oproti S&P 500</p>
              <HelpButton
                title="Kumulatívny výnos v %"
                body="Obe krivky začínajú na 0 % v prvý deň rozsahu. Portfólio je TWR, index je vývoj uzávierok ^GSPC."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              Obe krivky začínajú na 0 % v prvý deň zobrazeného rozsahu.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Portfólio</p>
              <p
                className={`rd-type-data-lg font-medium ${
                  toneOf(last?.portfolioCumulativePct ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]"
                }`}
              >
                {last ? signedPct(last.portfolioCumulativePct) : "—"}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">S&P 500</p>
              <p className="rd-type-data-lg font-medium text-[var(--rd-chart-benchmark)]">
                {last ? signedPct(last.sp500CumulativePct) : "—"}
              </p>
            </div>
          </div>
          <div className="h-36 w-full">
            {points.length < 2 ? (
              <p className="text-xs text-[var(--rd-text-secondary)]">Nedostatok dát pre porovnanie v %.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--rd-border-subtle)" vertical={false} />
                  <XAxis dataKey="date" tick={axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={28} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <RTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as HistoryPoint;
                      return (
                        <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-2 text-xs">
                          <p>{row.date}</p>
                          <p>Portfólio: {signedPct(row.portfolioCumulativePct)}</p>
                          <p>S&P 500: {signedPct(row.sp500CumulativePct)}</p>
                        </div>
                      );
                    }}
                  />
                  <Line dataKey="portfolioCumulativePct" stroke="var(--rd-profit)" strokeWidth={2} dot={false} />
                  <Line dataKey="sp500CumulativePct" stroke="var(--rd-chart-benchmark)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex gap-3 text-xs text-[var(--rd-text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-profit)]" /> Portfólio (TWR)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-chart-benchmark)]" /> S&P 500 (^GSPC)
            </span>
          </div>
        </Card>
      </PageBody>
    </div>
  );
}
