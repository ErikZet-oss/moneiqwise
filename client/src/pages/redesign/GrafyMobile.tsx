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
  { v: "all", label: "VĹˇetko" },
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
  const mask = (value: string) => (hideAmounts ? "â€˘â€˘â€˘â€˘â€˘â€˘" : value);
  const overline = isAllPortfolios ? "VĹˇetky portfĂłliĂˇ" : selectedPortfolio?.name ?? "PortfĂłlio";

  const { data: history, isLoading: histLoading, error } = useQuery<PortfolioHistoryRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, range, currency],
    queryFn: async () => {
      const params = new URLSearchParams({ portfolio: portfolioParam, range });
      const res = await fetch(`/api/portfolio-history?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("HistĂłria zlyhala");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: athHistory } = useQuery<PortfolioHistoryRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, "all", currency, "ath-info"],
    queryFn: async () => {
      const params = new URLSearchParams({ portfolio: portfolioParam, range: "all" });
      const res = await fetch(`/api/portfolio-history?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("ATH histĂłria zlyhala");
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
    <div>
      <TopBar overline={overline} title="Grafy" onOverlineClick={() => setPickerOpen(true)} />
      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <PageBody>
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-xs leading-4 text-[var(--rd-text-secondary)]">
            ÄŚasovĂ© sĂ©rie hodnoty portfĂłlia a porovnanie vĂ˝konu s indexom S&P 500.
          </p>
          <HelpButton
            title="StrĂˇnka Grafy"
            body="ÄŚasovĂ© sĂ©rie hodnoty portfĂłlia a porovnanie vĂ˝konu s indexom S&P 500. Metodika zodpovedĂˇ TWR (oceĹovanie MTM, vklady a vĂ˝bery ako toky)."
          />
        </div>

        <Card>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 rd-type-h2">Zobrazenie</p>
            <HelpButton
              title="Filtre grafu"
              body="PortfĂłlio urÄŤuje, ktorĂ© transakcie sa zarĂˇtajĂş do sĂ©rie. Obdobie skracuje ÄŤasovĂş os. VĂ˝ber portfĂłlia je zdieÄľanĂ˝ s ostatnĂ˝mi obrazovkami."
            />
          </div>
          <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">Vyberte portfĂłlio a ÄŤasovĂ© obdobie.</p>
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-[var(--rd-text-secondary)]">PortfĂłlio</p>
            <HelpButton title="VĂ˝ber portfĂłlia" body="Jedno portfĂłlio alebo agregĂˇcia vĹˇetkĂ˝ch. RovnakĂˇ voÄľba ako v hornom prepĂ­naÄŤi." />
          </div>
          <Select
            value={selectedPortfolioId || "all"}
            onChange={(id) => setSelectedPortfolioId(id)}
            options={[
              { value: "all", label: "VĹˇetky portfĂłliĂˇ" },
              ...portfolios.map((portfolio) => ({ value: portfolio.id, label: portfolio.name })),
            ]}
          />
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-[var(--rd-text-secondary)]">Obdobie</p>
            <HelpButton title="ÄŚasovĂ© obdobie" body="Rozsah dĂˇt na osi X. YTD je od 1. januĂˇra beĹľnĂ©ho roka." />
          </div>
          <div className="flex flex-wrap gap-1">
            {RANGES.map((option) => (
              <Chip key={option.v} active={range === option.v} onClick={() => setRange(option.v)}>
                {option.label}
              </Chip>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-xs leading-4 text-[var(--rd-text-tertiary)]">
              {history?.methodNote || "DĂˇta z rovnakĂ©ho oceĹovania a tokov (MTM, vklady/vĂ˝bery) ako TWR."}
            </p>
            <HelpButton title="PoznĂˇmka k metodike" body="StruÄŤnĂ© vysvetlenie vĂ˝poÄŤtu z backendu pre zobrazenĂş sĂ©riu a menu." />
          </div>
        </Card>

        {error ? (
          <EmptyState title="HistĂłria sa nenaÄŤĂ­tala" body="Skontrolujte pripojenie a skĂşste znova." />
        ) : null}

        <Card>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 rd-type-h2">CelkovĂˇ hodnota vs. investovanĂ©</p>
            <HelpButton
              title="Hodnota vs. ÄŤistĂ© vklady"
              body="Krivka je dennĂˇ trhovĂˇ hodnota. SchodĂ­k sĂş kumulatĂ­vne ÄŤistĂ© vklady mĂ­nus vĂ˝bery. Farba plochy zĂˇvisĂ­ od toho, ÄŤi je hodnota nad touto ÄŤiarou."
            />
          </div>
          <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
            Plocha pod krivkou: farba podÄľa zisku oproti tokom. SchodĂ­ky = ÄŤistĂ© vklady mĂ­nus vĂ˝bery.
          </p>
          <div className="h-40 w-full">
            {histLoading || isLoading ? (
              <p className="text-xs text-[var(--rd-text-tertiary)]">NaÄŤĂ­tavam grafâ€¦</p>
            ) : points.length === 0 ? (
              <p className="text-xs text-[var(--rd-text-secondary)]">Nedostatok dĂˇt v zvolenom rozsahu.</p>
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
                          <p>ÄŚistĂ© vklady: {mask(formatCurrency(row.netInvested))}</p>
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
          <div className="flex gap-4 text-xs text-[var(--rd-text-secondary)]">
            <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--rd-profit)]" /> TrhovĂˇ hodnota</span>
            <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--rd-chart-6)]" /> ÄŚistĂ© vklady</span>
          </div>
          <div className="h-px w-full bg-[var(--rd-border-subtle)]" />
          <KvRow
            label="ATH portfĂłlia"
            value={
              athPoint
                ? format(parseISO(athPoint.date), "d. MMM yyyy", { locale: sk })
                : "Nedostatok dĂˇt"
            }
          />
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 rd-type-h2">VĂ˝kon v % oproti S&P 500</p>
            <HelpButton
              title="KumulatĂ­vny vĂ˝nos v %"
              body="Obe krivky zaÄŤĂ­najĂş na 0 % v prvĂ˝ deĹ rozsahu. PortfĂłlio je TWR, index je vĂ˝voj uzĂˇvierok ^GSPC."
            />
          </div>
          <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
            Obe krivky zaÄŤĂ­najĂş na 0 % v prvĂ˝ deĹ zobrazenĂ©ho rozsahu.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">PortfĂłlio</p>
              <p className={`rd-type-data-lg font-medium ${toneOf(last?.portfolioCumulativePct ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]"}`}>
                {last ? signedPct(last.portfolioCumulativePct) : "â€”"}
              </p>
            </div>
            <div>
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">S&P 500</p>
              <p className="rd-type-data-lg font-medium text-[var(--rd-warning)]">
                {last ? signedPct(last.sp500CumulativePct) : "â€”"}
              </p>
            </div>
          </div>
          <div className="h-36 w-full">
            {points.length < 2 ? (
              <p className="text-xs text-[var(--rd-text-secondary)]">Nedostatok dĂˇt pre porovnanie v %.</p>
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
                          <p>PortfĂłlio: {signedPct(row.portfolioCumulativePct)}</p>
                          <p>S&P 500: {signedPct(row.sp500CumulativePct)}</p>
                        </div>
                      );
                    }}
                  />
                  <Line dataKey="portfolioCumulativePct" stroke="var(--rd-profit)" strokeWidth={2} dot={false} />
                  <Line dataKey="sp500CumulativePct" stroke="var(--rd-warning)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex gap-4 text-xs text-[var(--rd-text-secondary)]">
            <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--rd-profit)]" /> PortfĂłlio (TWR)</span>
            <span className="inline-flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--rd-warning)]" /> S&P 500 (^GSPC)</span>
          </div>
        </Card>
      </PageBody>
    </div>
  );
}
