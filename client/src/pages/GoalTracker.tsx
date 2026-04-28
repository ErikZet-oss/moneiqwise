import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useCurrency } from "@/hooks/useCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { HelpTip } from "@/components/HelpTip";

type HistoryPoint = {
  date: string;
  totalValue: number;
  netInvested: number;
};

type PortfolioHistoryRes = {
  points: HistoryPoint[];
};

type MonthlyActual = {
  monthKey: string;
  date: string;
  actualValue: number;
};

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

const MONTHS_SK = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jún", "Júl", "Aug", "Sep", "Okt", "Nov", "Dec"];

function monthKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseNumberInput(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export default function GoalTracker() {
  const { getQueryParam, selectedPortfolio, isAllPortfolios } = usePortfolio();
  const { formatCurrency } = useCurrency();
  const portfolioParam = getQueryParam();
  const isMobile = useIsMobile();

  const [initialAmountInput, setInitialAmountInput] = useState("10000");
  const [goalAmountInput, setGoalAmountInput] = useState("50000");
  const [monthlyDepositInput, setMonthlyDepositInput] = useState("300");
  const [annualReturnInput, setAnnualReturnInput] = useState("8");
  const [useCurrentPortfolioAsInitial, setUseCurrentPortfolioAsInitial] = useState(true);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>("");

  const { data: history, isLoading } = useQuery<PortfolioHistoryRes>({
    queryKey: ["/api/portfolio-history", portfolioParam, "all", "goal-tracker"],
    queryFn: async () => {
      const u = new URLSearchParams();
      u.set("portfolio", portfolioParam);
      u.set("range", "all");
      const res = await fetch(`/api/portfolio-history?${u.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Nepodarilo sa načítať históriu pre Môj cieľ.");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const points = history?.points ?? [];
  const latestActualValue = points.length > 0 ? points[points.length - 1]?.totalValue ?? null : null;

  const monthlyActualMap = useMemo(() => {
    const map = new Map<string, MonthlyActual>();
    for (const p of points) {
      const d = new Date(`${p.date}T12:00:00`);
      if (Number.isNaN(d.getTime()) || !Number.isFinite(p.totalValue)) continue;
      const key = monthKeyFromDate(d);
      map.set(key, { monthKey: key, date: p.date, actualValue: p.totalValue });
    }
    return map;
  }, [points]);

  const firstActualDate = useMemo(() => {
    if (points.length === 0) return null;
    const d = new Date(`${points[0]?.date ?? ""}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
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
    const monthCount = 12 * 100;
    const minRenderMonths = 12;
    let balance = effectiveInitialAmount;
    let contributionOnly = effectiveInitialAmount;
    const finiteGoal = goalAmount > 0 ? goalAmount : Number.POSITIVE_INFINITY;
    for (let i = 0; i <= monthCount; i++) {
      const d = new Date(simulationStart.getFullYear(), simulationStart.getMonth() + i, 1);
      if (i > 0) {
        balance = balance * (1 + rMonthly) + monthlyDeposit;
        contributionOnly += monthlyDeposit;
      }
      const key = monthKeyFromDate(d);
      const actual = monthlyActualMap.get(key)?.actualValue ?? null;
      out.push({
        idx: i,
        monthKey: key,
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
        year: d.getFullYear(),
        month: d.getMonth(),
        label: `${MONTHS_SK[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,
        targetValue: balance,
        contributionOnlyValue: contributionOnly,
        actualValue: actual,
      });
      // Keep at least one visible year so the chart is readable even when target is already hit at start.
      if (balance >= finiteGoal && i >= minRenderMonths) break;
    }
    return out;
  }, [annualReturn, effectiveInitialAmount, monthlyDeposit, monthlyActualMap, simulationStart, goalAmount]);

  const goalHitPoint = useMemo(() => {
    if (!(goalAmount > 0)) return null;
    return projection.find((p) => p.targetValue >= goalAmount) ?? null;
  }, [projection, goalAmount]);

  const projectionSummary = useMemo(() => {
    const last = goalHitPoint ?? projection[projection.length - 1] ?? null;
    const plannedMonths = goalHitPoint?.idx ?? projection.length - 1;
    const totalPlannedDeposits = monthlyDeposit * plannedMonths;
    const totalOwnContributions = effectiveInitialAmount + totalPlannedDeposits;
    const projectedFinalValue = last?.targetValue ?? effectiveInitialAmount;
    const projectedGrowth = projectedFinalValue - totalOwnContributions;
    const projectedGrowthPct =
      totalOwnContributions > 0 ? (projectedGrowth / totalOwnContributions) * 100 : 0;
    return {
      projectedFinalValue,
      totalPlannedDeposits,
      totalOwnContributions,
      projectedGrowth,
      projectedGrowthPct,
      monthsToGoal: goalHitPoint?.idx ?? null,
      goalHitDate: goalHitPoint?.date ?? null,
    };
  }, [projection, goalHitPoint, monthlyDeposit, effectiveInitialAmount]);

  const yearsList = useMemo(() => {
    const set = new Set<number>();
    for (const p of projection) set.add(p.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [projection]);

  const effectiveSelectedYear = useMemo(() => {
    if (selectedYear && yearsList.includes(Number(selectedYear))) return Number(selectedYear);
    return yearsList[0] ?? new Date().getFullYear();
  }, [selectedYear, yearsList]);

  const yearRows = useMemo(
    () => projection.filter((p) => p.year === effectiveSelectedYear),
    [projection, effectiveSelectedYear],
  );

  const selectedDetail = useMemo(() => {
    if (selectedMonthKey) return projection.find((p) => p.monthKey === selectedMonthKey) ?? null;
    return yearRows[0] ?? null;
  }, [projection, selectedMonthKey, yearRows]);

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 px-3 sm:px-0 pb-4 sm:pb-0">
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Target className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          Môj cieľ
          <HelpTip title="Ako funguje sekcia Môj cieľ">
            <p>Porovnáva plán zloženého úročenia s realitou z histórie tvojho portfólia.</p>
            <p>Plán sa počíta mesačne zo zadaných inputov (počiatočná suma, mesačný vklad, ročný úrok, roky).</p>
          </HelpTip>
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {isAllPortfolios ? "Všetky portfóliá" : `Portfólio: ${selectedPortfolio?.name ?? "Vybrané"}`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-1">
            Nastavenie simulácie
            <HelpTip title="Vstupy simulácie">
              <p>Počiatočná suma = štartový kapitál.</p>
              <p>Mesačný vklad = pravidelné dokladanie každý mesiac.</p>
              <p>Cieľový úrok je ročné zhodnotenie, ktoré sa prepočítava na mesiace.</p>
              <p>Cieľová suma je hodnota, ktorú chceš dosiahnuť; appka vypočíta odhadovaný mesiac dosiahnutia.</p>
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Zadaj cieľovú hodnotu, mesačný vklad a ročný výnos. Výpočet určí kedy (mesiac/rok) by si mal cieľ dosiahnuť.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="goal-initial" className="text-xs sm:text-sm">Počiatočná suma</Label>
            <Input
              id="goal-initial"
              value={initialAmountInput}
              onChange={(e) => setInitialAmountInput(e.target.value)}
              className="h-9 sm:h-10"
              inputMode="decimal"
              disabled={useCurrentPortfolioAsInitial}
              data-testid="input-goal-initial-amount"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-target" className="text-xs sm:text-sm">Cieľová suma</Label>
            <Input
              id="goal-target"
              value={goalAmountInput}
              onChange={(e) => setGoalAmountInput(e.target.value)}
              className="h-9 sm:h-10"
              inputMode="decimal"
              data-testid="input-goal-target-amount"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-monthly" className="text-xs sm:text-sm">Mesačný vklad</Label>
            <Input
              id="goal-monthly"
              value={monthlyDepositInput}
              onChange={(e) => setMonthlyDepositInput(e.target.value)}
              className="h-9 sm:h-10"
              inputMode="decimal"
              data-testid="input-goal-monthly-deposit"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="goal-return" className="text-xs sm:text-sm">Cieľový úrok (% p.a.)</Label>
            <Input
              id="goal-return"
              value={annualReturnInput}
              onChange={(e) => setAnnualReturnInput(e.target.value)}
              className="h-9 sm:h-10"
              inputMode="decimal"
              data-testid="input-goal-annual-return"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4 rounded-md border p-2.5 sm:p-3">
            <div className="flex items-start sm:items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs sm:text-sm font-medium flex items-center gap-1">
                  Použiť aktuálnu hodnotu portfólia
                  <HelpTip title="Automatické predvyplnenie počiatočnej sumy">
                    <p>
                      Keď je zapnuté, počiatočná suma sa berie z poslednej reálnej hodnoty portfólia
                      z histórie (bez manuálneho prepisovania).
                    </p>
                  </HelpTip>
                </p>
                <p className="text-[11px] sm:text-xs text-muted-foreground">
                  {latestActualValue != null && Number.isFinite(latestActualValue)
                    ? `Aktuálna hodnota: ${formatCurrency(latestActualValue)}`
                    : "Aktuálna hodnota zatiaľ nie je dostupná."}
                </p>
              </div>
              <Switch
                checked={useCurrentPortfolioAsInitial}
                onCheckedChange={setUseCurrentPortfolioAsInitial}
                data-testid="switch-goal-use-current-portfolio"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-1">
            Odhad na konci cieľa
            <HelpTip title="Ako čítať tento odhad">
              <p>
                Toto je odhad dátumu a sumy, kedy by mala cieľová krivka prvýkrát dosiahnuť tvoj cieľ.
              </p>
              <p>
                „Zhodnotenie“ je rozdiel medzi odhadovanou hodnotou a tvojimi vlastnými vkladmi.
              </p>
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-goal-projected-final-value">
            {formatCurrency(projectionSummary.projectedFinalValue)}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground" data-testid="text-goal-hit-date">
            {projectionSummary.goalHitDate
              ? `Odhad dosiahnutia cieľa: ${new Date(projectionSummary.goalHitDate).toLocaleDateString("sk-SK")} (${projectionSummary.monthsToGoal ?? 0} mesiacov)`
              : "Cieľ pri týchto vstupoch zatiaľ nie je dosiahnutý v horizonte simulácie."}
          </p>
          <div className="grid gap-2 sm:grid-cols-3 text-xs sm:text-sm">
            <div className="rounded-md border p-2.5">
              <p className="text-muted-foreground text-[11px] sm:text-xs">Vklady spolu</p>
              <p className="font-semibold mt-0.5">{formatCurrency(projectionSummary.totalOwnContributions)}</p>
            </div>
            <div className="rounded-md border p-2.5">
              <p className="text-muted-foreground text-[11px] sm:text-xs">Mesačné vklady spolu</p>
              <p className="font-semibold mt-0.5">{formatCurrency(projectionSummary.totalPlannedDeposits)}</p>
            </div>
            <div className="rounded-md border p-2.5">
              <p className="text-muted-foreground text-[11px] sm:text-xs">Zhodnotenie</p>
              <p
                className={`font-semibold mt-0.5 ${projectionSummary.projectedGrowth >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                data-testid="text-goal-projected-growth"
              >
                {projectionSummary.projectedGrowth >= 0 ? "+" : "-"}
                {formatCurrency(Math.abs(projectionSummary.projectedGrowth))} ({projectionSummary.projectedGrowthPct.toFixed(1)}%)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-1">
            Cieľ vs realita
            <HelpTip title="Graf cieľ vs realita">
              <p>Prerušovaná čiara je plán (target), plocha je skutočný stav portfólia (actual).</p>
              <p>Vodorovná zelená čiara je tvoja cieľová suma.</p>
              <p>Sivá čiara ukazuje len tvoje čisté vklady bez zhodnotenia.</p>
              <p>V tooltipe vidíš rozdiel: či si nad plánom alebo zaostávaš.</p>
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Prerušovaná čiara = cieľový plán. Plocha = reálna historická hodnota portfólia.
          </CardDescription>
        </CardHeader>
        <CardContent className={isMobile ? "h-[260px] px-2" : "h-[340px]"}>
          {isLoading ? (
            <div className="h-full rounded-md border bg-muted/20 animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projection}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" minTickGap={isMobile ? 18 : 24} tick={{ fontSize: isMobile ? 10 : 12 }} />
                <YAxis
                  width={isMobile ? 40 : 56}
                  tick={{ fontSize: isMobile ? 10 : 12 }}
                  tickFormatter={(v) => new Intl.NumberFormat("sk-SK", { notation: "compact", maximumFractionDigits: 1 }).format(v)}
                />
                <RTooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as ProjectionPoint;
                    const diff = row.actualValue != null ? row.actualValue - row.targetValue : null;
                    return (
                      <div className="rounded-md border bg-background/95 p-2 text-[11px] sm:text-xs shadow-md max-w-[220px]">
                        <p className="font-medium mb-1">{label}</p>
                        <p>Cieľ: {formatCurrency(row.targetValue)}</p>
                        <p className="text-muted-foreground">Vklady bez výnosu: {formatCurrency(row.contributionOnlyValue)}</p>
                        <p>Realita: {row.actualValue != null ? formatCurrency(row.actualValue) : "—"}</p>
                        {diff != null && (
                          <p className={diff >= 0 ? "text-emerald-600" : "text-rose-600"}>
                            {diff >= 0 ? "Si nad plánom: " : "Zaostávaš: "}
                            {formatCurrency(Math.abs(diff))}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                {goalAmount > 0 && (
                  <ReferenceLine
                    y={goalAmount}
                    stroke="hsl(142 60% 40%)"
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                    label={{ value: "Cieľ", position: "insideTopRight", fill: "hsl(142 60% 40%)", fontSize: 11 }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="actualValue"
                  name="Reality"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary) / 0.18)"
                  strokeWidth={2}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="targetValue"
                  name="Cieľ"
                  stroke="hsl(var(--foreground))"
                  strokeDasharray="6 4"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="contributionOnlyValue"
                  name="Vklady bez výnosu"
                  stroke="hsl(var(--muted-foreground))"
                  dot={false}
                  strokeWidth={1.75}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-1">
                Mesačný kalendár (4 × 3)
                <HelpTip title="Ako čítať mesačný grid">
                  <p>Zelený mesiac = v danom mesiaci tvoja realita dosiahla alebo prekonala cieľovú sumu.</p>
                  <p>Červený mesiac = cieľová suma ešte nebola dosiahnutá. Sivý = zatiaľ bez dát.</p>
                  <p>Po kliknutí na mesiac sa dole zobrazí detailný rozpis.</p>
                </HelpTip>
              </CardTitle>
              <CardDescription>
                Klikni na mesiac a uvidíš porovnanie cieľovej a reálnej hodnoty.
              </CardDescription>
            </div>
            <Select value={String(effectiveSelectedYear)} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-goal-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearsList.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, m) => {
              const row = yearRows.find((p) => p.month === m) ?? null;
              const diffToGoal = row && row.actualValue != null ? row.actualValue - goalAmount : null;
              const bg = diffToGoal == null ? "bg-slate-100 dark:bg-slate-900" : diffToGoal >= 0 ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-rose-100 dark:bg-rose-900/25";
              const active = selectedDetail?.monthKey === row?.monthKey;
              return (
                <button
                  key={`${effectiveSelectedYear}-${m}`}
                  type="button"
                  onClick={() => row && setSelectedMonthKey(row.monthKey)}
                  className={`rounded-md border px-2.5 sm:px-3 py-2 text-left min-h-[64px] sm:min-h-[70px] ${bg} ${active ? "ring-2 ring-primary" : ""}`}
                  data-testid={`goal-month-${effectiveSelectedYear}-${m + 1}`}
                >
                  <p className="text-xs sm:text-sm font-medium">{MONTHS_SK[m]}</p>
                  <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 leading-tight">
                    {row?.actualValue != null
                      ? diffToGoal != null && diffToGoal >= 0
                        ? `✓ +${formatCurrency(diffToGoal)}`
                        : diffToGoal != null
                          ? `✕ -${formatCurrency(Math.abs(diffToGoal))}`
                          : "—"
                      : "Bez reality"}
                  </p>
                </button>
              );
            })}
          </div>

          {selectedDetail && (
            <div className="rounded-md border p-3 text-xs sm:text-sm space-y-1.5" data-testid="goal-month-detail">
              <p className="font-medium">
                {MONTHS_SK[selectedDetail.month]} {selectedDetail.year}
              </p>
              <p>Cieľová suma: {formatCurrency(goalAmount)}</p>
              <p>Potrebná hodnota pre cieľ: {formatCurrency(selectedDetail.targetValue)}</p>
              <p>
                Tvoja reálna hodnota:{" "}
                {selectedDetail.actualValue != null ? formatCurrency(selectedDetail.actualValue) : "Bez dát"}
              </p>
              <p className={(selectedDetail.actualValue ?? 0) - goalAmount >= 0 ? "text-emerald-600" : "text-rose-600"}>
                Stav voči cieľu:{" "}
                {selectedDetail.actualValue != null
                  ? `${(selectedDetail.actualValue - goalAmount) >= 0 ? "+" : "-"}${formatCurrency(
                      Math.abs(selectedDetail.actualValue - goalAmount),
                    )}`
                  : "—"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

