import { ChevronDown, ChevronRight, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { Badge, type BadgeTone } from "./Badge";
import { Delta, type DeltaTrend } from "./Delta";

export function LotRow({
  label = "Nákup",
  tone = "Profit",
  date,
  lot,
  returnLabel,
  trend = "Up",
}: {
  label?: string;
  tone?: BadgeTone;
  date: string;
  lot: string;
  returnLabel: string;
  trend?: DeltaTrend;
}) {
  const returnClass =
    trend === "Down"
      ? "text-[var(--rd-loss)]"
      : trend === "Flat"
        ? "text-[var(--rd-text-secondary)]"
        : "text-[var(--rd-profit)]";
  return (
    <div className="flex min-h-11 w-full items-center gap-2 py-2">
      <Badge label={label} tone={tone} />
      <p className="min-w-0 flex-1 font-mono text-xs font-medium leading-4 text-[var(--rd-text-secondary)]">
        {date}
      </p>
      <p className="shrink-0 font-mono text-xs font-medium leading-4 text-[var(--rd-text-primary)]">
        {lot}
      </p>
      <p className={cn("shrink-0 text-right font-mono text-xs font-medium leading-4", returnClass)}>
        {returnLabel}
      </p>
    </div>
  );
}

export type HoldingLot = {
  date: string;
  lot: string;
  returnLabel: string;
  trend?: DeltaTrend;
  label?: string;
  tone?: BadgeTone;
};

function AfterHours({
  price,
  change,
  className,
}: {
  price?: string;
  change?: string;
  className?: string;
}) {
  if (!price && !change) return null;
  return (
    <div className={cn("flex items-center gap-1 text-[var(--rd-text-tertiary)]", className)}>
      <Moon className="size-3" aria-hidden />
      <span className="text-xs leading-4">Mimo trhu</span>
      {price ? <span className="font-mono text-[10px] leading-3 text-[var(--rd-text-primary)]">{price}</span> : null}
      {change ? <span className="font-mono text-[10px] leading-3">{change}</span> : null}
    </div>
  );
}

export function HoldingRow({
  ticker,
  name,
  qty,
  value,
  delta,
  trend = "Flat",
  onTickerClick,
}: {
  ticker: string;
  name: string;
  qty: string;
  value: string;
  delta: string;
  trend?: DeltaTrend;
  onTickerClick?: () => void;
}) {
  return (
    <div className="flex min-h-11 w-full items-center gap-3 py-3">
      <Avatar ticker={ticker} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {onTickerClick ? (
            <button type="button" onClick={onTickerClick} className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">
              {ticker}
            </button>
          ) : (
            <p className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">{ticker}</p>
          )}
          <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{qty}</p>
        </div>
        <p className="truncate text-xs leading-4 text-[var(--rd-text-secondary)]">{name}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">{value}</p>
        <Delta value={delta} trend={trend} />
      </div>
    </div>
  );
}

export function HoldingRowExpandable({
  ticker,
  name,
  qty,
  value,
  delta,
  trend = "Flat",
  avg,
  price,
  dayChange,
  dayTrend = "Flat",
  pl,
  plTrend = "Up",
  expanded = false,
  onToggle,
  onTickerClick,
  lots = [],
  afterHoursPrice,
  afterHoursChange,
}: {
  ticker: string;
  name: string;
  qty: string;
  value: string;
  delta: string;
  trend?: DeltaTrend;
  avg?: string;
  price?: string;
  dayChange?: string;
  dayTrend?: DeltaTrend;
  pl?: string;
  plTrend?: DeltaTrend;
  expanded?: boolean;
  onToggle?: () => void;
  onTickerClick?: () => void;
  lots?: HoldingLot[];
  afterHoursPrice?: string;
  afterHoursChange?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-2 py-3">
      <div className="flex min-h-11 items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Zbaliť loty" : "Rozbaliť loty"}
          onClick={onToggle}
          className="inline-flex size-8 items-center justify-center text-[var(--rd-text-tertiary)]"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <Avatar ticker={ticker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {onTickerClick ? (
              <button type="button" onClick={onTickerClick} className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">
                {ticker}
              </button>
            ) : (
              <p className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">{ticker}</p>
            )}
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{qty}</p>
          </div>
          <p className="truncate text-xs leading-4 text-[var(--rd-text-secondary)]">{name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">{value}</p>
          <Delta value={delta} trend={trend} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pl-6">
        <div className="flex min-w-0 items-center gap-3 text-xs leading-4 text-[var(--rd-text-tertiary)]">
          {avg ? (
            <span>
              Priem <span className="font-mono text-[10px] leading-3 text-[var(--rd-text-primary)]">{avg}</span>
            </span>
          ) : null}
          {price ? (
            <span>
              Cena <span className="font-mono text-[10px] leading-3 text-[var(--rd-text-primary)]">{price}</span>{" "}
              {dayChange ? (
                <span
                  className={cn(
                    "font-mono text-[10px] leading-3",
                    dayTrend === "Down" ? "text-[var(--rd-loss)]" : dayTrend === "Up" ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-tertiary)]",
                  )}
                >
                  {dayChange}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        {pl ? (
          <p className={cn("shrink-0 font-mono text-xs font-medium leading-4", plTrend === "Down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]")}>
            {pl}
          </p>
        ) : null}
      </div>
      <AfterHours price={afterHoursPrice} change={afterHoursChange} className="pl-6" />
      {expanded && lots.length > 0 ? (
        <div className="pl-2">
          {lots.map((lot) => (
            <LotRow key={`${lot.date}-${lot.lot}`} {...lot} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HoldingRowSimple({
  ticker,
  name,
  assetType = "Akcie",
  value,
  lot,
  dayChange,
  dayTrend = "Flat",
  pl,
  expanded = false,
  onToggle,
  lots = [],
  afterHoursPrice,
  afterHoursChange,
}: {
  ticker: string;
  name: string;
  assetType?: string;
  value: string;
  lot: string;
  dayChange?: string;
  dayTrend?: DeltaTrend;
  pl?: string;
  expanded?: boolean;
  onToggle?: () => void;
  lots?: HoldingLot[];
  afterHoursPrice?: string;
  afterHoursChange?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-2 py-3">
      <div className="flex min-h-11 items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Zbaliť loty" : "Rozbaliť loty"}
          onClick={onToggle}
          className="inline-flex size-8 items-center justify-center text-[var(--rd-text-tertiary)]"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <Avatar ticker={ticker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-[var(--rd-text-primary)]">{name}</p>
            <Badge label={assetType} />
            <p className="shrink-0 font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">{value}</p>
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] leading-3">
            <p className="min-w-0 flex-1 truncate text-[var(--rd-text-secondary)]">{lot}</p>
            {dayChange ? (
              <p className={dayTrend === "Down" ? "text-[var(--rd-loss)]" : dayTrend === "Up" ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-secondary)]"}>
                {dayChange}
              </p>
            ) : null}
            {pl ? <p className="text-[var(--rd-profit)]">{pl}</p> : null}
          </div>
        </div>
      </div>
      <AfterHours price={afterHoursPrice} change={afterHoursChange} className="pl-[68px]" />
      {expanded && lots.length > 0 ? (
        <div className="pl-2">
          {lots.map((item) => (
            <LotRow key={`${item.date}-${item.lot}`} {...item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
