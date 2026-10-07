import { useState } from "react";
import { CalendarDays, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PortfolioChartPeriod = "1M" | "3M" | "6M" | "YTD" | "ALL";

export const PORTFOLIO_CHART_PERIODS: PortfolioChartPeriod[] = [
  "1M",
  "3M",
  "6M",
  "YTD",
  "ALL",
];

export const portfolioChartPeriodToRange: Record<
  PortfolioChartPeriod,
  "1m" | "3m" | "6m" | "ytd" | "all"
> = {
  "1M": "1m",
  "3M": "3m",
  "6M": "6m",
  YTD: "ytd",
  ALL: "all",
};

export const portfolioChartPeriodGainLabel: Record<PortfolioChartPeriod, string> = {
  "1M": "Za 1M",
  "3M": "Za 3M",
  "6M": "Za 6M",
  YTD: "Za YTD",
  ALL: "Celkový",
};

/** Mobile P&L row under the chart (shorter wording). */
export const portfolioChartPeriodMobileGainLabel: Record<PortfolioChartPeriod, string> = {
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  YTD: "YTD",
  ALL: "celé obdobie",
};

const PERIOD_MENU: { id: PortfolioChartPeriod; title: string; hint: string }[] = [
  { id: "1M", title: "1 mesiac", hint: "Posledných ~30 dní" },
  { id: "3M", title: "3 mesiace", hint: "Posledné štvrťročie" },
  { id: "6M", title: "6 mesiacov", hint: "Pol roka späť" },
  { id: "YTD", title: "YTD", hint: "Od začiatku roka" },
  { id: "ALL", title: "Celé obdobie", hint: "Všetky dostupné dáta" },
];

function periodButtonLabel(period: PortfolioChartPeriod): string {
  return period === "ALL" ? "Vše" : period;
}

type PortfolioChartPeriodPickerProps = {
  value: PortfolioChartPeriod;
  onChange: (period: PortfolioChartPeriod) => void;
  layout: "desktop" | "mobile";
  className?: string;
};

export function PortfolioChartPeriodPicker({
  value,
  onChange,
  layout,
  className,
}: PortfolioChartPeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = layout === "desktop";

  const pick = (period: PortfolioChartPeriod) => {
    onChange(period);
    setOpen(false);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 shrink-0",
        layout === "mobile" && "w-full justify-between -mx-2 mt-2",
        className,
      )}
    >
      <div
        className={cn(
          "flex gap-1",
          layout === "mobile" && "flex-1 justify-between min-w-0",
        )}
      >
        {PORTFOLIO_CHART_PERIODS.map((period) => (
          <button
            key={period}
            type="button"
            onClick={() => onChange(period)}
            className={cn(
              "font-medium transition-colors",
              isDesktop
                ? cn(
                    "px-2.5 py-1 text-xs rounded-md",
                    value === period
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )
                : cn(
                    "px-3 py-1.5 text-xs rounded-full",
                    value === period
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  ),
            )}
            data-testid={
              isDesktop
                ? `button-desktop-period-${period}`
                : `button-period-${period}`
            }
          >
            {periodButtonLabel(period)}
          </button>
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={open ? "default" : "outline"}
            className={cn(
              "shrink-0",
              isDesktop ? "h-8 w-8" : "h-9 w-9 touch-manipulation",
            )}
            aria-label="Vybrať obdobie grafu"
            data-testid={
              isDesktop
                ? "button-desktop-chart-period-calendar"
                : "button-mobile-chart-period-calendar"
            }
          >
            <CalendarDays className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="end">
          <p className="px-2 py-1.5 text-xs font-semibold text-foreground">
            Obdobie grafu
          </p>
          <ul className="space-y-0.5">
            {PERIOD_MENU.map((item) => {
              const active = value === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => pick(item.id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                      active
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-muted/80 text-foreground",
                    )}
                  >
                    <span className="mt-0.5 shrink-0 w-4">
                      {active ? (
                        <Check className="h-4 w-4 text-primary" aria-hidden />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-tight">
                        {item.title}
                      </span>
                      <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
                        {item.hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
