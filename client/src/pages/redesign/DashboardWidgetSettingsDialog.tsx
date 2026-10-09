import type { ReactNode } from "react";
import {
  useChartSettings,
  type ChartBenchmarkId,
  type DailyMoversDisplayCount,
  type MobileAssetsView,
} from "@/hooks/useChartSettings";
import { CHART_BENCHMARK_OPTIONS } from "@/lib/chartBenchmarks";
import {
  DASHBOARD_WIDGET_META,
  type DashboardWidgetId,
} from "@/lib/dashboardLayout";
import { DASHBOARD_WIDGETS_WITH_SETTINGS } from "@/components/DashboardWidgetSettingsButton";
import { Dialog, Select, Toggle } from "@/redesign/ui";

export { DASHBOARD_WIDGETS_WITH_SETTINGS };

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="rd-type-body-strong text-[var(--rd-text-primary)]">{title}</p>
        <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

export function DashboardWidgetSettingsDialog({
  widgetId,
  onClose,
}: {
  widgetId: DashboardWidgetId | null;
  onClose: () => void;
}) {
  const {
    hideAmounts,
    setHideAmounts,
    showTooltip,
    setShowTooltip,
    showChartBenchmark,
    setShowChartBenchmark,
    chartBenchmarkId,
    setChartBenchmarkId,
    dailyMoversCount,
    setDailyMoversCount,
    mobileAssetsView,
    setMobileAssetsView,
  } = useChartSettings();

  if (!widgetId || !DASHBOARD_WIDGETS_WITH_SETTINGS.has(widgetId)) return null;

  const title = DASHBOARD_WIDGET_META[widgetId].label;

  return (
    <Dialog open title={title} onClose={onClose} showHelpIcon={false}>
      <div className="mt-2 flex flex-col gap-1">
        {widgetId === "summary" ? (
          <SettingRow
            title="Skryť sumy"
            description="Nahradiť peňažné hodnoty hviezdičkami"
            control={
              <Toggle
                checked={hideAmounts}
                onCheckedChange={setHideAmounts}
                label="Skryť sumy"
              />
            }
          />
        ) : null}

        {widgetId === "chart" ? (
          <>
            <SettingRow
              title="Interakcia s grafom"
              description="Zobraziť hodnotu pri dotyku / kliknutí"
              control={
                <Toggle
                  checked={showTooltip}
                  onCheckedChange={setShowTooltip}
                  label="Interakcia s grafom"
                />
              }
            />
            <div className="h-px bg-[var(--rd-border-subtle)]" />
            <SettingRow
              title="Porovnanie s indexom"
              description="Obidve krivky v % od začiatku obdobia"
              control={
                <Toggle
                  checked={showChartBenchmark}
                  onCheckedChange={setShowChartBenchmark}
                  label="Porovnanie s indexom"
                />
              }
            />
            {showChartBenchmark ? (
              <Select
                label="Porovnať s"
                value={chartBenchmarkId}
                options={CHART_BENCHMARK_OPTIONS.map((opt) => ({
                  value: opt.id,
                  label: opt.label,
                }))}
                onChange={(value) => setChartBenchmarkId(value as ChartBenchmarkId)}
              />
            ) : null}
          </>
        ) : null}

        {widgetId === "dailyGainers" || widgetId === "dailyLosers" ? (
          <div className="flex flex-col gap-2 py-1">
            <div>
              <p className="rd-type-body-strong text-[var(--rd-text-primary)]">Počet pozícií v rebríčku</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Platí pre najsilnejšie aj najslabšie
              </p>
            </div>
            <Select
              value={String(dailyMoversCount)}
              options={[
                { value: "1", label: "1" },
                { value: "3", label: "3" },
                { value: "5", label: "5" },
              ]}
              onChange={(value) =>
                setDailyMoversCount(parseInt(value, 10) as DailyMoversDisplayCount)
              }
            />
          </div>
        ) : null}

        {widgetId === "holdings" ? (
          <div className="flex flex-col gap-2 py-1">
            <div>
              <p className="rd-type-body-strong text-[var(--rd-text-primary)]">Zobrazenie aktív (mobil)</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Podrobný zoznam alebo jednoduchý prehľad
              </p>
            </div>
            <Select
              value={mobileAssetsView}
              options={[
                { value: "detailed", label: "Podrobné" },
                { value: "simple", label: "Jednoduché" },
              ]}
              onChange={(value) => setMobileAssetsView(value as MobileAssetsView)}
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
