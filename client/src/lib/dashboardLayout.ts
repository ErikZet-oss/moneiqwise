/** Bloky Prehľadu, ktoré ide zapnúť/vypnúť a premiestniť. */
export const DASHBOARD_WIDGET_IDS = [
  "summary",
  "chart",
  "realizedDividends",
  "ytdBenchmark",
  "earnings",
  "topPosition",
  "macroEvent",
  "optionsInsight",
  "news",
  "dailyMovers",
  "holdings",
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** Starý monolitický Insights → tieto widgety. */
export const INSIGHT_WIDGET_IDS = [
  "realizedDividends",
  "ytdBenchmark",
  "earnings",
  "topPosition",
  "macroEvent",
  "optionsInsight",
] as const satisfies readonly DashboardWidgetId[];

export type DashboardLayout = {
  order: DashboardWidgetId[];
  visible: Record<DashboardWidgetId, boolean>;
};

export const DASHBOARD_WIDGET_META: Record<
  DashboardWidgetId,
  { label: string; /** Nedá sa úplne skryť */ required?: boolean }
> = {
  summary: { label: "Súhrn", required: true },
  chart: { label: "Graf", required: false },
  realizedDividends: { label: "Zisk a dividendy", required: false },
  ytdBenchmark: { label: "YTD vs S&P", required: false },
  earnings: { label: "Earnings", required: false },
  topPosition: { label: "Top pozícia", required: false },
  macroEvent: { label: "Makro udalosť", required: false },
  optionsInsight: { label: "Opcie", required: false },
  news: { label: "Novinky", required: false },
  dailyMovers: { label: "Najlepšie / najhoršie", required: false },
  holdings: { label: "Prehľad aktív", required: false },
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  order: [...DASHBOARD_WIDGET_IDS],
  visible: {
    summary: true,
    chart: true,
    realizedDividends: true,
    ytdBenchmark: true,
    earnings: true,
    topPosition: true,
    macroEvent: true,
    optionsInsight: true,
    news: true,
    dailyMovers: true,
    holdings: true,
  },
};

export function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return (
    typeof value === "string" &&
    (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value)
  );
}

function expandOrderItem(item: unknown): DashboardWidgetId[] {
  if (item === "insights") return [...INSIGHT_WIDGET_IDS];
  // Staršie rozdelené boxy → jeden spoločný widget
  if (item === "realizedGain" || item === "dividends") return ["realizedDividends"];
  if (isDashboardWidgetId(item)) return [item];
  return [];
}

export function normalizeDashboardLayout(
  raw: unknown,
  seed?: Partial<Record<"news" | "dailyMovers" | "chart", boolean>>,
): DashboardLayout {
  const base = DEFAULT_DASHBOARD_LAYOUT;
  const parsed =
    raw && typeof raw === "object" ? (raw as Partial<DashboardLayout> & { visible?: Record<string, unknown> }) : {};

  const seen = new Set<DashboardWidgetId>();
  const order: DashboardWidgetId[] = [];
  const rawOrder = Array.isArray(parsed.order) ? parsed.order : [];
  for (const item of rawOrder) {
    for (const id of expandOrderItem(item)) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) order.push(id);
  }

  const rawVisible =
    parsed.visible && typeof parsed.visible === "object" ? parsed.visible : {};
  const legacyInsights =
    typeof rawVisible.insights === "boolean" ? rawVisible.insights : true;

  const visible = { ...base.visible };
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (typeof rawVisible[id] === "boolean") {
      visible[id] = rawVisible[id] as boolean;
    } else if (id === "realizedDividends") {
      const rg = rawVisible.realizedGain;
      const dv = rawVisible.dividends;
      if (typeof rg === "boolean" || typeof dv === "boolean") {
        // Skryť len ak boli oba staré boxy vypnuté
        visible[id] = !(rg === false && dv === false);
      } else {
        visible[id] = legacyInsights;
      }
    } else if ((INSIGHT_WIDGET_IDS as readonly string[]).includes(id)) {
      visible[id] = legacyInsights;
    } else if (id === "news" && typeof seed?.news === "boolean") {
      visible[id] = seed.news;
    } else if (id === "dailyMovers" && typeof seed?.dailyMovers === "boolean") {
      visible[id] = seed.dailyMovers;
    } else if (id === "chart" && typeof seed?.chart === "boolean") {
      visible[id] = seed.chart;
    }
  }
  visible.summary = true;

  return { order, visible };
}

export function reorderDashboardWidgets(
  order: DashboardWidgetId[],
  activeId: string,
  overId: string,
): DashboardWidgetId[] {
  if (!isDashboardWidgetId(activeId) || !isDashboardWidgetId(overId)) return order;
  const oldIndex = order.indexOf(activeId);
  const newIndex = order.indexOf(overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return order;
  const next = [...order];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved!);
  return next;
}
