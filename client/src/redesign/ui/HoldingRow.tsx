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
    <div className="flex min-h-[32px] w-full items-center gap-1.5 py-1.5">
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

function AfterHoursLine({
  price,
  change,
  changeTrend = "Flat",
  showLabel = true,
  className,
}: {
  price?: string;
  change?: string;
  changeTrend?: DeltaTrend;
  showLabel?: boolean;
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
    <div className={cn("flex items-center gap-1", className)}>
      <Moon className="size-3 shrink-0 text-[var(--rd-warning)]" aria-hidden />
      {showLabel ? <span className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Mimo trhu</span> : null}
      {price ? <span className="rd-type-data-micro text-[var(--rd-text-primary)]">{price}</span> : null}
      {change ? <span className={cn("rd-type-data-micro", changeClass)}>{change}</span> : null}
    </div>
  );
}

function ExpandChevron({
  expanded,
  onToggle,
  size = "md",
}: {
  expanded: boolean;
  onToggle?: () => void;
  size?: "sm" | "md";
}) {
  const icon = expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />;
  if (!onToggle) {
    return <span className={cn("inline-flex shrink-0 items-center justify-center", size === "sm" ? "size-4" : "size-4")} aria-hidden />;
  }
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? "Zbaliť loty" : "Rozbaliť loty"}
      onClick={onToggle}
      className="inline-flex size-4 shrink-0 items-center justify-center text-[var(--rd-text-tertiary)]"
    >
      {icon}
    </button>
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
  imageUrl,
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
  imageUrl?: string | null;
  afterHoursPrice?: string;
  afterHoursChange?: string;
  afterHoursTrend?: DeltaTrend;
}) {
  return (
    <div className="flex w-full flex-col gap-1 py-2">
      <div className="flex min-h-[40px] w-full items-center gap-1.5">
        <Avatar ticker={ticker} companyName={name} imageUrl={imageUrl} />
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
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="rd-type-data text-[var(--rd-text-primary)]">{value}</p>
          <Delta value={delta} trend={trend} />
        </div>
      </div>
      <AfterHoursLine
        price={afterHoursPrice}
        change={afterHoursChange}
        changeTrend={afterHoursTrend}
        className="pl-9"
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
  pl,
  plTrend = "Up",
  expanded = false,
  onToggle,
  onTickerClick,
  imageUrl,
  lots = [],
  lotsSlot,
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
  /** @deprecated day change is not shown on detailed rows in Figma */
  dayChange?: string;
  dayTrend?: DeltaTrend;
  pl?: string;
  plTrend?: DeltaTrend;
  expanded?: boolean;
  onToggle?: () => void;
  onTickerClick?: () => void;
  imageUrl?: string | null;
  lots?: HoldingLot[];
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

  return (
    <div className="flex w-full flex-col gap-1.5 py-2">
      <div className="flex items-center gap-1.5">
        <ExpandChevron expanded={expanded} onToggle={onToggle} />
        <Avatar ticker={ticker} companyName={name} imageUrl={imageUrl} />
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
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="rd-type-data text-[var(--rd-text-primary)]">{value}</p>
          <Delta value={delta} trend={trend} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-1.5 pl-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {avg ? (
            <span className="inline-flex items-center gap-1 rd-type-body-sm text-[var(--rd-text-tertiary)]">
              Priem <span className="rd-type-data-micro text-[var(--rd-text-primary)]">{avg}</span>
            </span>
          ) : null}
          {price ? (
            <span className="inline-flex items-center gap-1 rd-type-body-sm text-[var(--rd-text-tertiary)]">
              Cena <span className="rd-type-data-micro text-[var(--rd-text-primary)]">{price}</span>
              <AfterHoursLine
                price={afterHoursPrice}
                change={afterHoursChange}
                changeTrend={afterHoursTrend}
                showLabel={false}
              />
            </span>
          ) : null}
        </div>
        {pl ? <p className={cn("rd-type-data-sm shrink-0", plClass)}>{pl}</p> : null}
      </div>
      {expanded ? (
        <div className="pl-1.5">
          {lotsSlot}
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
  imageUrl,
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
  imageUrl?: string | null;
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
        <ExpandChevron expanded={expanded} onToggle={expandable ? onToggle : undefined} size="sm" />
        <Avatar ticker={ticker} companyName={name} imageUrl={imageUrl} />
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
      <AfterHoursLine
        price={afterHoursPrice}
        change={afterHoursChange}
        changeTrend={afterHoursTrend}
        className="pl-[68px]"
      />
      {expanded ? (
        <div className="pl-1.5">
          {lotsSlot}
          {lots.map((item) => (
            <LotRow key={`${item.date}-${item.lot}`} {...item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
