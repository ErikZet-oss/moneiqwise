import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

/** Widgety, ktoré majú dodatočné nastavenia (ako v Nastaveniach). */
export const DASHBOARD_WIDGETS_WITH_SETTINGS = new Set<DashboardWidgetId>([
  "summary",
  "chart",
  "dailyGainers",
  "dailyLosers",
  "holdings",
]);

type Props = {
  id: DashboardWidgetId;
};

export function DashboardWidgetSettingsButton({ id }: Props) {
  if (!DASHBOARD_WIDGETS_WITH_SETTINGS.has(id)) return null;

  const meta = DASHBOARD_WIDGET_META[id];
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-8 w-8 rounded-full shadow-sm"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Nastavenia: ${meta.label}`}
          data-testid={`dashboard-widget-settings-${id}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-3 space-y-3"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium">{meta.label}</p>

        {id === "summary" && (
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <Label htmlFor={`dash-hide-amounts-${id}`} className="text-sm font-medium">
                Skryť sumy
              </Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Nahradiť peňažné hodnoty hviezdičkami
              </p>
            </div>
            <Switch
              id={`dash-hide-amounts-${id}`}
              checked={hideAmounts}
              onCheckedChange={setHideAmounts}
              data-testid="dashboard-setting-hide-amounts"
            />
          </div>
        )}

        {id === "chart" && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <Label htmlFor={`dash-tooltip-${id}`} className="text-sm font-medium">
                  Interakcia s grafom
                </Label>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Zobraziť hodnotu pri dotyku / kliknutí
                </p>
              </div>
              <Switch
                id={`dash-tooltip-${id}`}
                checked={showTooltip}
                onCheckedChange={setShowTooltip}
                data-testid="dashboard-setting-chart-tooltip"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
              <div className="space-y-0.5 min-w-0">
                <Label htmlFor={`dash-benchmark-${id}`} className="text-sm font-medium">
                  Porovnanie s indexom
                </Label>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Obidve krivky v % od začiatku obdobia
                </p>
              </div>
              <Switch
                id={`dash-benchmark-${id}`}
                checked={showChartBenchmark}
                onCheckedChange={setShowChartBenchmark}
                data-testid="dashboard-setting-chart-benchmark"
              />
            </div>

            {showChartBenchmark && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Porovnať s</Label>
                <Select
                  value={chartBenchmarkId}
                  onValueChange={(v) => setChartBenchmarkId(v as ChartBenchmarkId)}
                >
                  <SelectTrigger
                    className="w-full"
                    data-testid="dashboard-setting-chart-benchmark-id"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHART_BENCHMARK_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}

        {(id === "dailyGainers" || id === "dailyLosers") && (
          <div className="space-y-2">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Počet pozícií v rebríčku</Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Platí pre najsilnejšie aj najslabšie
              </p>
            </div>
            <Select
              value={String(dailyMoversCount)}
              onValueChange={(v) =>
                setDailyMoversCount(parseInt(v, 10) as DailyMoversDisplayCount)
              }
            >
              <SelectTrigger
                className="w-full"
                data-testid="dashboard-setting-daily-movers-count"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {id === "holdings" && (
          <div className="space-y-2">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Zobrazenie aktív (mobil)</Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Podrobný zoznam alebo jednoduchý prehľad
              </p>
            </div>
            <Select
              value={mobileAssetsView}
              onValueChange={(v) => setMobileAssetsView(v as MobileAssetsView)}
            >
              <SelectTrigger
                className="w-full"
                data-testid="dashboard-setting-mobile-assets-view"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="detailed">Podrobné</SelectItem>
                <SelectItem value="simple">Jednoduché</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
