import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCurrency } from "@/hooks/useCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileRedesign } from "@/hooks/useMobileUi";
import { useGoalTracker } from "@/hooks/useGoalTracker";
import GoalTrackerMobile from "@/pages/redesign/GoalTrackerMobile";
import { HelpTip } from "@/components/HelpTip";
import { MONTHS_SK, calendarTileAmount, type GoalChartPoint, type GoalMonthPoint } from "@/lib/goalTracker";

function statusLabel(status: GoalMonthPoint["status"]): string {
  switch (status) {
    case "met":
      return "Splnené";
    case "missed":
      return "Nesplnené";
    case "current":
      return "Prebieha";
    case "future":
      return "Plán";
    case "no_data":
      return "Bez dát";
    default:
      return "—";
  }
}

function tileClass(status: GoalMonthPoint["status"] | null): string {
  switch (status) {
    case "met":
      return "bg-emerald-100 border-emerald-500/40 dark:bg-[var(--rd-profit-dim,rgb(6_78_59/0.3))]";
    case "missed":
      return "bg-rose-100 border-rose-500/40 dark:bg-[var(--rd-loss-dim,rgb(136_19_55/0.25))]";
    case "current":
      return "bg-amber-100 border-amber-500/40 dark:border-[var(--rd-profit,rgb(245_158_11/0.4))] dark:bg-[var(--rd-profit-dim,rgb(120_53_15/0.25))]";
    default:
      return "bg-slate-100 border-border dark:bg-[var(--rd-bg-surface,#0f172a)]";
  }
}

function GoalTrackerClassic() {
  const { formatCurrency } = useCurrency();
  const isMobile = useIsMobile();
  const g = useGoalTracker();
  const {
    isAllPortfolios,
    selectedPortfolio,
    isLoading,
    goalAmountInput,
    setGoalAmountInput,
    monthlyDepositInput,
    setMonthlyDepositInput,
    annualReturnInput,
    setAnnualReturnInput,
    initialAmountInput,
    setInitialAmountInput,
    useCurrentPortfolioAsInitial,
    onToggleUseCurrent,
    setSelectedYear,
    setSelectedMonthKey,
    effectiveSelectedYear,
    yearsList,
    yearRows,
    selectedDetail,
    model,
    chartData,
    chartYDomain,
    effectiveInitialDisplay,
    latestActualValue,
    goalAmount,
  } = g;

  const tooltipBoxClass = "rounded-lg border border-border bg-popover px-3 py-2.5 text-[11px] leading-4 shadow-lg max-w-[240px]";
  const goalLineColor = "var(--rd-warning, hsl(142 60% 40%))";
  const overlineClass = "text-[10px] font-semibold uppercase leading-3 tracking-[0.8px]";

  return (
    <div className="flex flex-col gap-3 px-3 sm:px-0 pb-4 sm:pb-0">
      <div className="space-y-1">
        <p className={`${overlineClass} text-tertiary`}>
          {isAllPortfolios ? "Všetky portfóliá" : `Portfólio: ${selectedPortfolio?.name ?? "Vybrané"}`}
        </p>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          Môj cieľ
          <HelpTip title="Ako funguje sekcia Môj cieľ">
            <p>
              Živý tracker: plánovaná krivka (zložené úročenie) vs. skutočná hodnota portfólia
              mesiac po mesiaci — aj do minulosti, aj do budúcnosti.
            </p>
            <p>
              Mesačný úrok: (1 + r<sub>pa</sub>)<sup>1/12</sup> − 1. Plán(t) = Plán(t−1)·(1+r) + PMT.
            </p>
            <p>
              Odhad dátumu cieľa má dve verzie: podľa cieľového výnosu a podľa tvojho reálneho tempa
              za posledné mesiace.
            </p>
          </HelpTip>
        </h1>
        {g.firstMonthKey ? (
          <p className="text-xs md:text-[13px] text-muted-foreground">
            Sledovanie od {g.firstMonthKey} (prvá transakcia)
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1">
            Nastavenie cieľa
            <HelpTip title="Vstupy">
              <p>Počiatočná suma = štart sledovania (alebo live hodnota pri zapnutom prepínači).</p>
              <p>Mesačný vklad = plánované dokladanie každý mesiac.</p>
              <p>Cieľový úrok je ročné zhodnotenie, prepočítané na zložený mesačný úrok.</p>
              <p>Cieľová suma je hodnota, ktorú chceš dosiahnuť.</p>
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Nastav cieľ, vklad a výnos. Kalendár a ETA sa prepočítajú z histórie aj z live hodnoty.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2 grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="goal-initial" className="text-xs sm:text-[12px] text-muted-foreground">Počiatočná suma</Label>
            <Input
              id="goal-initial"
              value={
                useCurrentPortfolioAsInitial
                  ? String(Math.round(effectiveInitialDisplay))
                  : initialAmountInput
              }
              onChange={(e) => setInitialAmountInput(e.target.value)}
              className="h-9 sm:h-10"
              inputMode="decimal"
              disabled={useCurrentPortfolioAsInitial}
              data-testid="input-goal-initial-amount"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-target" className="text-xs sm:text-[12px] text-muted-foreground">Cieľová suma</Label>
            <Input
              id="goal-target"
              value={goalAmountInput}
              onChange={(e) => setGoalAmountInput(e.target.value)}
              className="h-9 sm:h-10"
              inputMode="decimal"
              data-testid="input-goal-target-amount"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-monthly" className="text-xs sm:text-[12px] text-muted-foreground">Mesačný vklad</Label>
            <Input
              id="goal-monthly"
              value={monthlyDepositInput}
              onChange={(e) => setMonthlyDepositInput(e.target.value)}
              className="h-9 sm:h-10"
              inputMode="decimal"
              data-testid="input-goal-monthly-deposit"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-return" className="text-xs sm:text-[12px] text-muted-foreground">Cieľový úrok (% p.a.)</Label>
            <Input
              id="goal-return"
              value={annualReturnInput}
              onChange={(e) => setAnnualReturnInput(e.target.value)}
              className="h-9 sm:h-10"
              inputMode="decimal"
              data-testid="input-goal-annual-return"
            />
          </div>
          <div className="sm:col-span-2 pt-0.5">
            <div className="flex items-start sm:items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs sm:text-[13px] font-medium flex items-center gap-1">
                  Použiť aktuálnu hodnotu portfólia
                  <HelpTip title="Automatické predvyplnenie počiatočnej sumy">
                    <p>
                      Keď je zapnuté, počiatočná suma a budúci plán sa berú z live hodnoty portfólia.
                      Minulé mesiace sa stále porovnávajú s plánom od začiatku histórie.
                    </p>
                  </HelpTip>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {latestActualValue != null && Number.isFinite(latestActualValue)
                    ? `Aktuálna hodnota: ${formatCurrency(latestActualValue)}`
                    : "Aktuálna hodnota zatiaľ nie je dostupná."}
                </p>
              </div>
              <Switch
                checked={useCurrentPortfolioAsInitial}
                onCheckedChange={onToggleUseCurrent}
                data-testid="switch-goal-use-current-portfolio"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1">
            Kedy dosiahnem cieľ?
            <HelpTip title="Dve predikcie">
              <p>
                <strong>Plán</strong> — pri tvojom cieľovom výnose a mesačnom vklade.
              </p>
              <p>
                <strong>Reálny trend</strong> — z priemerného mesačného zhodnotenia a vkladov za posledné
                mesiace histórie.
              </p>
            </HelpTip>
          </CardTitle>
          <Target className="h-4 w-4 shrink-0 text-primary" />
        </CardHeader>
        <CardContent className="p-4 pt-1 space-y-3">
          <p
            className="text-2xl md:text-[28px] md:leading-[34px] font-bold leading-tight tracking-tight text-primary tabular-nums"
            data-testid="text-goal-projected-final-value"
          >
            {formatCurrency(model.summary.projectedFinalValue)}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1 dark:bg-background" data-testid="text-goal-hit-date">
              <p className={`${overlineClass} text-primary dark:!text-[var(--rd-profit)]`}>Statický plán</p>
              <p className="text-[11px] leading-4 text-muted-foreground">{model.etaPlan.label}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1 dark:bg-background" data-testid="text-goal-hit-date-real">
              <p className={`${overlineClass} text-amber-600 dark:!text-[var(--rd-warning)]`}>Reálny trend</p>
              <p className="text-[11px] leading-4 text-muted-foreground">{model.etaReal.label}</p>
            </div>
          </div>
          <div className="space-y-2 pt-1 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">Vklady spolu</span>
              <span className="font-semibold tabular-nums">{formatCurrency(model.summary.totalOwnContributions)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">Mesačné vklady spolu</span>
              <span className="font-semibold tabular-nums">{formatCurrency(model.summary.totalPlannedDeposits)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">Zhodnotenie</span>
              <span
                className={`font-semibold tabular-nums ${model.summary.projectedGrowth >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                data-testid="text-goal-projected-growth"
              >
                {model.summary.projectedGrowth >= 0 ? "+" : "-"}
                {formatCurrency(Math.abs(model.summary.projectedGrowth))} ({model.summary.projectedGrowthPct.toFixed(1)}%)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1">
            Cieľ vs realita
            <HelpTip title="Graf cieľ vs realita">
              <p>Zelená/modrá plocha = skutočná hodnota portfólia v minulosti.</p>
              <p>Prerušovaná čiara = plán (pri zapnutom live toggle od dneška dopredu).</p>
              <p>Vodorovná zelená čiara = cieľová suma.</p>
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Plocha = realita. Prerušovaná čiara = plán. Vodorovná = cieľová suma.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-primary" />
              Realita
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-px w-3 bg-foreground" />
              Plán
            </span>
            {!useCurrentPortfolioAsInitial && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-px w-3 bg-muted-foreground" />
                Vklady bez výnosu
              </span>
            )}
            {goalAmount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-3" style={{ backgroundColor: goalLineColor }} />
                Cieľ {formatCurrency(goalAmount)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className={isMobile ? "relative h-[260px] overflow-hidden px-2" : "relative h-[300px] overflow-hidden"}>
          <div className="chart-fade-grid rounded-lg" aria-hidden />
          {isLoading ? (
            <div className="h-full rounded-md border bg-muted/20 animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} className="stroke-muted" opacity={0.5} />
                <XAxis
                  dataKey="label"
                  minTickGap={isMobile ? 18 : 24}
                  tick={{ fontSize: isMobile ? 10 : 11 }}
                  axisLine={false}
                  tickLine={false}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  width={isMobile ? 40 : 56}
                  domain={chartYDomain}
                  allowDataOverflow
                  tick={{ fontSize: isMobile ? 10 : 11 }}
                  axisLine={false}
                  tickLine={false}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("sk-SK", { notation: "compact", maximumFractionDigits: 1 }).format(v)
                  }
                />
                <RTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as GoalChartPoint;
                    const diff =
                      row.actualValue != null && row.planValue != null
                        ? row.actualValue - row.planValue
                        : row.delta;
                    return (
                      <div className={tooltipBoxClass}>
                        <p className="mb-1.5 font-medium text-muted-foreground">{label}</p>
                        <p className="flex items-center gap-1.5">
                          <span className="size-1.5 rounded-full bg-foreground" />
                          Plán: <span className="font-semibold tabular-nums">{formatCurrency(row.planValue)}</span>
                        </p>
                        {row.contributionOnlyValue != null && (
                          <p className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-muted-foreground" />
                            Vklady bez výnosu: {formatCurrency(row.contributionOnlyValue)}
                          </p>
                        )}
                        <p className="flex items-center gap-1.5">
                          <span className="size-1.5 rounded-full bg-primary" />
                          Realita:{" "}
                          <span className="font-semibold tabular-nums">
                            {row.actualValue != null ? formatCurrency(row.actualValue) : "—"}
                          </span>
                        </p>
                        {goalAmount > 0 && (
                          <p className="flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full" style={{ backgroundColor: goalLineColor }} />
                            Cieľ: <span className="font-semibold tabular-nums">{formatCurrency(goalAmount)}</span>
                          </p>
                        )}
                        {diff != null && row.actualValue != null && (
                          <p className={`mt-1 ${diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
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
                    stroke={goalLineColor}
                    strokeWidth={1.5}
                    ifOverflow="extendDomain"
                  />
                )}
                {chartData.some((p) => p.isCurrent) && (
                  <ReferenceLine
                    x={chartData.find((p) => p.isCurrent)!.label}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="2 2"
                    ifOverflow="hidden"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="actualValue"
                  name="Realita"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary) / 0.18)"
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="targetValue"
                  name="Plán"
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {!useCurrentPortfolioAsInitial && (
                  <Line
                    type="monotone"
                    dataKey="contributionOnlyValue"
                    name="Vklady bez výnosu"
                    stroke="hsl(var(--muted-foreground))"
                    strokeOpacity={0.6}
                    dot={false}
                    strokeWidth={1.25}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-1">
                Mesačný kalendár (4 × 3)
                <HelpTip title="Ako čítať mesačný grid">
                  <p>
                    Na bunke je tvoja skutočná hodnota portfólia na koniec mesiaca. Budúce mesiace
                    ukazujú plán.
                  </p>
                  <p>Minulé: zelená = realita ≥ plán, červená = pod plánom.</p>
                  <p>Aktuálny mesiac = žltá (prebieha). Budúce mesiace = sivé (predikcia).</p>
                </HelpTip>
              </CardTitle>
              <CardDescription>
                Číslo = skutočná hodnota portfólia na konci mesiaca (budúce = plán).
              </CardDescription>
            </div>
            <Select value={String(effectiveSelectedYear)} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-full sm:w-[110px] sm:h-8 sm:text-[13px]" data-testid="select-goal-year">
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
        <CardContent className="p-4 pt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, m) => {
              const row = yearRows.find((p) => p.month === m) ?? null;
              const active = selectedDetail?.monthKey === row?.monthKey;
              return (
                <button
                  key={`${effectiveSelectedYear}-${m}`}
                  type="button"
                  onClick={() => row && setSelectedMonthKey(row.monthKey)}
                  className={`rounded-lg border px-2.5 sm:px-3 py-2 sm:py-2.5 text-left min-h-[64px] sm:min-h-[70px] ${tileClass(row?.status ?? null)} ${active ? "ring-2 ring-primary" : ""}`}
                  data-testid={`goal-month-${effectiveSelectedYear}-${m + 1}`}
                >
                  <p className={`text-xs sm:text-[12px] font-medium ${row?.status === "current" ? "text-primary dark:!text-[var(--rd-profit)]" : "text-muted-foreground"}`}>
                    {MONTHS_SK[m]}
                  </p>
                  <p className="text-[11px] sm:text-[13px] font-semibold text-foreground mt-1 leading-tight tabular-nums">
                    {row ? formatCurrency(calendarTileAmount(row)) : "—"}
                  </p>
                  <p className={`text-[10px] sm:text-[11px] mt-0.5 ${row?.status === "current" ? "text-primary dark:!text-[var(--rd-profit)]" : "text-muted-foreground"}`}>
                    {row ? statusLabel(row.status) : "—"}
                  </p>
                </button>
              );
            })}
          </div>

          {selectedDetail && (
            <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-xs space-y-2 dark:bg-background" data-testid="goal-month-detail">
              <p className="text-[13px] font-semibold">
                {MONTHS_SK[selectedDetail.month]} {selectedDetail.year}
                <span className="ml-1.5 text-muted-foreground font-normal">
                  ({statusLabel(selectedDetail.status)})
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">Finálny cieľ (celkový)</span>
                <span className="font-semibold tabular-nums">{formatCurrency(goalAmount)}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">Plán na koniec mesiaca</span>
                <span className="font-semibold tabular-nums">{formatCurrency(selectedDetail.planValue)}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">Tvoja reálna hodnota</span>
                <span className="font-semibold tabular-nums">
                  {selectedDetail.actualValue != null ? formatCurrency(selectedDetail.actualValue) : "Bez dát"}
                </span>
              </p>
              {selectedDetail.depositMonth != null && (
                <p className="flex justify-between gap-3 text-muted-foreground">
                  <span>Čistý vklad v mesiaci</span>
                  <span className="tabular-nums">{formatCurrency(selectedDetail.depositMonth)}</span>
                </p>
              )}
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">Stav voči mesačnému plánu</span>
                <span
                  className={`font-semibold tabular-nums ${
                    (selectedDetail.delta ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {selectedDetail.delta != null
                    ? `${selectedDetail.delta >= 0 ? "+" : "-"}${formatCurrency(Math.abs(selectedDetail.delta))}`
                    : "—"}
                </span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GoalTracker() {
  const redesign = useMobileRedesign();
  return redesign ? <GoalTrackerMobile /> : <GoalTrackerClassic />;
}
