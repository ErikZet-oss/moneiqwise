import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useCurrency } from "@/hooks/useCurrency";
import { Badge, Card, Input, Select, Toggle, TopBar } from "@/redesign/ui";
import { HelpButton, KvRow, PageBody, PortfolioSwitcher, signedMoney, signedPct, toneOf } from "./mobileChrome";

type HistoryPoint = { date: string; totalValue: number; netInvested: number };
type MonthlyActual = { monthKey: string; date: string; actualValue: number };
type ProjectionPoint = {
  idx: number;
  monthKey: string;
  date: string;
  year: number;
  month: number;
  label: string;
  targetValue: number;
  contributionOnlyValue: number;
  actualValue: number | null;
};

const MONTHS_SK = ["Jan", "Feb", "Mar", "Apr", "Máj", "Jún", "Júl", "Aug", "Sep", "Okt", "Nov", "Dec"];

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseNumberInput(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export default function GoalTrackerMobile() {
  const { getQueryParam, selectedPortfolio, isAllPortfolios } = usePortfolio();
  const { formatCurrency } = useCurrency();
  const portfolioParam = getQueryParam();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [initialAmountInput, setInitialAmountInput] = useState("10000");
  const [goalAmountInput, setGoalAmountInput] = useState("50000");
  const [monthlyDepositInput, setMonthlyDepositInput] = useState("300");
  const [annualReturnInput, setAnnualReturnInput] = useState("8");
  const [useCurrentPortfolioAsInitial, setUseCurrentPortfolioAsInitial] = useState(true);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");

  const { data: history, isLoading } = useQuery<{ points: HistoryPoint[] }>({
    queryKey: ["/api/portfolio-history", portfolioParam, "all", "goal-tracker"],
    queryFn: async () => {
      const params = new URLSearchParams({ portfolio: portfolioParam, range: "all" });
      const res = await fetch(`/api/portfolio-history?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Nepodarilo sa načítať históriu pre Môj cieľ.");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const points = history?.points ?? [];
  const latestActualValue = points.length > 0 ? points[points.length - 1]?.totalValue ?? null : null;
  const monthlyActualMap = useMemo(() => {
    const map = new Map<string, MonthlyActual>();
    for (const point of points) {
      const date = new Date(`${point.date}T12:00:00`);
      if (Number.isNaN(date.getTime()) || !Number.isFinite(point.totalValue)) continue;
      const key = monthKeyFromDate(date);
      map.set(key, { monthKey: key, date: point.date, actualValue: point.totalValue });
    }
    return map;
  }, [points]);

  const firstActualDate = useMemo(() => {
    if (points.length === 0) return null;
    const date = new Date(`${points[0]?.date ?? ""}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [points]);

  const simulationStart = useMemo(() => {
    if (useCurrentPortfolioAsInitial) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const base = firstActualDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [firstActualDate, useCurrentPortfolioAsInitial]);

  const initialAmount = Math.max(0, parseNumberInput(initialAmountInput, 0));
  const goalAmount = Math.max(0, parseNumberInput(goalAmountInput, 0));
  const effectiveInitialAmount =
    useCurrentPortfolioAsInitial && latestActualValue != null && Number.isFinite(latestActualValue)
      ? Math.max(0, latestActualValue)
      : initialAmount;
  const monthlyDeposit = parseNumberInput(monthlyDepositInput, 0);
  const annualReturn = parseNumberInput(annualReturnInput, 0);

  const projection = useMemo(() => {
    const out: ProjectionPoint[] = [];
    const rMonthly = annualReturn / 100 / 12;
    let balance = effectiveInitialAmount;
    let contributionOnly = effectiveInitialAmount;
    const finiteGoal = goalAmount > 0 ? goalAmount : Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 12 * 100; i++) {
      const date = new Date(simulationStart.getFullYear(), simulationStart.getMonth() + i, 1);
      if (i > 0) {
        balance = balance * (1 + rMonthly) + monthlyDeposit;
        contributionOnly += monthlyDeposit;
      }
      const key = monthKeyFromDate(date);
      out.push({
        idx: i,
        monthKey: key,
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`,
        year: date.getFullYear(),
        month: date.getMonth(),
        label: `${MONTHS_SK[date.getMonth()]} ${String(date.getFullYear()).slice(-2)}`,
        targetValue: balance,
        contributionOnlyValue: contributionOnly,
        actualValue: monthlyActualMap.get(key)?.actualValue ?? null,
      });
      if (balance >= finiteGoal && i >= 12) break;
    }
    return out;
  }, [annualReturn, effectiveInitialAmount, monthlyDeposit, monthlyActualMap, simulationStart, goalAmount]);

  const goalHitPoint = useMemo(() => {
    if (!(goalAmount > 0)) return null;
    return projection.find((point) => point.targetValue >= goalAmount) ?? null;
  }, [projection, goalAmount]);

  const summary = useMemo(() => {
    const last = goalHitPoint ?? projection[projection.length - 1] ?? null;
    const plannedMonths = goalHitPoint?.idx ?? Math.max(projection.length - 1, 0);
    const totalPlannedDeposits = monthlyDeposit * plannedMonths;
    const totalOwnContributions = effectiveInitialAmount + totalPlannedDeposits;
    const projectedFinalValue = last?.targetValue ?? effectiveInitialAmount;
    const projectedGrowth = projectedFinalValue - totalOwnContributions;
    return {
      projectedFinalValue,
      totalPlannedDeposits,
      totalOwnContributions,
      projectedGrowth,
      projectedGrowthPct: totalOwnContributions > 0 ? (projectedGrowth / totalOwnContributions) * 100 : 0,
      monthsToGoal: goalHitPoint?.idx ?? null,
      goalHitDate: goalHitPoint?.date ?? null,
    };
  }, [projection, goalHitPoint, monthlyDeposit, effectiveInitialAmount]);

  const yearsList = useMemo(() => {
    const set = new Set<number>();
    for (const point of projection) set.add(point.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [projection]);
  const effectiveSelectedYear =
    selectedYear && yearsList.includes(Number(selectedYear)) ? Number(selectedYear) : yearsList[0] ?? new Date().getFullYear();
  const yearRows = projection.filter((point) => point.year === effectiveSelectedYear);
  const selectedDetail =
    (selectedMonthKey ? projection.find((point) => point.monthKey === selectedMonthKey) : null) ?? yearRows[0] ?? null;
  const overline = isAllPortfolios ? "Všetky portfóliá" : selectedPortfolio?.name ?? "Portfólio";
  const hitLabel = summary.goalHitDate ? new Date(summary.goalHitDate).toLocaleDateString("sk-SK") : "—";
  const currentMonthKey = monthKeyFromDate(new Date());

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline={overline} title="Môj cieľ" onOverlineClick={() => setPickerOpen(true)} />
      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <PageBody>
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 text-xs leading-4 text-[var(--rd-text-secondary)]">
            Porovnanie plánu zloženého úročenia s realitou tvojho portfólia.
          </p>
          <HelpButton
            title="Ako funguje sekcia Môj cieľ"
            body="Porovnáva plán zloženého úročenia s realitou z histórie portfólia. Plán sa počíta mesačne z počiatočnej sumy, mesačného vkladu a ročného úroku."
          />
        </div>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Nastavenie simulácie</p>
              <HelpButton
                title="Vstupy simulácie"
                body="Zadaj cieľovú hodnotu, mesačný vklad a ročný výnos. Počiatočná suma môže ísť z aktuálnej hodnoty portfólia."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              Zadaj cieľovú hodnotu, mesačný vklad a ročný výnos.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Počiatočná suma"
              value={useCurrentPortfolioAsInitial ? String(Math.round(effectiveInitialAmount)) : initialAmountInput}
              onChange={(event) => setInitialAmountInput(event.target.value)}
              inputMode="decimal"
              disabled={useCurrentPortfolioAsInitial}
            />
            <Input
              label="Cieľová suma"
              value={goalAmountInput}
              onChange={(event) => setGoalAmountInput(event.target.value)}
              inputMode="decimal"
            />
            <Input
              label="Mesačný vklad"
              value={monthlyDepositInput}
              onChange={(event) => setMonthlyDepositInput(event.target.value)}
              inputMode="decimal"
            />
            <Input
              label="Cieľový úrok (% p.a.)"
              value={annualReturnInput}
              onChange={(event) => setAnnualReturnInput(event.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm leading-5">Použiť aktuálnu hodnotu portfólia</p>
            <HelpButton
              title="Automatické predvyplnenie"
              body="Keď je zapnuté, počiatočná suma sa berie z poslednej reálnej hodnoty portfólia."
            />
            <Toggle
              checked={useCurrentPortfolioAsInitial}
              onCheckedChange={setUseCurrentPortfolioAsInitial}
              label="Použiť aktuálnu hodnotu portfólia"
            />
          </div>
        </Card>

        <Card className="gap-2">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 rd-type-overline text-[var(--rd-text-tertiary)]">Odhad na konci cieľa</p>
            <HelpButton
              title="Ako čítať tento odhad"
              body="Odhadovaná hodnota pri dosiahnutí cieľa podľa plánu. Dátum a počet mesiacov sú z mesačnej projekcie."
            />
          </div>
          <p className="rd-type-display-hero" data-testid="text-goal-projected-final-value">
            {formatCurrency(summary.projectedFinalValue)}
          </p>
          <div className="flex items-center gap-2">
            <Badge label={hitLabel} tone="Profit" />
            <p className="text-xs text-[var(--rd-text-secondary)]">
              {summary.monthsToGoal != null ? `${summary.monthsToGoal} mesiacov` : "mimo horizontu"}
            </p>
          </div>
          <KvRow label="Vklady spolu" value={formatCurrency(summary.totalOwnContributions)} />
          <KvRow label="Mesačné vklady spolu" value={formatCurrency(summary.totalPlannedDeposits)} />
          <KvRow
            label="Zhodnotenie"
            value={`${signedMoney(formatCurrency, summary.projectedGrowth)} (${signedPct(summary.projectedGrowthPct, 1)})`}
            tone={toneOf(summary.projectedGrowth)}
          />
        </Card>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Cieľ vs realita</p>
              <HelpButton
                title="Graf cieľ vs realita"
                body="Prerušovaná čiara je cieľový plán. Plocha je reálna hodnota portfólia. Vodorovná čiara je cieľová suma."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              Prerušovaná čiara = cieľový plán. Plocha = reálna hodnota portfólia.
            </p>
          </div>
          <div className="h-40 w-full">
            {isLoading ? (
              <p className="text-xs text-[var(--rd-text-tertiary)]">Načítavam históriu…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projection} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--rd-border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    minTickGap={24}
                    tick={{ fontSize: 10, fill: "var(--rd-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <RTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as ProjectionPoint;
                      return (
                        <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-2 text-xs">
                          <p>{row.label}</p>
                          <p>Cieľ: {formatCurrency(row.targetValue)}</p>
                          <p>Realita: {row.actualValue != null ? formatCurrency(row.actualValue) : "—"}</p>
                        </div>
                      );
                    }}
                  />
                  {goalAmount > 0 ? <ReferenceLine y={goalAmount} stroke="var(--rd-profit)" strokeDasharray="4 4" /> : null}
                  <Area
                    type="monotone"
                    dataKey="actualValue"
                    stroke="var(--rd-profit)"
                    fill="var(--rd-profit)"
                    fillOpacity={0.2}
                    connectNulls={false}
                  />
                  <Line type="monotone" dataKey="targetValue" stroke="var(--rd-text-secondary)" strokeDasharray="6 4" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex gap-3 text-xs text-[var(--rd-text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-profit)]" /> Realita
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-[var(--rd-text-secondary)]" /> Plán
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full border border-[var(--rd-profit)] bg-transparent" /> Cieľ
            </span>
          </div>
        </Card>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Mesačný kalendár</p>
              <HelpButton
                title="Ako čítať mesačný grid"
                body="Na bunke je plánovaná hodnota na koniec mesiaca. Po prechode mesiaca: zelená = realita ≥ plán, červená = realita pod plánom. Budúce mesiace zostávajú sivé."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              Číslo = koľko by si mal mať na konci mesiaca. Zelená = mesiac splnený.
            </p>
          </div>
          <Select
            label="Rok"
            value={String(effectiveSelectedYear)}
            onChange={setSelectedYear}
            options={yearsList.map((year) => ({ value: String(year), label: String(year) }))}
          />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, month) => {
              const row = yearRows.find((point) => point.month === month) ?? null;
              const monthPassed = row != null && row.monthKey < currentMonthKey;
              const met =
                monthPassed && row.actualValue != null ? row.actualValue >= row.targetValue : null;
              const active = selectedDetail?.monthKey === row?.monthKey;
              const tone =
                met === true
                  ? "border-[var(--rd-profit)] bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]"
                  : met === false
                    ? "border-[var(--rd-loss)] bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]"
                    : "border-[var(--rd-border-subtle)] text-[var(--rd-text-tertiary)]";
              const cellLabel = row
                ? formatCurrency(row.targetValue)
                : "—";
              const statusHint =
                met === true ? "Splnené" : met === false ? "Nesplnené" : monthPassed ? "Bez dát" : "Plán";
              return (
                <button
                  key={`${effectiveSelectedYear}-${month}`}
                  type="button"
                  onClick={() => row && setSelectedMonthKey(row.monthKey)}
                  className={`min-h-[64px] rounded-[var(--rd-radius-sm)] border bg-[var(--rd-bg-surface-raised)] px-2 py-2 text-left ${tone} ${active ? "ring-1 ring-[var(--rd-text-primary)]" : ""}`}
                >
                  <p className="text-xs font-medium text-[var(--rd-text-primary)]">{MONTHS_SK[month]}</p>
                  <p className="mt-1 font-mono text-[10px] leading-3 tabular-nums">{cellLabel}</p>
                  <p className="mt-0.5 text-[9px] leading-3 opacity-80">{statusHint}</p>
                </button>
              );
            })}
          </div>
          {selectedDetail ? (
            <div className="flex flex-col gap-2 rounded-[var(--rd-radius-sm)] bg-[var(--rd-bg-surface-raised)] p-3">
              <p className="text-sm font-semibold">
                {MONTHS_SK[selectedDetail.month]} {selectedDetail.year}
              </p>
              <KvRow label="Finálny cieľ (celkový)" value={formatCurrency(goalAmount)} />
              <KvRow label="Plán na koniec mesiaca" value={formatCurrency(selectedDetail.targetValue)} />
              <KvRow
                label="Tvoja reálna hodnota"
                value={selectedDetail.actualValue != null ? formatCurrency(selectedDetail.actualValue) : "Bez dát"}
              />
              <KvRow
                label="Stav voči mesačnému plánu"
                value={
                  selectedDetail.actualValue != null
                    ? signedMoney(formatCurrency, selectedDetail.actualValue - selectedDetail.targetValue)
                    : "—"
                }
                tone={toneOf((selectedDetail.actualValue ?? 0) - selectedDetail.targetValue)}
              />
            </div>
          ) : null}
        </Card>
      </PageBody>
    </div>
  );
}
