import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  DASHBOARD_WIDGET_META,
  normalizeDashboardLayout,
  reorderDashboardWidgets,
  type DashboardLayout,
  type DashboardWidgetId,
} from "@/lib/dashboardLayout";

const STORAGE_KEY = "moneiqwise-dashboard-layout";

type ChartSeed = Partial<Record<"news" | "dailyMovers" | "chart", boolean>>;

function readChartSeed(): ChartSeed {
  try {
    const stored = localStorage.getItem("portfolio-chart-settings");
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return {
      news: typeof parsed.showNews === "boolean" ? parsed.showNews : undefined,
      dailyMovers:
        typeof parsed.showDailyMovers === "boolean" ? parsed.showDailyMovers : undefined,
      chart: typeof parsed.showChart === "boolean" ? parsed.showChart : undefined,
    };
  } catch {
    return {};
  }
}

function loadLayout(): DashboardLayout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return normalizeDashboardLayout(JSON.parse(stored), readChartSeed());
    }
  } catch {
    // ignore
  }
  return normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT, readChartSeed());
}

function saveLayout(layout: DashboardLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    window.dispatchEvent(new CustomEvent("dashboardLayoutChanged", { detail: layout }));
  } catch {
    // ignore
  }
}

/** Sync showNews / showDailyMovers / showChart v chart settings (plný objekt kvôli listeneru). */
function syncChartSettingsVisibility(layout: DashboardLayout) {
  try {
    const stored = localStorage.getItem("portfolio-chart-settings");
    const prev = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
    const next = {
      showTooltip: false,
      hideAmounts: false,
      dailyMoversCount: 5,
      showAthPopup: true,
      showCalendarEventsPopup: true,
      mobileAssetsSortBy: "name",
      mobileAssetsSortOrder: "asc",
      mobileAssetsView: "detailed",
      ...prev,
      showNews: layout.visible.news,
      showDailyMovers:
        layout.visible.dailyGainers !== false || layout.visible.dailyLosers !== false,
      showChart: layout.visible.chart,
    };
    localStorage.setItem("portfolio-chart-settings", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("chartSettingsChanged", { detail: next }));
  } catch {
    // ignore
  }
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayout>(loadLayout);
  const [editing, setEditingState] = useState(false);

  useEffect(() => {
    const onLayout = (e: CustomEvent<DashboardLayout>) => setLayout(e.detail);
    const onEditing = (e: CustomEvent<boolean>) => setEditingState(e.detail === true);
    const onChart = (e: CustomEvent<Record<string, unknown>>) => {
      const d = e.detail;
      setLayout((prev) => {
        const next = {
          ...prev,
          visible: {
            ...prev.visible,
            summary: true,
            news: typeof d.showNews === "boolean" ? d.showNews : prev.visible.news,
            dailyGainers:
              typeof d.showDailyMovers === "boolean"
                ? d.showDailyMovers
                : prev.visible.dailyGainers,
            dailyLosers:
              typeof d.showDailyMovers === "boolean"
                ? d.showDailyMovers
                : prev.visible.dailyLosers,
            chart: typeof d.showChart === "boolean" ? d.showChart : prev.visible.chart,
          },
        };
        // Avoid loop: only persist if visibility actually changed
        if (
          next.visible.news === prev.visible.news &&
          next.visible.dailyGainers === prev.visible.dailyGainers &&
          next.visible.dailyLosers === prev.visible.dailyLosers &&
          next.visible.chart === prev.visible.chart
        ) {
          return prev;
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    };
    window.addEventListener("dashboardLayoutChanged", onLayout as EventListener);
    window.addEventListener("dashboardEditingChanged", onEditing as EventListener);
    window.addEventListener("chartSettingsChanged", onChart as EventListener);
    return () => {
      window.removeEventListener("dashboardLayoutChanged", onLayout as EventListener);
      window.removeEventListener("dashboardEditingChanged", onEditing as EventListener);
      window.removeEventListener("chartSettingsChanged", onChart as EventListener);
    };
  }, []);

  const setEditing = useCallback((value: boolean) => {
    setEditingState(value);
    window.dispatchEvent(new CustomEvent("dashboardEditingChanged", { detail: value }));
  }, []);

  const commit = useCallback((next: DashboardLayout, syncChart = true) => {
    setLayout(next);
    saveLayout(next);
    if (syncChart) syncChartSettingsVisibility(next);
  }, []);

  const isVisible = useCallback(
    (id: DashboardWidgetId) => layout.visible[id] !== false,
    [layout.visible],
  );

  const toggleVisible = useCallback(
    (id: DashboardWidgetId) => {
      if (DASHBOARD_WIDGET_META[id]?.required) return;
      const next: DashboardLayout = {
        ...layout,
        visible: { ...layout.visible, [id]: !layout.visible[id], summary: true },
      };
      commit(
        next,
        id === "news" ||
          id === "dailyGainers" ||
          id === "dailyLosers" ||
          id === "chart",
      );
    },
    [layout, commit],
  );

  const setOrder = useCallback(
    (order: DashboardWidgetId[]) => {
      commit({ ...layout, order }, false);
    },
    [layout, commit],
  );

  const reorder = useCallback(
    (activeId: string, overId: string) => {
      const order = reorderDashboardWidgets(layout.order, activeId, overId);
      if (order === layout.order) return;
      commit({ ...layout, order }, false);
    },
    [layout, commit],
  );

  const resetLayout = useCallback(() => {
    const next = normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
    commit(next, true);
  }, [commit]);

  return {
    order: layout.order,
    visible: layout.visible,
    editing,
    setEditing,
    isVisible,
    toggleVisible,
    setOrder,
    reorder,
    resetLayout,
  };
}
