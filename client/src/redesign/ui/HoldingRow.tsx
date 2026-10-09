import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { Badge, type BadgeTone } from "./Badge";
import { Delta, type DeltaTrend } from "./Delta";

/** Figma Body/Strong — name / ticker (13/18, 600). Explicit px so phone font scaling cannot rem-inflate. */
const typeName = "text-[13px] font-semibold leading-[18px]";
/** Figma Data/Default — position value (13/18, 600). */
const typeValue = "text-[13px] font-semibold leading-[18px] tabular-nums";
/** Figma Body/Small — secondary labels (11/14, 400). */
const typeMeta = "text-[11px] font-normal leading-[14px]";
/** Figma Data/Small — P/L, delta (11/14, 500). */
const typeDataSm = "text-[11px] font-medium leading-[14px] tabular-nums";
/** Figma Data/Micro — lot line, prices (10/12, 500). */
const typeMicro = "text-[10px] font-medium leading-[12px] tabular-nums";

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
      <p className={cn(typeDataSm, "min-w-0 flex-1 text-[var(--rd-text-secondary)]")}>{date}</p>
      <p className={cn(typeDataSm, "shrink-0 text-[var(--rd-text-primary)]")}>{lot}</p>
      <p className={cn(typeDataSm, "shrink-0 text-right", returnClass)}>{returnLabel}</p>
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
      {showLabel ? <span className={cn(typeMeta, "text-[var(--rd-text-tertiary)]")}>Mimo trhu</span> : null}
      {price ? <span className={cn(typeMicro, "text-[var(--rd-text-primary)]")}>{price}</span> : null}
      {change ? <span className={cn(typeMicro, changeClass)}>{change}</span> : null}
    </div>
  );
}

function ExpandChevron({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle?: () => void;
}) {
  const icon = expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />;
  if (!onToggle) {
    return <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden />;
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
    <div className="flex w-full flex-col gap-1.5 py-2">
      <div className="flex min-h-[40px] w-full items-center gap-1.5">
        <Avatar ticker={ticker} companyName={name} imageUrl={imageUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {onTickerClick ? (
              <button type="button" onClick={onTickerClick} className={cn(typeName, "text-[var(--rd-text-primary)]")}>
                {ticker}
              </button>
            ) : (
              <p className={cn(typeName, "text-[var(--rd-text-primary)]")}>{ticker}</p>
            )}
            <p className={cn(typeMeta, "text-[var(--rd-text-tertiary)]")}>{qty}</p>
          </div>
          <p className={cn(typeMeta, "truncate text-[var(--rd-text-secondary)]")}>{name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className={cn(typeValue, "text-[var(--rd-text-primary)]")}>{value}</p>
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
    <div className="flex w-full flex-col gap-1.5 py-2" data-testid={`row-holding-${ticker}`}>
      <div className="flex items-center gap-1.5">
        <ExpandChevron expanded={expanded} onToggle={onToggle} />
        <Avatar ticker={ticker} companyName={name} imageUrl={imageUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {onTickerClick ? (
              <button type="button" onClick={onTickerClick} className={cn(typeName, "text-[var(--rd-text-primary)]")}>
                {ticker}
              </button>
            ) : (
              <p className={cn(typeName, "text-[var(--rd-text-primary)]")}>{ticker}</p>
            )}
            <p className={cn(typeMeta, "text-[var(--rd-text-tertiary)]")}>{qty}</p>
          </div>
          <p className={cn(typeMeta, "truncate text-[var(--rd-text-secondary)]")}>{name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className={cn(typeValue, "text-[var(--rd-text-primary)]")}>{value}</p>
          <Delta value={delta} trend={trend} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-1.5 pl-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {avg ? (
            <span className={cn("inline-flex items-center gap-1", typeMeta, "text-[var(--rd-text-tertiary)]")}>
              Priem <span className={cn(typeMicro, "text-[var(--rd-text-primary)]")}>{avg}</span>
            </span>
          ) : null}
          {price ? (
            <span className={cn("inline-flex items-center gap-1", typeMeta, "text-[var(--rd-text-tertiary)]")}>
              Cena <span className={cn(typeMicro, "text-[var(--rd-text-primary)]")}>{price}</span>
              <AfterHoursLine
                price={afterHoursPrice}
                change={afterHoursChange}
                changeTrend={afterHoursTrend}
                showLabel={false}
              />
            </span>
          ) : null}
        </div>
        {pl ? <p className={cn(typeDataSm, "shrink-0", plClass)}>{pl}</p> : null}
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
    <div className="flex w-full flex-col gap-1.5 py-2" data-testid={`row-holding-${ticker}`}>
      <div className="flex items-center gap-1.5">
        <ExpandChevron expanded={expanded} onToggle={expandable ? onToggle : undefined} />
        <Avatar ticker={ticker} companyName={name} imageUrl={imageUrl} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            {onNameClick ? (
              <button
                type="button"
                onClick={onNameClick}
                className={cn(typeName, "min-w-0 flex-1 truncate text-left text-[var(--rd-text-primary)]")}
              >
                {name}
              </button>
            ) : (
              <p className={cn(typeName, "min-w-0 flex-1 truncate text-[var(--rd-text-primary)]")}>{name}</p>
            )}
            <Badge label={assetType} className="shrink-0" />
            <p className={cn(typeValue, "shrink-0 text-[var(--rd-text-primary)]")}>{value}</p>
          </div>
          <div className="flex items-center gap-1">
            <p className={cn(typeMicro, "min-w-0 flex-1 truncate text-[var(--rd-text-secondary)]")}>{lot}</p>
            {dayChange ? <p className={cn(typeMicro, "shrink-0", dayClass)}>{dayChange}</p> : null}
            {pl ? <p className={cn(typeMicro, "shrink-0 text-right", plClass)}>{pl}</p> : null}
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
