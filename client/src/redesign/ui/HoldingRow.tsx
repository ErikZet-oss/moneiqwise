import type { ReactNode } from "react";
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
    <div className="flex min-h-[40px] w-full items-center gap-1.5 py-1.5">
      <Badge label={label} tone={tone} />
      <p className="rd-type-data-sm min-w-0 flex-1 text-[var(--rd-text-secondary)]">{date}</p>
      <p className="rd-type-data-sm shrink-0 text-[var(--rd-text-primary)]">{lot}</p>
      <p className={cn("rd-type-data-sm shrink-0 text-right", returnClass)}>{returnLabel}</p>
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
  changeTrend = "Flat",
  className,
}: {
  price?: string;
  change?: string;
  changeTrend?: DeltaTrend;
  className?: string;
}) {
  if (!price && !change) return null;
  const changeClass =
    changeTrend === "Down"
      ? "text-[var(--rd-loss)]"
      : changeTrend === "Up"
        ? "text-[var(--rd-profit)]"
        : "text-[var(--rd-text-tertiary)]";
  return (
    <div className={cn("flex items-center gap-1 text-[var(--rd-text-tertiary)]", className)}>
      <Moon className="size-2.5 shrink-0 text-[var(--rd-warning)]" aria-hidden />
      <span className="rd-type-body-sm">Mimo trhu</span>
      {price ? <span className="rd-type-data-micro text-[var(--rd-text-primary)]">{price}</span> : null}
      {change ? <span className={cn("rd-type-data-micro", changeClass)}>{change}</span> : null}
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
  afterHoursPrice,
  afterHoursChange,
  afterHoursTrend = "Flat",
}: {
  ticker: string;
  name: string;
  qty: string;
  value: string;
  delta: string;
  trend?: DeltaTrend;
  onTickerClick?: () => void;
  afterHoursPrice?: string;
  afterHoursChange?: string;
  afterHoursTrend?: DeltaTrend;
}) {
  return (
    <div className="flex w-full flex-col gap-1 py-2.5">
      <div className="flex min-h-[40px] w-full items-center gap-2">
        <Avatar ticker={ticker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {onTickerClick ? (
              <button type="button" onClick={onTickerClick} className="rd-type-data text-[var(--rd-text-primary)]">
                {ticker}
              </button>
            ) : (
              <p className="rd-type-data text-[var(--rd-text-primary)]">{ticker}</p>
            )}
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">{qty}</p>
          </div>
          <p className="rd-type-body-sm truncate text-[var(--rd-text-secondary)]">{name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <p className="rd-type-data text-[var(--rd-text-primary)]">{value}</p>
          <Delta value={delta} trend={trend} />
        </div>
      </div>
      <AfterHours
        price={afterHoursPrice}
        change={afterHoursChange}
        changeTrend={afterHoursTrend}
        className="pl-[36px]"
      />
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
  afterHoursTrend = "Flat",
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
  afterHoursTrend?: DeltaTrend;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5 py-2.5">
      <div className="flex min-h-[40px] items-center gap-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Zbaliť loty" : "Rozbaliť loty"}
          onClick={onToggle}
          className="inline-flex size-[30px] items-center justify-center text-[var(--rd-text-tertiary)]"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <Avatar ticker={ticker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {onTickerClick ? (
              <button type="button" onClick={onTickerClick} className="rd-type-data text-[var(--rd-text-primary)]">
                {ticker}
              </button>
            ) : (
              <p className="rd-type-data text-[var(--rd-text-primary)]">{ticker}</p>
            )}
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">{qty}</p>
          </div>
          <p className="rd-type-body-sm truncate text-[var(--rd-text-secondary)]">{name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <p className="rd-type-data text-[var(--rd-text-primary)]">{value}</p>
          <Delta value={delta} trend={trend} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pl-8">
        <div className="flex min-w-0 items-center gap-2 rd-type-body-sm text-[var(--rd-text-tertiary)]">
          {avg ? (
            <span>
              Priem <span className="rd-type-data-micro text-[var(--rd-text-primary)]">{avg}</span>
            </span>
          ) : null}
          {price ? (
            <span>
              Cena <span className="rd-type-data-micro text-[var(--rd-text-primary)]">{price}</span>{" "}
              {dayChange ? (
                <span
                  className={cn(
                    "rd-type-data-micro",
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
          <p className={cn("rd-type-data-sm shrink-0", plTrend === "Down" ? "text-[var(--rd-loss)]" : "text-[var(--rd-profit)]")}>
            {pl}
          </p>
        ) : null}
      </div>
      <AfterHours
        price={afterHoursPrice}
        change={afterHoursChange}
        changeTrend={afterHoursTrend}
        className="pl-8"
      />
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
  plTrend = "Flat",
  expandable = true,
  expanded = false,
  onToggle,
  onNameClick,
  lots = [],
  lotsSlot,
  afterHoursPrice,
  afterHoursChange,
  afterHoursTrend = "Flat",
}: {
  ticker: string;
  name: string;
  assetType?: string;
  value: string;
  lot: string;
  dayChange?: string;
  dayTrend?: DeltaTrend;
  /** e.g. "+2 711,68 € (+120.46%)" */
  pl?: string;
  plTrend?: DeltaTrend;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onNameClick?: () => void;
  lots?: HoldingLot[];
  /** Lazy-loaded lots panel (preferred over static `lots`). */
  lotsSlot?: ReactNode;
  afterHoursPrice?: string;
  afterHoursChange?: string;
  afterHoursTrend?: DeltaTrend;
}) {
  const plClass =
    plTrend === "Down"
      ? "text-[var(--rd-loss)]"
      : plTrend === "Up"
        ? "text-[var(--rd-profit)]"
        : "text-[var(--rd-text-secondary)]";
  const dayClass =
    dayTrend === "Down"
      ? "text-[var(--rd-loss)]"
      : dayTrend === "Up"
        ? "text-[var(--rd-profit)]"
        : "text-[var(--rd-text-secondary)]";

  return (
    <div className="flex w-full flex-col gap-1.5 py-2">
      <div className="flex items-center gap-1.5">
        {expandable ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Zbaliť loty" : "Rozbaliť loty"}
            onClick={onToggle}
            className="inline-flex size-4 shrink-0 items-center justify-center text-[var(--rd-text-tertiary)]"
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="inline-block size-4 shrink-0" aria-hidden />
        )}
        <Avatar ticker={ticker} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            {onNameClick ? (
              <button
                type="button"
                onClick={onNameClick}
                className="rd-type-body-strong min-w-0 flex-1 truncate text-left text-[var(--rd-text-primary)]"
              >
                {name}
              </button>
            ) : (
              <p className="rd-type-body-strong min-w-0 flex-1 truncate text-[var(--rd-text-primary)]">{name}</p>
            )}
            <Badge label={assetType} className="shrink-0" />
            <p className="rd-type-data shrink-0 text-[var(--rd-text-primary)]">{value}</p>
          </div>
          <div className="flex items-center gap-1">
            <p className="rd-type-data-micro min-w-0 flex-1 truncate text-[var(--rd-text-secondary)]">{lot}</p>
            {dayChange ? <p className={cn("rd-type-data-micro shrink-0", dayClass)}>{dayChange}</p> : null}
            {pl ? <p className={cn("rd-type-data-micro shrink-0 text-right", plClass)}>{pl}</p> : null}
          </div>
        </div>
      </div>
      <AfterHours
        price={afterHoursPrice}
        change={afterHoursChange}
        changeTrend={afterHoursTrend}
        className="pl-[68px]"
      />
      {expanded ? (
        <div className="pl-2">
          {lotsSlot}
          {lots.map((item) => (
            <LotRow key={`${item.date}-${item.lot}`} {...item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
