import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
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
import { MONTHS_SK, calendarTileAmount, type GoalMonthPoint } from "@/lib/goalTracker";

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
      return "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-500/40";
    case "missed":
      return "bg-rose-100 dark:bg-rose-900/25 border-rose-500/40";
    case "current":
      return "bg-amber-100 dark:bg-amber-900/25 border-amber-500/40";
    default:
      return "bg-slate-100 dark:bg-slate-900";
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
    effectiveInitialDisplay,
    latestActualValue,
    goalAmount,
  } = g;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-3 md:gap-6 px-3 sm:px-0 pb-4 sm:pb-0">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Target className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
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
        <p className="text-xs text-muted-foreground">
          {isAllPortfolios ? "Všetky portfóliá" : `Portfólio: ${selectedPortfolio?.name ?? "Vybrané"}`}
          {g.firstMonthKey
            ? ` · Sledovanie od ${g.firstMonthKey} (prvá transakcia)`
            : null}
        </p>
      </div>

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
        <CardContent className="p-4 pt-3 grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="goal-initial" className="text-xs sm:text-sm">Počiatočná suma</Label>
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
                      Keď je zapnuté, počiatočná suma a budúci plán sa berú z live hodnoty portfólia.
                      Minulé mesiace sa stále porovnávajú s plánom od začiatku histórie.
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
                onCheckedChange={onToggleUseCurrent}
                data-testid="switch-goal-use-current-portfolio"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
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
        </CardHeader>
        <CardContent className="p-4 pt-3 space-y-3">
          <p className="text-2xl font-semibold leading-tight tracking-tight" data-testid="text-goal-projected-final-value">
            {formatCurrency(model.summary.projectedFinalValue)}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 text-xs sm:text-sm">
            <div className="rounded-md border p-2.5 space-y-1" data-testid="text-goal-hit-date">
              <p className="text-[11px] sm:text-xs text-muted-foreground font-medium">Statický plán</p>
              <p>{model.etaPlan.label}</p>
            </div>
            <div className="rounded-md border p-2.5 space-y-1" data-testid="text-goal-hit-date-real">
              <p className="text-[11px] sm:text-xs text-muted-foreground font-medium">Reálny trend</p>
              <p>{model.etaReal.label}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 text-xs sm:text-sm">
            <div className="rounded-md border p-2.5">
              <p className="text-muted-foreground text-[11px] sm:text-xs">Vklady spolu</p>
              <p className="font-semibold mt-0.5">{formatCurrency(model.summary.totalOwnContributions)}</p>
            </div>
            <div className="rounded-md border p-2.5">
              <p className="text-muted-foreground text-[11px] sm:text-xs">Mesačné vklady spolu</p>
              <p className="font-semibold mt-0.5">{formatCurrency(model.summary.totalPlannedDeposits)}</p>
            </div>
            <div className="rounded-md border p-2.5">
              <p className="text-muted-foreground text-[11px] sm:text-xs">Zhodnotenie</p>
              <p
                className={`font-semibold mt-0.5 ${model.summary.projectedGrowth >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                data-testid="text-goal-projected-growth"
              >
                {model.summary.projectedGrowth >= 0 ? "+" : "-"}
                {formatCurrency(Math.abs(model.summary.projectedGrowth))} ({model.summary.projectedGrowthPct.toFixed(1)}%)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1">
            Cieľ vs realita
            <HelpTip title="Graf cieľ vs realita">
              <p>Prerušovaná čiara je plán (target), plocha je skutočný stav portfólia (actual).</p>
              <p>Vodorovná zelená čiara je tvoja cieľová suma.</p>
              <p>Sivá čiara ukazuje len tvoje čisté vklady bez zhodnotenia.</p>
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Prerušovaná čiara = cieľový plán. Plocha = reálna historická hodnota portfólia.
          </CardDescription>
        </CardHeader>
        <CardContent className={isMobile ? "relative h-[260px] overflow-hidden px-2" : "relative h-[340px] overflow-hidden"}>
          <div className="chart-fade-grid rounded-lg" aria-hidden />
          {isLoading ? (
            <div className="h-full rounded-md border bg-muted/20 animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" opacity={0.4} />
                <XAxis dataKey="label" minTickGap={isMobile ? 18 : 24} tick={{ fontSize: isMobile ? 10 : 12 }} />
                <YAxis
                  width={isMobile ? 40 : 56}
                  tick={{ fontSize: isMobile ? 10 : 12 }}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("sk-SK", { notation: "compact", maximumFractionDigits: 1 }).format(v)
                  }
                />
                <RTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as GoalMonthPoint & { targetValue: number };
                    const diff = row.delta;
                    return (
                      <div className="rounded-md border bg-background/95 p-2 text-[11px] sm:text-xs shadow-md max-w-[220px]">
                        <p className="font-medium mb-1">{label}</p>
                        <p>Cieľ: {formatCurrency(row.planValue)}</p>
                        <p className="text-muted-foreground">
                          Vklady bez výnosu: {formatCurrency(row.contributionOnlyValue)}
                        </p>
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
        <CardContent className="p-4 pt-3 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, m) => {
              const row = yearRows.find((p) => p.month === m) ?? null;
              const active = selectedDetail?.monthKey === row?.monthKey;
              return (
                <button
                  key={`${effectiveSelectedYear}-${m}`}
                  type="button"
                  onClick={() => row && setSelectedMonthKey(row.monthKey)}
                  className={`rounded-md border px-2.5 sm:px-3 py-2 text-left min-h-[64px] sm:min-h-[70px] ${tileClass(row?.status ?? null)} ${active ? "ring-2 ring-primary" : ""}`}
                  data-testid={`goal-month-${effectiveSelectedYear}-${m + 1}`}
                >
                  <p className="text-xs sm:text-sm font-medium">{MONTHS_SK[m]}</p>
                  <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 leading-tight tabular-nums">
                    {row ? formatCurrency(calendarTileAmount(row)) : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {row ? statusLabel(row.status) : "—"}
                  </p>
                </button>
              );
            })}
          </div>

          {selectedDetail && (
            <div className="rounded-md border p-3 text-xs sm:text-sm space-y-1.5" data-testid="goal-month-detail">
              <p className="font-medium">
                {MONTHS_SK[selectedDetail.month]} {selectedDetail.year}
                <span className="ml-2 text-muted-foreground font-normal">
                  ({statusLabel(selectedDetail.status)})
                </span>
              </p>
              <p>Finálny cieľ (celkový): {formatCurrency(goalAmount)}</p>
              <p>Plán na koniec mesiaca: {formatCurrency(selectedDetail.planValue)}</p>
              <p>
                Tvoja reálna hodnota:{" "}
                {selectedDetail.actualValue != null ? formatCurrency(selectedDetail.actualValue) : "Bez dát"}
              </p>
              {selectedDetail.depositMonth != null && (
                <p className="text-muted-foreground">
                  Čistý vklad v mesiaci: {formatCurrency(selectedDetail.depositMonth)}
                </p>
              )}
              <p
                className={
                  (selectedDetail.delta ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"
                }
              >
                Stav voči mesačnému plánu:{" "}
                {selectedDetail.delta != null
                  ? `${selectedDetail.delta >= 0 ? "+" : "-"}${formatCurrency(Math.abs(selectedDetail.delta))}`
                  : "—"}
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
