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
        "flex w-full flex-col gap-3 overflow-hidden rounded-[var(--rd-radius-md)] border bg-[var(--rd-bg-surface)] p-3",
        border,
        view === "Compact" && "gap-0 py-3",
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-2">
        {view === "Detailed" ? (
          <GripVertical className="size-5 shrink-0 text-[var(--rd-text-tertiary)]" aria-hidden />
        ) : null}
        <Avatar ticker={ticker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {onOpen ? (
              <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">
                {ticker}
                <ExternalLink className="size-3 text-[var(--rd-text-tertiary)]" aria-hidden />
              </button>
            ) : (
              <p className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">{ticker}</p>
            )}
          </div>
          <p className="truncate text-xs leading-4 text-[var(--rd-text-secondary)]">{name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className={cn("font-mono font-medium text-[var(--rd-text-primary)]", view === "Detailed" ? "text-[17px] leading-6" : "text-sm leading-5")}>
            {price}
          </p>
          <Delta value={delta} trend={trend} />
        </div>
      </div>
      {view === "Detailed" ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-[var(--rd-text-tertiary)]">
              52W
            </span>
            <span className="font-mono text-[10px] leading-3 text-[var(--rd-text-secondary)]">{low}</span>
            <span className="relative h-1.5 min-w-0 flex-1 rounded-full bg-[var(--rd-bg-surface-hover)]">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: marker,
                  background: trend === "Down" ? "rgba(240,102,126,0.55)" : "rgba(47,218,184,0.55)",
                }}
              />
              <span
                className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-[var(--rd-text-primary)]"
                style={{ left: `calc(${marker} - 4px)` }}
              />
            </span>
            <span className="font-mono text-[10px] leading-3 text-[var(--rd-text-secondary)]">{high}</span>
            <span className="font-mono text-[10px] leading-3 text-[var(--rd-text-primary)]">{Math.round(clamped)}%</span>
          </div>
          <div className="flex items-center gap-3 text-xs leading-4">
            <span className="text-[var(--rd-text-tertiary)]">
              P/E <span className="font-mono font-medium text-[var(--rd-text-primary)]">{pe ?? "—"}</span>
            </span>
            <span className="text-[var(--rd-text-tertiary)]">
              Div. <span className="font-mono font-medium text-[var(--rd-text-primary)]">{dividend ?? "—"}</span>
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-[var(--rd-text-tertiary)]">
              <Calendar className="size-3" aria-hidden />
              Earnings <span className="font-mono font-medium text-[var(--rd-text-primary)]">{earnings ?? "—"}</span>
            </span>
          </div>
        </>
      ) : null}
    </article>
  );
}
