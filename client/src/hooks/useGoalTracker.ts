import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/usePortfolio";
import {
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
  const [anchorMonthKey, setAnchorMonthKey] = useState(monthKeyFromDate(new Date()));
  const [anchorValue, setAnchorValue] = useState(10000);
  const [hydrated, setHydrated] = useState(false);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");

  const { data: history, isLoading } = useQuery<{
    points: Array<{ date: string; totalValue: number; netInvested: number }>;
  }>({
    queryKey: ["/api/portfolio-history", portfolioParam, "all", "goal-tracker-v2"],
    queryFn: async () => {
      const params = new URLSearchParams({
        portfolio: portfolioParam,
        range: "all",
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

  // Rehydrate settings when portfolio scope changes (not on every history tick).
  useEffect(() => {
    setHydrated(false);
    const saved = loadGoalSettings(scopeKey);
    const next = saved ?? defaultGoalSettings();
    setGoalAmountInput(String(next.goalAmount));
    setMonthlyDepositInput(String(next.monthlyDeposit));
    setAnnualReturnInput(String(next.annualReturnPct));
    setInitialAmountInput(String(next.manualInitialAmount));
    setUseCurrentPortfolioAsInitial(next.useCurrentPortfolioAsInitial);
    setAnchorMonthKey(next.anchorMonthKey);
    setAnchorValue(next.anchorValue);
    setHydrated(true);
  }, [scopeKey]);

  // Doplň T_start z histórie, keď príde (bez resetu užívateľských inputov).
  useEffect(() => {
    if (!hydrated || !firstMonthKey) return;
    if (monthlyMap.has(anchorMonthKey)) return;
    const first = monthlyMap.get(firstMonthKey);
    if (!first) return;
    setAnchorMonthKey(firstMonthKey);
    setAnchorValue(first.actualValue);
  }, [hydrated, firstMonthKey, monthlyMap, anchorMonthKey]);

  const settings: GoalSettings = useMemo(() => {
    const goalAmount = Math.max(0, parseNumberInput(goalAmountInput, 0));
    const monthlyDeposit = parseNumberInput(monthlyDepositInput, 0);
    const annualReturnPct = parseNumberInput(annualReturnInput, 0);
    const manualInitialAmount = Math.max(0, parseNumberInput(initialAmountInput, 0));
    let aValue = Math.max(0, anchorValue);
    const aMonth = anchorMonthKey;

    if (useCurrentPortfolioAsInitial) {
      if (monthlyMap.has(aMonth)) {
        aValue = Math.max(0, monthlyMap.get(aMonth)!.actualValue);
      } else if (latestActualValue != null) {
        aValue = Math.max(0, latestActualValue);
      }
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
    anchorMonthKey,
    anchorValue,
    latestActualValue,
    monthlyMap,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    saveGoalSettings(scopeKey, settings);
  }, [hydrated, scopeKey, settings]);

  const onToggleUseCurrent = (on: boolean) => {
    setUseCurrentPortfolioAsInitial(on);
    if (on && latestActualValue != null) {
      setInitialAmountInput(String(Math.round(latestActualValue)));
      if (firstMonthKey && monthlyMap.has(firstMonthKey)) {
        setAnchorMonthKey(firstMonthKey);
        setAnchorValue(monthlyMap.get(firstMonthKey)!.actualValue);
      } else {
        setAnchorMonthKey(monthKeyFromDate(new Date()));
        setAnchorValue(latestActualValue);
      }
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

  const chartData = useMemo(
    () =>
      model.months.map((m) => ({
        ...m,
        targetValue: m.planValue,
      })),
    [model.months],
  );

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
    effectiveInitialDisplay,
    latestActualValue,
    goalAmount: settings.goalAmount,
  };
}

export type GoalTrackerController = ReturnType<typeof useGoalTracker>;
