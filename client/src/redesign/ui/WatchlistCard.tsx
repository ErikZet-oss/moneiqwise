import { Calendar, ExternalLink, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { Delta, type DeltaTrend } from "./Delta";

export function WatchlistCard({
  view = "Detailed",
  ticker,
  name,
  price,
  delta,
  trend = "Flat",
  low,
  high,
  position = 0,
  pe,
  dividend,
  earnings,
  onOpen,
  className,
}: {
  view?: "Detailed" | "Compact";
  ticker: string;
  name: string;
  price: string;
  delta: string;
  trend?: DeltaTrend;
  low?: string;
  high?: string;
  /** 0–100 position inside the 52-week range. */
  position?: number;
  pe?: string;
  dividend?: string;
  earnings?: string;
  onOpen?: () => void;
  className?: string;
}) {
  const border =
    trend === "Up"
      ? "border-[var(--rd-profit-dim)]"
      : trend === "Down"
        ? "border-[var(--rd-loss-dim)]"
        : "border-[var(--rd-border-subtle)]";
  const clamped = Math.min(100, Math.max(0, position));
  const marker = `${clamped}%`;

  return (
    <article
      className={cn(
        "flex w-full flex-col gap-2 overflow-hidden rounded-[var(--rd-radius-md)] border bg-[var(--rd-bg-surface)] p-3 [background-image:var(--rd-bg-surface-gradient)]",
        border,
        view === "Compact" && "gap-0 py-2.5",
        className,
      )}
    >
      <div className="flex min-h-[40px] items-center gap-1.5">
        {view === "Detailed" ? (
          <GripVertical className="size-4 shrink-0 text-[var(--rd-text-tertiary)]" aria-hidden />
        ) : null}
        <Avatar ticker={ticker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {onOpen ? (
              <button type="button" onClick={onOpen} className="rd-type-data inline-flex items-center gap-1 text-[var(--rd-text-primary)]">
                {ticker}
                <ExternalLink className="size-2.5 text-[var(--rd-text-tertiary)]" aria-hidden />
              </button>
            ) : (
              <p className="rd-type-data text-[var(--rd-text-primary)]">{ticker}</p>
            )}
          </div>
          <p className="rd-type-body-sm truncate text-[var(--rd-text-secondary)]">{name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <p className={cn(view === "Detailed" ? "rd-type-data-lg" : "rd-type-data", "text-[var(--rd-text-primary)]")}>
            {price}
          </p>
          <Delta value={delta} trend={trend} />
        </div>
      </div>
      {view === "Detailed" ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="rd-type-overline text-[var(--rd-text-tertiary)]">52W</span>
            <span className="rd-type-data-micro text-[var(--rd-text-secondary)]">{low}</span>
            <span className="relative h-1.5 min-w-0 flex-1 rounded-full bg-[var(--rd-bg-surface-hover)]">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: marker,
                  background: trend === "Down" ? "rgba(240,102,126,0.55)" : "rgba(47,218,184,0.55)",
                }}
              />
              <span
                className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-[var(--rd-text-primary)]"
                style={{ left: `calc(${marker} - 3px)` }}
              />
            </span>
            <span className="rd-type-data-micro text-[var(--rd-text-secondary)]">{high}</span>
            <span className="rd-type-data-micro text-[var(--rd-text-primary)]">{Math.round(clamped)}%</span>
          </div>
          <div className="flex items-center gap-2 rd-type-body-sm">
            <span className="text-[var(--rd-text-tertiary)]">
              P/E <span className="rd-type-data-sm text-[var(--rd-text-primary)]">{pe ?? "—"}</span>
            </span>
            <span className="text-[var(--rd-text-tertiary)]">
              Div. <span className="rd-type-data-sm text-[var(--rd-text-primary)]">{dividend ?? "—"}</span>
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-[var(--rd-text-tertiary)]">
              <Calendar className="size-2.5" aria-hidden />
              Earnings <span className="rd-type-data-sm text-[var(--rd-text-primary)]">{earnings ?? "—"}</span>
            </span>
          </div>
        </>
      ) : null}
    </article>
  );
}
