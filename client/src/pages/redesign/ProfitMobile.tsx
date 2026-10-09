import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { ChevronDown } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Avatar, Badge, Card, Chip, Dialog, EmptyState, StatTile, TopBar, type StatTone } from "@/redesign/ui";
import { HelpButton, PageBody, signedMoney, signedPct, toneOf } from "./mobileChrome";

function statTone(value: number): StatTone {
  const t = toneOf(value);
  return t === "up" ? "Up" : t === "down" ? "Down" : "Neutral";
}

const PROFIT_PORTFOLIOS_KEY = "moneiqwise.profit.portfolios";
const MONTHS_SK = ["Jan", "Feb", "Mar", "Apr", "Máj", "Jún", "Júl", "Aug", "Sep", "Okt", "Nov", "Dec"];

type PeriodStats = {
  label: string;
  startDate: string;
  endDate: string;
  profit: number;
  percentReturn: number;
  twrPercentReturn?: number;
  sp500PercentReturn?: number | null;
};

type YearPerformance = PeriodStats & {
  year: number;
  months: PeriodStats[];
};

type PerformanceResponse = {
  years: YearPerformance[];
  totals: PeriodStats | null;
};

type RealizedTickerRow = {
  ticker: string;
  companyName?: string | null;
  totalGain: number;
  totalCost?: number;
  totalSold?: number;
  transactions?: number;
  totalSharesSold?: number;
};

type RealizedResponse = {
  totalRealized: number;
  realizedGainTotal?: number;
  closeTradeNetEur?: number;
  realizedToday: number;
  realizedThisMonth: number;
  realizedYTD: number;
  byTicker?: RealizedTickerRow[];
  transactionCount?: number;
};

function realizedSaleReturnPct(totalGain: number, totalCost: number): number | null {
  if (!(totalCost > 0) || !Number.isFinite(totalGain)) return null;
  return (totalGain / totalCost) * 100;
}

function safeNum(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function annualizePercentReturn(cumulativePct: number, startIso: string, endIso: string): number | null {
  if (!Number.isFinite(cumulativePct) || !startIso || !endIso || startIso > endIso) return null;
  const startMs = new Date(`${startIso}T12:00:00.000Z`).getTime();
  const endMs = new Date(`${endIso}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const years = (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000);
  if (!(years > 0)) return null;
  const r = cumulativePct / 100;
  if (r <= -1) return -100;
  const annualized = (Math.pow(1 + r, 1 / years) - 1) * 100;
  return Number.isFinite(annualized) ? annualized : null;
}

function yearsBetweenIso(startIso: string, endIso: string): number | null {
  const startMs = new Date(`${startIso}T12:00:00.000Z`).getTime();
  const endMs = new Date(`${endIso}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000);
}

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

function monthIndexFromPeriod(row: PeriodStats): number | null {
  // Prefer YYYY-MM-DD string parse (no timezone surprises) over Date().
  const iso = (row.startDate || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const month = Number(iso.slice(5, 7));
    if (month >= 1 && month <= 12) return month - 1;
  }
  const labelMatch = /^(\d{1,2})\/(\d{4})$/.exec((row.label || "").trim());
  if (labelMatch) {
    const month = Number(labelMatch[1]);
    if (month >= 1 && month <= 12) return month - 1;
  }
  return null;
}

export default function ProfitMobile() {
  const { formatCurrency: formatCurrencyRaw } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const { portfolios } = usePortfolio();
  const formatCurrency = (n: number) => {
    if (hideAmounts) return "••••••";
    if (!Number.isFinite(n)) return "—";
    return formatCurrencyRaw(n);
  };
  const visibleIds = useMemo(() => portfolios.map((p) => p.id), [portfolios]);
  const [appliedIds, setAppliedIds] = useState<string[]>(() => readStoredIds() ?? []);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<"simple" | "twr">("simple");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

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

  const years = useMemo(
    () =>
      (perf?.years ?? []).map((y) => ({
        ...y,
        year: Number(y.year),
        months: Array.isArray(y.months) ? y.months : [],
      })),
    [perf?.years],
  );
  const effectiveYear =
    selectedYear != null && years.some((y) => y.year === selectedYear)
      ? selectedYear
      : years[years.length - 1]?.year ?? null;
  const yearRow = years.find((y) => y.year === effectiveYear) ?? null;

  const pctFor = (row: PeriodStats): number | null => {
    if (mode === "twr") {
      return typeof row.twrPercentReturn === "number" && Number.isFinite(row.twrPercentReturn)
        ? row.twrPercentReturn
        : null;
    }
    return typeof row.percentReturn === "number" && Number.isFinite(row.percentReturn)
      ? row.percentReturn
      : null;
  };

  const realizedToday = safeNum(realized?.realizedToday);
  const realizedMonth = safeNum(realized?.realizedThisMonth);
  const realizedYtd = safeNum(realized?.realizedYTD);
  const realizedTotal = safeNum(
    realized?.realizedGainTotal ?? realized?.totalRealized,
  );
  const tickerRows = useMemo(() => {
    const rows = realized?.byTicker ?? [];
    return rows.map((row) => {
      const totalGain = safeNum(row.totalGain);
      const totalCost =
        typeof row.totalCost === "number" && Number.isFinite(row.totalCost)
          ? row.totalCost
          : Math.max(0, safeNum(row.totalSold) - totalGain);
      return {
        ticker: row.ticker,
        companyName: row.companyName,
        totalGain,
        sellCount: row.transactions,
        shares: row.totalSharesSold,
        returnPct: realizedSaleReturnPct(totalGain, totalCost),
      };
    });
  }, [realized?.byTicker]);

  const annualized = useMemo(() => {
    if (!perf?.totals) return null;
    const totalPct =
      mode === "twr"
        ? typeof perf.totals.twrPercentReturn === "number"
          ? perf.totals.twrPercentReturn
          : null
        : perf.totals.percentReturn;
    if (totalPct == null || !Number.isFinite(totalPct)) return null;
    const span = yearsBetweenIso(perf.totals.startDate, perf.totals.endDate);
    const avg = annualizePercentReturn(totalPct, perf.totals.startDate, perf.totals.endDate);
    if (avg == null || span == null) return null;
    const spxAvg =
      typeof perf.totals.sp500PercentReturn === "number"
        ? annualizePercentReturn(perf.totals.sp500PercentReturn, perf.totals.startDate, perf.totals.endDate)
        : null;
    return { avg, years: span, spxAvg };
  }, [perf, mode]);

  const monthCells = useMemo(() => {
    const byMonth = new Map<number, PeriodStats>();
    for (const m of yearRow?.months ?? []) {
      const idx = monthIndexFromPeriod(m);
      if (idx == null) continue;
      byMonth.set(idx, m);
    }
    return MONTHS_SK.map((name, idx) => {
      const row = byMonth.get(idx) ?? null;
      const pct = row ? pctFor(row) : null;
      return { name, pct, row };
    });
  }, [yearRow, mode]);

  const monthSub = format(new Date(), "LLLL", { locale: sk });
  const ytdSub = String(new Date().getFullYear());

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
        <button
          type="button"
          onClick={() => {
            setDraftIds(appliedIds);
            setPickerOpen(true);
          }}
          className="flex min-h-[40px] w-full items-center gap-1.5 rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] px-2 py-2 text-left text-[13px] leading-[18px] text-[var(--rd-text-primary)]"
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDown className="size-4 shrink-0 text-[var(--rd-text-tertiary)]" />
        </button>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Výkonnosť podľa rokov a mesiacov</p>
              <HelpButton
                title="Ako sa počíta % výkonnosť"
                body="Jednoduchý %: zisk = koniec − začiatok − čistý inflow. TWR % očisťuje timing vkladov. S&P 500 je buy-and-hold ^GSPC v tom istom období."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">Ročný prehľad s rozbalením na mesiace.</p>
          </div>

          <div className="flex gap-1">
            <Chip active={mode === "simple"} onClick={() => setMode("simple")}>
              Jednoduchý %
            </Chip>
            <Chip active={mode === "twr"} onClick={() => setMode("twr")}>
              TWR %
            </Chip>
          </div>

          <div className="flex flex-col gap-1 rounded-[var(--rd-radius-sm)] bg-[var(--rd-profit-dim)] p-2">
            <p className="rd-type-overline text-[var(--rd-text-secondary)]">Priemerné ročné zhodnotenie</p>
            <div className="flex items-end gap-1.5">
              <p className="rd-type-display-lg text-[var(--rd-profit)]">
                {annualized ? signedPct(annualized.avg) : "—"}
              </p>
              <p className="pb-0.5 text-xs text-[var(--rd-text-secondary)]">
                p.a. za{" "}
                {annualized
                  ? annualized.years < 1
                    ? `${Math.max(1, Math.round(annualized.years * 365))} dní`
                    : `${annualized.years.toFixed(1).replace(".", ",")} r.`
                  : "—"}
              </p>
            </div>
            <p className="text-[11px] font-medium leading-[14px] text-[var(--rd-text-secondary)]">
              S&P 500 {annualized?.spxAvg != null ? `${signedPct(annualized.spxAvg)} p.a.` : "—"}
            </p>
          </div>

          {isPending ? (
            <p className="text-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
          ) : years.length === 0 ? (
            <EmptyState title="Zatiaľ bez výkonnosti" body="Pridaj transakcie alebo vyber iné portfólio." />
          ) : (
            <>
              <div className="flex gap-1 overflow-x-auto">
                {years.map((y) => (
                  <Chip key={y.year} active={y.year === effectiveYear} onClick={() => setSelectedYear(y.year)}>
                    {String(y.year)}
                  </Chip>
                ))}
              </div>

              {yearRow ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="min-w-0">
                    <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Zisk {yearRow.year}</p>
                    <p
                      className={`truncate text-[13px] font-semibold leading-[18px] ${
                        toneOf(yearRow.profit) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]"
                      }`}
                    >
                      {signedMoney(formatCurrency, yearRow.profit)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Zhodnotenie</p>
                    <p
                      className={`truncate text-[13px] font-semibold leading-[18px] ${
                        toneOf(pctFor(yearRow) ?? 0) === "down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]"
                      }`}
                    >
                      {pctFor(yearRow) != null ? signedPct(pctFor(yearRow)!) : "—"}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="rd-type-overline text-[var(--rd-text-tertiary)]">S&P 500</p>
                    <p className="truncate text-[13px] font-semibold leading-[18px] text-[var(--rd-text-primary)]">
                      {typeof yearRow.sp500PercentReturn === "number" ? signedPct(yearRow.sp500PercentReturn) : "—"}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                {[0, 1, 2].map((rowIdx) => (
                  <div key={rowIdx} className="grid grid-cols-4 gap-1.5">
                    {monthCells.slice(rowIdx * 4, rowIdx * 4 + 4).map((cell) => {
                      const has = cell.pct != null;
                      const up = has && (cell.pct as number) >= 0;
                      const bg = !has
                        ? "bg-[var(--rd-bg-surface-raised)]"
                        : up
                          ? "bg-[var(--rd-profit-dim)]"
                          : "bg-[var(--rd-loss-dim)]";
                      const color = !has
                        ? "text-[var(--rd-text-tertiary)]"
                        : up
                          ? "text-[var(--rd-profit)]"
                          : "text-[var(--rd-loss)]";
                      return (
                        <div key={cell.name} className={`flex flex-col gap-0.5 rounded-[var(--rd-radius-sm)] p-2 ${bg}`}>
                          <p className="text-[10px] font-medium leading-3 text-[var(--rd-text-secondary)]">{cell.name}</p>
                          <p className={`text-[13px] font-semibold leading-[18px] ${color}`}>
                            {has ? signedPct(cell.pct as number, 1) : "—"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {perf?.totals ? (
                <div className="flex items-center gap-2 text-[11px] leading-[14px]">
                  <p className="min-w-0 flex-1 text-[var(--rd-text-secondary)]">Celkovo</p>
                  <p className="shrink-0 font-medium text-[var(--rd-profit)]">
                    {signedMoney(formatCurrency, perf.totals.profit)} ·{" "}
                    {pctFor(perf.totals) != null ? signedPct(pctFor(perf.totals)!) : "—"}
                  </p>
                  <p className="shrink-0 font-medium text-[var(--rd-text-secondary)]">
                    S&P{" "}
                    {typeof perf.totals.sp500PercentReturn === "number"
                      ? signedPct(perf.totals.sp500PercentReturn)
                      : "—"}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </Card>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <p className="rd-type-h2">Realizovaný zisk/strata</p>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              Z predajov podľa histórie; celkom vrátane príp. XTB „close trade“.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Dnes"
              value={formatCurrency(realizedToday)}
              sub="realizované"
              tone={statTone(realizedToday)}
            />
            <StatTile
              label="Mesiac"
              value={formatCurrency(realizedMonth)}
              sub={monthSub}
              tone={statTone(realizedMonth)}
            />
            <StatTile
              label="YTD"
              value={signedMoney(formatCurrency, realizedYtd)}
              sub={ytdSub}
              tone={statTone(realizedYtd)}
            />
            <StatTile
              label="Celkovo"
              value={signedMoney(formatCurrency, realizedTotal)}
              sub="od začiatku"
              tone={statTone(realizedTotal)}
            />
          </div>
        </Card>

        <Card className="gap-1">
          <p className="rd-type-h2">Podľa tickerov</p>
          {tickerRows.length === 0 ? (
            <p className="text-xs text-[var(--rd-text-tertiary)]">Zatiaľ žiadne realizované predaje.</p>
          ) : (
            tickerRows.slice(0, 20).map((row, index) => (
              <div key={row.ticker}>
                {index > 0 ? <div className="h-px w-full bg-[var(--rd-border-subtle)]" /> : null}
                <div className="flex items-center gap-2 py-2">
                  <Avatar ticker={row.ticker} companyName={row.companyName || undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-mono text-[13px] font-semibold leading-[18px]">{row.ticker}</p>
                      <p className="truncate text-[11px] text-[var(--rd-text-tertiary)]">
                        {row.sellCount ?? "—"}× predaj
                        {row.shares != null ? ` · ${row.shares} ks` : ""}
                      </p>
                    </div>
                    <p className="truncate text-[11px] text-[var(--rd-text-secondary)]">
                      {row.companyName || row.ticker}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p
                      className={`font-mono text-[13px] font-semibold leading-[18px] ${
                        toneOf(row.totalGain) === "down"
                          ? "text-[var(--rd-loss)]"
                          : "text-[var(--rd-profit)]"
                      }`}
                    >
                      {signedMoney(formatCurrency, row.totalGain)}
                    </p>
                    {row.returnPct != null ? (
                      <Badge
                        label={signedPct(row.returnPct)}
                        tone={row.returnPct >= 0 ? "Profit" : "Loss"}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>
      </PageBody>

      <Dialog open={pickerOpen} title="Portfóliá vo výkonnosti" onClose={() => setPickerOpen(false)}>
        <div className="mt-3 flex flex-col gap-1">
          {portfolios.map((p) => {
            const on = draftIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className="flex min-h-[40px] items-center justify-between rounded-[var(--rd-radius-sm)] px-2 text-left text-sm"
                onClick={() => setDraftIds((prev) => (on ? prev.filter((id) => id !== p.id) : [...prev, p.id]))}
              >
                <span>{p.name}</span>
                <span className={on ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-tertiary)]"}>{on ? "✓" : ""}</span>
              </button>
            );
          })}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="min-h-[40px] flex-1 rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] text-sm"
              onClick={() => setPickerOpen(false)}
            >
              Zrušiť
            </button>
            <button
              type="button"
              className="min-h-[40px] flex-1 rounded-[var(--rd-radius-sm)] bg-[var(--rd-profit)] text-sm font-semibold text-[var(--rd-text-on-brand)]"
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
