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
/** Figma Label/Overline — compact column headers (10/12, 600). */
const typeOverline = "text-[10px] font-semibold leading-[12px]";

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

function trendClass(trend: DeltaTrend) {
  if (trend === "Down") return "text-[var(--rd-loss)]";
  if (trend === "Up") return "text-[var(--rd-profit)]";
  return "text-[var(--rd-text-secondary)]";
}

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
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Moon className="size-3 shrink-0 text-[var(--rd-warning)]" aria-hidden />
      {showLabel ? <span className={cn(typeMeta, "text-[var(--rd-text-tertiary)]")}>Mimo trhu</span> : null}
      {price ? <span className={cn(typeMicro, "text-[var(--rd-text-primary)]")}>{price}</span> : null}
      {change ? <span className={cn(typeMicro, trendClass(changeTrend))}>{change}</span> : null}
    </div>
  );
}

/** Inline moon + % for Jednoduché (Figma: only when market is closed). */
function AfterHoursInline({
  change,
  changeTrend = "Flat",
}: {
  change?: string;
  changeTrend?: DeltaTrend;
}) {
  if (!change) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <Moon className="size-2.5 shrink-0 text-[var(--rd-warning)]" aria-hidden />
      <span className={cn(typeDataSm, "whitespace-nowrap", trendClass(changeTrend))}>{change}</span>
    </span>
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
  const box = size === "sm" ? "size-3" : "size-4";
  const icon = expanded ? (
    <ChevronDown className={box} />
  ) : (
    <ChevronRight className={box} />
  );
  if (!onToggle) {
    return <span className={cn("inline-flex shrink-0 items-center justify-center", box)} aria-hidden />;
  }
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? "Zbaliť loty" : "Rozbaliť loty"}
      onClick={onToggle}
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-[var(--rd-text-tertiary)]",
        box,
      )}
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
        {pl ? <p className={cn(typeDataSm, "shrink-0", trendClass(plTrend))}>{pl}</p> : null}
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

/** Figma Holding row / Simple — Jednoduché: logo, ticker, ks/priem, hodnota, zisk €/%, AH %. */
export function HoldingRowSimple({
  ticker,
  name,
  value,
  lot,
  plEur,
  plPercent,
  plTrend = "Flat",
  expandable = true,
  expanded = false,
  onToggle,
  onNameClick,
  imageUrl,
  lots = [],
  lotsSlot,
  afterHoursChange,
  afterHoursTrend = "Flat",
  /** @deprecated kept for callers; not shown in Figma Jednoduché */
  assetType: _assetType,
  dayChange: _dayChange,
  dayTrend: _dayTrend,
  pl: legacyPl,
  afterHoursPrice: _afterHoursPrice,
}: {
  ticker: string;
  name: string;
  value: string;
  /** e.g. "16 ks / 132,19 €" */
  lot: string;
  plEur?: string;
  plPercent?: string;
  plTrend?: DeltaTrend;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onNameClick?: () => void;
  imageUrl?: string | null;
  lots?: HoldingLot[];
  lotsSlot?: ReactNode;
  afterHoursChange?: string;
  afterHoursTrend?: DeltaTrend;
  assetType?: string;
  dayChange?: string;
  dayTrend?: DeltaTrend;
  /** Legacy combined string — used only if plEur/plPercent omitted */
  pl?: string;
  afterHoursPrice?: string;
}) {
  const plEurText = plEur ?? legacyPl;
  const plClass = trendClass(plTrend);

  return (
    <div className="flex w-full flex-col gap-1.5 py-2" data-testid={`row-holding-${ticker}`}>
      <div className="flex items-center gap-2">
        <ExpandChevron expanded={expanded} onToggle={expandable ? onToggle : undefined} size="sm" />
        <Avatar ticker={ticker} companyName={name} imageUrl={imageUrl} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
          {onNameClick ? (
            <button
              type="button"
              onClick={onNameClick}
              className={cn(typeName, "truncate text-left text-[var(--rd-text-primary)]")}
              title={name}
            >
              {ticker}
            </button>
          ) : (
            <p className={cn(typeName, "truncate text-[var(--rd-text-primary)]")} title={name}>
              {ticker}
            </p>
          )}
          <p className={cn(typeMeta, "truncate text-[var(--rd-text-tertiary)]")}>{lot}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 overflow-hidden">
          <p className={cn(typeValue, "whitespace-nowrap text-[var(--rd-text-primary)]")}>{value}</p>
          <div className="flex items-center gap-1.5">
            {plEurText ? (
              <p className={cn(typeDataSm, "whitespace-nowrap", plClass)}>{plEurText}</p>
            ) : null}
            {plPercent ? (
              <p className={cn(typeDataSm, "whitespace-nowrap", plClass)}>{plPercent}</p>
            ) : null}
            <AfterHoursInline change={afterHoursChange} changeTrend={afterHoursTrend} />
          </div>
        </div>
      </div>
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

/** Column labels above Kompaktné list (Figma columns-header). */
export function HoldingCompactColumns() {
  return (
    <div className="flex items-center gap-2 pb-1 pl-5">
      <p className={cn(typeOverline, "min-w-0 flex-1 text-[var(--rd-text-tertiary)]")}>Aktívum</p>
      <p className={cn(typeOverline, "w-[62px] shrink-0 text-right text-[var(--rd-text-tertiary)]")}>
        Zisk %
      </p>
      <p className={cn(typeOverline, "w-[78px] shrink-0 text-right text-[var(--rd-text-tertiary)]")}>
        Zisk €
      </p>
      <p className={cn(typeOverline, "w-20 shrink-0 text-right text-[var(--rd-text-tertiary)]")}>
        Hodnota
      </p>
    </div>
  );
}

/** Figma Holding row / Compact — bez loga, 1 riadok: ticker · zisk% · zisk€ · hodnota. */
export function HoldingRowCompact({
  ticker,
  name,
  value,
  plEur,
  plPercent,
  plTrend = "Flat",
  expandable = true,
  expanded = false,
  onToggle,
  onTickerClick,
  lots = [],
  lotsSlot,
}: {
  ticker: string;
  name?: string;
  value: string;
  plEur?: string;
  plPercent?: string;
  plTrend?: DeltaTrend;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onTickerClick?: () => void;
  lots?: HoldingLot[];
  lotsSlot?: ReactNode;
}) {
  const plClass = trendClass(plTrend);

  return (
    <div className="flex w-full flex-col" data-testid={`row-holding-${ticker}`}>
      <div className="flex items-center gap-2 py-1.5">
        <ExpandChevron expanded={expanded} onToggle={expandable ? onToggle : undefined} size="sm" />
        {onTickerClick ? (
          <button
            type="button"
            onClick={onTickerClick}
            className={cn(typeName, "min-w-0 flex-1 truncate text-left text-[var(--rd-text-primary)]")}
            title={name ?? ticker}
          >
            {ticker}
          </button>
        ) : (
          <p
            className={cn(typeName, "min-w-0 flex-1 truncate text-[var(--rd-text-primary)]")}
            title={name ?? ticker}
          >
            {ticker}
          </p>
        )}
        <p className={cn(typeDataSm, "w-[62px] shrink-0 text-right", plClass)}>{plPercent ?? "—"}</p>
        <p className={cn(typeDataSm, "w-[78px] shrink-0 text-right", plClass)}>{plEur ?? "—"}</p>
        <p className={cn(typeValue, "w-20 shrink-0 text-right text-[var(--rd-text-primary)]")}>{value}</p>
      </div>
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
