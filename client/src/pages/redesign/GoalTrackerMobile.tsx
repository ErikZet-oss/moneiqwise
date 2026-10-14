import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { useCurrency } from "@/hooks/useCurrency";
import { useGoalTracker } from "@/hooks/useGoalTracker";
import { Badge, Card, Input, Select, Toggle, TopBar } from "@/redesign/ui";
import { HelpButton, KvRow, PageBody, PortfolioSwitcher, signedMoney, signedPct, toneOf } from "./mobileChrome";
import { MONTHS_SK, type GoalMonthPoint } from "@/lib/goalTracker";

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

function tileTone(status: GoalMonthPoint["status"] | null): string {
  switch (status) {
    case "met":
      return "border-[var(--rd-profit)] bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]";
    case "missed":
      return "border-[var(--rd-loss)] bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]";
    case "current":
      return "border-[var(--rd-warning,#d97706)] bg-[color-mix(in_srgb,var(--rd-warning,#d97706)_18%,transparent)] text-[var(--rd-warning,#d97706)]";
    default:
      return "border-[var(--rd-border-subtle)] text-[var(--rd-text-tertiary)]";
  }
}

export default function GoalTrackerMobile() {
  const { formatCurrency } = useCurrency();
  const [pickerOpen, setPickerOpen] = useState(false);
  const g = useGoalTracker();
  const {
    scopeLabel,
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
    goalAmount,
  } = g;

  const planHitLabel = model.etaPlan.hitDate
    ? new Date(`${model.etaPlan.hitDate}T12:00:00`).toLocaleDateString("sk-SK", {
        month: "short",
        year: "numeric",
      })
    : "—";

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline={scopeLabel} title="Môj cieľ" onOverlineClick={() => setPickerOpen(true)} />
      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <PageBody>
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 text-xs leading-4 text-[var(--rd-text-secondary)]">
            {g.firstMonthKey
              ? `Plán od ${g.firstMonthKey} (prvá transakcia) — minulé mesiace zelená/červená podľa splnenia.`
              : "Živý tracker: plán vs. realita v minulosti aj v budúcnosti."}
          </p>
          <HelpButton
            title="Ako funguje sekcia Môj cieľ"
            body="Plánovaná krivka (zložené úročenie) vs. skutočná hodnota portfólia. ETA má dve verzie: cieľový výnos a reálne tempo za posledné mesiace."
          />
        </div>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Nastavenie cieľa</p>
              <HelpButton
                title="Vstupy"
                body="Zadaj cieľovú hodnotu, mesačný vklad a ročný výnos. Počiatočná suma môže ísť z aktuálnej hodnoty portfólia — budúci plán sa potom rebaseuje z live hodnoty."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              Zadaj cieľovú hodnotu, mesačný vklad a ročný výnos.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Počiatočná suma"
              value={
                useCurrentPortfolioAsInitial
                  ? String(Math.round(effectiveInitialDisplay))
                  : initialAmountInput
              }
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
              body="Keď je zapnuté, počiatočná suma a budúci plán sa berú z live hodnoty portfólia. Minulé mesiace sa porovnávajú s plánom od začiatku histórie."
            />
            <Toggle
              checked={useCurrentPortfolioAsInitial}
              onCheckedChange={onToggleUseCurrent}
              label="Použiť aktuálnu hodnotu portfólia"
            />
          </div>
        </Card>

        <Card className="gap-2">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 rd-type-overline text-[var(--rd-text-tertiary)]">Kedy dosiahnem cieľ?</p>
            <HelpButton
              title="Dve predikcie"
              body="Statický plán = cieľový výnos + PMT. Reálny trend = priemerné mesačné zhodnotenie a vklady z histórie."
            />
          </div>
          <p className="rd-type-display-hero" data-testid="text-goal-projected-final-value">
            {formatCurrency(model.summary.projectedFinalValue)}
          </p>
          <div className="flex items-center gap-2">
            <Badge label={planHitLabel} tone="Profit" />
            <p className="text-xs text-[var(--rd-text-secondary)]">
              {model.etaPlan.months != null ? `${model.etaPlan.months} mes.` : "mimo horizontu"}
            </p>
          </div>
          <p className="text-xs leading-4 text-[var(--rd-text-secondary)]" data-testid="text-goal-hit-date">
            {model.etaPlan.label}
          </p>
          <p className="text-xs leading-4 text-[var(--rd-text-secondary)]" data-testid="text-goal-hit-date-real">
            {model.etaReal.label}
          </p>
          <KvRow label="Vklady spolu" value={formatCurrency(model.summary.totalOwnContributions)} />
          <KvRow label="Mesačné vklady spolu" value={formatCurrency(model.summary.totalPlannedDeposits)} />
          <KvRow
            label="Zhodnotenie"
            value={`${signedMoney(formatCurrency, model.summary.projectedGrowth)} (${signedPct(model.summary.projectedGrowthPct, 1)})`}
            tone={toneOf(model.summary.projectedGrowth)}
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
                <AreaChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
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
                      const row = payload[0]?.payload as GoalMonthPoint & { targetValue: number };
                      return (
                        <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-2 text-xs">
                          <p>{row.label}</p>
                          <p>Cieľ: {formatCurrency(row.planValue)}</p>
                          <p>Realita: {row.actualValue != null ? formatCurrency(row.actualValue) : "—"}</p>
                        </div>
                      );
                    }}
                  />
                  {goalAmount > 0 ? (
                    <ReferenceLine y={goalAmount} stroke="var(--rd-profit)" strokeDasharray="4 4" />
                  ) : null}
                  <Area
                    type="monotone"
                    dataKey="actualValue"
                    stroke="var(--rd-profit)"
                    fill="var(--rd-profit)"
                    fillOpacity={0.2}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="targetValue"
                    stroke="var(--rd-text-secondary)"
                    strokeDasharray="6 4"
                    dot={false}
                  />
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
                body="Minulé: zelená = realita ≥ plán, červená = pod plánom. Aktuálny = prebieha. Budúce = sivé (predikcia)."
              />
            </div>
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              Číslo = koľko by si mal mať na konci mesiaca podľa plánu.
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
              const active = selectedDetail?.monthKey === row?.monthKey;
              return (
                <button
                  key={`${effectiveSelectedYear}-${month}`}
                  type="button"
                  onClick={() => row && setSelectedMonthKey(row.monthKey)}
                  className={`min-h-[64px] rounded-[var(--rd-radius-sm)] border bg-[var(--rd-bg-surface-raised)] px-2 py-2 text-left ${tileTone(row?.status ?? null)} ${active ? "ring-1 ring-[var(--rd-text-primary)]" : ""}`}
                >
                  <p className="text-xs font-medium text-[var(--rd-text-primary)]">{MONTHS_SK[month]}</p>
                  <p className="mt-1 font-mono text-[10px] leading-3 tabular-nums">
                    {row ? formatCurrency(row.planValue) : "—"}
                  </p>
                  <p className="mt-0.5 text-[9px] leading-3 opacity-80">
                    {row ? statusLabel(row.status) : "—"}
                  </p>
                </button>
              );
            })}
          </div>
          {selectedDetail ? (
            <div className="flex flex-col gap-2 rounded-[var(--rd-radius-sm)] bg-[var(--rd-bg-surface-raised)] p-3">
              <p className="text-sm font-semibold">
                {MONTHS_SK[selectedDetail.month]} {selectedDetail.year}{" "}
                <span className="font-normal text-[var(--rd-text-tertiary)]">
                  ({statusLabel(selectedDetail.status)})
                </span>
              </p>
              <KvRow label="Finálny cieľ (celkový)" value={formatCurrency(goalAmount)} />
              <KvRow label="Plán na koniec mesiaca" value={formatCurrency(selectedDetail.planValue)} />
              <KvRow
                label="Tvoja reálna hodnota"
                value={selectedDetail.actualValue != null ? formatCurrency(selectedDetail.actualValue) : "Bez dát"}
              />
              {selectedDetail.depositMonth != null ? (
                <KvRow label="Čistý vklad v mesiaci" value={formatCurrency(selectedDetail.depositMonth)} />
              ) : null}
              <KvRow
                label="Stav voči mesačnému plánu"
                value={
                  selectedDetail.delta != null
                    ? signedMoney(formatCurrency, selectedDetail.delta)
                    : "—"
                }
                tone={toneOf(selectedDetail.delta ?? 0)}
              />
            </div>
          ) : null}
        </Card>
      </PageBody>
    </div>
  );
}
