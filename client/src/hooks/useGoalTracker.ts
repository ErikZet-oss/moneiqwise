import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/usePortfolio";
import {
  buildGoalChartData,
  buildGoalModel,
  buildMonthlySeries,
  defaultGoalSettings,
  loadGoalSettings,
  monthKeyFromDate,
  parseNumberInput,
  saveGoalSettings,
  type GoalSettings,
} from "@/lib/goalTracker";

export function useGoalTracker() {
  const { getQueryParam, selectedPortfolio, isAllPortfolios, scopeLabel } =
    usePortfolio();
  const portfolioParam = getQueryParam();
  const scopeKey = portfolioParam || "all";

  const [goalAmountInput, setGoalAmountInput] = useState("100000");
  const [monthlyDepositInput, setMonthlyDepositInput] = useState("100");
  const [annualReturnInput, setAnnualReturnInput] = useState("15");
  const [initialAmountInput, setInitialAmountInput] = useState("10000");
  const [useCurrentPortfolioAsInitial, setUseCurrentPortfolioAsInitial] =
    useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");

  const { data: history, isLoading } = useQuery<{
    points: Array<{ date: string; totalValue: number; netInvested: number }>;
  }>({
    queryKey: [
      "/api/portfolio-history",
      portfolioParam,
      "all",
      "goal-tracker-monthly-v3",
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        portfolio: portfolioParam,
        range: "all",
        granularity: "monthly",
        benchmark: "0",
      });
      const res = await fetch(`/api/portfolio-history?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Nepodarilo sa načítať históriu pre Môj cieľ.");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const points = history?.points ?? [];
  const monthlyMap = useMemo(() => buildMonthlySeries(points), [points]);
  const latestActualValue =
    points.length > 0 ? points[points.length - 1]?.totalValue ?? null : null;
  const firstMonthKey = useMemo(() => {
    const keys = Array.from(monthlyMap.keys()).sort();
    return keys[0] ?? null;
  }, [monthlyMap]);
  const firstMonthValue = firstMonthKey
    ? monthlyMap.get(firstMonthKey)?.actualValue ?? null
    : null;

  // Rehydrate user inputs when portfolio scope changes.
  useEffect(() => {
    setHydrated(false);
    const saved = loadGoalSettings(scopeKey);
    const next = saved ?? defaultGoalSettings();
    setGoalAmountInput(String(next.goalAmount));
    setMonthlyDepositInput(String(next.monthlyDeposit));
    setAnnualReturnInput(String(next.annualReturnPct));
    setInitialAmountInput(String(next.manualInitialAmount));
    setUseCurrentPortfolioAsInitial(next.useCurrentPortfolioAsInitial);
    setHydrated(true);
  }, [scopeKey]);

  const settings: GoalSettings = useMemo(() => {
    const goalAmount = Math.max(0, parseNumberInput(goalAmountInput, 0));
    const monthlyDeposit = parseNumberInput(monthlyDepositInput, 0);
    const annualReturnPct = parseNumberInput(annualReturnInput, 0);
    const manualInitialAmount = Math.max(0, parseNumberInput(initialAmountInput, 0));

    // T_start = vždy mesiac prvej transakcie (ak história existuje).
    const aMonth = firstMonthKey ?? monthKeyFromDate(new Date());
    let aValue: number;
    if (useCurrentPortfolioAsInitial) {
      aValue = Math.max(0, firstMonthValue ?? latestActualValue ?? 0);
    } else {
      aValue = manualInitialAmount;
    }

    return {
      goalAmount,
      monthlyDeposit,
      annualReturnPct,
      useCurrentPortfolioAsInitial,
      manualInitialAmount,
      anchorMonthKey: aMonth,
      anchorValue: aValue,
    };
  }, [
    goalAmountInput,
    monthlyDepositInput,
    annualReturnInput,
    initialAmountInput,
    useCurrentPortfolioAsInitial,
    firstMonthKey,
    firstMonthValue,
    latestActualValue,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    saveGoalSettings(scopeKey, settings);
  }, [hydrated, scopeKey, settings]);

  const onToggleUseCurrent = (on: boolean) => {
    setUseCurrentPortfolioAsInitial(on);
    if (on && latestActualValue != null) {
      setInitialAmountInput(String(Math.round(latestActualValue)));
    }
  };

  const model = useMemo(
    () =>
      buildGoalModel({
        settings,
        historyPoints: points,
        liveValue: latestActualValue,
      }),
    [settings, points, latestActualValue],
  );

  const yearsList = useMemo(() => {
    const set = new Set<number>();
    for (const m of model.months) set.add(m.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [model.months]);

  const effectiveSelectedYear = useMemo(() => {
    if (selectedYear && yearsList.includes(Number(selectedYear))) {
      return Number(selectedYear);
    }
    const cy = new Date().getFullYear();
    if (yearsList.includes(cy)) return cy;
    return yearsList[0] ?? cy;
  }, [selectedYear, yearsList]);

  const yearRows = useMemo(
    () => model.months.filter((m) => m.year === effectiveSelectedYear),
    [model.months, effectiveSelectedYear],
  );

  const selectedDetail = useMemo(() => {
    if (selectedMonthKey) {
      return model.months.find((m) => m.monthKey === selectedMonthKey) ?? null;
    }
    const cur = yearRows.find((m) => m.monthKey === model.currentMonthKey);
    return cur ?? yearRows[0] ?? null;
  }, [model.months, model.currentMonthKey, selectedMonthKey, yearRows]);

  const effectiveInitialDisplay = settings.useCurrentPortfolioAsInitial
    ? model.currentValue ?? settings.anchorValue
    : settings.manualInitialAmount;

  const chart = useMemo(
    () => buildGoalChartData(model, settings.goalAmount),
    [model, settings.goalAmount],
  );
  const chartData = chart.points;
  const chartYDomain = chart.yDomain;

  return {
    portfolioParam,
    selectedPortfolio,
    isAllPortfolios,
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
    selectedYear,
    setSelectedYear,
    selectedMonthKey,
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
    goalAmount: settings.goalAmount,
    firstMonthKey,
  };
}

export type GoalTrackerController = ReturnType<typeof useGoalTracker>;
