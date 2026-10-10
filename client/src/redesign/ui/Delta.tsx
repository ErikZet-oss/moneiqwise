import { Moon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DeltaTrend = "Up" | "Down" | "Flat";

const trendClass: Record<DeltaTrend, string> = {
  Up: "bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]",
  Down: "bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]",
  Flat: "bg-[var(--rd-bg-surface-hover)] text-[var(--rd-text-secondary)]",
};

export function Delta({
  value,
  trend = "Flat",
  showMoon = false,
  className,
}: {
  value: string;
  trend?: DeltaTrend;
  /** Mimo RTH — mesiačik vedľa percenta (ako klasický Watchlist / Dashboard). */
  showMoon?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--rd-radius-xs)] px-1.5 py-0.5 text-[11px] font-medium leading-[14px] tabular-nums",
        trendClass[trend],
        className,
      )}
    >
      {showMoon ? (
        <Moon className="size-2.5 shrink-0 text-[var(--rd-warning)]" aria-hidden />
      ) : null}
      {value}
    </span>
  );
}

export function trendFromNumber(value: number): DeltaTrend {
  if (!Number.isFinite(value) || value === 0) return "Flat";
  return value > 0 ? "Up" : "Down";
}
