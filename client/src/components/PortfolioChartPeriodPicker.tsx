import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PortfolioChartPeriod =
  | "1D"
  | "1W"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "ALL";

export type PortfolioChartPeriodSelection =
  | { type: "preset"; period: PortfolioChartPeriod }
  | { type: "custom"; from: string; to: string };

export const PORTFOLIO_CHART_PERIODS: PortfolioChartPeriod[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "ALL",
];

export const portfolioChartPeriodToRange: Record<
  PortfolioChartPeriod,
  "1d" | "1w" | "1m" | "3m" | "6m" | "ytd" | "all"
> = {
  "1D": "1d",
  "1W": "1w",
  "1M": "1m",
  "3M": "3m",
  "6M": "6m",
  YTD: "ytd",
  ALL: "all",
};

export const portfolioChartPeriodGainLabel: Record<PortfolioChartPeriod, string> = {
  "1D": "Za 1D",
  "1W": "Za 1W",
  "1M": "Za 1M",
  "3M": "Za 3M",
  "6M": "Za 6M",
  YTD: "Za YTD",
  ALL: "Celkový",
};

export const portfolioChartPeriodMobileGainLabel: Record<PortfolioChartPeriod, string> = {
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  YTD: "YTD",
  ALL: "celé obdobie",
};

export function portfolioHistoryQueryKeyPart(
  selection: PortfolioChartPeriodSelection,
): string {
  if (selection.type === "custom") {
    return `custom:${selection.from}:${selection.to}`;
  }
  return portfolioChartPeriodToRange[selection.period];
}

export function buildPortfolioHistorySearchParams(
  portfolioParam: string,
  selection: PortfolioChartPeriodSelection,
): URLSearchParams {
  const p = new URLSearchParams();
  p.set("portfolio", portfolioParam);
  if (selection.type === "custom") {
    p.set("from", selection.from);
    p.set("to", selection.to);
  } else {
    p.set("range", portfolioChartPeriodToRange[selection.period]);
  }
  return p;
}

export function chartPeriodGainLabel(
  selection: PortfolioChartPeriodSelection,
  mobile = false,
): string {
  if (selection.type === "custom") {
    if (mobile) return "vlastné obdobie";
    const from = format(parseISO(selection.from), "d. M. yyyy", { locale: sk });
    const to = format(parseISO(selection.to), "d. M. yyyy", { locale: sk });
    return `${from} – ${to}`;
  }
  return mobile
    ? portfolioChartPeriodMobileGainLabel[selection.period]
    : portfolioChartPeriodGainLabel[selection.period];
}

function periodButtonLabel(period: PortfolioChartPeriod): string {
  return period === "ALL" ? "Vše" : period;
}

function isoFromDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

type PortfolioChartPeriodPickerProps = {
  value: PortfolioChartPeriodSelection;
  onChange: (selection: PortfolioChartPeriodSelection) => void;
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
  const [draft, setDraft] = useState<DateRange | undefined>();
  const isDesktop = layout === "desktop";

  useEffect(() => {
    if (!open) return;
    if (value.type === "custom") {
      setDraft({
        from: parseISO(value.from),
        to: parseISO(value.to),
      });
    } else {
      setDraft(undefined);
    }
  }, [open, value]);

  const chipBase = isDesktop
    ? "px-2 py-1 text-[11px] rounded-md font-medium transition-colors inline-flex items-center justify-center"
    : "px-1.5 py-1 text-[11px] rounded-full font-medium transition-colors inline-flex items-center justify-center";

  const chipActive = isDesktop
    ? "bg-primary text-primary-foreground"
    : "bg-muted text-foreground";

  const chipIdle = isDesktop
    ? "bg-muted text-muted-foreground hover:text-foreground"
    : "text-muted-foreground hover:text-foreground";

  const customActive = value.type === "custom";

  const applyCustomRange = () => {
    if (!draft?.from || !draft?.to) return;
    let from = draft.from;
    let to = draft.to;
    if (from > to) {
      const t = from;
      from = to;
      to = t;
    }
    onChange({ type: "custom", from: isoFromDate(from), to: isoFromDate(to) });
    setOpen(false);
  };

  const today = new Date();

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
          "flex items-center gap-1",
          layout === "mobile" && "flex-1 justify-between min-w-0",
        )}
      >
        {PORTFOLIO_CHART_PERIODS.map((period) => {
          const active =
            value.type === "preset" && value.period === period;
          return (
            <button
              key={period}
              type="button"
              onClick={() => onChange({ type: "preset", period })}
              className={cn(chipBase, active ? chipActive : chipIdle)}
              data-testid={
                isDesktop
                  ? `button-desktop-period-${period}`
                  : `button-period-${period}`
              }
            >
              {periodButtonLabel(period)}
            </button>
          );
        })}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                chipBase,
                customActive || open ? chipActive : chipIdle,
                "px-2 min-w-[2rem]",
              )}
              aria-label="Vybrať vlastné obdobie v kalendári"
              data-testid={
                isDesktop
                  ? "button-desktop-chart-period-calendar"
                  : "button-mobile-chart-period-calendar"
              }
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <div className="px-3 pt-3 pb-1">
              <p className="text-xs font-semibold">Vlastné obdobie</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Vyber dátum od a do
              </p>
            </div>
            <Calendar
              mode="range"
              locale={sk}
              selected={draft}
              onSelect={setDraft}
              disabled={{ after: today }}
              numberOfMonths={isDesktop ? 2 : 1}
              defaultMonth={draft?.from ?? today}
              initialFocus
            />
            <div className="flex items-center justify-end gap-2 border-t border-border p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setOpen(false)}
              >
                Zrušiť
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                disabled={!draft?.from || !draft?.to}
                onClick={applyCustomRange}
                data-testid="button-chart-period-apply"
              >
                Použiť
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
