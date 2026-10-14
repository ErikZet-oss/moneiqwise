/** Shared math + timeline for „Môj cieľ“. */

export const MONTHS_SK = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Máj",
  "Jún",
  "Júl",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dec",
] as const;

export type GoalHistoryPoint = {
  date: string;
  totalValue: number;
  netInvested: number;
};

export type GoalSettings = {
  goalAmount: number;
  monthlyDeposit: number;
  annualReturnPct: number;
  useCurrentPortfolioAsInitial: boolean;
  manualInitialAmount: number;
  /** YYYY-MM — začiatok sledovania plánu */
  anchorMonthKey: string;
  /** Hodnota portfólia (alebo manuál) na začiatku anchor mesiaca */
  anchorValue: number;
};

export type MonthStatus = "met" | "missed" | "current" | "future" | "no_data";

export type GoalMonthPoint = {
  idx: number;
  monthKey: string;
  date: string;
  year: number;
  month: number;
  label: string;
  planValue: number;
  contributionOnlyValue: number;
  actualValue: number | null;
  depositMonth: number | null;
  delta: number | null;
  status: MonthStatus;
};

/** Číslo v kalendári: realita (minulosť/teraz), plán (budúcnosť / bez dát). */
export function calendarTileAmount(row: GoalMonthPoint): number {
  if (row.status === "future" || row.actualValue == null) return row.planValue;
  return row.actualValue;
}

export type GoalChartPoint = {
  label: string;
  monthKey: string;
  /** Realita — null = budúcnosť (Area sa skončí). */
  actualValue: number | null;
  /**
   * Plánovaná krivka.
   * Pri „použiť aktuálnu hodnotu“: null v minulosti (čiara ide od dnes dopredu),
   * inak celá historická plánovaná krivka.
   */
  targetValue: number | null;
  contributionOnlyValue: number | null;
  isCurrent: boolean;
  planValue: number;
  delta: number | null;
};

export type GoalEta = {
  months: number | null;
  hitDate: string | null;
  label: string;
};

export type GoalModelResult = {
  settings: GoalSettings;
  currentMonthKey: string;
  currentValue: number | null;
  effectiveStartValue: number;
  months: GoalMonthPoint[];
  etaPlan: GoalEta;
  etaReal: GoalEta;
  summary: {
    projectedFinalValue: number;
    totalPlannedDeposits: number;
    totalOwnContributions: number;
    projectedGrowth: number;
    projectedGrowthPct: number;
  };
  realTrend: {
    windowMonths: number;
    monthlyReturnPct: number | null;
    avgMonthlyDeposit: number | null;
  };
};

/**
 * Dáta pre graf: od T_start po dosiahnutie cieľa (+ rezerva), bez 100-ročného chvosta.
 * Y-domain pri live toggle zoomuje na pásmo reality/plánu (nie na starý nízky benchmark).
 */
export function buildGoalChartData(
  model: GoalModelResult,
  goalAmount: number,
): { points: GoalChartPoint[]; yDomain: [number, number] | ["auto", "auto"] } {
  const months = model.months;
  if (months.length === 0) {
    return { points: [], yDomain: ["auto", "auto"] };
  }

  const curIdx = months.findIndex((m) => m.monthKey === model.currentMonthKey);
  const goalHitIdx = months.findIndex(
    (m) =>
      goalAmount > 0 &&
      m.planValue >= goalAmount &&
      (curIdx < 0 || m.idx >= (months[curIdx]?.idx ?? 0)),
  );
  const endIdx = Math.min(
    months.length - 1,
    Math.max(
      curIdx >= 0 ? curIdx + 24 : 36,
      goalHitIdx >= 0 ? goalHitIdx + 3 : (curIdx >= 0 ? curIdx : 0) + 36,
      18,
    ),
  );

  const useLive = model.settings.useCurrentPortfolioAsInitial;
  const points: GoalChartPoint[] = months.slice(0, endIdx + 1).map((m) => {
    const isFuture = m.monthKey > model.currentMonthKey;
    const isPast = m.monthKey < model.currentMonthKey;
    // Pri live toggle: plánová čiara od aktuálneho mesiaca (bez skoku z nízkeho hist. plánu).
    const showPlan = !useLive || !isPast;
    return {
      label: m.label,
      monthKey: m.monthKey,
      actualValue: isFuture ? null : m.actualValue,
      targetValue: showPlan ? m.planValue : null,
      contributionOnlyValue: showPlan ? m.contributionOnlyValue : null,
      isCurrent: m.monthKey === model.currentMonthKey,
      planValue: m.planValue,
      delta: m.delta,
    };
  });

  const nums: number[] = [];
  for (const p of points) {
    if (p.actualValue != null && Number.isFinite(p.actualValue)) nums.push(p.actualValue);
    if (p.targetValue != null && Number.isFinite(p.targetValue)) nums.push(p.targetValue);
  }
  if (goalAmount > 0) nums.push(goalAmount);

  if (nums.length === 0) {
    return { points, yDomain: ["auto", "auto"] };
  }

  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const pad = Math.max((hi - lo) * 0.08, hi * 0.02, 1);
  const yMin = useLive ? Math.max(0, lo - pad) : 0;
  const yMax = hi + pad;
  return { points, yDomain: [yMin, yMax] };
}

export function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (!Number.isFinite(year) || month < 0 || month > 11) return null;
  return { year, month };
}

export function addMonthsKey(key: string, n: number): string {
  const p = parseMonthKey(key);
  if (!p) return key;
  const d = new Date(p.year, p.month + n, 1);
  return monthKeyFromDate(d);
}

export function parseNumberInput(raw: string, fallback: number): number {
  const n = Number.parseFloat(String(raw).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

/** Efektívna mesačná sadzba zo zloženého ročného úroku. */
export function monthlyRateFromAnnualPct(annualPct: number): number {
  const r = annualPct / 100;
  if (!Number.isFinite(r) || r <= -0.999999) return 0;
  return Math.pow(1 + r, 1 / 12) - 1;
}

/**
 * Počet mesiacov do cieľa (uzavretý tvar).
 * n = ln((V_t * r + PMT) / (V_c * r + PMT)) / ln(1+r)
 */
export function monthsToReachGoal(input: {
  currentValue: number;
  targetValue: number;
  monthlyDeposit: number;
  monthlyRate: number;
}): number | null {
  const V = Math.max(0, input.currentValue);
  const T = input.targetValue;
  const PMT = input.monthlyDeposit;
  const r = input.monthlyRate;
  if (!(T > 0) || !Number.isFinite(T)) return null;
  if (V >= T) return 0;
  if (!(r > 0)) {
    if (!(PMT > 0)) return null;
    return Math.ceil((T - V) / PMT);
  }
  const num = T * r + PMT;
  const den = V * r + PMT;
  if (!(den > 0) || !(num > 0) || num / den <= 0) return null;
  const n = Math.log(num / den) / Math.log(1 + r);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.ceil(n);
}

export function hitDateFromMonths(fromMonthKey: string, months: number | null): string | null {
  if (months == null || !Number.isFinite(months)) return null;
  const key = addMonthsKey(fromMonthKey, Math.max(0, months));
  return `${key}-01`;
}

/** Posledný bod v každom YYYY-MM. */
export function buildMonthlySeries(points: GoalHistoryPoint[]): Map<
  string,
  { monthKey: string; date: string; actualValue: number; netInvested: number }
> {
  const raw = new Map<
    string,
    { monthKey: string; date: string; actualValue: number; netInvested: number }
  >();
  for (const p of points) {
    const d = new Date(`${p.date}T12:00:00`);
    if (Number.isNaN(d.getTime()) || !Number.isFinite(p.totalValue)) continue;
    const key = monthKeyFromDate(d);
    raw.set(key, {
      monthKey: key,
      date: p.date,
      actualValue: p.totalValue,
      netInvested: Number.isFinite(p.netInvested) ? p.netInvested : 0,
    });
  }

  // Doplň medzery medzi prvým a posledným mesiacom (forward-fill),
  // aby kalendár vedel vyhodnotiť každý mesiac od prvej transakcie.
  const keys = Array.from(raw.keys()).sort();
  if (keys.length === 0) return raw;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const filled = new Map(raw);
  let cursor = first;
  let prev = raw.get(first)!;
  while (cursor < last) {
    cursor = addMonthsKey(cursor, 1);
    if (filled.has(cursor)) {
      prev = filled.get(cursor)!;
    } else {
      filled.set(cursor, {
        monthKey: cursor,
        date: `${cursor}-28`,
        actualValue: prev.actualValue,
        netInvested: prev.netInvested,
      });
    }
  }
  return filled;
}

function depositForMonth(
  map: ReturnType<typeof buildMonthlySeries>,
  monthKey: string,
  prevKey: string | null,
): number | null {
  const cur = map.get(monthKey);
  if (!cur) return null;
  if (!prevKey) return null;
  const prev = map.get(prevKey);
  if (!prev) return null;
  return cur.netInvested - prev.netInvested;
}

/** Geometrický priemerný mesačný výnos z reálnych hodnôt (posledných N mesiacov). */
export function estimateRealMonthlyReturn(
  monthKeysAsc: string[],
  map: ReturnType<typeof buildMonthlySeries>,
  window = 6,
): { monthlyReturn: number | null; avgDeposit: number | null; used: number } {
  const withData = monthKeysAsc.filter((k) => map.has(k));
  if (withData.length < 2) {
    return { monthlyReturn: null, avgDeposit: null, used: 0 };
  }
  const slice = withData.slice(-Math.max(2, window + 1));
  const returns: number[] = [];
  const deposits: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const a = map.get(slice[i - 1]!)!;
    const b = map.get(slice[i]!)!;
    if (a.actualValue > 0 && b.actualValue > 0) {
      // Odstráň vplyv vkladu: V' ≈ V_end - deposit
      const dep = b.netInvested - a.netInvested;
      const endAdj = b.actualValue - dep;
      if (endAdj > 0) {
        returns.push(endAdj / a.actualValue - 1);
      }
      deposits.push(dep);
    }
  }
  if (returns.length === 0) {
    return { monthlyReturn: null, avgDeposit: null, used: 0 };
  }
  const geo =
    Math.exp(returns.reduce((s, x) => s + Math.log(1 + x), 0) / returns.length) - 1;
  const avgDeposit =
    deposits.length > 0
      ? deposits.reduce((s, x) => s + x, 0) / deposits.length
      : null;
  return {
    monthlyReturn: Number.isFinite(geo) ? geo : null,
    avgDeposit: avgDeposit != null && Number.isFinite(avgDeposit) ? avgDeposit : null,
    used: returns.length,
  };
}

export function defaultGoalSettings(input?: {
  currentValue?: number | null;
  firstMonthKey?: string | null;
}): GoalSettings {
  const now = monthKeyFromDate(new Date());
  const anchor = input?.firstMonthKey || now;
  const value =
    input?.currentValue != null && Number.isFinite(input.currentValue)
      ? Math.max(0, input.currentValue)
      : 10000;
  return {
    goalAmount: 100000,
    monthlyDeposit: 100,
    annualReturnPct: 15,
    useCurrentPortfolioAsInitial: true,
    manualInitialAmount: value,
    anchorMonthKey: anchor,
    anchorValue: value,
  };
}

export function buildGoalModel(input: {
  settings: GoalSettings;
  historyPoints: GoalHistoryPoint[];
  /** Live aktuálna hodnota (preferovaná pred posledným hist. bodom). */
  liveValue?: number | null;
}): GoalModelResult {
  const map = buildMonthlySeries(input.historyPoints);
  const currentMonthKey = monthKeyFromDate(new Date());
  const lastHist = input.historyPoints[input.historyPoints.length - 1];
  const currentValue =
    input.liveValue != null && Number.isFinite(input.liveValue)
      ? input.liveValue
      : lastHist && Number.isFinite(lastHist.totalValue)
        ? lastHist.totalValue
        : map.get(currentMonthKey)?.actualValue ?? null;

  const s = input.settings;
  const rMonthly = monthlyRateFromAnnualPct(s.annualReturnPct);

  // Vždy sleduj od prvej dostupnej histórie (prvá transakcia), nie od „teraz“.
  const histKeysAsc = Array.from(map.keys()).sort();
  const firstHistKey = histKeysAsc[0] ?? null;
  const firstHistVal = firstHistKey ? map.get(firstHistKey)?.actualValue ?? null : null;
  const anchorKey =
    firstHistKey && (!s.anchorMonthKey || s.anchorMonthKey > firstHistKey)
      ? firstHistKey
      : s.anchorMonthKey || firstHistKey || currentMonthKey;
  const planStartValue = Math.max(
    0,
    // Pri live toggle: minulý plán štartuje z reálnej hodnoty pri T_start.
    s.useCurrentPortfolioAsInitial && firstHistVal != null && anchorKey === firstHistKey
      ? firstHistVal
      : s.anchorValue > 0
        ? s.anchorValue
        : firstHistVal ?? 0,
  );

  // Horizont: od anchora aspoň po cieľ + 12 mesiacov, max 100 rokov.
  const etaFromAnchor = monthsToReachGoal({
    currentValue: planStartValue,
    targetValue: s.goalAmount,
    monthlyDeposit: s.monthlyDeposit,
    monthlyRate: rMonthly,
  });
  const horizonMonths = Math.min(
    12 * 100,
    Math.max(24, (etaFromAnchor ?? 60) + 24, monthDiff(anchorKey, currentMonthKey) + 18),
  );

  const months: GoalMonthPoint[] = [];
  let balance = planStartValue;
  let contributionOnly = planStartValue;
  let prevKey: string | null = null;
  const vNow =
    s.useCurrentPortfolioAsInitial && currentValue != null
      ? Math.max(0, currentValue)
      : planStartValue;
  let rebasedFromLive = false;

  for (let i = 0; i <= horizonMonths; i++) {
    const key = addMonthsKey(anchorKey, i);
    if (i > 0) {
      balance = balance * (1 + rMonthly) + s.monthlyDeposit;
      contributionOnly += s.monthlyDeposit;
    }

    // Pri „použiť aktuálnu hodnotu“: od aktuálneho mesiaca rebase plánu z live hodnoty.
    if (
      s.useCurrentPortfolioAsInitial &&
      currentValue != null &&
      key >= currentMonthKey &&
      !rebasedFromLive
    ) {
      balance = Math.max(0, currentValue);
      contributionOnly = Math.max(0, currentValue);
      rebasedFromLive = true;
    }

    const p = parseMonthKey(key)!;
    const actualRow = map.get(key);
    let actualValue = actualRow?.actualValue ?? null;
    // Aktuálny mesiac: preferuj live hodnotu.
    if (key === currentMonthKey && currentValue != null) {
      actualValue = currentValue;
    }
    const depositMonth = depositForMonth(map, key, prevKey);
    const delta = actualValue != null ? actualValue - balance : null;
    let status: MonthStatus;
    if (key > currentMonthKey) status = "future";
    else if (key === currentMonthKey) status = "current";
    else if (actualValue == null) status = "no_data";
    else status = actualValue >= balance ? "met" : "missed";

    months.push({
      idx: i,
      monthKey: key,
      date: `${key}-01`,
      year: p.year,
      month: p.month,
      label: `${MONTHS_SK[p.month]} ${String(p.year).slice(-2)}`,
      planValue: balance,
      contributionOnlyValue: contributionOnly,
      actualValue,
      depositMonth,
      delta,
      status,
    });
    prevKey = key;
  }

  const planMonths = monthsToReachGoal({
    currentValue: vNow,
    targetValue: s.goalAmount,
    monthlyDeposit: s.monthlyDeposit,
    monthlyRate: rMonthly,
  });

  const histKeys = Array.from(map.keys()).sort();
  const real = estimateRealMonthlyReturn(histKeys, map, 6);
  const realPmt =
    real.avgDeposit != null && real.avgDeposit > 0
      ? real.avgDeposit
      : s.monthlyDeposit;
  const realMonths =
    real.monthlyReturn != null
      ? monthsToReachGoal({
          currentValue: vNow,
          targetValue: s.goalAmount,
          monthlyDeposit: realPmt,
          monthlyRate: real.monthlyReturn,
        })
      : null;

  const planHit = hitDateFromMonths(currentMonthKey, planMonths);
  const realHit = hitDateFromMonths(currentMonthKey, realMonths);

  // Summary od „teraz“ (ETA), nie od historického anchora.
  const plannedMonthsCount = Math.max(0, planMonths ?? 0);
  const totalPlannedDeposits = s.monthlyDeposit * plannedMonthsCount;
  const totalOwnContributions = vNow + totalPlannedDeposits;
  const projectedFinalValue =
    s.goalAmount > 0 && planMonths != null
      ? (() => {
          let bal = vNow;
          for (let i = 0; i < plannedMonthsCount; i++) {
            bal = bal * (1 + rMonthly) + s.monthlyDeposit;
          }
          return bal;
        })()
      : months[months.length - 1]?.planValue ?? vNow;
  const projectedGrowth = projectedFinalValue - totalOwnContributions;

  return {
    settings: s,
    currentMonthKey,
    currentValue,
    effectiveStartValue: vNow,
    months,
    etaPlan: {
      months: planMonths,
      hitDate: planHit,
      label:
        planMonths == null
          ? "Pri plánovanom výnose cieľ v horizonte nie je dosiahnuteľný."
          : planMonths === 0
            ? "Cieľ je už dosiahnutý."
            : `Pri ${s.annualReturnPct.toFixed(1)} % p.a. a ${s.monthlyDeposit.toFixed(0)} €/mes. ≈ ${formatSkMonthYear(planHit)} (${planMonths} mes.)`,
    },
    etaReal: {
      months: realMonths,
      hitDate: realHit,
      label:
        real.monthlyReturn == null
          ? "Reálny trend: málo histórie (potrebujem aspoň 2 mesiace)."
          : realMonths == null
            ? "Pri reálnom tempe cieľ v horizonte nie je dosiahnuteľný."
            : realMonths === 0
              ? "Pri reálnom tempe je cieľ už dosiahnutý."
              : `Pri reálnom tempe (~${(real.monthlyReturn * 100).toFixed(2)} %/mes., vklad ~${(realPmt).toFixed(0)} €) ≈ ${formatSkMonthYear(realHit)} (${realMonths} mes.)`,
    },
    summary: {
      projectedFinalValue,
      totalPlannedDeposits,
      totalOwnContributions,
      projectedGrowth,
      projectedGrowthPct:
        totalOwnContributions > 0 ? (projectedGrowth / totalOwnContributions) * 100 : 0,
    },
    realTrend: {
      windowMonths: real.used,
      monthlyReturnPct:
        real.monthlyReturn != null ? real.monthlyReturn * 100 : null,
      avgMonthlyDeposit: real.avgDeposit,
    },
  };
}

function monthDiff(fromKey: string, toKey: string): number {
  const a = parseMonthKey(fromKey);
  const b = parseMonthKey(toKey);
  if (!a || !b) return 0;
  return (b.year - a.year) * 12 + (b.month - a.month);
}

function formatSkMonthYear(isoDay: string | null): string {
  if (!isoDay) return "—";
  const d = new Date(`${isoDay}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("sk-SK", { month: "long", year: "numeric" });
}

const STORAGE_PREFIX = "moneiqwise.goal.v1:";

export function loadGoalSettings(scopeKey: string): GoalSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + scopeKey);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    return {
      goalAmount: Number(o.goalAmount) || 100000,
      monthlyDeposit: Number(o.monthlyDeposit) || 100,
      annualReturnPct: Number(o.annualReturnPct) || 15,
      useCurrentPortfolioAsInitial: o.useCurrentPortfolioAsInitial !== false,
      manualInitialAmount: Number(o.manualInitialAmount) || 10000,
      anchorMonthKey: String(o.anchorMonthKey || monthKeyFromDate(new Date())),
      anchorValue: Number(o.anchorValue) || 10000,
    };
  } catch {
    return null;
  }
}

export function saveGoalSettings(scopeKey: string, settings: GoalSettings) {
  try {
    localStorage.setItem(STORAGE_PREFIX + scopeKey, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
