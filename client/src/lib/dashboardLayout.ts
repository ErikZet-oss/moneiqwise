/** Bloky Prehľadu, ktoré ide zapnúť/vypnúť a premiestniť. */
export const DASHBOARD_WIDGET_IDS = [
  "summary",
  "chart",
  "insights",
  "news",
  "dailyMovers",
  "holdings",
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

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
  insights: { label: "Insights", required: false },
  news: { label: "Novinky", required: false },
  dailyMovers: { label: "Najlepšie / najhoršie", required: false },
  holdings: { label: "Prehľad aktív", required: false },
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  order: [...DASHBOARD_WIDGET_IDS],
  visible: {
    summary: true,
    chart: true,
    insights: true,
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

export function normalizeDashboardLayout(
  raw: unknown,
  seed?: Partial<Record<"news" | "dailyMovers" | "chart", boolean>>,
): DashboardLayout {
  const base = DEFAULT_DASHBOARD_LAYOUT;
  const parsed =
    raw && typeof raw === "object" ? (raw as Partial<DashboardLayout>) : {};

  const seen = new Set<DashboardWidgetId>();
  const order: DashboardWidgetId[] = [];
  const rawOrder = Array.isArray(parsed.order) ? parsed.order : [];
  for (const item of rawOrder) {
    if (!isDashboardWidgetId(item) || seen.has(item)) continue;
    seen.add(item);
    order.push(item);
  }
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) order.push(id);
  }

  const rawVisible =
    parsed.visible && typeof parsed.visible === "object" ? parsed.visible : {};
  const visible = { ...base.visible };
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (typeof (rawVisible as Record<string, unknown>)[id] === "boolean") {
      visible[id] = (rawVisible as Record<string, boolean>)[id]!;
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
