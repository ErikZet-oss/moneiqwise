import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Avatar, Card, Chip, Dialog, EmptyState, StatTile, TopBar, type StatTone } from "@/redesign/ui";
import { PageBody, signedMoney, signedPct, toneOf } from "./mobileChrome";

function statTone(value: number): StatTone {
  const t = toneOf(value);
  return t === "up" ? "Up" : t === "down" ? "Down" : "Neutral";
}

const PROFIT_PORTFOLIOS_KEY = "moneiqwise.profit.portfolios";

type YearRow = {
  year: number;
  profit: number;
  simpleReturnPct: number | null;
  twrPct: number | null;
  sp500Pct: number | null;
};

type PerformanceResponse = {
  years: YearRow[];
  totals: { avgAnnualSimplePct?: number | null; yearsSpan?: number | null } | null;
};

type RealizedResponse = {
  totalRealizedEur: number;
  byTicker?: Array<{
    ticker: string;
    companyName?: string | null;
    realizedEur: number;
    realizedPct?: number | null;
    sellCount?: number;
    shares?: number;
  }>;
  todayEur?: number;
  monthEur?: number;
  ytdEur?: number;
};

function readStoredIds(): string[] | null {
  try {
    const raw = localStorage.getItem(PROFIT_PORTFOLIOS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export default function ProfitMobile() {
  const { formatCurrency: formatCurrencyRaw } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const { portfolios } = usePortfolio();
  const formatCurrency = (n: number) => (hideAmounts ? "••••••" : formatCurrencyRaw(n));
  const visibleIds = useMemo(() => portfolios.map((p) => p.id), [portfolios]);
  const [appliedIds, setAppliedIds] = useState<string[]>(() => readStoredIds() ?? []);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<"simple" | "twr">("simple");

  useEffect(() => {
    if (visibleIds.length === 0) return;
    setAppliedIds((prev) => {
      const base = prev.length > 0 ? prev : readStoredIds() ?? visibleIds;
      const pruned = base.filter((id) => visibleIds.includes(id));
      return pruned.length > 0 ? pruned : visibleIds;
    });
  }, [visibleIds]);

  useEffect(() => {
    if (appliedIds.length === 0) return;
    try {
      localStorage.setItem(PROFIT_PORTFOLIOS_KEY, JSON.stringify(appliedIds));
    } catch {
      /* ignore */
    }
  }, [appliedIds]);

  const allSelected = appliedIds.length === visibleIds.length && visibleIds.length > 0;
  const portfolioParam = allSelected ? "all" : appliedIds.join(",");
  const label = allSelected
    ? "Všetky portfóliá"
    : appliedIds.length === 1
      ? portfolios.find((p) => p.id === appliedIds[0])?.name || "Portfólio"
      : `${appliedIds.length} portfóliá`;

  const { data: perf, isPending } = useQuery<PerformanceResponse>({
    queryKey: ["/api/portfolio-performance", portfolioParam, "v7-twr-spx"],
    queryFn: async () => {
      const res = await fetch(`/api/portfolio-performance?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("performance");
      return res.json();
    },
    enabled: appliedIds.length > 0,
  });

  const { data: realized } = useQuery<RealizedResponse>({
    queryKey: ["/api/realized-gains", portfolioParam, "v5-by-portfolio"],
    queryFn: async () => {
      const res = await fetch(`/api/realized-gains?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("realized");
      return res.json();
    },
    enabled: appliedIds.length > 0,
  });

  const years = perf?.years ?? [];
  const avg = perf?.totals?.avgAnnualSimplePct;

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar
        overline={label}
        title="Analýza zisku"
        onOverlineClick={() => {
          setDraftIds(appliedIds);
          setPickerOpen(true);
        }}
      />
      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Výkonnosť podľa rokov a mesiacov. Ročný prehľad s porovnaním voči S&P 500.
        </p>
        <div className="flex gap-1">
          <Chip active={mode === "simple"} onClick={() => setMode("simple")}>
            Jednoduchý %
          </Chip>
          <Chip active={mode === "twr"} onClick={() => setMode("twr")}>
            TWR %
          </Chip>
        </div>

        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rd-text-tertiary)]">
            Priemerné ročné zhodnotenie
          </p>
          <p className="mt-2 font-mono text-[28px] font-bold leading-[34px] text-[var(--rd-profit)]">
            {avg != null ? signedPct(avg) : "—"}
          </p>
          <p className="mt-1 text-xs text-[var(--rd-text-tertiary)]">
            p.a. za {perf?.totals?.yearsSpan != null ? `${perf.totals.yearsSpan.toFixed(1)} r.` : "—"}
          </p>
        </Card>

        {isPending ? (
          <p className="text-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
        ) : years.length === 0 ? (
          <EmptyState title="Zatiaľ bez výkonnosti" body="Pridaj transakcie alebo vyber iné portfólio." />
        ) : (
          <Card className="gap-0 p-0">
            <div className="grid grid-cols-[1fr_1.1fr_0.8fr_0.8fr] gap-2 border-b border-[var(--rd-border-subtle)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--rd-text-tertiary)]">
              <span>Obdobie</span>
              <span className="text-right">Zisk</span>
              <span className="text-right">%</span>
              <span className="text-right">S&P %</span>
            </div>
            {years.map((row) => {
              const pct = mode === "twr" ? row.twrPct : row.simpleReturnPct;
              return (
                <div
                  key={row.year}
                  className="grid grid-cols-[1fr_1.1fr_0.8fr_0.8fr] gap-2 border-b border-[var(--rd-border-subtle)] px-4 py-3 last:border-b-0"
                >
                  <span className="font-mono text-sm">{row.year}</span>
                  <span className={`text-right font-mono text-sm ${toneOf(row.profit) === "up" ? "text-[var(--rd-profit)]" : toneOf(row.profit) === "down" ? "text-[var(--rd-loss)]" : ""}`}>
                    {signedMoney(formatCurrency, row.profit)}
                  </span>
                  <span className="text-right font-mono text-xs text-[var(--rd-text-secondary)]">
                    {pct != null ? signedPct(pct) : "—"}
                  </span>
                  <span className="text-right font-mono text-xs text-[var(--rd-text-tertiary)]">
                    {row.sp500Pct != null ? signedPct(row.sp500Pct) : "—"}
                  </span>
                </div>
              );
            })}
          </Card>
        )}

        <section className="space-y-3">
          <h3 className="text-[17px] font-semibold leading-6">Realizovaný zisk/strata</h3>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Dnes" value={formatCurrency(realized?.todayEur ?? 0)} tone={statTone(realized?.todayEur ?? 0)} />
            <StatTile label="Mesiac" value={formatCurrency(realized?.monthEur ?? 0)} tone={statTone(realized?.monthEur ?? 0)} />
            <StatTile label="YTD" value={formatCurrency(realized?.ytdEur ?? 0)} tone={statTone(realized?.ytdEur ?? 0)} />
            <StatTile label="Celkovo" value={formatCurrency(realized?.totalRealizedEur ?? 0)} tone={statTone(realized?.totalRealizedEur ?? 0)} />
          </div>
          <Card className="gap-0 p-0">
            <p className="px-4 py-3 text-[15px] font-semibold">Podľa tickerov</p>
            {(realized?.byTicker ?? []).slice(0, 12).map((row) => (
              <div key={row.ticker} className="flex items-center gap-3 border-t border-[var(--rd-border-subtle)] px-4 py-3">
                <Avatar ticker={row.ticker} />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium">{row.ticker}</p>
                  <p className="truncate text-xs text-[var(--rd-text-tertiary)]">
                    {row.sellCount ?? "—"}× predaj · {row.companyName || row.ticker}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-mono text-sm ${toneOf(row.realizedEur) === "up" ? "text-[var(--rd-profit)]" : "text-[var(--rd-loss)]"}`}>
                    {signedMoney(formatCurrency, row.realizedEur)}
                  </p>
                  <p className="font-mono text-xs text-[var(--rd-text-tertiary)]">
                    {row.realizedPct != null ? signedPct(row.realizedPct) : "—"}
                  </p>
                </div>
              </div>
            ))}
          </Card>
        </section>
      </PageBody>

      <Dialog open={pickerOpen} title="Portfóliá vo výkonnosti" onClose={() => setPickerOpen(false)}>
        <div className="mt-3 flex flex-col gap-1">
          {portfolios.map((p) => {
            const on = draftIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className="flex min-h-11 items-center justify-between rounded-[var(--rd-radius-sm)] px-2 text-left text-sm"
                onClick={() =>
                  setDraftIds((prev) => (on ? prev.filter((id) => id !== p.id) : [...prev, p.id]))
                }
              >
                <span>{p.name}</span>
                <span className={on ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-tertiary)]"}>
                  {on ? "✓" : ""}
                </span>
              </button>
            );
          })}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="flex-1 min-h-11 rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] text-sm"
              onClick={() => setPickerOpen(false)}
            >
              Zrušiť
            </button>
            <button
              type="button"
              className="flex-1 min-h-11 rounded-[var(--rd-radius-sm)] bg-[var(--rd-profit)] text-sm font-semibold text-[var(--rd-text-on-brand)]"
              onClick={() => {
                setAppliedIds(draftIds.length > 0 ? draftIds : visibleIds);
                setPickerOpen(false);
              }}
            >
              Hotovo
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
